/**
 * Reading an AmneziaWG `[Interface]` as a noise recipe.
 *
 * AWG is a WireGuard fork that sends decoys before each handshake and can
 * also change the protocol itself. Only the first half has an equivalent in
 * Xray, so this module is mostly about saying plainly which half came across:
 *
 *   I1..I5          decoy datagrams, as tag chains      → packet steps
 *   Jc/Jmin/Jmax    random decoys before the handshake  → a junk step
 *   S1..S4          padding on WireGuard's own messages → nothing, and said so
 *   H1..H4          WireGuard's message type numbers    → nothing, and said so
 *
 * The two halves differ in kind, not just in support. Decoys are extra
 * datagrams around an unchanged WireGuard; S and H change what WireGuard
 * itself puts on the wire, so both ends must agree. Xray's WireGuard speaks
 * the standard protocol, so a peer that wants non-default S or H cannot be
 * reached from here at all — which is worth a loud note rather than a config
 * that looks fine and never connects.
 *
 * Facts cite the AmneziaWG source (github.com/amnezia-vpn/amneziawg-go).
 */

import { t } from '../../i18n';
import type { Note, Rng } from './types';
import { formatAwgSpec, parseAwgSpec, renderAwgSpec } from './awg-tags';
import { type Recipe, type Step } from './recipe';
import { newSeed, seededRng, toHex } from './bytes';

/** The `I` lines, in the order AWG sends them (device/send.go:139). */
const I_KEYS = ['I1', 'I2', 'I3', 'I4', 'I5'];

/**
 * WireGuard's own message type numbers (device/noise-protocol.go:59-62).
 * H1..H4 replace them, so these four values mean "unchanged".
 */
const STANDARD_HEADERS: Record<string, number> = { H1: 1, H2: 2, H3: 3, H4: 4 };

/**
 * What each padding length applies to (device/send.go:149, 199, 258, 331).
 *
 * Thunks rather than strings: the text goes into a note the user reads, so it
 * is translated, and a translated string read at module load would be frozen
 * in whatever language the app started in.
 */
const PADDING_TARGETS: Record<string, () => string> = {
    S1: () => t("handshake initiation"),
    S2: () => t("handshake response"),
    S3: () => t("cookie reply"),
    S4: () => t("transport packets"),
};

/** Keys this app models; anything else AWG-specific is reported rather than ignored. */
const KNOWN = new Set([
    'PrivateKey', 'Address', 'DNS', 'MTU', 'ListenPort', 'Table', 'PreUp', 'PostUp', 'PreDown', 'PostDown', 'FwMark',
    'Jc', 'Jmin', 'Jmax', ...I_KEYS, ...Object.keys(STANDARD_HEADERS), ...Object.keys(PADDING_TARGETS),
]);

const lookup = (iface: Record<string, string>, key: string): string | undefined => {
    const found = Object.keys(iface).find(candidate => candidate.toLowerCase() === key.toLowerCase());
    return found === undefined ? undefined : iface[found];
};

const number = (value: string | undefined): number | undefined => {
    if (value === undefined) return undefined;
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
};

/** True when the interface carries anything AmneziaWG-specific at all. */
export const isAwgInterface = (iface: Record<string, string>): boolean =>
    ['Jc', 'Jmin', 'Jmax', ...I_KEYS, ...Object.keys(STANDARD_HEADERS), ...Object.keys(PADDING_TARGETS)]
        .some(key => lookup(iface, key) !== undefined);

/**
 * What the protocol-changing half of the config asks for, and why none of it
 * survives the move. Separate from the recipe because it is about whether the
 * tunnel can work, not about what the decoys look like.
 */
export const awgProtocolNotes = (iface: Record<string, string>): Note[] => {
    const notes: Note[] = [];

    const padded = Object.keys(PADDING_TARGETS).filter(key => (number(lookup(iface, key)) ?? 0) > 0);
    if (padded.length > 0) {
        const targets = padded.map(key => `${key} (${PADDING_TARGETS[key]?.()})`).join(', ');
        notes.push({
            severity: 'warning',
            message: t("This profile pads WireGuard's own messages — {targets}. Xray's WireGuard sends them unpadded, and the setting is dropped. It is not the same thing as the outbound's \"reserved\", which substitutes three header bytes for Cloudflare WARP; writing it there would corrupt the handshake.", { targets }),
        });
    }

    const changed = Object.keys(STANDARD_HEADERS).filter(key => {
        const value = number(lookup(iface, key));
        return value !== undefined && value !== STANDARD_HEADERS[key];
    });
    if (changed.length > 0) {
        notes.push({
            severity: 'critical',
            message: t("This profile renumbers WireGuard's message types ({keys}). The peer expects that numbering and Xray speaks the standard one, so this outbound will not complete a handshake with it. The decoys below were still imported.", { keys: changed.join(', ') }),
        });
    }

    const extra = Object.keys(iface).filter(key => !KNOWN.has(key) && !/^(Pre|Post)(Up|Down)$/i.test(key));
    if (extra.length > 0) {
        notes.push({
            severity: 'warning',
            message: t("Not carried across: {keys}. This app models WireGuard plus AmneziaWG's decoys; anything else in the profile is left behind.", { keys: extra.join(', ') }),
        });
    }

    return notes;
};

/**
 * The decoys an AWG interface sends, as a recipe.
 *
 * Junk size maps straight across: AWG draws `Jmin + fastrandn(Jmax-Jmin)`
 * (device/noise-protocol.go:639) and Xray draws `RandBetween(from, to)`
 * (v26.7.28:common/crypto/crypto.go:12) — both exclude the upper bound, so
 * `Jmin-Jmax` is the same range written the same way.
 *
 * No delays are set: AWG writes its decoys back to back with no pauses
 * (device/send.go:139-147), and Xray's default of no delay matches that.
 *
 * Synchronous, unlike the generator's other builders: a tag chain is bytes
 * laid end to end with nothing to encrypt, and `parseWireguardConfig` is a
 * plain function that should stay one.
 */
export const recipeFromAwgInterface = (
    iface: Record<string, string>,
    rng: Rng,
): { recipe: Recipe; notes: Note[] } => {
    const notes: Note[] = [];
    const steps: Step[] = [];

    for (const key of I_KEYS) {
        const spec = lookup(iface, key);
        if (spec === undefined || spec.trim() === '') continue;
        const { tags, notes: parsed } = parseAwgSpec(spec);
        notes.push(...parsed.map(note => ({ ...note, message: `${key}: ${note.message}` })));
        if (tags.length === 0) continue;
        const seed = newSeed(rng);
        const drawn = renderAwgSpec(tags, seededRng(seed));
        notes.push(...drawn.notes.map(note => ({ ...note, message: `${key}: ${note.message}` })));
        steps.push({ kind: 'packet', template: { kind: 'awg', tags }, hex: toHex(drawn.bytes), seed });
    }

    // AWG sends every I packet first, then the junk, so the junk goes last.
    const count = number(lookup(iface, 'Jc')) ?? 0;
    if (count > 0) {
        const min = number(lookup(iface, 'Jmin')) ?? 40;
        const max = number(lookup(iface, 'Jmax')) ?? 70;
        steps.push({ kind: 'junk', count, size: `${min}-${max}` });
    }

    return { recipe: { steps }, notes };
};

/** The `I` lines and junk triple a recipe writes as, for the export side. */
export interface AwgObfuscation {
    /** `I1`..`I5`, in order; at most five, as AWG has no more (device/device.go:113). */
    iLines: string[];
    junk?: { count: number; min: number; max: number };
    notes: Note[];
}

const specForHex = (hex: string): string => `<b 0x${hex}>`;

/**
 * A recipe as AmneziaWG's obfuscation settings.
 *
 * Three things do not fit, each reported rather than quietly dropped: AWG
 * holds five decoy packets and no more; it has one junk triple, so several
 * junk steps have to collapse into it; and it sends everything in one burst,
 * so per-packet delays have nowhere to go.
 */
export const awgObfuscationFromRecipe = (recipe: Recipe): AwgObfuscation => {
    const notes: Note[] = [];
    const iLines: string[] = [];
    const junkSteps: { count: number; min: number; max: number }[] = [];
    let seenJunk = false;
    let outOfOrder = false;

    for (const step of recipe.steps) {
        if (step.kind === 'packet') {
            // AWG keeps a tag chain as written, so an imported one goes back
            // out as it came in — random tags included, still redrawn per
            // handshake once AmneziaWG has it again.
            const spec = step.template.kind === 'awg' && step.template.tags.length > 0
                ? formatAwgSpec(step.template.tags)
                : specForHex(step.hex);
            if (iLines.length < I_KEYS.length) iLines.push(spec);
            if (seenJunk) outOfOrder = true;
            continue;
        }
        seenJunk = true;
        const range = step.size.includes('-') ? step.size.split('-') : [step.size, step.size];
        const min = Number(range[0]);
        const max = Number(range[1] ?? range[0]);
        if (Number.isFinite(min) && Number.isFinite(max)) junkSteps.push({ count: step.count, min, max });
    }

    const packets = recipe.steps.filter(step => step.kind === 'packet').length;
    if (packets > I_KEYS.length) {
        notes.push({
            severity: 'warning',
            message: t("AmneziaWG carries five decoy packets (I1-I5); the last {n} were left out.", { n: packets - I_KEYS.length }),
        });
    }
    if (outOfOrder) {
        notes.push({
            severity: 'warning',
            message: t("AmneziaWG sends all five I packets before its junk, so a packet written after a junk step moves ahead of it."),
        });
    }
    if (recipe.steps.some(step => step.delay)) {
        notes.push({
            severity: 'info',
            message: t("Delays were dropped: AmneziaWG writes its decoys back to back."),
        });
    }
    if (recipe.reset) {
        notes.push({
            severity: 'info',
            message: t("\"reset\" was dropped: AmneziaWG sends its decoys before every handshake rather than re-arming after silence."),
        });
    }
    if (recipe.steps.some(step => step.kind === 'junk' && step.randRange)) {
        notes.push({
            severity: 'warning',
            message: t("AmneziaWG's junk is always uniform random bytes, so a narrowed \"randRange\" was dropped."),
        });
    }

    let junk: AwgObfuscation['junk'];
    if (junkSteps.length > 0) {
        junk = {
            count: junkSteps.reduce((total, step) => total + step.count, 0),
            min: Math.min(...junkSteps.map(step => step.min)),
            max: Math.max(...junkSteps.map(step => step.max)),
        };
        if (junkSteps.length > 1) {
            notes.push({
                severity: 'warning',
                message: t("AmneziaWG has one junk setting (Jc/Jmin/Jmax), so {steps} junk steps became {count} packets of {min}-{max} bytes.", { steps: junkSteps.length, count: junk.count, min: junk.min, max: junk.max }),
            });
        }
    }

    return { iLines, ...(junk ? { junk } : {}), notes };
};
