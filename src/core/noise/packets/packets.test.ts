import { describe, expect, it } from 'bun:test';
import { seededRng } from '../bytes';
import { buildSip, sipDefaults, sipProblems, type SipMethod, type SipParams } from './sip';
import { buildDns, dnsDefaults, dnsProblems, type DnsParams } from './dns';
import { buildStun, stunDefaults, stunProblems } from './stun';

/*
 * These builders exist so a decoy parses as the protocol it imitates, so every
 * test here decodes or walks the datagram back rather than checking its
 * length. A seeded `Rng` makes each one reproducible: the same seed draws the
 * same transaction id, branch and query id every run.
 */

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

const view = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

// ── SIP ──────────────────────────────────────────────────────────────────

const sipParams = (method: SipMethod): SipParams => ({
    method,
    fromUser: 'alice',
    fromHost: 'atlanta.example.com',
    toUser: 'bob',
    toHost: 'biloxi.example.com',
    viaHost: 'pc33.atlanta.example.com',
    branch: 'z9hG4bK74bf9',
    fromTag: '9fxced76sl',
    callId: '3848276298220188511@atlanta.example.com',
    cseq: 314159,
});

/** Headers split the way a SIP parser splits them: CRLF, then a blank line. */
const parseSip = (text: string) => {
    const [head = '', ...rest] = text.split('\r\n\r\n');
    const [start = '', ...headers] = head.split('\r\n');
    const header = (name: string): string | undefined =>
        headers.find(line => line.toLowerCase().startsWith(`${name.toLowerCase()}: `))?.slice(name.length + 2);
    return { start, headers, header, body: rest.join('\r\n\r\n') };
};

describe('buildSip', () => {
    const lines: Record<SipMethod, string> = {
        invite: 'INVITE sip:bob@biloxi.example.com SIP/2.0',
        register: 'REGISTER sip:biloxi.example.com SIP/2.0',
        options: 'OPTIONS sip:biloxi.example.com SIP/2.0',
        trying: 'SIP/2.0 100 Trying',
        ringing: 'SIP/2.0 180 Ringing',
    };

    it('opens with the request or status line the method calls for', async () => {
        for (const method of Object.keys(lines) as SipMethod[]) {
            const text = decode(await buildSip(sipParams(method), seededRng('sip')));
            expect(parseSip(text).start).toBe(lines[method]);
        }
    });

    it('sends the headers CRLF-separated with an empty body', async () => {
        for (const method of Object.keys(lines) as SipMethod[]) {
            const text = decode(await buildSip(sipParams(method), seededRng('sip')));
            const { headers, header, body } = parseSip(text);

            // RFC 3261 s7: a blank line closes the headers. With Content-Length
            // 0 there is nothing after it.
            expect(text.endsWith('\r\n\r\n')).toBe(true);
            expect(body).toBe('');
            expect(header('Content-Length')).toBe('0');

            // Every line break is a CRLF — a bare LF would end the message
            // early for a strict parser.
            expect(/[^\r]\n/.test(text)).toBe(false);
            expect(headers.every(line => line.length > 0)).toBe(true);

            // s8.1.1 / s8.2.6.2: the headers both ends need, request or response.
            expect(header('Via')).toContain(';branch=z9hG4bK74bf9');
            expect(header('To')).toContain('<sip:bob@biloxi.example.com>');
            expect(header('From')).toBe('<sip:alice@atlanta.example.com>;tag=9fxced76sl');
            expect(header('Call-ID')).toBe('3848276298220188511@atlanta.example.com');
        }
    });

    it('carries the branch magic cookie RFC 3261 s8.1.1.7 requires', async () => {
        const text = decode(await buildSip(sipDefaults(seededRng('cookie')), seededRng('cookie')));
        expect(parseSip(text).header('Via')).toMatch(/;branch=z9hG4bK[0-9a-f]{16}$/);
    });

    it('puts Max-Forwards and Contact on requests only', async () => {
        for (const method of ['invite', 'register', 'options'] as SipMethod[]) {
            const { header } = parseSip(decode(await buildSip(sipParams(method), seededRng('sip'))));
            // s20.22 is a request header; s8.1.1.8 gives the peer somewhere to
            // reach this endpoint directly.
            expect(header('Max-Forwards')).toBe('70');
            expect(header('Contact')).toBe('<sip:alice@pc33.atlanta.example.com>');
        }
        for (const method of ['trying', 'ringing'] as SipMethod[]) {
            const { header } = parseSip(decode(await buildSip(sipParams(method), seededRng('sip'))));
            expect(header('Max-Forwards')).toBeUndefined();
            expect(header('Contact')).toBeUndefined();
        }
    });

    it('echoes the method a response is answering in its CSeq', async () => {
        // s8.1.1.5: CSeq names the request's method, and 100/180 answer an INVITE.
        for (const method of ['invite', 'trying', 'ringing'] as SipMethod[]) {
            const { header } = parseSip(decode(await buildSip(sipParams(method), seededRng('sip'))));
            expect(header('CSeq')).toBe('314159 INVITE');
        }
        const register = parseSip(decode(await buildSip(sipParams('register'), seededRng('sip'))));
        expect(register.header('CSeq')).toBe('314159 REGISTER');
    });

    it('tags the To of a 180 but may leave 100 Trying without one', async () => {
        // s8.2.6.2 excepts only 100 Trying from the To tag requirement.
        const ringing = parseSip(decode(await buildSip(sipParams('ringing'), seededRng('tag'))));
        expect(ringing.header('To')).toMatch(/^<sip:bob@biloxi\.example\.com>;tag=[0-9a-f]{8}$/);

        const trying = parseSip(decode(await buildSip(sipParams('trying'), seededRng('tag'))));
        expect(trying.header('To')).toBe('<sip:bob@biloxi.example.com>');
    });

    it('is pure ASCII', async () => {
        // SIP headers are ASCII text (s25.1). Checking the bytes rather than the
        // decoded string also rules out a multi-byte sequence sneaking through.
        for (const seed of ['a', 'b', 'c']) {
            const bytes = await buildSip(sipDefaults(seededRng(seed)), seededRng(seed));
            const printable = bytes.every(byte => byte === 0x0d || byte === 0x0a || (byte >= 0x20 && byte < 0x7f));
            expect(printable).toBe(true);
        }
    });

    it('draws a different identity for every user', () => {
        const one = sipDefaults(seededRng('seed-one'));
        const two = sipDefaults(seededRng('seed-two'));

        // The point of the generator: the packet this repo shipped before was
        // RFC 3261's own example, byte-identical for everyone.
        expect(JSON.stringify(one)).not.toBe(JSON.stringify(two));
        expect(one.branch).not.toBe(two.branch);
        expect(one.callId).not.toBe(two.callId);
        expect(one.fromTag).not.toBe(two.fromTag);
        expect(one.branch).not.toBe('z9hG4bK776asdhds');

        // A pull from one stream keeps moving, so a redraw differs too.
        const rng = seededRng('same');
        expect(sipDefaults(rng).branch).not.toBe(sipDefaults(rng).branch);
    });

    it('reproduces a packet from its seed', async () => {
        const params = sipDefaults(seededRng('fixed'));
        const first = await buildSip(params, seededRng('fixed'));
        const second = await buildSip(params, seededRng('fixed'));
        expect(decode(first)).toBe(decode(second));
    });
});

describe('sipProblems', () => {
    it('reports a branch without the magic cookie', () => {
        expect(sipProblems(sipParams('invite'))).toEqual([]);
        const notes = sipProblems({ ...sipParams('invite'), branch: '776asdhds' });
        expect(notes).toHaveLength(1);
        expect(notes[0]?.severity).toBe('warning');
        expect(notes[0]?.message).toContain('z9hG4bK');
    });

    it('reports every empty user or host', () => {
        const notes = sipProblems({ ...sipParams('invite'), fromUser: '', toHost: '   ' });
        expect(notes).toHaveLength(2);
        expect(notes.map(note => note.message).join('\n')).toContain('Caller is empty');
        expect(notes.map(note => note.message).join('\n')).toContain("Callee's host is empty");
    });
});

// ── DNS ──────────────────────────────────────────────────────────────────

/** The query walked back the way a resolver reads it (RFC 1035 s4.1). */
const parseDns = (bytes: Uint8Array) => {
    const data = view(bytes);
    const labels: string[] = [];
    let at = 12;
    for (;;) {
        const size = bytes[at];
        if (size === undefined) throw new Error('QNAME ran off the end of the datagram');
        at += 1;
        if (size === 0) break;
        labels.push(decode(bytes.subarray(at, at + size)));
        at += size;
    }
    return {
        id: data.getUint16(0),
        flags: data.getUint16(2),
        counts: [data.getUint16(4), data.getUint16(6), data.getUint16(8), data.getUint16(10)],
        labels,
        name: labels.join('.'),
        qtype: data.getUint16(at),
        qclass: data.getUint16(at + 2),
        end: at + 4,
    };
};

describe('buildDns', () => {
    const query = (over: Partial<DnsParams> = {}): DnsParams =>
        ({ name: 'www.example.com', recordType: 'A', recursionDesired: true, ...over });

    it('writes a header a resolver can read back', async () => {
        const bytes = await buildDns(query(), seededRng('dns'));
        const parsed = parseDns(bytes);

        // s4.1.1: the id is the first two bytes, and it is the only thing the
        // builder draws — so the seed predicts it exactly.
        const drawn = seededRng('dns')(2);
        expect(parsed.id).toBe(((drawn[0] ?? 0) << 8) | (drawn[1] ?? 0));

        // QR=0, OPCODE=0, RD=1 and nothing else: one question, no records.
        expect(parsed.flags).toBe(0x0100);
        expect(parsed.counts).toEqual([1, 0, 0, 0]);
        // Nothing trails the question.
        expect(parsed.end).toBe(bytes.length);
    });

    it('clears RD when recursion is not wanted', async () => {
        const bytes = await buildDns(query({ recursionDesired: false }), seededRng('dns'));
        expect(parseDns(bytes).flags).toBe(0x0000);
    });

    it('encodes QNAME as length-prefixed labels', async () => {
        const bytes = await buildDns(query({ name: 'api.cdn.example.net' }), seededRng('dns'));
        const parsed = parseDns(bytes);
        expect(parsed.labels).toEqual(['api', 'cdn', 'example', 'net']);
        expect(parsed.name).toBe('api.cdn.example.net');
        // s4.1.2: the root label terminates the name, so the byte before QTYPE
        // is the zero the walk above stopped on.
        expect(bytes[parsed.end - 5]).toBe(0);
    });

    it('treats a trailing dot as the root label it already is', async () => {
        const bytes = await buildDns(query({ name: 'www.example.com.' }), seededRng('dns'));
        const parsed = parseDns(bytes);
        expect(parsed.name).toBe('www.example.com');
        // An empty label would be a second zero byte and would end the name
        // early, leaving QTYPE to be read out of the leftovers.
        expect(parsed.qtype).toBe(1);
        expect(parsed.end).toBe(bytes.length);
    });

    it('asks for the record type with the right QTYPE and QCLASS', async () => {
        // A/TXT from s3.2.2, AAAA from RFC 3596 s2.1, HTTPS from RFC 9460.
        const codes: [DnsParams['recordType'], number][] = [['A', 1], ['TXT', 16], ['AAAA', 28], ['HTTPS', 65]];
        for (const [recordType, qtype] of codes) {
            const parsed = parseDns(await buildDns(query({ recordType }), seededRng('dns')));
            expect(parsed.qtype).toBe(qtype);
            // s3.2.4: class IN.
            expect(parsed.qclass).toBe(1);
        }
    });

    it('cuts an over-long label so the datagram still parses', async () => {
        const long = 'a'.repeat(70);
        const bytes = await buildDns(query({ name: `${long}.example.com` }), seededRng('dns'));
        const parsed = parseDns(bytes);
        // s2.3.4: 63 is all a length byte can express.
        expect(parsed.labels[0]).toBe('a'.repeat(63));
        expect(parsed.labels.slice(1)).toEqual(['example', 'com']);
        expect(parsed.end).toBe(bytes.length);
    });

    it('reproduces a query from its seed', async () => {
        const first = await buildDns(query(), seededRng('fixed'));
        const second = await buildDns(query(), seededRng('fixed'));
        expect(first).toEqual(second);
    });

    it('draws a plausible query by default', () => {
        const one = dnsDefaults(seededRng('one'));
        const two = dnsDefaults(seededRng('two'));
        expect(one.recursionDesired).toBe(true);
        for (const drawn of [one, two]) {
            expect(drawn.name).toMatch(/^[a-z]+\.example\.(com|net|org)$/);
        }
        expect(JSON.stringify(one)).not.toBe(JSON.stringify(two));
    });
});

describe('dnsProblems', () => {
    it('passes an ordinary name', () => {
        expect(dnsProblems({ name: 'www.example.com', recordType: 'A', recursionDesired: true })).toEqual([]);
        // The trailing dot is the root label, not a name a byte longer.
        expect(dnsProblems({ name: 'www.example.com.', recordType: 'A', recursionDesired: true })).toEqual([]);
    });

    it('reports a label over 63 bytes', () => {
        const notes = dnsProblems({ name: `${'a'.repeat(64)}.example.com`, recordType: 'A', recursionDesired: true });
        expect(notes).toHaveLength(1);
        expect(notes[0]?.severity).toBe('critical');
        expect(notes[0]?.message).toContain('64 bytes');
    });

    it('reports a name over 253 bytes', () => {
        // Four 60-byte labels plus their dots: every label is legal, the whole
        // name is not.
        const name = Array.from({ length: 5 }, () => 'a'.repeat(60)).join('.');
        expect(name.length).toBe(304);
        const notes = dnsProblems({ name, recordType: 'A', recursionDesired: true });
        expect(notes).toHaveLength(1);
        expect(notes[0]?.message).toContain('304 bytes');
    });
});

// ── STUN ─────────────────────────────────────────────────────────────────

/** The message walked back as RFC 5389 s6 and s15 lay it out. */
const parseStun = (bytes: Uint8Array) => {
    const data = view(bytes);
    const attributes: { type: number; value: Uint8Array; padding: Uint8Array }[] = [];
    let at = 20;
    while (at < bytes.length) {
        const type = data.getUint16(at);
        const size = data.getUint16(at + 2);
        const padded = size + ((4 - (size % 4)) % 4);
        attributes.push({
            type,
            value: bytes.subarray(at + 4, at + 4 + size),
            padding: bytes.subarray(at + 4 + size, at + 4 + padded),
        });
        at += 4 + padded;
    }
    return {
        type: data.getUint16(0),
        length: data.getUint16(2),
        cookie: data.getUint32(4),
        transactionId: bytes.subarray(8, 20),
        attributes,
        end: at,
    };
};

describe('buildStun', () => {
    it('writes the header RFC 5389 s6 describes', async () => {
        const bytes = await buildStun({ software: 'coturn 4.5.2' }, seededRng('stun'));
        const parsed = parseStun(bytes);

        expect(parsed.type).toBe(0x0001);
        // The cookie sits at offset 4 and is how a receiver recognises STUN.
        expect(parsed.cookie).toBe(0x2112a442);
        // 96 bits of transaction id, and it is the builder's only draw.
        expect(parsed.transactionId).toEqual(seededRng('stun')(12));
        expect(parsed.transactionId.length).toBe(12);
        // The two high bits of a STUN message type are always zero.
        expect(parsed.type & 0xc000).toBe(0);
    });

    it('declares exactly the attribute bytes that follow, in multiples of 4', async () => {
        for (const software of ['', 'x', 'ab', 'pjnath', 'coturn 4.5.2', 'a'.repeat(31)]) {
            const bytes = await buildStun({ software }, seededRng('stun'));
            const parsed = parseStun(bytes);
            // s6: the length counts only what follows the 20-byte header, and
            // its last two bits are always zero because attributes are padded.
            expect(parsed.length).toBe(bytes.length - 20);
            expect(parsed.length % 4).toBe(0);
            // The attribute walk lands exactly on the end.
            expect(parsed.end).toBe(bytes.length);
        }
    });

    it('round-trips SOFTWARE, padding included', async () => {
        // 12, 7, 10 and 9 bytes long, so the padding is 0, 1, 2 and 3 bytes —
        // every width s15 can produce.
        for (const software of ['coturn 4.5.2', 'libnice', 'coturn 4.5', 'ice4j 3.0']) {
            const bytes = await buildStun({ software }, seededRng('stun'));
            const [attribute, ...rest] = parseStun(bytes).attributes;
            expect(rest).toEqual([]);
            // s18.2: SOFTWARE is comprehension-optional, hence the 0x8022.
            expect(attribute?.type).toBe(0x8022);
            // s15: the declared length is the value before padding, so the
            // string comes back without trailing zeros.
            expect(decode(attribute?.value ?? new Uint8Array(0))).toBe(software);
            expect(attribute?.padding.length).toBe((4 - (software.length % 4)) % 4);
            expect(attribute?.padding.every(byte => byte === 0)).toBe(true);
        }
    });

    it('sends a bare header when there is nothing to say', async () => {
        const bytes = await buildStun({ software: '' }, seededRng('stun'));
        const parsed = parseStun(bytes);
        expect(bytes.length).toBe(20);
        expect(parsed.length).toBe(0);
        expect(parsed.attributes).toEqual([]);
    });

    it('reproduces a message from its seed', async () => {
        const params = stunDefaults(seededRng('fixed'));
        expect(await buildStun(params, seededRng('fixed'))).toEqual(await buildStun(params, seededRng('fixed')));
    });

    it('draws an agent and version by default', () => {
        const one = stunDefaults(seededRng('one'));
        const two = stunDefaults(seededRng('two'));
        for (const drawn of [one, two]) {
            expect(drawn.software).toMatch(/^[a-z0-9]+ \d+\.\d+\.\d+$/);
            expect(stunProblems(drawn)).toEqual([]);
        }
        expect(one.software).not.toBe(two.software);
    });
});

describe('stunProblems', () => {
    it('reports SOFTWARE past what s15.10 allows', () => {
        const notes = stunProblems({ software: 'a'.repeat(128) });
        expect(notes).toHaveLength(1);
        expect(notes[0]?.severity).toBe('warning');
        expect(notes[0]?.message).toContain('128 characters');
    });

    it('says nothing about an empty or ordinary value', () => {
        expect(stunProblems({ software: '' })).toEqual([]);
        expect(stunProblems({ software: 'coturn 4.5.2' })).toEqual([]);
    });
});
