import { t } from '../../i18n';
import { concat, fromHex, toHex } from './bytes';
import type { Note, Rng } from './types';

/**
 * AmneziaWG's obfuscation tag chains — the `I1`..`I5` lines of an AWG config.
 *
 * A chain describes one decoy datagram as a sequence of `<key arg>` tags, e.g.
 * `I1 = <b 0x494e56495445>` or `I1 = <b 0xdeadbeef><r 16><t><rc 8>`. AWG walks
 * the chain and writes each tag's bytes in order (device/obf.go:98-105), so the
 * chain is the packet.
 *
 * Behaviour here is taken from amneziawg-go's `device/obf*.go` and every claim
 * cites the file and line it came from — read those, not this comment, when
 * something looks surprising.
 *
 * The gap this module exists to manage: AWG redraws the random and timestamp
 * tags on *every handshake*, and its `d`/`ds`/`dz` tags splice in the real
 * WireGuard payload the chain is wrapping. An Xray finalmask noise item is a
 * standalone decoy of fixed bytes — no payload, drawn once. So a chain can only
 * be rendered faithfully when it is nothing but `<b ...>`; anything else comes
 * back with a note saying what was lost. `renderAwgSpec` never silently
 * pretends otherwise.
 */

export type AwgTagKey = 'b' | 't' | 'r' | 'rc' | 'rd' | 'd' | 'ds' | 'dz';

export interface AwgTag {
    key: AwgTagKey;
    /** The tag's argument as written: hex for `b`, a length for `r`/`rc`/`rd`/`dz`. */
    value?: string;
}

/** The eight keys in `obfBuilders` (device/obf.go:11-20), in that order. */
const TAG_KEYS: readonly AwgTagKey[] = ['b', 't', 'r', 'rc', 'rd', 'd', 'ds', 'dz'];

/**
 * The keys whose argument means something. `t`, `d` and `ds` take a builder
 * argument and throw it away (device/obf_timestamp.go:8, obf_data.go:3,
 * obf_datastring.go:7), so there is nothing to keep for them.
 */
const TAKES_ARG: ReadonlySet<AwgTagKey> = new Set<AwgTagKey>(['b', 'r', 'rc', 'rd', 'dz']);

/** device/obf_randchars.go:9 — `rc` samples these 52, lowercase first. */
const CHARS_52 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** device/obf_randdigits.go:9. */
const DIGITS_10 = '0123456789';

/**
 * Lengths are bounded because the chain renders into one UDP datagram, which
 * cannot carry more than this anyway — and because a pasted config should not
 * be able to make the browser allocate a gigabyte from `<r 999999999>`.
 * amneziawg-go has no such ceiling (it is talking to a real MTU instead).
 */
const MAX_TAG_LENGTH = 65535;

const isTagKey = (key: string): key is AwgTagKey => (TAG_KEYS as readonly string[]).includes(key);

const critical = (message: string): Note => ({ severity: 'critical', message });

/**
 * The builders for `r`/`rc`/`rd`/`dz` read their argument with `strconv.Atoi`
 * (device/obf_rand.go:9, obf_randchars.go:12, obf_randdigits.go:12,
 * obf_datasize.go:6), which accepts a leading sign — but a negative length then
 * panics on `dst[:o.length]` (device/obf_rand.go:24), so refuse it up front
 * rather than mirroring a crash.
 */
const readLength = (arg: string): { length: number } | { error: string } => {
    if (!/^[+-]?\d+$/.test(arg)) return { error: t("\"{arg}\" is not a number", { arg }) };
    const length = Number(arg);
    if (length < 0) return { error: t("negative length {length}", { length }) };
    if (length > MAX_TAG_LENGTH) return { error: t("length {length} exceeds one datagram", { length }) };
    return { length };
};

/**
 * `<b ...>` as amneziawg-go reads it (device/obf_bytes.go:10-26): strip one
 * leading `0x`, then reject an empty argument and an odd digit count before
 * decoding. The prefix strip is `strings.TrimPrefix`, so it is case-sensitive —
 * `<b 0Xff>` keeps the `X` and fails the hex decode, and this does too.
 */
const readHex = (arg: string): { bytes: Uint8Array } | { error: string } => {
    const digits = arg.startsWith('0x') ? arg.slice(2) : arg;
    if (digits.length === 0) return { error: t("empty argument") };
    if (digits.length % 2 !== 0) return { error: t("odd amount of symbols") };
    // Checked here rather than left to fromHex, which is more forgiving than
    // encoding/hex is (it strips whitespace and another leading 0x).
    if (!/^[0-9a-fA-F]+$/.test(digits)) return { error: t("\"{arg}\" is not hex", { arg }) };
    const bytes = fromHex(digits);
    return bytes ? { bytes } : { error: t("\"{arg}\" is not hex", { arg }) };
};

/** Whatever the matching builder in `obfBuilders` would refuse, or null. */
const argError = (key: AwgTagKey, arg: string): string | null => {
    if (key === 'b') {
        const read = readHex(arg);
        return 'error' in read ? read.error : null;
    }
    if (key === 'r' || key === 'rc' || key === 'rd' || key === 'dz') {
        const read = readLength(arg);
        return 'error' in read ? read.error : null;
    }
    // t, d, ds take no argument and cannot fail to build.
    return null;
};

/** Tags of a spec string, plus whatever it got wrong. `tags` is empty when it is not a chain. */
export const parseAwgSpec = (spec: string): { tags: AwgTag[]; notes: Note[] } => {
    const tags: AwgTag[] = [];
    const notes: Note[] = [];

    // device/obf.go:40-83 — scan for `<`, then for the `>` after it. Anything
    // outside a pair of brackets is not an error, it is simply skipped.
    let remaining = spec;
    for (;;) {
        const start = remaining.indexOf('<');
        if (start === -1) break;

        const end = remaining.indexOf('>', start);
        if (end === -1) {
            // device/obf.go:48-50 returns here instead of collecting, so the
            // rest of the spec is never looked at.
            notes.push(critical(t("missing enclosing > — the chain is cut off")));
            break;
        }

        // `strings.Fields` (device/obf.go:54): split on runs of whitespace, no
        // empty fields. The first field is the key, the second the argument,
        // and anything after the second is ignored.
        const fields = remaining.slice(start + 1, end).split(/\s+/).filter(field => field !== '');
        remaining = remaining.slice(end + 1);

        const key = fields[0];
        if (key === undefined) {
            notes.push(critical(t("empty tag <>")));
            continue;
        }
        if (!isTagKey(key)) {
            notes.push(critical(t("unknown tag <{key}>", { key })));
            continue;
        }

        const arg = fields[1] ?? '';
        const error = argError(key, arg);
        if (error !== null) {
            notes.push(critical(t("failed to build <{key}>: {error}", { key, error })));
            continue;
        }

        tags.push(TAKES_ARG.has(key) ? { key, value: arg } : { key });
    }

    // device/obf.go:85-87 — one bad tag rejects the whole chain, it does not
    // fall back to the tags that did parse. Half a decoy is not the decoy AWG
    // would have sent, so importing one would be worse than importing none.
    return { tags: notes.length > 0 ? [] : tags, notes };
};

/** The spec string these tags write as, e.g. "<b 0xdead><r 16>". */
export const formatAwgSpec = (tags: AwgTag[]): string =>
    tags.map(tag => (tag.value === undefined || tag.value === '' ? `<${tag.key}>` : `<${tag.key} ${tag.value}>`)).join('');

/** device/obf_timestamp.go:15-16 — `uint32(time.Now().Unix())`, big-endian. */
const timestampBytes = (nowMs: number): Uint8Array => {
    const bytes = new Uint8Array(4);
    // setUint32 truncates mod 2^32, which is what the Go cast does.
    new DataView(bytes.buffer).setUint32(0, Math.floor(nowMs / 1000), false);
    return bytes;
};

/**
 * device/obf_randchars.go:27-30 and obf_randdigits.go:27-30: draw raw random
 * bytes, then fold each one into the alphabet with `alphabet[b % len]`. The
 * modulo bias is AWG's, and reproducing it is the point — a seeded rng has to
 * give the same letters here as it would there.
 */
const randomFromAlphabet = (alphabet: string, length: number, rng: Rng): Uint8Array => {
    const bytes = rng(length);
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        out[i] = alphabet.charCodeAt((bytes[i] ?? 0) % alphabet.length);
    }
    return out;
};

/**
 * One datagram the chain would send. AWG redraws the random and timestamp
 * tags on every handshake; Xray can only carry fixed bytes, so a chain with
 * any of those renders FROZEN — one draw, kept forever — and says so.
 */
export const renderAwgSpec = (tags: AwgTag[], rng: Rng, nowMs: number = Date.now()): { bytes: Uint8Array; notes: Note[] } => {
    const parts: Uint8Array[] = [];
    const notes: Note[] = [];

    // One note per thing that went wrong, however many tags hit it — four
    // `<r>` tags are one caveat to read, not four.
    const note = (severity: Note['severity'], message: string): void => {
        if (!notes.some(existing => existing.message === message)) notes.push({ severity, message });
    };
    // Each caveat is written out per tag rather than assembled from a stem and
    // a fragment: a half-sentence cannot be translated, and these are read.

    /** Shared by the four length-taking tags; null once a note has been filed. */
    const lengthOf = (tag: AwgTag): number | null => {
        const read = readLength(tag.value ?? '');
        if ('error' in read) {
            note('critical', t("<{key}> has no usable length ({error}) and contributes nothing", { key: tag.key, error: read.error }));
            return null;
        }
        return read.length;
    };

    for (const tag of tags) {
        switch (tag.key) {
            case 'b': {
                const read = readHex(tag.value ?? '');
                if ('error' in read) {
                    note('critical', t("<b> is not usable hex ({error}) and contributes nothing", { error: read.error }));
                } else {
                    parts.push(read.bytes);
                }
                break;
            }
            case 't': {
                parts.push(timestampBytes(nowMs));
                note('warning', t("<t> is the current unix time, read anew on every AWG handshake; this config freezes it at its first draw"));
                break;
            }
            case 'r': {
                const length = lengthOf(tag);
                if (length !== null) parts.push(rng(length));
                note('warning', t("<r> is random bytes, drawn anew on every AWG handshake; this config freezes it at its first draw"));
                break;
            }
            case 'rc': {
                const length = lengthOf(tag);
                if (length !== null) parts.push(randomFromAlphabet(CHARS_52, length, rng));
                note('warning', t("<rc> is random latin letters, drawn anew on every AWG handshake; this config freezes it at its first draw"));
                break;
            }
            case 'rd': {
                const length = lengthOf(tag);
                if (length !== null) parts.push(randomFromAlphabet(DIGITS_10, length, rng));
                note('warning', t("<rd> is random digits, drawn anew on every AWG handshake; this config freezes it at its first draw"));
                break;
            }
            case 'd': {
                // device/obf_data.go:10-11 copies the payload through; with no
                // payload the tag is zero bytes wide.
                note('warning', t("<d> stands for the real WireGuard payload, which a standalone noise packet has none of — it contributes nothing here"));
                break;
            }
            case 'ds': {
                // device/obf_datastring.go:14-15 base64s the payload; base64 of
                // nothing is nothing.
                note('warning', t("<ds> stands for the real WireGuard payload, which a standalone noise packet has none of — its base64 is empty here"));
                break;
            }
            case 'dz': {
                // device/obf_datasize.go:20-26 writes the payload length into
                // `length` big-endian bytes — of a zero-length payload, so the
                // width survives the trip but every byte is zero.
                const length = lengthOf(tag);
                if (length !== null) parts.push(new Uint8Array(length));
                note('warning', t("<dz> stands for the real WireGuard payload, which a standalone noise packet has none of — it becomes that many zero bytes"));
                break;
            }
        }
    }

    return { bytes: concat(...parts), notes };
};

/** Fixed bytes as the one-tag chain that reproduces them. */
export const awgSpecForBytes = (bytes: Uint8Array): AwgTag[] =>
    // `<b>` with an empty argument is the one thing AWG refuses outright
    // (device/obf_bytes.go:13-15), so no bytes means no chain.
    bytes.length === 0 ? [] : [{ key: 'b', value: `0x${toHex(bytes)}` }];
