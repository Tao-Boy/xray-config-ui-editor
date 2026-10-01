/**
 * A noise recipe: the decoy datagrams a finalmask `noise` layer sends, held
 * as what BUILT them rather than only as the bytes they came out as.
 *
 * A config can only carry bytes — `{type:'hex', packet:'494e...'}` — so that
 * is what gets written. But bytes alone cannot be edited: changing the SNI of
 * a QUIC Initial means rebuilding and re-encrypting it, and redrawing a SIP
 * call's identity means regenerating every header that mentions it. The
 * recipe keeps the parameters beside the rendered bytes so both are possible,
 * and lives in the editor's session only — none of it is written into the
 * user's config, which stays exactly the shape Xray reads.
 *
 * Reading a config back therefore cannot recover the parameters: an imported
 * layer comes back as `hex` templates, which is honest about what is known.
 */

import { t } from '../../i18n';
import type { NoiseItem, Note, Rng } from './types';
import { cryptoRng, fromHex, newSeed, seededRng, toHex } from './bytes';
import { buildSip, sipDefaults, sipProblems, type SipParams } from './packets/sip';
import { buildDns, dnsDefaults, dnsProblems, type DnsParams } from './packets/dns';
import { buildStun, stunDefaults, stunProblems, type StunParams } from './packets/stun';
import { buildQuic, quicDefaults, quicProblems, type QuicParams } from './packets/quic';
import { renderAwgSpec, type AwgTag } from './awg-tags';

/** What built a decoy datagram, and what it would take to build another. */
export type Template =
    | { kind: 'sip'; params: SipParams }
    | { kind: 'quic'; params: QuicParams }
    | { kind: 'dns'; params: DnsParams }
    | { kind: 'stun'; params: StunParams }
    /** An AmneziaWG tag chain, kept as tags so the export writes back what came in. */
    | { kind: 'awg'; tags: AwgTag[] }
    /** Bytes with no recipe behind them: hand-entered, or read back from a config. */
    | { kind: 'hex'; hex: string };

export type TemplateKind = Template['kind'];

export const TEMPLATE_KINDS: TemplateKind[] = ['sip', 'quic', 'dns', 'stun', 'hex', 'awg'];

/** One decoy datagram. `hex` is what goes in the config; `template` is how to make another. */
export interface PacketStep {
    kind: 'packet';
    template: Template;
    hex: string;
    /**
     * The randomness this datagram was drawn with. Stored so the draw can be
     * repeated: a packet is a function of its parameters and its seed, so
     * editing one header rebuilds that header and leaves the connection ids,
     * nonces and tags exactly where they were. A new seed is a new draw.
     */
    seed: string;
    /** Milliseconds to wait after sending it, as Xray's `delay` range. */
    delay?: string;
}

/**
 * Datagrams of random bytes. One step stands for `count` of them because that
 * is how both ends describe it — AmneziaWG as `Jc`/`Jmin`/`Jmax`, and a run of
 * identical Xray `rand` items.
 */
export interface JunkStep {
    kind: 'junk';
    count: number;
    /** Length range, written as Xray writes it. The upper bound is exclusive. */
    size: string;
    delay?: string;
    /** Byte values to draw from, inclusive at both ends. 0-255 when unset. */
    randRange?: string;
}

export type Step = PacketStep | JunkStep;

export interface Recipe {
    steps: Step[];
    /** Seconds of silence to a destination after which the layer sends again. */
    reset?: string;
}

export const EMPTY_RECIPE: Recipe = { steps: [] };

// ── Building ─────────────────────────────────────────────────────────────

/** Fresh parameters for a template of this kind, randomised where it matters. */
export const newTemplate = (kind: TemplateKind, rng: Rng): Template => {
    switch (kind) {
        case 'sip': return { kind, params: sipDefaults(rng) };
        case 'quic': return { kind, params: quicDefaults(rng) };
        case 'dns': return { kind, params: dnsDefaults(rng) };
        case 'stun': return { kind, params: stunDefaults(rng) };
        case 'awg': return { kind, tags: [] };
        case 'hex': return { kind, hex: '' };
    }
};

/**
 * The same template with its incidental identity drawn again, keeping the
 * choices the form presents as decisions rather than noise.
 *
 * What counts as a decision is the shape of the packet — which SIP method,
 * which name a QUIC Initial asks for, how big it is. What counts as noise is
 * everything a real client would draw per connection: the SIP call's branch,
 * tags and Call-ID, the QUIC connection ids, the name a DNS query happens to
 * ask about. Pressing the dice should give a different-looking packet of the
 * same kind, not a different kind of packet.
 *
 * `hex` and `awg` have no parameters to redraw — their randomness, where
 * there is any, comes from the seed via AmneziaWG's `<r>` and `<t>` tags.
 */
export const redrawTemplate = (template: Template, rng: Rng): Template => {
    switch (template.kind) {
        case 'sip': return { kind: 'sip', params: { ...sipDefaults(rng), method: template.params.method } };
        case 'quic': {
            const fresh = quicDefaults(rng);
            const { serverName, alpn, size } = template.params;
            return { kind: 'quic', params: { ...fresh, serverName, alpn, size } };
        }
        case 'dns': {
            const { recordType, recursionDesired } = template.params;
            return { kind: 'dns', params: { ...dnsDefaults(rng), recordType, recursionDesired } };
        }
        case 'stun': return { kind: 'stun', params: { ...stunDefaults(rng), software: template.params.software } };
        case 'awg':
        case 'hex':
            return template;
    }
};

/** The datagram a template describes, drawn with the randomness given. */
export const renderTemplate = async (template: Template, rng: Rng): Promise<{ hex: string; notes: Note[] }> => {
    switch (template.kind) {
        case 'sip': return { hex: toHex(await buildSip(template.params, rng)), notes: [] };
        case 'quic': return { hex: toHex(await buildQuic(template.params, rng)), notes: [] };
        case 'dns': return { hex: toHex(await buildDns(template.params, rng)), notes: [] };
        case 'stun': return { hex: toHex(await buildStun(template.params, rng)), notes: [] };
        case 'awg': {
            const drawn = renderAwgSpec(template.tags, rng);
            return { hex: toHex(drawn.bytes), notes: drawn.notes };
        }
        // Nothing to draw: the bytes are the whole template.
        case 'hex': return { hex: template.hex, notes: [] };
    }
};

/** A step holding this template's bytes, drawn with a fresh seed. */
export const packetStep = async (template: Template, rng: Rng, delay?: string): Promise<{ step: PacketStep; notes: Note[] }> => {
    const seed = newSeed(rng);
    const { hex, notes } = await renderTemplate(template, seededRng(seed));
    return { step: { kind: 'packet', template, hex, seed, ...(delay ? { delay } : {}) }, notes };
};

/** One step's bytes, drawn again from its own seed — the same bytes unless its parameters changed. */
export const renderStep = async (step: PacketStep): Promise<{ step: PacketStep; notes: Note[] }> => {
    const { hex, notes } = await renderTemplate(step.template, seededRng(step.seed));
    return { step: { ...step, hex }, notes };
};

/**
 * Every packet step rebuilt from the seed it already has. Nothing moves that
 * the parameters did not move, which is what makes editing one field safe.
 */
export const rerenderRecipe = async (recipe: Recipe): Promise<{ recipe: Recipe; notes: Note[] }> => {
    const notes: Note[] = [];
    const steps: Step[] = [];
    for (const step of recipe.steps) {
        if (step.kind !== 'packet') {
            steps.push(step);
            continue;
        }
        const drawn = await renderStep(step);
        notes.push(...drawn.notes);
        steps.push(drawn.step);
    }
    return { recipe: { ...recipe, steps }, notes };
};

/** One step with a new identity and a new seed. */
export const redrawStep = async (step: PacketStep, rng: Rng): Promise<{ step: PacketStep; notes: Note[] }> => {
    const seed = newSeed(rng);
    const template = redrawTemplate(step.template, rng);
    const { hex, notes } = await renderTemplate(template, seededRng(seed));
    return { step: { ...step, template, hex, seed }, notes };
};

/**
 * Every packet step drawn again. A `hex` step has nothing to vary and comes
 * out byte for byte the same, which is the honest answer for bytes somebody
 * pasted in.
 */
export const redrawRecipe = async (recipe: Recipe, rng: Rng): Promise<{ recipe: Recipe; notes: Note[] }> => {
    const notes: Note[] = [];
    const steps: Step[] = [];
    for (const step of recipe.steps) {
        if (step.kind !== 'packet') {
            steps.push(step);
            continue;
        }
        const drawn = await redrawStep(step, rng);
        notes.push(...drawn.notes);
        steps.push(drawn.step);
    }
    return { recipe: { ...recipe, steps }, notes };
};

// ── Xray ─────────────────────────────────────────────────────────────────

/** The finalmask noise items a recipe writes as. */
export const toNoiseItems = (recipe: Recipe): NoiseItem[] => {
    const items: NoiseItem[] = [];
    for (const step of recipe.steps) {
        if (step.kind === 'packet') {
            items.push({ type: 'hex', packet: step.hex, ...(step.delay ? { delay: step.delay } : {}) });
            continue;
        }
        for (let i = 0; i < step.count; i++) {
            items.push({
                rand: step.size,
                ...(step.randRange ? { randRange: step.randRange } : {}),
                ...(step.delay ? { delay: step.delay } : {}),
            });
        }
    }
    return items;
};

const text = (value: unknown): string | undefined =>
    typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined;

/**
 * One item's bytes, decoded the way the core decodes them
 * (v26.7.28:infra/conf/transport_finalmask.go:33, PraseByteSlice): `hex`,
 * `str` and `base64` take a string, and an absent or `array` type takes a
 * JSON array of byte values.
 */
export const packetBytes = (item: NoiseItem): Uint8Array | null => {
    const { packet } = item;
    const kind = String(item.type ?? '').toLowerCase();
    if (kind === 'hex') return typeof packet === 'string' ? fromHex(packet) : null;
    if (kind === 'str') return typeof packet === 'string' ? new TextEncoder().encode(packet) : null;
    if (kind === 'base64') {
        if (typeof packet !== 'string') return null;
        try {
            return Uint8Array.from(atob(packet), char => char.charCodeAt(0));
        } catch {
            return null;
        }
    }
    if (kind === '' || kind === 'array') {
        if (!Array.isArray(packet)) return null;
        if (!packet.every(byte => typeof byte === 'number' && Number.isInteger(byte) && byte >= 0 && byte <= 255)) return null;
        return Uint8Array.from(packet as number[]);
    }
    return null;
};

/**
 * A noise layer read back as a recipe. The parameters that built each packet
 * are not in the config, so every packet comes back as `hex` — which is the
 * truth about what is known, not a limitation worth hiding. Consecutive
 * `rand` items that agree are folded into one junk step, the shape they were
 * almost certainly written in.
 */
export const fromNoiseItems = (value: unknown, reset?: unknown, rng: Rng = cryptoRng): Recipe => {
    const items: NoiseItem[] = Array.isArray(value)
        ? value.filter((item): item is NoiseItem => !!item && typeof item === 'object' && !Array.isArray(item))
        : [];
    const steps: Step[] = [];
    for (const item of items) {
        const delay = text(item.delay);
        if (item.packet !== undefined) {
            const bytes = packetBytes(item);
            // Bytes that will not decode are kept as they were written rather
            // than dropped: the config is the user's, and this is a reader.
            const hex = bytes ? toHex(bytes) : String(item.packet ?? '');
            steps.push({ kind: 'packet', template: { kind: 'hex', hex }, hex, seed: newSeed(rng), ...(delay ? { delay } : {}) });
            continue;
        }
        const size = text(item.rand);
        if (size === undefined) continue;
        const randRange = text(item.randRange);
        const last = steps[steps.length - 1];
        if (last?.kind === 'junk' && last.size === size && last.delay === delay && last.randRange === randRange) {
            last.count += 1;
            continue;
        }
        steps.push({ kind: 'junk', count: 1, size, ...(delay ? { delay } : {}), ...(randRange ? { randRange } : {}) });
    }
    const seconds = text(reset);
    return { steps, ...(seconds ? { reset: seconds } : {}) };
};

// ── Review ───────────────────────────────────────────────────────────────

/** A range as Xray parses it (infra/conf ParseRangeString): "40-70", or a bare number. */
export const parseRange = (value: string | undefined): [number, number] | null => {
    if (value === undefined) return null;
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const single = Number(trimmed);
    if (Number.isFinite(single)) return [single, single];
    const match = /^(-?\d+)-(-?\d+)$/.exec(trimmed);
    if (!match) return null;
    const from = Number(match[1]);
    const to = Number(match[2]);
    return from <= to ? [from, to] : [to, from];
};

/** The largest this recipe's datagrams can get, for comparing against a path MTU. */
export const largestDatagram = (recipe: Recipe): number =>
    recipe.steps.reduce((largest, step) => {
        const size = step.kind === 'packet' ? step.hex.length / 2 : (parseRange(step.size)?.[1] ?? 0);
        return Math.max(largest, size);
    }, 0);

/** How many datagrams go out before the first real packet. */
export const datagramCount = (recipe: Recipe): number =>
    recipe.steps.reduce((total, step) => total + (step.kind === 'packet' ? 1 : step.count), 0);

const templateProblems = (template: Template): Note[] => {
    switch (template.kind) {
        case 'sip': return sipProblems(template.params);
        case 'quic': return quicProblems(template.params);
        case 'dns': return dnsProblems(template.params);
        case 'stun': return stunProblems(template.params);
        case 'awg': return template.tags.length === 0
            ? [{ severity: 'warning', message: t("An AmneziaWG chain with no tags sends an empty datagram.") }]
            : [];
        case 'hex': return template.hex === ''
            ? [{ severity: 'warning', message: t("A packet with no bytes sends an empty datagram.") }]
            : [];
    }
};

/** Datagrams before the first real byte, past which the burst is itself a shape. */
const BUSY_CHAIN = 8;

/** SIP replies: a caller sends a request and receives these, never both. */
const SIP_REPLIES: string[] = ['trying', 'ringing'];

/** What a packet imitates, for spotting a chain that tells two stories at once. */
const protocolOf = (template: Template): string | null => {
    switch (template.kind) {
        case 'sip': return 'SIP';
        case 'quic': return 'QUIC';
        case 'dns': return 'DNS';
        case 'stun': return 'STUN';
        // Raw bytes and an imported chain could be anything, so they make no claim.
        case 'hex':
        case 'awg':
            return null;
    }
};

/**
 * How the chain reads as a whole.
 *
 * Each decoy goes to the same address and port as the real traffic, in order,
 * before anything real is sent — so the list is one flow to one endpoint, and
 * it either tells a story that endpoint could plausibly be part of or it does
 * not. None of this stops the config loading.
 */
export const combinationNotes = (recipe: Recipe): Note[] => {
    const notes: Note[] = [];
    const packets = recipe.steps.filter((step): step is PacketStep => step.kind === 'packet');

    // A caller sends INVITE; the far end answers 100 Trying. Both from this
    // side is not a call anyone makes, and a reader that follows SIP sees it.
    const methods = packets.flatMap(step => (step.template.kind === 'sip' ? [step.template.params.method] : []));
    const asks = methods.filter(method => !SIP_REPLIES.includes(method));
    const answers = methods.filter(method => SIP_REPLIES.includes(method));
    if (asks.length > 0 && answers.length > 0) {
        notes.push({
            severity: 'warning',
            message: t("This chain sends a SIP request and a SIP reply ({replies}) from the same end. In a real call the reply comes back from the other side, so the two together are not a conversation anyone has. Keep the request, or send the reply on its own.", {
                replies: answers.join(', '),
            }),
        });
    }

    // One endpoint, one application. Several protocols back to back is a
    // grab bag rather than a flow.
    const protocols = [...new Set(packets.map(step => protocolOf(step.template)).filter((name): name is string => name !== null))];
    if (protocols.length > 1) {
        notes.push({
            severity: 'info',
            message: t("These decoys imitate {count} protocols ({names}) on one address and port. A real flow is one application, so a single kind — plus junk — usually reads better than a mixture.", {
                count: protocols.length,
                names: protocols.join(', '),
            }),
        });
    }

    const total = datagramCount(recipe);
    if (total > BUSY_CHAIN) {
        notes.push({
            severity: 'info',
            message: t("{n} datagrams go out before the first real one. A long burst is a shape of its own; the WARP profiles send five or six.", { n: total }),
        });
    }

    return notes;
};

/**
 * What this recipe gets wrong, in the config's terms rather than each
 * builder's. Nothing here is fatal to the core — a noise layer is bytes on a
 * socket — so these are about whether the decoys do their job.
 */
export const recipeProblems = (recipe: Recipe): Note[] => {
    const notes: Note[] = [];
    for (const step of recipe.steps) {
        if (step.kind === 'packet') {
            notes.push(...templateProblems(step.template));
            continue;
        }
        const size = parseRange(step.size);
        if (!size) {
            notes.push({ severity: 'critical', message: t("\"{size}\" is not a length range — the core refuses the config.", { size: step.size }) });
        } else if (size[0] < 0) {
            notes.push({ severity: 'critical', message: t("A junk length cannot be negative.") });
        }
        if (step.count < 1) notes.push({ severity: 'warning', message: t("A junk step that sends nothing.") });
    }
    return notes;
};
