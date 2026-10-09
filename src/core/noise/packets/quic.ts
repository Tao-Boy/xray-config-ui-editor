/**
 * A QUIC v1 client Initial datagram, built properly: a real TLS 1.3
 * ClientHello in a CRYPTO frame, AEAD-sealed and header-protected exactly as
 * RFC 9001 section 5 prescribes.
 *
 * Why go to the trouble for a decoy. The noise layer sends these ahead of a
 * WireGuard handshake so the first thing a path sees looks like a browser
 * opening an HTTP/3 connection. A DPI box that actually parses QUIC — and the
 * ones worth hiding from do — will drop a datagram whose Length field
 * disagrees with its payload, or whose AEAD tag cannot be checked against the
 * initial keys, which anybody can derive from the Destination Connection ID.
 * So "looks roughly like QUIC" is not enough: the packet has to be the real
 * thing, which is cheap here because every input is public.
 *
 * Nothing in this module is a secret. The initial keys come from the DCID that
 * travels in the clear, so this encryption buys obfuscation, never privacy.
 *
 * Every crypto step cites its section of RFC 9001 (QUIC-TLS) or RFC 9000
 * (QUIC transport); `quic.test.ts` pins the derivation and the finished packet
 * against the published Appendix A.1/A.2 vectors.
 */

import { t } from '../../../i18n';
import type { Note, Rng } from '../types';
import { concat, fromHex, toHex, utf8 } from '../bytes';

export interface QuicParams {
    /** SNI sent in the ClientHello, e.g. "www.cloudflare.com". */
    serverName: string;
    /** ALPN protocol ids, e.g. ["h3"]. */
    alpn: string[];
    /** Destination Connection ID, hex. 8 bytes is typical. */
    dcidHex: string;
    /** Source Connection ID, hex. May be empty. */
    scidHex: string;
    /** Total datagram size in bytes. Must be >= 1200 per RFC 9000 s14.1. */
    size: number;
}

/** RFC 9000 s14.1 — a client MUST expand an Initial datagram to at least this. */
const MIN_DATAGRAM = 1200;
/** A UDP payload cannot exceed this, so neither can the datagram. */
const MAX_DATAGRAM = 65527;
/** RFC 9000 s17.2 — a version 1 connection id is 0 to 20 bytes. */
const MAX_CID = 20;
/** RFC 9000 s7.2 — a client's first DCID MUST carry at least this much entropy. */
const MIN_FIRST_DCID = 8;

/**
 * We always use the 4-byte packet number encoding. It is what the RFC's own
 * sample uses, and it makes the header protection sample start right at the
 * ciphertext (s5.4.2 samples from the packet number offset + 4 regardless).
 */
const PN_LENGTH = 4;

/** The AES-128-GCM authentication tag RFC 9001 s5.3 appends to every payload. */
const TAG_LENGTH = 16;

const hex = (text: string): Uint8Array => {
    const bytes = fromHex(text);
    if (!bytes) throw new Error(t("quic: not hex: {value1}", { value1: String(text) }));
    return bytes;
};

/** Read a byte; out of range reads are genuinely absent, not zero-by-accident. */
const byte = (bytes: Uint8Array, at: number): number => bytes[at] ?? 0;

/**
 * WebCrypto's typings want a view over a plain ArrayBuffer, while `concat` and
 * `fromHex` only promise the looser ArrayBufferLike. Copy at the boundary
 * rather than casting — it is a few hundred bytes per call, and it keeps every
 * crypto step below readable.
 */
const forCrypto = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => Uint8Array.from(bytes);

const u8 = (...values: number[]): Uint8Array => Uint8Array.from(values);
const u16 = (value: number): Uint8Array => u8((value >> 8) & 0xff, value & 0xff);
const u24 = (value: number): Uint8Array => u8((value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff);

/** A TLS vector — its body behind a length prefix of 1, 2 or 3 bytes. */
const vec8 = (body: Uint8Array): Uint8Array => concat(u8(body.length), body);
const vec16 = (body: Uint8Array): Uint8Array => concat(u16(body.length), body);
const vec24 = (body: Uint8Array): Uint8Array => concat(u24(body.length), body);

/** A TLS extension — 2-byte type, then the body as a 2-byte vector. */
const extension = (type: number, body: Uint8Array): Uint8Array => concat(u16(type), vec16(body));

// ---------------------------------------------------------------------------
// RFC 9000 s16 — variable-length integers
// ---------------------------------------------------------------------------

/**
 * The two top bits of a varint's first byte say how wide it is. We only ever
 * emit the minimal width: a longer encoding is legal but nothing sends one,
 * and a decoy that does would stand out.
 */
const varintWidth = (value: number): 1 | 2 | 4 | 8 =>
    value <= 0x3f ? 1 : value <= 0x3fff ? 2 : value <= 0x3fffffff ? 4 : 8;

const varint = (value: number): Uint8Array => {
    const width = varintWidth(value);
    const prefix = width === 1 ? 0x00 : width === 2 ? 0x40 : width === 4 ? 0x80 : 0xc0;
    const out = new Uint8Array(width);
    let rest = value;
    // Fill from the back; whatever is left over is the (partial) first byte.
    for (let at = width - 1; at > 0; at--) {
        out[at] = rest & 0xff;
        rest = Math.floor(rest / 0x100);
    }
    out[0] = prefix | (rest & 0x3f);
    return out;
};

// ---------------------------------------------------------------------------
// RFC 9001 s5.2 — initial keys
// ---------------------------------------------------------------------------

/**
 * The version 1 initial salt (RFC 9001 s5.2). It is a published constant, not
 * a secret: it exists so both ends derive the same keys from the DCID alone.
 */
const INITIAL_SALT = hex('38762cf7f55934b34d179ae6a4c80cadccbb7f0a');

const hmacSha256 = async (key: Uint8Array, data: Uint8Array): Promise<Uint8Array> => {
    const handle = await globalThis.crypto.subtle.importKey(
        'raw', forCrypto(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    return new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', handle, forCrypto(data)));
};

/**
 * HKDF-Extract and HKDF-Expand (RFC 5869) spelled out over HMAC rather than
 * taken from WebCrypto's "HKDF" algorithm, because that one only offers
 * extract-then-expand as a single step. QUIC extracts once and then expands
 * the result four times with different labels, so the two halves have to be
 * reachable separately.
 */
const hkdfExtract = (salt: Uint8Array, ikm: Uint8Array): Promise<Uint8Array> => hmacSha256(salt, ikm);

const hkdfExpand = async (prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> => {
    const out = new Uint8Array(length);
    let block: Uint8Array = new Uint8Array(0);
    for (let at = 0, counter = 1; at < length; at += 32, counter++) {
        block = await hmacSha256(prk, concat(block, info, u8(counter)));
        out.set(block.subarray(0, Math.min(32, length - at)), at);
    }
    return out;
};

/**
 * HKDF-Expand-Label from TLS 1.3 (RFC 8446 s7.1), which QUIC reuses verbatim.
 * The info block is the struct HkdfLabel: the output length, then "tls13 "
 * prepended to the label as a 1-byte vector, then an empty context vector —
 * QUIC never passes a context.
 */
const expandLabel = (prk: Uint8Array, label: string, length: number): Promise<Uint8Array> => {
    const prefixed = utf8(`tls13 ${label}`);
    return hkdfExpand(prk, concat(u16(length), vec8(prefixed), vec8(new Uint8Array(0))), length);
};

export interface InitialKeys {
    /** initial_secret = HKDF-Extract(initial_salt, DCID). */
    initialSecret: Uint8Array;
    /** client_initial_secret, 32 bytes. */
    secret: Uint8Array;
    /** AES-128-GCM key, 16 bytes. */
    key: Uint8Array;
    /** Nonce base the packet number is xor'd into, 12 bytes. */
    iv: Uint8Array;
    /** Header protection key, 16 bytes. */
    hp: Uint8Array;
}

/**
 * The client's Initial keys, derived from the DCID exactly as RFC 9001 s5.2
 * pseudocode does. Exported so the test can hold it against the published
 * Appendix A.1 values — if this drifts, nothing else in the file matters.
 */
export const deriveClientInitialKeys = async (dcid: Uint8Array): Promise<InitialKeys> => {
    const initialSecret = await hkdfExtract(INITIAL_SALT, dcid);
    const secret = await expandLabel(initialSecret, 'client in', 32);
    return {
        initialSecret,
        secret,
        key: await expandLabel(secret, 'quic key', 16),
        iv: await expandLabel(secret, 'quic iv', 12),
        hp: await expandLabel(secret, 'quic hp', 16),
    };
};

// ---------------------------------------------------------------------------
// RFC 9001 s5.4 — header protection
// ---------------------------------------------------------------------------

/**
 * One block of AES-ECB, which is what RFC 9001 s5.4.3 asks for over the
 * sample. WebCrypto has no ECB mode — but AES-CTR with the sample as the full
 * 16-byte counter block produces exactly one keystream block, E(hp, sample),
 * and xoring that over 16 zero bytes hands it back untouched. Same primitive,
 * same output; no counter ever increments because we ask for a single block.
 * `quic.test.ts` pins this against both FIPS-197 C.1 and the RFC's own mask.
 */
export const aesEcbBlock = async (key: Uint8Array, block: Uint8Array): Promise<Uint8Array> => {
    const handle = await globalThis.crypto.subtle.importKey('raw', forCrypto(key), 'AES-CTR', false, ['encrypt']);
    const out = await globalThis.crypto.subtle.encrypt(
        { name: 'AES-CTR', counter: forCrypto(block), length: 128 }, handle, new Uint8Array(16),
    );
    return new Uint8Array(out);
};

// ---------------------------------------------------------------------------
// The packet
// ---------------------------------------------------------------------------

export interface InitialParts {
    dcid: Uint8Array;
    scid: Uint8Array;
    /** Address validation token; a client's first Initial has none. */
    token: Uint8Array;
    packetNumber: number;
    /** The frame payload, already padded to its final length. */
    payload: Uint8Array;
}

/**
 * Wrap a finished payload in a long header, seal it and protect the header.
 * Split out from `buildQuic` because this is the half the RFC publishes a
 * vector for: hand it Appendix A.2's payload and packet number and it must
 * reproduce A.2's packet byte for byte.
 */
export const sealInitial = async (parts: InitialParts): Promise<Uint8Array> => {
    const { dcid, scid, token, packetNumber, payload } = parts;
    const keys = await deriveClientInitialKeys(dcid);

    // RFC 9000 s17.2: first byte is header form 1, fixed bit 1, long packet
    // type 00 (Initial), two reserved bits 0, then the packet number length
    // minus one. Then the version, and each connection id behind its own
    // 1-byte length — connection ids are not varints.
    const prefix = concat(
        u8(0xc0 | (PN_LENGTH - 1)),
        u8(0x00, 0x00, 0x00, 0x01),
        vec8(dcid),
        vec8(scid),
        varint(token.length),
        token,
    );

    // RFC 9000 s17.2.2: Length counts the packet number field plus the
    // protected payload — and the AEAD makes that payload 16 bytes longer
    // than the plaintext.
    const length = varint(PN_LENGTH + payload.length + TAG_LENGTH);
    const pnOffset = prefix.length + length.length;

    const pn = new Uint8Array(PN_LENGTH);
    for (let at = PN_LENGTH - 1, rest = packetNumber; at >= 0; at--, rest = Math.floor(rest / 0x100)) {
        pn[at] = rest & 0xff;
    }

    // RFC 9001 s5.3: the nonce is the 12-byte iv xor'd with the *full* packet
    // number, left-padded to the iv's length — not with the truncated field
    // that goes on the wire. The AAD is the whole header up to and including
    // the packet number, which is still unprotected at this point.
    const header = concat(prefix, length, pn);
    const nonce = keys.iv.slice();
    for (let at = nonce.length - 1, rest = packetNumber; at >= 0; at--, rest = Math.floor(rest / 0x100)) {
        nonce[at] = byte(nonce, at) ^ (rest & 0xff);
    }

    const aead = await globalThis.crypto.subtle.importKey('raw', forCrypto(keys.key), 'AES-GCM', false, ['encrypt']);
    const sealed = new Uint8Array(await globalThis.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: forCrypto(nonce), additionalData: forCrypto(header), tagLength: TAG_LENGTH * 8 },
        aead, forCrypto(payload),
    ));

    const packet = concat(header, sealed);

    // RFC 9001 s5.4.2: the sample starts four bytes past the packet number
    // offset whatever the packet number's real length, so that a receiver can
    // take it before it has learned that length. With PN_LENGTH 4 that is the
    // first 16 bytes of the ciphertext.
    const sample = packet.slice(pnOffset + 4, pnOffset + 20);
    const mask = await aesEcbBlock(keys.hp, sample);

    // RFC 9001 s5.4.1: in a long header only the low four bits of the first
    // byte are protected — the high four carry the form and type a receiver
    // must read first — and then the packet number bytes.
    packet[0] = byte(packet, 0) ^ (byte(mask, 0) & 0x0f);
    for (let at = 0; at < PN_LENGTH; at++) {
        packet[pnOffset + at] = byte(packet, pnOffset + at) ^ byte(mask, 1 + at);
    }
    return packet;
};

// ---------------------------------------------------------------------------
// The ClientHello
// ---------------------------------------------------------------------------

/** TLS 1.3 only (RFC 8446 s4.1.2 / appendix B.4), in the order browsers offer. */
const CIPHER_SUITES = [0x1301, 0x1302, 0x1303];

/** RFC 8446 s4.2.3. ECDSA and RSA-PSS over the hashes a public server will have. */
const SIGNATURE_ALGORITHMS = [
    0x0403, 0x0804, 0x0401, 0x0503, 0x0805, 0x0501, 0x0806, 0x0601,
];

/** x25519 first, then the two NIST curves — what a browser's list looks like. */
const SUPPORTED_GROUPS = [0x001d, 0x0017, 0x0018];

/**
 * QUIC's own parameters (RFC 9001 s8.2 carries them in TLS extension 57,
 * RFC 9000 s18 defines them): each is a varint id, a varint length, then the
 * value — itself a varint for the integer ones. The numbers are a plausible
 * browser's, except `initial_source_connection_id`, which RFC 9000 s18.2
 * requires to be the SCID this very packet carries; a server cross-checks it,
 * so it is the one value here that cannot be invented.
 */
const buildTransportParameters = (scid: Uint8Array): Uint8Array => {
    const parameter = (id: number, value: Uint8Array): Uint8Array =>
        concat(varint(id), varint(value.length), value);
    return concat(
        parameter(0x0f, scid),              // initial_source_connection_id
        parameter(0x01, varint(30000)),     // max_idle_timeout, 30s
        parameter(0x03, varint(1472)),      // max_udp_payload_size
        parameter(0x04, varint(12582912)),  // initial_max_data
        parameter(0x05, varint(6291456)),   // initial_max_stream_data_bidi_local
        parameter(0x06, varint(6291456)),   // initial_max_stream_data_bidi_remote
        parameter(0x07, varint(6291456)),   // initial_max_stream_data_uni
        parameter(0x08, varint(100)),       // initial_max_streams_bidi
        parameter(0x09, varint(100)),       // initial_max_streams_uni
        parameter(0x0e, varint(2)),         // active_connection_id_limit
    );
};

/**
 * A TLS 1.3 ClientHello as a bare handshake message — in QUIC the CRYPTO
 * frame carries handshake messages directly, with no TLS record layer
 * (RFC 9001 s4.1).
 */
const buildClientHello = (params: QuicParams, scid: Uint8Array, rng: Rng): Uint8Array => {
    const extensions = concat(
        // RFC 6066 s3: a ServerNameList of one entry, type 0 (host_name).
        extension(0x0000, vec16(concat(u8(0x00), vec16(utf8(params.serverName))))),
        // RFC 8446 s4.2.1: the only place a TLS 1.3 client really says "1.3".
        extension(0x002b, vec8(u16(0x0304))),
        // RFC 8446 s4.2.7.
        extension(0x000a, vec16(concat(...SUPPORTED_GROUPS.map(u16)))),
        // RFC 8446 s4.2.8: one x25519 share. 32 random bytes are a well-formed
        // share — a decoy never reads the reply, so the point need not be on
        // the curve, and x25519 has no on-the-wire format that would tell.
        extension(0x0033, vec16(concat(u16(0x001d), vec16(rng(32))))),
        // RFC 8446 s4.2.3.
        extension(0x000d, vec16(concat(...SIGNATURE_ALGORITHMS.map(u16)))),
        // RFC 7301 s3.1, and RFC 9001 s8.1 makes ALPN mandatory over QUIC.
        extension(0x0010, vec16(concat(...params.alpn.map(id => vec8(utf8(id)))))),
        extension(0x0039, buildTransportParameters(scid)),
    );
    const body = concat(
        // legacy_version is frozen at TLS 1.2 for every TLS 1.3 ClientHello.
        u16(0x0303),
        rng(32),
        // legacy_session_id stays EMPTY. The 32-byte form is TLS 1.3 middlebox
        // compatibility mode, and RFC 9001 s8.4 says a QUIC client MUST NOT
        // request it — a server SHOULD answer a non-empty one with
        // PROTOCOL_VIOLATION. The RFC's own A.2 ClientHello sends it empty,
        // and so do browsers over QUIC.
        vec8(new Uint8Array(0)),
        vec16(concat(...CIPHER_SUITES.map(u16))),
        // legacy_compression_methods: the null method only, per RFC 8446.
        vec8(u8(0x00)),
        vec16(extensions),
    );
    // Handshake header: msg_type client_hello (1), then a uint24 length.
    return concat(u8(0x01), vec24(body));
};

/** RFC 9000 s19.6: a CRYPTO frame at offset 0 carries the first flight. */
const cryptoFrame = (data: Uint8Array): Uint8Array =>
    concat(u8(0x06), varint(0), varint(data.length), data);

/**
 * How much plaintext payload fits in a datagram of `size`.
 *
 * Everything but the payload is fixed-width except the header's own Length
 * varint, and that varint's width depends on the value it has to hold, which
 * depends on the payload — so solve it: try the widths in order and take the
 * first whose minimal encoding really is that wide.
 */
const payloadRoom = (size: number, prefixLength: number): number | null => {
    for (const width of [1, 2, 4, 8] as const) {
        const length = size - prefixLength - width;
        const payload = length - PN_LENGTH - TAG_LENGTH;
        if (payload >= 0 && varintWidth(length) === width) return payload;
    }
    return null;
};

/** The header bytes ahead of the Length field, whose width `payloadRoom` solves. */
const prefixLengthFor = (dcid: Uint8Array, scid: Uint8Array): number =>
    1 + 4 + 1 + dcid.length + 1 + scid.length + 1; // first byte, version, cids, empty token varint

/** Fresh params with random connection ids and a sensible default name. */
export const quicDefaults = (rng: Rng): QuicParams => ({
    serverName: 'www.cloudflare.com',
    alpn: ['h3'],
    dcidHex: toHex(rng(8)),
    scidHex: toHex(rng(8)),
    // 1232 = the 1280-byte IPv6 minimum MTU less an IPv6 and a UDP header, so
    // the datagram never needs fragmenting on any path.
    size: 1232,
});

/**
 * A valid, fully encrypted QUIC v1 client Initial datagram.
 *
 * Throws on params `quicProblems` reports as critical — call that first if the
 * values came from a user.
 */
export const buildQuic = async (params: QuicParams, rng: Rng): Promise<Uint8Array> => {
    const dcid = hex(params.dcidHex);
    const scid = hex(params.scidHex);

    const frame = cryptoFrame(buildClientHello(params, scid, rng));
    const room = payloadRoom(params.size, prefixLengthFor(dcid, scid));
    if (room === null || room < frame.length) {
        throw new Error(
            t("quic: a {value1}-byte datagram has no room for a {value2}-byte ClientHello frame", { value1: String(params.size), value2: String(frame.length) }),
        );
    }

    // RFC 9000 s19.1: a PADDING frame is a single zero byte, so the tail of a
    // zero-filled payload already is the run of them that pads the datagram
    // out to its full length.
    const payload = new Uint8Array(room);
    payload.set(frame, 0);

    return sealInitial({ dcid, scid, token: new Uint8Array(0), packetNumber: 0, payload });
};

/** Params the core would refuse or that are out of spec. */
export const quicProblems = (params: QuicParams): Note[] => {
    const notes: Note[] = [];
    const critical = (message: string): void => {
        notes.push({ severity: 'critical', message });
    };
    const warn = (message: string): void => {
        notes.push({ severity: 'warning', message });
    };

    const cid = (text: string, what: string): Uint8Array | null => {
        const bytes = fromHex(text);
        if (!bytes) {
            critical(t("{what} is not hex.", { what }));
            return null;
        }
        if (bytes.length > MAX_CID) {
            critical(t("{what} is {size} bytes; QUIC v1 allows at most {max} (RFC 9000 s17.2).", { what, size: bytes.length, max: MAX_CID }));
            return null;
        }
        return bytes;
    };

    const dcid = cid(params.dcidHex, t("Destination Connection ID"));
    const scid = cid(params.scidHex, t("Source Connection ID"));
    if (dcid && dcid.length < MIN_FIRST_DCID) {
        warn(t("Destination Connection ID is {size} bytes; a client's first one must be at least {min} so the server gets enough entropy (RFC 9000 s7.2).", { size: dcid.length, min: MIN_FIRST_DCID }));
    }

    if (!Number.isInteger(params.size)) {
        critical(t("Size must be a whole number of bytes."));
    } else if (params.size < MIN_DATAGRAM) {
        critical(t("Size is {size}; a client Initial datagram must be padded to at least {min} bytes or a server will drop it (RFC 9000 s14.1).", { size: params.size, min: MIN_DATAGRAM }));
    } else if (params.size > MAX_DATAGRAM) {
        critical(t("Size is {size}; a UDP payload cannot exceed {max} bytes.", { size: params.size, max: MAX_DATAGRAM }));
    }

    if (!params.serverName) {
        critical(t("Server name is empty; the SNI extension needs a host name to carry."));
    } else if (!/^[\da-z](?:[\da-z-]*[\da-z])?(?:\.[\da-z](?:[\da-z-]*[\da-z])?)*$/i.test(params.serverName)) {
        warn(t("\"{name}\" is not a host name, so the SNI will not look like a browser's.", { name: params.serverName }));
    }

    if (params.alpn.length === 0) {
        critical(t("No ALPN ids; QUIC requires ALPN, and a server closes the connection without it (RFC 9001 s8.1)."));
    }
    for (const id of params.alpn) {
        if (!id) critical(t("An ALPN id is empty; each one is a non-empty byte string (RFC 7301 s3.1)."));
        else if (utf8(id).length > 255) critical(t("ALPN id \"{id}\" is longer than the 255 bytes its length prefix allows.", { id }));
    }

    // Whether the ClientHello fits is a question about size, not randomness,
    // so measure it with a zero source — every field it draws is fixed-width.
    if (dcid && scid && Number.isInteger(params.size) && params.serverName && params.alpn.every(Boolean)) {
        const needed = cryptoFrame(buildClientHello(params, scid, length => new Uint8Array(length))).length;
        const room = payloadRoom(params.size, prefixLengthFor(dcid, scid));
        if (room === null || room < needed) {
            critical(t(
                "A {size}-byte datagram leaves {room} bytes for frames, but this ClientHello needs {needed}. Raise the size or shorten the server name.",
                { size: params.size, room: Math.max(room ?? 0, 0), needed },
            ));
        }
    }

    return notes;
};
