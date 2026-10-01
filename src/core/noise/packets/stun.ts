/**
 * A STUN Binding request decoy (RFC 5389).
 *
 * Every WebRTC call opens with one of these, so a short burst of STUN on a
 * fresh UDP flow is about as unremarkable as UDP gets. It is also the smallest
 * well-formed decoy here: 20 bytes of header is already a complete, valid
 * message.
 */

import { t } from '../../../i18n';
import type { Note, Rng } from '../types';
import { concat, utf8 } from '../bytes';

export interface StunParams {
    /** Include a SOFTWARE attribute (0x8022) and what it should say. */ software: string;
}

/**
 * Message type 0x0001: the two most significant bits are 00 (which is how a
 * STUN message is told apart from other protocols on the same port), method
 * 0x001 = Binding, class 0b00 = request (RFC 5389 s6, s18.1).
 */
const BINDING_REQUEST = 0x0001;

/** RFC 5389 s6: a fixed cookie at offset 4, used to recognise RFC 5389 messages. */
const MAGIC_COOKIE = 0x2112a442;

/** RFC 5389 s18.2: SOFTWARE is a comprehension-optional attribute, so 0x8022. */
const SOFTWARE = 0x8022;

/** s15.10: the value must be under 128 characters, which can run to 763 bytes. */
const MAX_SOFTWARE_CHARS = 128;
const MAX_SOFTWARE_BYTES = 763;

// ── Drawing ──────────────────────────────────────────────────────────────

const draw = (rng: Rng, count: number): number => rng(count).reduce((n, byte) => n * 256 + byte, 0);

const pick = <T>(pool: readonly [T, ...T[]], rng: Rng): T => pool[draw(rng, 1) % pool.length] ?? pool[0];

/**
 * s15.10 asks SOFTWARE to name the implementation and version, so these read
 * the way an ICE agent's does. The version is drawn too: a fixed string is
 * itself a marker, and a client that never changes version is not plausible.
 */
const AGENTS = ['pjnath', 'libnice', 'coturn', 'ice4j', 'stuntman'] as const;

export const stunDefaults = (rng: Rng): StunParams => ({
    software: `${pick(AGENTS, rng)} ${1 + (draw(rng, 1) % 4)}.${draw(rng, 1) % 16}.${draw(rng, 1) % 10}`,
});

// ── Rendering ────────────────────────────────────────────────────────────

const u16 = (value: number): Uint8Array => new Uint8Array([(value >> 8) & 0xff, value & 0xff]);

const u32 = (value: number): Uint8Array =>
    new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);

/**
 * One attribute as TLV (s15): a 16-bit type, a 16-bit length holding the
 * value's length *before* padding, then the value padded out to a multiple of
 * 4 with zeros. The length deliberately excludes the padding, while the
 * header's message length (below) counts it.
 */
const attribute = (type: number, value: Uint8Array): Uint8Array => {
    const padding = new Uint8Array((4 - (value.length % 4)) % 4);
    return concat(u16(type), u16(value.length), value, padding);
};

export const buildStun = async (params: StunParams, rng: Rng): Promise<Uint8Array> => {
    // An empty string means no attribute at all, which leaves a bare header —
    // still a complete Binding request, and the common shape on the wire.
    const attributes = params.software === ''
        ? new Uint8Array(0)
        : attribute(SOFTWARE, utf8(params.software));

    /*
     * Header (s6): type, message length, cookie, transaction id.
     *
     * The message length counts only what follows the 20-byte header. Because
     * every attribute is padded to 4 bytes it is always a multiple of 4, which
     * is why s6 notes its last two bits are always zero.
     *
     * The transaction id is 96 bits and must be unpredictable: s10.2.3 makes it
     * the input to the short-term credential hash, so real agents draw it from
     * a CSPRNG and so do we.
     */
    const header = concat(u16(BINDING_REQUEST), u16(attributes.length), u32(MAGIC_COOKIE), rng(12));

    return concat(header, attributes);
};

export const stunProblems = (params: StunParams): Note[] => {
    const notes: Note[] = [];
    const bytes = utf8(params.software).length;
    // [...string] counts code points rather than UTF-16 units, which is what
    // s15.10 means by "characters".
    const chars = [...params.software].length;

    if (chars >= MAX_SOFTWARE_CHARS) {
        notes.push({
            severity: 'warning',
            message: t("SOFTWARE is {chars} characters — RFC 5389 s15.10 wants fewer than {max}.", { chars, max: MAX_SOFTWARE_CHARS }),
        });
    }
    if (bytes > MAX_SOFTWARE_BYTES) {
        notes.push({
            severity: 'warning',
            message: t("SOFTWARE is {bytes} bytes — RFC 5389 s15.10 caps the attribute at {max}.", { bytes, max: MAX_SOFTWARE_BYTES }),
        });
    }

    return notes;
};
