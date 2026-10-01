import type { Rng } from './types';

/** Byte plumbing for the noise conversions: hex, text, and the platform's random source. */

export const toHex = (bytes: Uint8Array): string =>
    Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

/** Hex to bytes; whitespace and a leading 0x are ignored. Null when it is not hex. */
export const fromHex = (text: string): Uint8Array | null => {
    const clean = text.replace(/\s+/g, '').replace(/^0x/i, '');
    if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) return null;
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return out;
};

export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

export const concat = (...parts: Uint8Array[]): Uint8Array => {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) {
        out.set(part, at);
        at += part.length;
    }
    return out;
};

/** The platform's CSPRNG. */
export const cryptoRng: Rng = length => {
    const out = new Uint8Array(length);
    // getRandomValues refuses more than 65536 bytes per call.
    for (let at = 0; at < length; at += 65536) {
        globalThis.crypto.getRandomValues(out.subarray(at, Math.min(length, at + 65536)));
    }
    return out;
};

/**
 * A reproducible byte stream from a seed (sfc32, seeded through a cheap
 * string hash).
 *
 * Packet builders take an `Rng`, so a packet is a function of its parameters
 * and its randomness. Giving each step a stored seed makes that function
 * deterministic: editing a SIP header redraws nothing else, and the preview
 * holds still instead of reshuffling on every keystroke. Pressing the dice is
 * then simply a new seed.
 *
 * Not the CSPRNG, and it does not need to be: the seed itself comes from
 * `cryptoRng`, so the stream it stretches is unpredictable to anyone who does
 * not have it, and these bytes are decoys rather than key material.
 */
export const seededRng = (seed: string): Rng => {
    let a = 0x9e3779b9, b = 0x243f6a88, c = 0xb7e15162, d = seed.length || 1;
    for (let i = 0; i < seed.length; i++) {
        d = (d ^ seed.charCodeAt(i)) >>> 0;
        d = Math.imul(d, 0x01000193) >>> 0;
    }
    const next = (): number => {
        a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
        const t = (a + b) >>> 0;
        a = (b ^ (b >>> 9)) >>> 0;
        b = (c + (c << 3)) >>> 0;
        c = ((c << 21) | (c >>> 11)) >>> 0;
        c = (c + t) >>> 0;
        d = (d + 1) >>> 0;
        return ((t + d) >>> 0);
    };
    // sfc32 is only well mixed after a few rounds; throw the first ones away.
    for (let i = 0; i < 12; i++) next();
    return length => {
        const out = new Uint8Array(length);
        for (let i = 0; i < length; i++) out[i] = next() & 0xff;
        return out;
    };
};

/** A fresh seed for a packet step. */
export const newSeed = (rng: Rng): string => toHex(rng(16));
