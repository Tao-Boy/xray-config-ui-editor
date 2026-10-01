/**
 * A DNS query decoy (RFC 1035 s4).
 *
 * A single outbound query is the most ordinary UDP datagram there is, and the
 * cheapest to get exactly right: a 12-byte header and one question, no
 * answers. It also stands up to a resolver-aware middlebox, which a random
 * blob on port 53 would not.
 */

import { t } from '../../../i18n';
import type { Note, Rng } from '../types';
import { concat, utf8 } from '../bytes';

export interface DnsParams {
    /** Name to ask about, e.g. "www.example.com". */ name: string;
    /** Record type. */ recordType: 'A' | 'AAAA' | 'HTTPS' | 'TXT';
    /** Set the Recursion Desired flag. */ recursionDesired: boolean;
}

/**
 * QTYPE codes: A and TXT from RFC 1035 s3.2.2, AAAA from RFC 3596 s2.1,
 * HTTPS from RFC 9460 (which registers it as type 65).
 */
const QTYPE: Record<DnsParams['recordType'], number> = { A: 1, TXT: 16, AAAA: 28, HTTPS: 65 };

/** QCLASS 1 = IN, the internet class (RFC 1035 s3.2.4). */
const QCLASS_IN = 1;

/** RFC 1035 s2.3.4: a label is at most 63 octets, a whole name at most 255. */
const MAX_LABEL = 63;
/**
 * 253 is that 255-octet wire limit expressed in presentation form: the
 * encoding spends one length byte per label plus the root's zero byte, so
 * "a.b" costs 5 on the wire for 3 characters of text, and 253 characters is
 * the longest text that still fits.
 */
const MAX_NAME = 253;

// ── Drawing ──────────────────────────────────────────────────────────────

const draw = (rng: Rng, count: number): number => rng(count).reduce((n, byte) => n * 256 + byte, 0);

const pick = <T>(pool: readonly [T, ...T[]], rng: Rng): T => pool[draw(rng, 1) % pool.length] ?? pool[0];

/**
 * Names reserved for documentation by RFC 2606 s3, varied by a host label.
 * A decoy aimed at a WireGuard peer is never resolved, so the only thing the
 * name has to do is look like a name and not be a constant.
 */
const HOSTS = ['www', 'api', 'cdn', 'mail', 'static', 'img', 'login', 'assets'] as const;
const ZONES = ['example.com', 'example.net', 'example.org'] as const;

/** The types a stub resolver actually emits, in roughly that order of frequency. */
const TYPES = ['A', 'A', 'AAAA', 'HTTPS', 'TXT'] as const;

export const dnsDefaults = (rng: Rng): DnsParams => ({
    name: `${pick(HOSTS, rng)}.${pick(ZONES, rng)}`,
    recordType: pick(TYPES, rng),
    // A stub resolver asking a recursive server always sets RD (s4.1.1).
    recursionDesired: true,
});

// ── Rendering ────────────────────────────────────────────────────────────

const u16 = (value: number): Uint8Array => new Uint8Array([(value >> 8) & 0xff, value & 0xff]);

/**
 * QNAME: each label prefixed with its length, terminated by the zero-length
 * root label (s4.1.2).
 *
 * Empty labels are dropped rather than encoded, which is what handles both a
 * trailing dot ("www.example.com." — the root is already the terminator) and
 * a typo like "www..com": a zero length byte in the middle would end the name
 * early and the reader would take QTYPE and QCLASS out of the leftover text.
 * An over-long label is cut to 63 for the same reason — the length byte
 * cannot express more, and `dnsProblems` is where the user hears about it.
 */
const qname = (name: string): Uint8Array => {
    const labels = name.split('.').filter(Boolean);
    const parts = labels.map(label => {
        const bytes = utf8(label).slice(0, MAX_LABEL);
        return concat(new Uint8Array([bytes.length]), bytes);
    });
    return concat(...parts, new Uint8Array([0]));
};

export const buildDns = async (params: DnsParams, rng: Rng): Promise<Uint8Array> => {
    /*
     * Header (s4.1.1): ID, then the flag word, then four counts.
     *
     * The flag word is QR=0 (a query), OPCODE=0 (QUERY), AA/TC/RA/Z=0 and
     * RCODE=0 — every bit zero except RD, which is bit 8. QDCOUNT is 1 for
     * the single question; AN/NS/ARCOUNT are 0 because a query carries no
     * records.
     */
    const flags = params.recursionDesired ? 0x0100 : 0x0000;
    const header = concat(rng(2), u16(flags), u16(1), u16(0), u16(0), u16(0));

    // Question (s4.1.2): QNAME, QTYPE, QCLASS.
    return concat(header, qname(params.name), u16(QTYPE[params.recordType]), u16(QCLASS_IN));
};

export const dnsProblems = (params: DnsParams): Note[] => {
    const notes: Note[] = [];
    const name = params.name.replace(/\.$/, '');

    for (const label of name.split('.').filter(Boolean)) {
        const size = utf8(label).length;
        if (size > MAX_LABEL) {
            notes.push({
                severity: 'critical',
                message: t("\"{label}...\" is {size} bytes — RFC 1035 s2.3.4 caps a label at {max}, so it is sent cut short and the decoy asks about a different name.", { label: label.slice(0, 20), size, max: MAX_LABEL }),
            });
        }
    }

    const total = utf8(name).length;
    if (total > MAX_NAME) {
        notes.push({
            severity: 'critical',
            message: t("The name is {total} bytes — RFC 1035 s2.3.4 caps an encoded name at 255, which is {max} as written here. A resolver would refuse to parse it.", { total, max: MAX_NAME }),
        });
    }

    return notes;
};
