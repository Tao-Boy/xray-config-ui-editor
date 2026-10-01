/**
 * An Xray `wireguard` outbound as an AmneziaWG (or plain WireGuard) `.conf`.
 *
 * This is the inverse of `parseWireguardConfig` in `src/utils/link-parser.ts`,
 * and the field mapping is deliberately the same one, read backwards:
 *
 *   settings.secretKey          → [Interface] PrivateKey
 *   settings.address[]          → [Interface] Address
 *   settings.mtu                → [Interface] MTU
 *   options.dns[]               → [Interface] DNS
 *   settings.peers[]            → one [Peer] each
 *   finalmask.udp[noise].noise  → [Interface] I1..I5 and Jc/Jmin/Jmax
 *
 * This module owns the .conf TEXT and nothing else. What AWG's obfuscation
 * can hold — five decoy slots, one junk triple, no pauses — belongs to
 * `src/core/noise`: `fromNoiseItems` reads a noise list as a recipe and
 * `awgObfuscationFromRecipe` reshapes that recipe into `I` lines and a junk
 * triple, with the notes for everything the reshaping costs. Keeping the two
 * sides in one place is what stops the import and export directions from
 * disagreeing about what AWG can express.
 *
 * What is still this module's own: the `[Interface]`/`[Peer]` rendering, the
 * guards for a user-edited outbound, and the notes for items the recipe reader
 * does not model (it is a reader — an undecodable packet survives it, which is
 * right for a round-trip through the editor and wrong for a .conf, where
 * `<b 0xzz>` is not a packet).
 *
 * Nothing here throws: the outbound comes from a user-edited JSON config, so
 * every field is read through a guard and anything unreadable becomes a note.
 *
 * AWG facts cite github.com/amnezia-vpn/amneziawg-go; Xray facts cite the tag
 * whose source says so, not main.
 */

import { t, tn } from '../../i18n';
import { awgObfuscationFromRecipe, type AwgObfuscation } from '../noise/awg';
import { fromNoiseItems, packetBytes, parseRange } from '../noise/recipe';
import type { NoiseItem, Note, Rng } from '../noise/types';

export interface AwgConfOptions {
    /** DNS servers for the [Interface] DNS line. Omitted when empty. */
    dns?: string[];
}

/** The .conf text plus everything that could not be carried across. */
export interface AwgConfResult {
    conf: string;
    notes: Note[];
}

/**
 * A recipe gives every packet step a seed so the editor can redraw it. An
 * export draws nothing — it writes the bytes the config already holds — so the
 * seeds are never read, and taking them from the CSPRNG would make a pure
 * generator consume entropy and stop being reproducible. Zeroes it is.
 */
const EXPORT_RNG: Rng = length => new Uint8Array(length);

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const get = (value: unknown, key: string): unknown => (isObject(value) ? value[key] : undefined);

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** The non-empty strings of an array field; anything else in it is ignored. */
const strings = (value: unknown): string[] =>
    Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)
        : [];

/** A number the way a config may hold it: 1280 or "1280". */
const integer = (value: unknown): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null;
    const raw = text(value);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
};

/**
 * The fields of a noise item, each only as far as it can be trusted. The
 * values come from user-edited JSON, so a field of the wrong type is read as
 * absent — the core would refuse such a config anyway.
 */
const asNoiseItem = (value: unknown): NoiseItem => {
    const item = isObject(value) ? value : {};
    const scalar = (field: unknown): string | number | undefined =>
        typeof field === 'string' || typeof field === 'number' ? field : undefined;
    return {
        type: typeof item.type === 'string' ? item.type : undefined,
        packet: item.packet,
        rand: scalar(item.rand),
        randRange: scalar(item.randRange),
        delay: scalar(item.delay),
    };
};

/** The first `noise` layer of the outbound's UDP finalmask chain, if it has one. */
const noiseLayer = (outbound: unknown): unknown => {
    const masks = get(get(get(outbound, 'streamSettings'), 'finalmask'), 'udp');
    if (!Array.isArray(masks)) return undefined;
    return masks.find(mask => text(get(mask, 'type')).toLowerCase() === 'noise');
};

/**
 * The items of a noise list that can reach a .conf at all, with a note for
 * each that cannot.
 *
 * Only the conditions the recipe reader does not model are decided here: it
 * keeps an undecodable packet as the string it was written as, and it skips an
 * item that is neither a packet nor junk without saying so. Everything the
 * recipe does model — order, delays, how many packets fit, how the junk folds
 * together — is left to it and to `awgObfuscationFromRecipe`.
 */
const carryable = (raw: unknown[], notes: Note[]): NoiseItem[] => {
    const items: NoiseItem[] = [];
    let undecodable = 0;
    let empty = 0;
    let unreadableRand = 0;
    let bothKinds = 0;
    let neitherKind = 0;

    for (const value of raw) {
        const item = asNoiseItem(value);
        const hasPacket = item.packet !== undefined;
        const hasRand = item.rand !== undefined;
        if (hasPacket && hasRand) bothKinds++;

        if (hasPacket) {
            // Decoded here only to find out whether it decodes; the item goes
            // on unchanged, and the recipe decodes it again the same way.
            const bytes = packetBytes(item);
            if (bytes === null) undecodable++;
            else if (bytes.length === 0) empty++;
            else items.push(item);
            continue;
        }

        if (hasRand) {
            if (parseRange(typeof item.rand === 'number' ? String(item.rand) : item.rand) === null) unreadableRand++;
            else items.push(item);
            continue;
        }

        neitherKind++;
    }

    if (bothKinds > 0) {
        notes.push({
            severity: 'warning',
            message: tn(
                bothKinds,
                "{n} noise item sets both packet and rand, which no supported core loads (v26.7.28:infra/conf/transport_finalmask.go:387). Exported as fixed bytes.",
                "{n} noise items set both packet and rand, which no supported core loads (v26.7.28:infra/conf/transport_finalmask.go:387). Exported as fixed bytes.",
            ),
        });
    }
    if (neitherKind > 0) {
        notes.push({
            severity: 'warning',
            message: tn(
                neitherKind,
                "{n} noise item has neither packet nor rand and were left out.",
                "{n} noise items have neither packet nor rand and were left out.",
            ),
        });
    }
    if (undecodable > 0) {
        notes.push({
            severity: 'warning',
            message: tn(
                undecodable,
                "{n} noise packet could not be decoded (type must be hex, str, base64 or array) and were left out.",
                "{n} noise packets could not be decoded (type must be hex, str, base64 or array) and were left out.",
            ),
        });
    }
    if (empty > 0) {
        notes.push({
            severity: 'warning',
            message: tn(
                empty,
                "{n} noise packet decoded to no bytes and were left out: AWG has no way to send an empty decoy.",
                "{n} noise packets decoded to no bytes and were left out: AWG has no way to send an empty decoy.",
            ),
        });
    }
    if (unreadableRand > 0) {
        notes.push({
            severity: 'warning',
            message: tn(
                unreadableRand,
                "{n} random noise item has a size that could not be read (expected \"40-70\" or a number) and were left out of Jc.",
                "{n} random noise items have a size that could not be read (expected \"40-70\" or a number) and were left out of Jc.",
            ),
        });
    }

    return items;
};

/** The `I` lines and junk triple this outbound's noise layer becomes. */
const awgObfuscation = (outbound: unknown, notes: Note[]): Omit<AwgObfuscation, 'notes'> => {
    const layer = noiseLayer(outbound);
    if (layer === undefined) return { iLines: [] };

    const settings = get(layer, 'settings');
    const raw = get(settings, 'noise');
    if (!Array.isArray(raw)) {
        notes.push({
            severity: 'warning',
            message: t("The finalmask noise layer has no noise list, so the exported .conf carries no decoys."),
        });
        return { iLines: [] };
    }

    // A reset of 0 or "" is how a config says "do not re-arm", so it is not
    // passed on: the recipe would carry it and report a setting as lost that
    // was never asked for.
    const reset = get(settings, 'reset');
    const rearms = reset !== undefined && reset !== 0 && reset !== '' && reset !== '0';

    const recipe = fromNoiseItems(carryable(raw, notes), rearms ? reset : undefined, EXPORT_RNG);
    const { iLines, junk, notes: reshaping } = awgObfuscationFromRecipe(recipe);
    notes.push(...reshaping);
    return { iLines, ...(junk ? { junk } : {}) };
};

/**
 * `settings.reserved` is Xray's three-byte substitution in WireGuard's own
 * header, which is how it reaches Cloudflare WARP. AWG's S1/S2 pad WireGuard's
 * handshake messages — a different field doing a different thing — so writing
 * one as the other would produce a conf that looks right and never connects.
 */
const reservedNote = (reserved: unknown): Note | null => {
    if (!Array.isArray(reserved) || reserved.length === 0) return null;
    if (reserved.every(byte => byte === 0)) return null;
    return {
        severity: 'warning',
        message: t("The outbound's reserved ({bytes}) was dropped: it substitutes three bytes of WireGuard's header for Cloudflare WARP, and AWG has no equivalent. It is not the same thing as S1/S2, which pad handshake messages, so it was not written as those.", { bytes: reserved.join(', ') }),
    };
};

const peerBlock = (peer: unknown, index: number, notes: Note[]): string[] => {
    const lines = ['', '[Peer]'];
    const missing: string[] = [];

    const publicKey = text(get(peer, 'publicKey'));
    if (publicKey) lines.push(`PublicKey = ${publicKey}`);
    else missing.push('publicKey');

    const preSharedKey = text(get(peer, 'preSharedKey'));
    if (preSharedKey) lines.push(`PresharedKey = ${preSharedKey}`);

    // An empty allowedIPs is a catch-all peer on both sides — the importer
    // fills in the same pair when the .conf omits the line
    // (src/utils/link-parser.ts:63).
    const allowedIPs = strings(get(peer, 'allowedIPs'));
    lines.push(`AllowedIPs = ${(allowedIPs.length > 0 ? allowedIPs : ['0.0.0.0/0', '::/0']).join(', ')}`);

    const endpoint = text(get(peer, 'endpoint'));
    if (endpoint) lines.push(`Endpoint = ${endpoint}`);
    else missing.push('endpoint');

    const keepAlive = integer(get(peer, 'keepAlive'));
    if (keepAlive !== null && keepAlive > 0) lines.push(`PersistentKeepalive = ${keepAlive}`);

    if (missing.length > 0) {
        notes.push({
            severity: 'warning',
            // Spelled out per case rather than joined: " and no " is a word, not
            // data, and a joined list would leave it in English either way.
            message: missing.length > 1
                ? t("Peer {index} has no publicKey and no endpoint, so the client app has nothing to connect to.", { index: index + 1 })
                : t("Peer {index} has no {field}, so the client app has nothing to connect to.", { index: index + 1, field: missing[0] }),
        });
    }
    return lines;
};

/**
 * No S1..S4 and no H1..H4 are ever written. This app does not model them, and
 * a default is not neutral: they change what WireGuard itself puts on the wire
 * (device/send.go:149, device/noise-protocol.go:59-62), so inventing values
 * would break the handshake against the plain WireGuard peer Xray dials.
 */
const HEADER = [
    '# AmneziaWG configuration exported from an Xray wireguard outbound.',
    '# No S1-S4 or H1-H4: they change WireGuard\'s own packets, both ends would',
    '# have to agree, and this config describes a standard WireGuard peer.',
];

/** An Xray `wireguard` outbound as an AmneziaWG .conf. */
export const toAwgConf = (outbound: unknown, options: AwgConfOptions = {}): AwgConfResult => {
    const notes: Note[] = [];
    try {
        const protocol = text(get(outbound, 'protocol')).toLowerCase();
        if (protocol && protocol !== 'wireguard') {
            notes.push({
                severity: 'warning',
                message: t("This outbound is \"{protocol}\", not wireguard. Only the fields a WireGuard client reads were exported.", { protocol }),
            });
        }

        const settings = get(outbound, 'settings');
        const lines = [...HEADER, '[Interface]'];

        const secretKey = text(get(settings, 'secretKey'));
        if (secretKey) lines.push(`PrivateKey = ${secretKey}`);
        else notes.push({ severity: 'warning', message: t("The outbound has no secretKey, so the .conf has no PrivateKey and no client app will load it.") });

        const address = strings(get(settings, 'address'));
        if (address.length > 0) lines.push(`Address = ${address.join(', ')}`);
        else notes.push({ severity: 'warning', message: t("The outbound has no address, so the .conf has no Address line and the interface cannot come up.") });

        const dns = strings(options.dns);
        if (dns.length > 0) lines.push(`DNS = ${dns.join(', ')}`);

        const mtu = integer(get(settings, 'mtu'));
        if (mtu !== null && mtu > 0) lines.push(`MTU = ${mtu}`);

        const { iLines, junk } = awgObfuscation(outbound, notes);
        if (junk) lines.push(`Jc = ${junk.count}`, `Jmin = ${junk.min}`, `Jmax = ${junk.max}`);
        // Already formatted as AWG's tag chains and already capped at five.
        iLines.forEach((spec, at) => lines.push(`I${at + 1} = ${spec}`));

        const reserved = reservedNote(get(settings, 'reserved'));
        if (reserved) notes.push(reserved);

        const peers = get(settings, 'peers');
        const peerList = Array.isArray(peers) ? peers : [];
        if (peerList.length === 0) {
            notes.push({ severity: 'warning', message: t("The outbound has no peers, so the .conf has no [Peer] section.") });
        }
        peerList.forEach((peer, index) => lines.push(...peerBlock(peer, index, notes)));

        return { conf: `${lines.join('\n')}\n`, notes };
    } catch (error) {
        // A config this app did not write can be shaped in ways no guard above
        // anticipated; an export that reports failure beats one that throws
        // inside whatever UI called it.
        notes.push({ severity: 'critical', message: t("The outbound could not be exported: {error}", { error: error instanceof Error ? error.message : String(error) }) });
        return { conf: '', notes };
    }
};
