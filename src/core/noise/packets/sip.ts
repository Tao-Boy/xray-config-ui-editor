/**
 * A SIP-over-UDP decoy datagram (RFC 3261).
 *
 * SIP signalling is plain text on UDP/5060 and is let through almost
 * everywhere, which is why it makes a good first packet on a flow that is
 * really about to carry a WireGuard handshake.
 *
 * The identity in it is drawn fresh. That is the whole point: the packet this
 * repo shipped before (`src/core/presets/noise.ts`) is the verbatim example
 * from RFC 3261 — alice@atlanta.com calling bob@biloxi.com with
 * `branch=z9hG4bK776asdhds` — so every user of every build sent the same 308
 * bytes, which is a one-byte-perfect signature rather than camouflage.
 */

import { t } from '../../../i18n';
import type { Note, Rng } from '../types';
import { toHex, utf8 } from '../bytes';

export type SipMethod = 'invite' | 'trying' | 'ringing' | 'register' | 'options';

export interface SipParams {
    method: SipMethod;
    /** Caller, e.g. "alice". */ fromUser: string;
    /** Caller's host, e.g. "atlanta.example.com". */ fromHost: string;
    /** Callee, e.g. "bob". */ toUser: string;
    /** Callee's host, e.g. "biloxi.example.com". */ toHost: string;
    /** The Via sent-by host, usually the caller's own client. */ viaHost: string;
    /** Via branch id; RFC 3261 s8.1.1.7 requires the "z9hG4bK" magic cookie prefix. */ branch: string;
    /** From header tag. */ fromTag: string;
    /** Call-ID. */ callId: string;
    /** CSeq sequence number. */ cseq: number;
}

// ── Drawing an identity ──────────────────────────────────────────────────

/** A big-endian integer from `count` drawn bytes. */
const draw = (rng: Rng, count: number): number => rng(count).reduce((n, byte) => n * 256 + byte, 0);

/**
 * One item out of a pool. The modulo is slightly biased towards the front of
 * the pool, which does not matter here — the unlinkability comes from the
 * branch, tag and Call-ID below, all of which are full-width random; the pool
 * only has to stop the *shape* of the packet being a constant.
 */
const pick = <T>(pool: readonly [T, ...T[]], rng: Rng): T => pool[draw(rng, 1) % pool.length] ?? pool[0];

const SIP_USERS = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace', 'heidi'] as const;

/**
 * Hosts are built from a service-ish label and a domain reserved for exactly
 * this by RFC 2606 s3 — inventing a real-looking company domain would put
 * someone else's name on our decoys, and a resolver never sees these anyway
 * (the datagram is thrown at the WireGuard peer, not at a SIP registrar).
 */
const SIP_ZONES = ['sip', 'voip', 'pbx', 'telecom', 'call', 'gw'] as const;
const SIP_DOMAINS = ['example.com', 'example.net', 'example.org'] as const;

const host = (rng: Rng): string => `${pick(SIP_ZONES, rng)}.${pick(SIP_DOMAINS, rng)}`;

export const sipDefaults = (rng: Rng): SipParams => {
    const fromHost = host(rng);
    // The Via sent-by is the calling endpoint itself, inside the caller's own
    // domain — the "pc33.atlanta.com" of RFC 3261 s24.2.
    const viaHost = `pc${10 + (draw(rng, 1) % 90)}.${fromHost}`;
    return {
        method: 'invite',
        fromUser: pick(SIP_USERS, rng),
        fromHost,
        toUser: pick(SIP_USERS, rng),
        toHost: host(rng),
        viaHost,
        // s8.1.1.7: the branch must be unique across space and time and must
        // begin with this cookie, which is how a receiver knows the sender
        // follows this RFC rather than RFC 2543.
        branch: `z9hG4bK${toHex(rng(8))}`,
        // s19.3 asks for at least 32 bits of randomness in a tag, and s8.1.1.4
        // for a cryptographically random Call-ID in "localid@host" form.
        fromTag: toHex(rng(4)),
        callId: `${toHex(rng(8))}@${viaHost}`,
        // s8.1.1.5 only requires a number below 2**31; real stacks start
        // anywhere, so a wide draw is as plausible as a low one.
        cseq: 1 + (draw(rng, 3) % 999999),
    };
};

// ── Rendering ────────────────────────────────────────────────────────────

/** Responses carry no Request-URI, and no Max-Forwards or Contact of their own. */
const isRequest = (method: SipMethod): boolean => method !== 'trying' && method !== 'ringing';

/** Request-Line (s7.1) or Status-Line (s7.2). */
const startLine = (p: SipParams): string => {
    switch (p.method) {
        // s8.1.1.1: for a call the Request-URI is the callee's address.
        case 'invite': return `INVITE sip:${p.toUser}@${p.toHost} SIP/2.0`;
        // s10.2: a REGISTER's Request-URI is the registrar's *domain* — it
        // names the server, so it carries no user part.
        case 'register': return `REGISTER sip:${p.toHost} SIP/2.0`;
        // s11.1 allows OPTIONS at a user or a server; aimed at the domain it is
        // the ordinary capability/keep-alive probe between proxies.
        case 'options': return `OPTIONS sip:${p.toHost} SIP/2.0`;
        case 'trying': return 'SIP/2.0 100 Trying';
        case 'ringing': return 'SIP/2.0 180 Ringing';
    }
};

/**
 * s8.1.1.5: CSeq names the method of the request it belongs to. 100 and 180
 * are answers to an INVITE, so that is the method they echo.
 */
const cseqMethod = (method: SipMethod): string =>
    isRequest(method) ? method.toUpperCase() : 'INVITE';

export const buildSip = async (params: SipParams, rng: Rng): Promise<Uint8Array> => {
    const request = isRequest(params.method);
    // The same To for every method. On a REGISTER s10.2 reads it as the
    // address-of-record being bound, and lets it differ from the From
    // ("third party registration"), so one form stays valid throughout.
    const to = `<sip:${params.toUser}@${params.toHost}>`;

    // s8.2.6.2: a UAS must put a tag on the To of its response — except on
    // 100 Trying, where one may be absent. A fresh one keeps 180 Ringing
    // correct without making the caller invent a parameter for it.
    const toTag = params.method === 'ringing' ? `;tag=${toHex(rng(4))}` : '';

    const lines = [
        startLine(params),
        // s8.1.1.7 / s18.1.1: one Via for the hop this datagram is on.
        `Via: SIP/2.0/UDP ${params.viaHost};branch=${params.branch}`,
        // s20.22: Max-Forwards is a request header, and 70 is its recommended
        // initial value.
        ...(request ? [`Max-Forwards: 70`] : []),
        `To: ${to}${toTag}`,
        `From: <sip:${params.fromUser}@${params.fromHost}>;tag=${params.fromTag}`,
        `Call-ID: ${params.callId}`,
        `CSeq: ${params.cseq} ${cseqMethod(params.method)}`,
        // s8.1.1.8: a request that can be answered later gives a Contact the
        // peer can reach directly, which is the endpoint, not the domain.
        ...(request ? [`Contact: <sip:${params.fromUser}@${params.viaHost}>`] : []),
        // The body is empty, so there is nothing to describe: s20.15 makes
        // Content-Type meaningful only with a body, and the shipped preset's
        // "application/sdp" alongside a zero length was self-contradictory.
        `Content-Length: 0`,
    ];

    // s7: CRLF between header fields, then an empty line ending the headers.
    // The trailing join leaves exactly CRLFCRLF and no body.
    return utf8(`${lines.join('\r\n')}\r\n\r\n`);
};

export const sipProblems = (params: SipParams): Note[] => {
    const notes: Note[] = [];

    // Without the cookie a receiver reads the branch under RFC 2543 rules,
    // which is the one thing about this packet that is cheap to spot.
    if (!params.branch.startsWith('z9hG4bK')) {
        notes.push({
            severity: 'warning',
            message: t("RFC 3261 s8.1.1.7 wants the branch to start with \"z9hG4bK\" — \"{branch}\" does not.", { branch: params.branch }),
        });
    }

    // An empty user or host leaves a URI like "sip:@example.com" or a Via with
    // no sent-by, and the datagram stops parsing as SIP.
    // The same labels the form draws these fields with, so a note names the box
    // the reader has to go and fill in.
    const fields: [string, string][] = [
        [t("Caller"), params.fromUser],
        [t("Caller's host"), params.fromHost],
        [t("Callee"), params.toUser],
        [t("Callee's host"), params.toHost],
        [t("Via host"), params.viaHost],
    ];
    for (const [label, value] of fields) {
        if (value.trim() === '') {
            notes.push({ severity: 'warning', message: t("{label} is empty — the URI it goes in will not parse as SIP.", { label }) });
        }
    }

    return notes;
};
