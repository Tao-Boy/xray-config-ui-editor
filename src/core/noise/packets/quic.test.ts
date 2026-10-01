import { describe, it, expect } from 'bun:test';
import { concat, cryptoRng, fromHex, toHex } from '../bytes';
import type { Rng } from '../types';
import {
    aesEcbBlock,
    buildQuic,
    deriveClientInitialKeys,
    quicDefaults,
    quicProblems,
    sealInitial,
    type QuicParams,
} from './quic';

// ---------------------------------------------------------------------------
// Test plumbing: a reader for the packets, so a round trip is a real parse
// rather than a re-run of the builder's own arithmetic.
// ---------------------------------------------------------------------------

const bytes = (text: string): Uint8Array => {
    const out = fromHex(text);
    if (!out) throw new Error(`test: not hex: ${text}`);
    return out;
};

const byte = (buffer: Uint8Array, at: number): number => buffer[at] ?? 0;
/** WebCrypto's typings want a view over a plain ArrayBuffer; see quic.ts. */
const forCrypto = (buffer: Uint8Array): Uint8Array<ArrayBuffer> => Uint8Array.from(buffer);
const u16 = (buffer: Uint8Array, at: number): number => (byte(buffer, at) << 8) | byte(buffer, at + 1);
const text = (buffer: Uint8Array): string => new TextDecoder().decode(buffer);

/** RFC 9000 s16: the first byte's top two bits are log2 of the width. */
const readVarint = (buffer: Uint8Array, at: number): { value: number; width: number } => {
    const width = 1 << (byte(buffer, at) >> 6);
    let value = byte(buffer, at) & 0x3f;
    for (let step = 1; step < width; step++) value = value * 0x100 + byte(buffer, at + step);
    return { value, width };
};

const parseLongHeader = (packet: Uint8Array) => {
    let at = 1;
    const version = toHex(packet.slice(at, at + 4));
    at += 4;
    const dcidLength = byte(packet, at++);
    const dcid = packet.slice(at, at + dcidLength);
    at += dcidLength;
    const scidLength = byte(packet, at++);
    const scid = packet.slice(at, at + scidLength);
    at += scidLength;
    const tokenLength = readVarint(packet, at);
    at += tokenLength.width;
    const token = packet.slice(at, at + tokenLength.value);
    at += tokenLength.value;
    const length = readVarint(packet, at);
    at += length.width;
    return { firstByte: byte(packet, 0), version, dcid, scid, token, length: length.value, pnOffset: at };
};

/**
 * Undo header protection and open the AEAD — the receiver's half of RFC 9001
 * section 5. The GCM tag only verifies if the header we rebuild is byte for
 * byte the one the sender authenticated, so a successful decrypt is itself the
 * proof that the packet is well-formed and not merely well-shaped.
 */
const openInitial = async (packet: Uint8Array, dcid: Uint8Array) => {
    const head = parseLongHeader(packet);
    const keys = await deriveClientInitialKeys(dcid);

    const sample = packet.slice(head.pnOffset + 4, head.pnOffset + 20);
    const mask = await aesEcbBlock(keys.hp, sample);
    const firstByte = head.firstByte ^ (byte(mask, 0) & 0x0f);
    const pnLength = (firstByte & 0x03) + 1;

    const pn = new Uint8Array(pnLength);
    let packetNumber = 0;
    for (let step = 0; step < pnLength; step++) {
        pn[step] = byte(packet, head.pnOffset + step) ^ byte(mask, 1 + step);
        packetNumber = packetNumber * 0x100 + byte(pn, step);
    }

    const header = concat(Uint8Array.from([firstByte]), packet.slice(1, head.pnOffset), pn);
    const ciphertext = packet.slice(head.pnOffset + pnLength, head.pnOffset + head.length);
    const nonce = keys.iv.slice();
    for (let at = nonce.length - 1, rest = packetNumber; at >= 0; at--, rest = Math.floor(rest / 0x100)) {
        nonce[at] = byte(nonce, at) ^ (rest & 0xff);
    }

    const aead = await globalThis.crypto.subtle.importKey(
        'raw', forCrypto(keys.key), 'AES-GCM', false, ['decrypt'],
    );
    const plaintext = new Uint8Array(await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: forCrypto(nonce), additionalData: forCrypto(header), tagLength: 128 },
        aead, forCrypto(ciphertext),
    ));
    return { ...head, firstByte, pnLength, packetNumber, header, sample, mask, plaintext };
};

/** RFC 9000 s19.6. */
const parseCryptoFrame = (plaintext: Uint8Array) => {
    const type = byte(plaintext, 0);
    const offset = readVarint(plaintext, 1);
    const length = readVarint(plaintext, 1 + offset.width);
    const start = 1 + offset.width + length.width;
    return { type, offset: offset.value, data: plaintext.slice(start, start + length.value), end: start + length.value };
};

const parseClientHello = (hello: Uint8Array) => {
    let at = 4; // handshake msg_type + uint24 length
    const legacyVersion = toHex(hello.slice(at, at + 2));
    at += 2;
    const random = hello.slice(at, at + 32);
    at += 32;
    const sessionIdLength = byte(hello, at++);
    const sessionId = hello.slice(at, at + sessionIdLength);
    at += sessionIdLength;
    const suitesLength = u16(hello, at);
    at += 2;
    const cipherSuites: number[] = [];
    for (let step = 0; step < suitesLength; step += 2) cipherSuites.push(u16(hello, at + step));
    at += suitesLength;
    const compressionLength = byte(hello, at++);
    const compression = hello.slice(at, at + compressionLength);
    at += compressionLength;
    const extensionsLength = u16(hello, at);
    at += 2;

    const extensions = new Map<number, Uint8Array>();
    const extensionsEnd = at + extensionsLength;
    while (at < extensionsEnd) {
        const type = u16(hello, at);
        const size = u16(hello, at + 2);
        extensions.set(type, hello.slice(at + 4, at + 4 + size));
        at += 4 + size;
    }
    return {
        msgType: byte(hello, 0),
        declaredLength: (byte(hello, 1) << 16) | u16(hello, 2),
        legacyVersion, random, sessionId, cipherSuites, compression, extensions, end: at,
    };
};

/** RFC 6066 s3: list length, then entry type 0 and the name as a 2-byte vector. */
const sniOf = (body: Uint8Array): string => text(body.slice(5, 5 + u16(body, 3)));

/** RFC 7301 s3.1: list length, then each id as a 1-byte vector. */
const alpnOf = (body: Uint8Array): string[] => {
    const out: string[] = [];
    for (let at = 2; at < body.length;) {
        const size = byte(body, at++);
        out.push(text(body.slice(at, at + size)));
        at += size;
    }
    return out;
};

/** RFC 9000 s18: varint id, varint length, value. */
const transportParametersOf = (body: Uint8Array): Map<number, Uint8Array> => {
    const out = new Map<number, Uint8Array>();
    for (let at = 0; at < body.length;) {
        const id = readVarint(body, at);
        at += id.width;
        const size = readVarint(body, at);
        at += size.width;
        out.set(id.value, body.slice(at, at + size.value));
        at += size.value;
    }
    return out;
};

/** xorshift32 — a seed makes a build reproducible, which `cryptoRng` cannot. */
const seededRng = (seed: number): Rng => {
    let state = seed >>> 0 || 1;
    return length => {
        const out = new Uint8Array(length);
        for (let at = 0; at < length; at++) {
            state = (state ^ (state << 13)) >>> 0;
            state = state ^ (state >>> 17);
            state = (state ^ (state << 5)) >>> 0;
            out[at] = state & 0xff;
        }
        return out;
    };
};

// ---------------------------------------------------------------------------
// RFC 9001 Appendix A — the published vectors
// ---------------------------------------------------------------------------

const A2_DCID = '8394c8f03e515708';

/** Appendix A.2's CRYPTO frame, zero-padded by the test to its 1162-byte payload. */
const A2_CRYPTO_FRAME =
    '060040f1010000ed0303ebf8fa56f12939b9584a3896472ec40bb863cfd3e868' +
    '04fe3a47f06a2b69484c00000413011302010000c000000010000e00000b6578' +
    '616d706c652e636f6dff01000100000a00080006001d00170018001000070005' +
    '04616c706e000500050100000000003300260024001d00209370b2c9caa47fba' +
    'baf4559fedba753de171fa71f50f1ce15d43e994ec74d748002b000302030400' +
    '0d0010000e0403050306030203080408050806002d00020101001c0002400100' +
    '3900320408ffffffffffffffff05048000ffff07048000ffff08011001048000' +
    '75300901100f088394c8f03e51570806048000ffff';

const A2_PACKET =
    'c000000001088394c8f03e5157080000449e7b9aec34d1b1c98dd7689fb8ec11' +
    'd242b123dc9bd8bab936b47d92ec356c0bab7df5976d27cd449f63300099f399' +
    '1c260ec4c60d17b31f8429157bb35a1282a643a8d2262cad67500cadb8e7378c' +
    '8eb7539ec4d4905fed1bee1fc8aafba17c750e2c7ace01e6005f80fcb7df6212' +
    '30c83711b39343fa028cea7f7fb5ff89eac2308249a02252155e2347b63d58c5' +
    '457afd84d05dfffdb20392844ae812154682e9cf012f9021a6f0be17ddd0c208' +
    '4dce25ff9b06cde535d0f920a2db1bf362c23e596d11a4f5a6cf3948838a3aec' +
    '4e15daf8500a6ef69ec4e3feb6b1d98e610ac8b7ec3faf6ad760b7bad1db4ba3' +
    '485e8a94dc250ae3fdb41ed15fb6a8e5eba0fc3dd60bc8e30c5c4287e53805db' +
    '059ae0648db2f64264ed5e39be2e20d82df566da8dd5998ccabdae053060ae6c' +
    '7b4378e846d29f37ed7b4ea9ec5d82e7961b7f25a9323851f681d582363aa5f8' +
    '9937f5a67258bf63ad6f1a0b1d96dbd4faddfcefc5266ba6611722395c906556' +
    'be52afe3f565636ad1b17d508b73d8743eeb524be22b3dcbc2c7468d54119c74' +
    '68449a13d8e3b95811a198f3491de3e7fe942b330407abf82a4ed7c1b311663a' +
    'c69890f4157015853d91e923037c227a33cdd5ec281ca3f79c44546b9d90ca00' +
    'f064c99e3dd97911d39fe9c5d0b23a229a234cb36186c4819e8b9c5927726632' +
    '291d6a418211cc2962e20fe47feb3edf330f2c603a9d48c0fcb5699dbfe58964' +
    '25c5bac4aee82e57a85aaf4e2513e4f05796b07ba2ee47d80506f8d2c25e50fd' +
    '14de71e6c418559302f939b0e1abd576f279c4b2e0feb85c1f28ff18f58891ff' +
    'ef132eef2fa09346aee33c28eb130ff28f5b766953334113211996d20011a198' +
    'e3fc433f9f2541010ae17c1bf202580f6047472fb36857fe843b19f5984009dd' +
    'c324044e847a4f4a0ab34f719595de37252d6235365e9b84392b061085349d73' +
    '203a4a13e96f5432ec0fd4a1ee65accdd5e3904df54c1da510b0ff20dcc0c77f' +
    'cb2c0e0eb605cb0504db87632cf3d8b4dae6e705769d1de354270123cb11450e' +
    'fc60ac47683d7b8d0f811365565fd98c4c8eb936bcab8d069fc33bd801b03ade' +
    'a2e1fbc5aa463d08ca19896d2bf59a071b851e6c239052172f296bfb5e724047' +
    '90a2181014f3b94a4e97d117b438130368cc39dbb2d198065ae3986547926cd2' +
    '162f40a29f0c3c8745c0f50fba3852e566d44575c29d39a03f0cda721984b6f4' +
    '40591f355e12d439ff150aab7613499dbd49adabc8676eef023b15b65bfc5ca0' +
    '6948109f23f350db82123535eb8a7433bdabcb909271a6ecbcb58b936a88cd4e' +
    '8f2e6ff5800175f113253d8fa9ca8885c2f552e657dc603f252e1a8e308f76f0' +
    'be79e2fb8f5d5fbbe2e30ecadd220723c8c0aea8078cdfcb3868263ff8f09400' +
    '54da48781893a7e49ad5aff4af300cd804a6b6279ab3ff3afb64491c85194aab' +
    '760d58a606654f9f4400e8b38591356fbf6425aca26dc85244259ff2b19c41b9' +
    'f96f3ca9ec1dde434da7d2d392b905ddf3d1f9af93d1af5950bd493f5aa731b4' +
    '056df31bd267b6b90a079831aaf579be0a39013137aac6d404f518cfd4684064' +
    '7e78bfe706ca4cf5e9c5453e9f7cfd2b8b4c8d169a44e55c88d4a9a7f9474241' +
    'e221af44860018ab0856972e194cd934';

describe('RFC 9001 A.1 — initial key derivation', () => {
    it('reproduces every published secret and key for DCID 0x8394c8f03e515708', async () => {
        const keys = await deriveClientInitialKeys(bytes(A2_DCID));
        expect(toHex(keys.initialSecret))
            .toBe('7db5df06e7a69e432496adedb00851923595221596ae2ae9fb8115c1e9ed0a44');
        expect(toHex(keys.secret))
            .toBe('c00cf151ca5be075ed0ebfb5c80323c42d6b7db67881289af4008f1f6c357aea');
        expect(toHex(keys.key)).toBe('1f369613dd76d5467730efcbe3b1a22d');
        expect(toHex(keys.iv)).toBe('fa044b2f42a3fd3b46fb255c');
        expect(toHex(keys.hp)).toBe('9f50449e04a0e810283a1e9933adedd2');
    });
});

describe('AES-ECB out of WebCrypto, which has no ECB mode', () => {
    it('matches the FIPS-197 C.1 AES-128 single-block answer', async () => {
        const block = await aesEcbBlock(
            bytes('000102030405060708090a0b0c0d0e0f'),
            bytes('00112233445566778899aabbccddeeff'),
        );
        expect(toHex(block)).toBe('69c4e0d86a7b0430d8cdb78070b4c55a');
    });

    it('turns A.2’s sample into A.2’s mask, which is the equivalence that matters', async () => {
        const block = await aesEcbBlock(
            bytes('9f50449e04a0e810283a1e9933adedd2'),
            bytes('d1b1c98dd7689fb8ec11d242b123dc9b'),
        );
        expect(toHex(block.slice(0, 5))).toBe('437b9aec36');
    });
});

describe('RFC 9001 A.2 — the client Initial packet, byte for byte', () => {
    // "the following CRYPTO frame, plus enough PADDING frames to make a
    // 1162-byte payload" — PADDING is a zero byte, so a zeroed buffer is it.
    const payload = new Uint8Array(1162);
    payload.set(bytes(A2_CRYPTO_FRAME), 0);

    const packet = sealInitial({
        dcid: bytes(A2_DCID),
        scid: new Uint8Array(0),
        token: new Uint8Array(0),
        packetNumber: 2,
        payload,
    });

    it('declares the length the RFC does and protects the header to its bytes', async () => {
        const sealed = await packet;
        // 1182 = 4-byte packet number + 1162 bytes of frames + 16-byte tag.
        expect(toHex(sealed.slice(0, 22))).toBe('c000000001088394c8f03e5157080000449e7b9aec34');
    });

    it('samples and masks exactly what the RFC lists', async () => {
        const opened = await openInitial(await packet, bytes(A2_DCID));
        expect(toHex(opened.sample)).toBe('d1b1c98dd7689fb8ec11d242b123dc9b');
        expect(toHex(opened.mask.slice(0, 5))).toBe('437b9aec36');
        // The header the RFC prints before protection is applied.
        expect(toHex(opened.header)).toBe('c300000001088394c8f03e5157080000449e00000002');
        expect(opened.packetNumber).toBe(2);
        expect(opened.length).toBe(1182);
    });

    it('is the published 1200-byte protected packet', async () => {
        const sealed = await packet;
        expect(sealed.length).toBe(1200);
        expect(toHex(sealed)).toBe(A2_PACKET);
    });
});

// ---------------------------------------------------------------------------
// buildQuic
// ---------------------------------------------------------------------------

const params: QuicParams = {
    serverName: 'www.cloudflare.com',
    alpn: ['h3'],
    dcidHex: '0011223344556677',
    scidHex: 'aabbccdd',
    size: 1232,
};

describe('buildQuic — round-tripped through a receiver', () => {
    it('decrypts, and the plaintext is a CRYPTO frame carrying the SNI we asked for', async () => {
        const packet = await buildQuic(params, seededRng(7));
        const opened = await openInitial(packet, bytes(params.dcidHex));

        // Long header, version 1, Initial, and the connection ids we handed in.
        expect(opened.firstByte & 0xf0).toBe(0xc0);
        expect(opened.version).toBe('00000001');
        expect(toHex(opened.dcid)).toBe(params.dcidHex);
        expect(toHex(opened.scid)).toBe(params.scidHex);
        expect(opened.token.length).toBe(0);
        expect(opened.packetNumber).toBe(0);
        // RFC 9000 s17.2.2: Length covers the packet number, payload and tag.
        expect(opened.pnOffset + opened.length).toBe(packet.length);

        const frame = parseCryptoFrame(opened.plaintext);
        expect(frame.type).toBe(0x06);
        expect(frame.offset).toBe(0);
        // Everything after the frame is PADDING, which is a run of zero bytes.
        expect(opened.plaintext.slice(frame.end).every(value => value === 0)).toBe(true);
        expect(opened.plaintext.length).toBeGreaterThan(frame.end);

        const hello = parseClientHello(frame.data);
        expect(hello.msgType).toBe(0x01);
        expect(hello.declaredLength).toBe(frame.data.length - 4);
        expect(hello.end).toBe(frame.data.length);
        expect(hello.legacyVersion).toBe('0303');
        expect(hello.random.length).toBe(32);
        expect(hello.cipherSuites).toEqual([0x1301, 0x1302, 0x1303]);
        expect(toHex(hello.compression)).toBe('00');
        // RFC 9001 s8.4: QUIC forbids TLS middlebox compatibility mode, so the
        // session id is empty here — not the 32 bytes a TCP ClientHello sends.
        expect(hello.sessionId.length).toBe(0);

        const sni = hello.extensions.get(0x0000);
        expect(sni).toBeDefined();
        expect(sniOf(sni ?? new Uint8Array(0))).toBe('www.cloudflare.com');
    });

    it('carries every extension QUIC and TLS 1.3 require', async () => {
        const packet = await buildQuic(params, seededRng(11));
        const opened = await openInitial(packet, bytes(params.dcidHex));
        const hello = parseClientHello(parseCryptoFrame(opened.plaintext).data);

        expect([...hello.extensions.keys()].sort((a, b) => a - b))
            .toEqual([0x0000, 0x000a, 0x000d, 0x0010, 0x002b, 0x0033, 0x0039]);

        // supported_versions says TLS 1.3 and nothing else.
        expect(toHex(hello.extensions.get(0x002b) ?? new Uint8Array(0))).toBe('020304');
        // key_share offers one x25519 (group 0x001d) share of 32 bytes.
        expect(toHex((hello.extensions.get(0x0033) ?? new Uint8Array(0)).slice(0, 6))).toBe('0024001d0020');
        // supported_groups leads with x25519.
        expect(u16(hello.extensions.get(0x000a) ?? new Uint8Array(0), 2)).toBe(0x001d);
        expect((hello.extensions.get(0x000d) ?? new Uint8Array(0)).length).toBeGreaterThan(2);
        expect(alpnOf(hello.extensions.get(0x0010) ?? new Uint8Array(0))).toEqual(['h3']);

        // RFC 9000 s18.2: initial_source_connection_id must be this packet's SCID.
        const quicParams = transportParametersOf(hello.extensions.get(0x0039) ?? new Uint8Array(0));
        expect(toHex(quicParams.get(0x0f) ?? new Uint8Array(0))).toBe(params.scidHex);
        expect(quicParams.has(0x04)).toBe(true);
    });

    it('honours multiple ALPN ids and an empty SCID', async () => {
        const withoutScid: QuicParams = { ...params, scidHex: '', alpn: ['h3', 'h3-29'] };
        const packet = await buildQuic(withoutScid, seededRng(3));
        const opened = await openInitial(packet, bytes(withoutScid.dcidHex));
        expect(opened.scid.length).toBe(0);
        const hello = parseClientHello(parseCryptoFrame(opened.plaintext).data);
        expect(alpnOf(hello.extensions.get(0x0010) ?? new Uint8Array(0))).toEqual(['h3', 'h3-29']);
        const quicParams = transportParametersOf(hello.extensions.get(0x0039) ?? new Uint8Array(0));
        expect((quicParams.get(0x0f) ?? new Uint8Array(1)).length).toBe(0);
    });
});

describe('buildQuic — size and randomness', () => {
    // 20000 is past 16383, so the header's Length needs a 4-byte varint and the
    // solver in `payloadRoom` has to notice that the room shrank by two bytes.
    for (const size of [1200, 1232, 1350, 1500, 4096, 20000]) {
        it(`fills a ${size}-byte datagram exactly`, async () => {
            const packet = await buildQuic({ ...params, size }, cryptoRng);
            expect(packet.length).toBe(size);
            // And it still opens, so the Length varint agreed at this width too.
            await expect(openInitial(packet, bytes(params.dcidHex))).resolves.toBeDefined();
        });
    }

    it('gives different bytes for different randomness, same bytes for the same seed', async () => {
        const first = await buildQuic(params, seededRng(1));
        const second = await buildQuic(params, seededRng(2));
        const again = await buildQuic(params, seededRng(1));
        expect(toHex(first)).not.toBe(toHex(second));
        expect(toHex(first)).toBe(toHex(again));
        expect(first.length).toBe(second.length);
    });

    it('builds from quicDefaults with nothing to complain about', async () => {
        const defaults = quicDefaults(cryptoRng);
        expect(quicProblems(defaults)).toEqual([]);
        expect(defaults.size).toBe(1232);
        expect(defaults.alpn).toEqual(['h3']);
        expect(bytes(defaults.dcidHex).length).toBe(8);
        const packet = await buildQuic(defaults, cryptoRng);
        expect(packet.length).toBe(1232);
        await expect(openInitial(packet, bytes(defaults.dcidHex))).resolves.toBeDefined();
    });
});

describe('quicProblems', () => {
    const messages = (overrides: Partial<QuicParams>): string[] =>
        quicProblems({ ...params, ...overrides }).map(note => `${note.severity}: ${note.message}`);

    it('is quiet about sane params', () => {
        expect(quicProblems(params)).toEqual([]);
    });

    it('calls a datagram under 1200 bytes critical', () => {
        const notes = quicProblems({ ...params, size: 1199 });
        expect(notes.some(note => note.severity === 'critical' && note.message.includes('1200'))).toBe(true);
    });

    it('rejects connection ids that are not hex or are over 20 bytes', () => {
        expect(messages({ dcidHex: 'nothex!!' }).join()).toContain('critical');
        expect(messages({ dcidHex: '00'.repeat(21) }).join()).toContain('at most 20');
        expect(messages({ scidHex: '00'.repeat(21) }).join()).toContain('Source Connection ID');
    });

    it('warns about a short DCID without blocking it', async () => {
        const short: QuicParams = { ...params, dcidHex: '00112233' };
        const notes = quicProblems(short);
        expect(notes.every(note => note.severity === 'warning')).toBe(true);
        expect(notes[0]?.message).toContain('at least 8');
        // It is out of spec, not unbuildable.
        expect((await buildQuic(short, cryptoRng)).length).toBe(short.size);
    });

    it('insists on an SNI and on ALPN', () => {
        expect(messages({ serverName: '' }).join()).toContain('host name');
        expect(messages({ alpn: [] }).join()).toContain('ALPN');
        expect(messages({ alpn: [''] }).join()).toContain('empty');
        expect(messages({ serverName: 'not a host name' }).join()).toContain('warning');
    });

    it('catches a ClientHello that cannot fit, instead of letting the build throw', async () => {
        const huge: QuicParams = { ...params, serverName: `${'a'.repeat(1200)}.example.com`, size: 1200 };
        expect(messages(huge).join()).toContain('needs');
        await expect(buildQuic(huge, cryptoRng)).rejects.toThrow(/no room/);
    });
});
