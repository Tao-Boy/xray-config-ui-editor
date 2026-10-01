/**
 * Finalmask, line by line: which settings each mask's struct decodes, which
 * side reads them, and the rules about where in a chain a mask may sit.
 *
 * FEATURES answers "does this line know this key" one path at a time, which
 * is enough for a checker but not for a form: a form has to draw every key a
 * mask takes on the chosen line, including the ones nothing ever changed.
 * MASK_KEYS is that list, read off the structs in
 * `infra/conf/transport_internet.go` (v26.3.27) and
 * `infra/conf/transport_finalmask.go` (v26.7.28, v26.9.9). Where a FEATURES
 * row exists for a key it still wins — `maskKeyStatus` asks it first — and
 * finalmask-rules.test.ts holds the two to each other.
 *
 * The chain rules at the bottom are the part no key table can say: a mask
 * that only works at one end of the list, and which end that is, moved
 * between lines. All of them fail at runtime rather than at load, so their
 * severity follows who pays: an inbound that cannot listen stops the core
 * from starting (`v26.9.9:app/proxyman/inbound/inbound.go:115` returns the
 * handler's error from Start), an outbound that cannot dial only fails its
 * own connections.
 */
import { t } from '../../../i18n';
import { coreVersion, type CoreVersionId } from './index';
import { allowedValues, coreValueSet, FEATURES, type FeatureStatus } from './features';

export type MaskList = 'tcp' | 'udp';
export type MaskSide = 'inbound' | 'outbound';

/** Where finalmask sits in an inbound or outbound — the prefix of every path here. */
export const FINALMASK_PATH = 'streamSettings.finalmask';

/**
 * The JSON a settings key decodes into, which is what an editor draws for it.
 *
 *   range   Int32Range: `10` or `"5-30"`
 *   ranges  []Int32Range
 *   ports   PortList: `443` or `"20000-30000,443"`
 *   choice  a string from `options`; empty means the core's default
 *   flags   a comma-separated combination of `options`
 *   json    anything with inner structure (items, TLS, sockopt)
 *   noise   the noise mask's item list
 *   udpHop  quicParams.udpHop: `{ports, interval}`
 */
export type MaskKeyShape =
    | 'string' | 'strings' | 'range' | 'ranges' | 'ports' | 'number' | 'bool'
    | 'choice' | 'flags' | 'json' | 'noise' | 'udpHop';

export interface MaskKey {
    key: string;
    shape: MaskKeyShape;
    /** The lines whose struct decodes this key. */
    lines: CoreVersionId[];
    /** Decoded on both sides, read by one. */
    side?: MaskSide;
    options?: string[];
    /** A second spelling the core falls back to: shown when present, never offered. */
    legacy?: boolean;
}

const ALL: CoreVersionId[] = ['26.3', '26.7', '26.9'];
const FROM_267: CoreVersionId[] = ['26.7', '26.9'];
const ONLY_263: CoreVersionId[] = ['26.3'];
const ONLY_269: CoreVersionId[] = ['26.9'];

// Sudoku is one struct for both lists and the same on every line:
// v26.3.27:transport_internet.go:1618, v26.9.9:transport_finalmask.go:654.
// The snake_case keys are fallbacks Build() reads when the camelCase one is empty.
const SUDOKU: MaskKey[] = [
    { key: 'password', shape: 'string', lines: ALL },
    { key: 'ascii', shape: 'string', lines: ALL },
    { key: 'customTable', shape: 'string', lines: ALL },
    { key: 'customTables', shape: 'strings', lines: ALL },
    { key: 'paddingMin', shape: 'number', lines: ALL },
    { key: 'paddingMax', shape: 'number', lines: ALL },
    { key: 'custom_table', shape: 'string', lines: ALL, legacy: true },
    { key: 'custom_tables', shape: 'strings', lines: ALL, legacy: true },
    { key: 'padding_min', shape: 'number', lines: ALL, legacy: true },
    { key: 'padding_max', shape: 'number', lines: ALL, legacy: true },
];

/** The eight 26.3 UDP masks mkcp-legacy replaced; none of them survived 26.3. */
const HEADER_TYPES = ['header-dtls', 'header-srtp', 'header-utp', 'header-wechat', 'header-wireguard'];

export const MASK_KEYS: Record<MaskList, Record<string, MaskKey[]>> = {
    tcp: {
        // v26.3.27:transport_internet.go:1270, v26.9.9:transport_finalmask.go:103
        'header-custom': [
            { key: 'clients', shape: 'json', lines: ALL },
            { key: 'servers', shape: 'json', lines: ALL },
            { key: 'errors', shape: 'json', lines: ALL },
        ],
        // v26.3.27:transport_internet.go:1383; lengths/delays from v26.7.28:transport_finalmask.go:238
        fragment: [
            { key: 'packets', shape: 'string', lines: ALL },
            { key: 'length', shape: 'range', lines: ALL },
            { key: 'lengths', shape: 'ranges', lines: FROM_267 },
            { key: 'delay', shape: 'range', lines: ALL },
            { key: 'delays', shape: 'ranges', lines: FROM_267 },
            { key: 'maxSplit', shape: 'range', lines: ALL },
        ],
        sudoku: SUDOKU,
        // v26.7.28:transport_finalmask.go:723; hostname only reaches newClientConn
        // (v26.9.9:transport/internet/finalmask/xmc/config.go:13).
        xmc: [
            { key: 'password', shape: 'string', lines: FROM_267 },
            { key: 'profiles', shape: 'json', lines: FROM_267 },
            { key: 'hostname', shape: 'string', lines: FROM_267, side: 'outbound' },
        ],
    },
    udp: {
        // v26.3.27:transport_internet.go:1484; mode from v26.7.28:transport_finalmask.go:505,
        // matched exactly — "" and "prefix" are the same thing.
        'header-custom': [
            { key: 'mode', shape: 'choice', lines: FROM_267, options: ['prefix', 'standalone'] },
            { key: 'client', shape: 'json', lines: ALL },
            { key: 'server', shape: 'json', lines: ALL },
        ],
        // v26.3.27:transport_internet.go:1547 (domain defaults to www.baidu.com)
        'header-dns': [{ key: 'domain', shape: 'string', lines: ONLY_263 }],
        ...Object.fromEntries([...HEADER_TYPES, 'mkcp-original'].map(type => [type, [] as MaskKey[]])),
        // v26.3.27:transport_internet.go:1598
        'mkcp-aes128gcm': [{ key: 'password', shape: 'string', lines: ONLY_263 }],
        // v26.7.28:transport_finalmask.go:595 — header picks the old type, value
        // carries what the old settings did (dns domain, aes128gcm password).
        'mkcp-legacy': [
            { key: 'header', shape: 'choice', lines: FROM_267, options: ['dns', 'dtls', 'srtp', 'utp', 'wechat', 'wireguard'] },
            { key: 'value', shape: 'string', lines: FROM_267 },
        ],
        // v26.3.27:transport_internet.go:1435, v26.9.9:transport_finalmask.go:306
        noise: [
            { key: 'noise', shape: 'noise', lines: ALL },
            { key: 'reset', shape: 'range', lines: ALL },
        ],
        // v26.3.27:transport_internet.go:1608; packetSize from v26.7.28:transport_finalmask.go:632
        salamander: [
            { key: 'password', shape: 'string', lines: ALL },
            { key: 'packetSize', shape: 'range', lines: FROM_267 },
        ],
        sudoku: SUDOKU,
        // v26.3.27:transport_internet.go:1662 took one domain. v26.7.28:transport_finalmask.go:695
        // splits it: the server answers for `domains` (xdns/server.go:69), the
        // client sends through `resolvers` (xdns/client.go:58).
        xdns: [
            { key: 'domain', shape: 'string', lines: ONLY_263 },
            { key: 'domains', shape: 'strings', lines: FROM_267, side: 'inbound' },
            { key: 'resolvers', shape: 'strings', lines: FROM_267, side: 'outbound' },
        ],
        // v26.3.27:transport_internet.go:1676; v26.7.28:transport_finalmask.go:798. Only the
        // client opens a datagram ICMP socket (v26.9.9:finalmask/xicmp/client.go:56).
        xicmp: [
            { key: 'listenIp', shape: 'string', lines: ONLY_263 },
            { key: 'id', shape: 'number', lines: ONLY_263 },
            { key: 'ips', shape: 'strings', lines: FROM_267 },
            { key: 'dgram', shape: 'bool', lines: FROM_267, side: 'outbound' },
        ],
        // v26.7.28:transport_finalmask.go:818; ipMode/portMapping v26.9.9:transport_finalmask.go:825
        realm: [
            { key: 'url', shape: 'string', lines: FROM_267 },
            { key: 'stunServers', shape: 'strings', lines: FROM_267 },
            { key: 'tlsConfig', shape: 'json', lines: FROM_267 },
            { key: 'ipMode', shape: 'choice', lines: ONLY_269, options: ['dual', 'v4', 'v6'] },
            { key: 'portMapping', shape: 'json', lines: ONLY_269 },
        ],
        // v26.9.9:transport_finalmask.go:911. The whole mask is client-only
        // (finalmask/udphop/config.go:19), so its keys carry no side of their own.
        udphop: [
            { key: 'mode', shape: 'flags', lines: ONLY_269, options: ['intervalLocal', 'intervalRemote', 'perConnRemote'] },
            { key: 'interval', shape: 'range', lines: ONLY_269 },
            { key: 'remotePorts', shape: 'ports', lines: ONLY_269 },
            { key: 'remoteIPs', shape: 'strings', lines: ONLY_269 },
            { key: 'sockopt', shape: 'json', lines: ONLY_269 },
        ],
    },
};

/**
 * `finalmask.quicParams`, one struct per line: v26.3.27:transport_internet.go:630,
 * v26.7.28:transport_finalmask.go:930, v26.9.9:transport_finalmask.go:993.
 * All numbers are plain integers — `maxIdleTimeout` and `keepAlivePeriod` in
 * seconds — and there is no handshake timeout at all.
 */
export const QUIC_KEYS: MaskKey[] = [
    { key: 'congestion', shape: 'choice', lines: ALL, options: ['reno', 'bbr', 'brutal', 'force-brutal'] },
    { key: 'bbrProfile', shape: 'choice', lines: FROM_267, options: ['conservative', 'standard', 'aggressive'] },
    { key: 'brutalUp', shape: 'string', lines: ALL },
    { key: 'brutalDown', shape: 'string', lines: ALL },
    { key: 'brutalDisableLossCompensation', shape: 'bool', lines: ONLY_269 },
    { key: 'maxIdleTimeout', shape: 'number', lines: ALL },
    { key: 'keepAlivePeriod', shape: 'number', lines: ALL },
    { key: 'initStreamReceiveWindow', shape: 'number', lines: ALL },
    { key: 'maxStreamReceiveWindow', shape: 'number', lines: ALL },
    { key: 'initConnectionReceiveWindow', shape: 'number', lines: ALL },
    { key: 'maxConnectionReceiveWindow', shape: 'number', lines: ALL },
    { key: 'maxIncomingStreams', shape: 'number', lines: ALL },
    { key: 'disablePathMTUDiscovery', shape: 'bool', lines: ALL },
    { key: 'disableChromeParrot', shape: 'bool', lines: ONLY_269 },
    { key: 'disableGSO', shape: 'bool', lines: ONLY_269 },
    { key: 'disableStatelessReset', shape: 'bool', lines: ONLY_269 },
    { key: 'debug', shape: 'bool', lines: ALL },
    // Gone from the struct in 26.9, where the udphop mask does the job.
    { key: 'udpHop', shape: 'udpHop', lines: ['26.3', '26.7'] },
];

/** Masks the core refuses to run on a server (`WrapPacketConnServer` errors). */
const CLIENT_ONLY_TYPES = new Set(['udphop']);

export const maskKeys = (list: MaskList, type: string): MaskKey[] =>
    MASK_KEYS[list][type.toLowerCase()] ?? [];

export interface KeyStatus {
    status: FeatureStatus;
    /** The line decodes the key, but only this side does anything with it. */
    readBy?: MaskSide;
    legacy?: boolean;
    /** What to use instead, when a FEATURES row names something. */
    replacement?: string;
}

const statusOf = (
    version: CoreVersionId,
    path: string,
    spec: MaskKey | undefined,
    side?: MaskSide,
): KeyStatus => {
    // A FEATURES row is the per-path answer the checker gives, so the form
    // gives the same one. Only the loud answers need it: "accepted" and
    // "absent" follow from the key table, and the test holds them together.
    const scope = side ?? 'outbound';
    const row = FEATURES.find(feature =>
        feature.scope === scope && feature.path === path && feature.value === undefined && !feature.protocol);
    const rowStatus = row?.status[version];
    const replacement = row?.replacement ? { replacement: row.replacement } : {};
    if (rowStatus === 'rejected' || rowStatus === 'deprecated') return { status: rowStatus, ...replacement };
    if (!spec || !spec.lines.includes(version)) return { status: 'absent', ...(rowStatus === 'absent' ? replacement : {}) };
    if (side && spec.side && spec.side !== side) return { status: 'accepted', readBy: spec.side };
    return spec.legacy ? { status: 'accepted', legacy: true } : { status: 'accepted' };
};

/** What `version` does with one settings key of one mask, seen from `side`. */
export const maskKeyStatus = (
    version: CoreVersionId,
    list: MaskList,
    type: string,
    key: string,
    side?: MaskSide,
): KeyStatus =>
    statusOf(
        version,
        `${FINALMASK_PATH}.${list}[type=${type.toLowerCase()}].settings.${key}`,
        maskKeys(list, type).find(spec => spec.key === key),
        side,
    );

/** What `version` does with one quicParams key. */
export const quicKeyStatus = (version: CoreVersionId, key: string, side?: MaskSide): KeyStatus =>
    statusOf(version, `${FINALMASK_PATH}.quicParams.${key}`, QUIC_KEYS.find(spec => spec.key === key), side);

/**
 * The keys a form should offer for a mask: decoded on this line, not a
 * fallback spelling, and read on this side. With no side known, both sides'
 * keys are offered.
 */
export const offeredMaskKeys = (version: CoreVersionId, list: MaskList, type: string, side?: MaskSide): MaskKey[] =>
    maskKeys(list, type).filter(spec =>
        spec.lines.includes(version) && !spec.legacy && (!side || !spec.side || spec.side === side));

export const offeredQuicKeys = (version: CoreVersionId): MaskKey[] =>
    QUIC_KEYS.filter(spec => spec.lines.includes(version));

export interface MaskTypeStatus {
    /** This line registers the type in this list. */
    accepted: boolean;
    /** What took its place, when the value set names something. */
    replacement?: string;
    /** Registered, but the core refuses to run it on this side. */
    clientOnly?: boolean;
}

export const maskTypeStatus = (version: CoreVersionId, list: MaskList, type: string, side?: MaskSide): MaskTypeStatus => {
    const id = `finalmask.${list}.type`;
    const wanted = type.toLowerCase();
    const accepted = allowedValues(version, id).some(value => value.toLowerCase() === wanted);
    const replacement = accepted ? undefined : coreValueSet(id)?.replacedBy?.[wanted];
    return {
        accepted,
        ...(replacement ? { replacement } : {}),
        ...(accepted && side === 'inbound' && CLIENT_ONLY_TYPES.has(wanted) ? { clientOnly: true } : {}),
    };
};

/**
 * The types a chooser should list: what this line registers in this list,
 * minus client-only masks on an inbound, plus the current type whatever it is
 * — a chooser that goes blank on a refused type hides the one thing the user
 * needs to see.
 */
export const maskTypeChoices = (version: CoreVersionId, list: MaskList, side?: MaskSide, current?: string): string[] => {
    const choices = allowedValues(version, `finalmask.${list}.type`)
        .filter(type => !(side === 'inbound' && CLIENT_ONLY_TYPES.has(type)));
    return current && !choices.some(type => type.toLowerCase() === current.toLowerCase())
        ? [...choices, current]
        : choices;
};

/**
 * The mkcp-legacy mask that builds what a removed 26.3 mask built.
 *
 * v26.7.28:transport_finalmask.go:600 — no header and no value is
 * mkcp-original, no header with a value is aes128gcm keyed by it, and a header
 * picks the old header mask, with `value` as the dns domain. Returns null for
 * a type mkcp-legacy does not replace.
 */
export const toMkcpLegacy = (type: string, settings: unknown): { type: 'mkcp-legacy'; settings: Record<string, string> } | null => {
    const old = (settings && typeof settings === 'object' ? settings : {}) as Record<string, unknown>;
    const text = (value: unknown) => (typeof value === 'string' ? value : '');
    switch (type.toLowerCase()) {
        case 'mkcp-original':
            return { type: 'mkcp-legacy', settings: {} };
        case 'mkcp-aes128gcm':
            return { type: 'mkcp-legacy', settings: text(old.password) ? { value: text(old.password) } : {} };
        case 'header-dns':
            return { type: 'mkcp-legacy', settings: { header: 'dns', ...(text(old.domain) ? { value: text(old.domain) } : {}) } };
        case 'header-dtls':
        case 'header-srtp':
        case 'header-utp':
        case 'header-wechat':
        case 'header-wireguard':
            return { type: 'mkcp-legacy', settings: { header: type.toLowerCase().slice('header-'.length) } };
        default:
            return null;
    }
};

// ── Chain rules ─────────────────────────────────────────────────────────

export interface FinalmaskIssue {
    /** From the inbound/outbound: `streamSettings.finalmask.udp[1].settings.mode`. */
    path: string;
    severity: 'critical' | 'warning' | 'info';
    message: string;
}

/**
 * Masks that must sit at level 0 — the one the core wraps first — and the
 * index level 0 is on each line. v26.3.27 walks the list forward, so level 0
 * is udp[0] (finalmask/finalmask.go:31); v26.7.28 walks it with
 * slices.Backward but keeps the original index as the level, so level 0 is
 * still udp[0] (finalmask.go:32); v26.9.9 reverses the slice before numbering
 * (finalmask.go:22), which puts level 0 at udp[last].
 *
 *   xicmp   v26.3.27:finalmask/xicmp/client.go:60, server.go:54;
 *           v26.7.28:finalmask/xicmp/config.go:17; v26.9.9:finalmask/xicmp/config.go:12
 *   realm   v26.7.28:finalmask/realm/config.go:16; v26.9.9:finalmask/realm/config.go:12
 *   udphop  v26.9.9:finalmask/udphop/config.go:12
 */
const OUTERMOST: Record<string, Partial<Record<CoreVersionId, 'first' | 'last'>>> = {
    xicmp: { '26.3': 'first', '26.7': 'first', '26.9': 'last' },
    realm: { '26.7': 'first', '26.9': 'last' },
    udphop: { '26.9': 'last' },
};

/**
 * A UDP sudoku mask must be at level == count-1 ("must be the innermost mask
 * in chain"): udp[last] before 26.9, udp[0] after the reversal.
 * v26.3.27:finalmask/sudoku/config.go:46, v26.7.28:finalmask/sudoku/config.go:46,
 * v26.9.9:finalmask/sudoku/config.go:40.
 */
const INNERMOST: Record<string, Partial<Record<CoreVersionId, 'first' | 'last'>>> = {
    sudoku: { '26.3': 'last', '26.7': 'last', '26.9': 'first' },
};

/**
 * The end of a mask list the core wraps around the socket first — the mask
 * whose output is what goes on the wire. 26.3 walks the list forward
 * (v26.3.27:finalmask/finalmask.go:31), 26.7 walks it backward
 * (v26.7.28:finalmask.go:32) and 26.9 reverses it before walking
 * (v26.9.9:finalmask.go:22).
 */
export const socketEnd = (version: CoreVersionId): 'first' | 'last' => (version === '26.3' ? 'first' : 'last');

/** The end of the UDP list a mask of this type has to hold on this line, if it has to hold one. */
export const pinnedEnd = (version: CoreVersionId, type: string): 'first' | 'last' | undefined => {
    const key = type.toLowerCase();
    return OUTERMOST[key]?.[version] ?? INNERMOST[key]?.[version];
};

const UDPHOP_MODES = ['intervallocal', 'intervalremote', 'perconnremote'];

const isObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

const typeOf = (mask: unknown): string =>
    isObject(mask) && typeof mask.type === 'string' ? mask.type.toLowerCase() : '';

const settingsOf = (mask: unknown): Record<string, unknown> =>
    isObject(mask) && isObject(mask.settings) ? mask.settings : {};

const nonEmptyStrings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry !== '') : [];

/**
 * An Int32Range the way `infra/conf/common.go` reads it: a number, or a
 * string that is a number or "a-b". Null for anything it would refuse.
 */
export const parseInt32Range = (value: unknown): [number, number] | null => {
    if (value === undefined || value === null) return [0, 0];
    if (typeof value === 'number') return Number.isInteger(value) ? [value, value] : null;
    if (typeof value !== 'string') return null;
    const text = value;
    if (text === '') return [0, 0];
    if (/^[+-]?\d+$/.test(text)) {
        const n = Number(text);
        return [n, n];
    }
    const match = /^(-?\d+)-(-?\d+)$/.exec(text);
    if (!match) return null;
    const a = Number(match[1]);
    const b = Number(match[2]);
    return a <= b ? [a, b] : [b, a];
};

/**
 * The runtime rules for one finalmask on one line, from one side.
 *
 * Covers what FEATURES and VALUE_SETS cannot: where in the chain a mask may
 * sit, and the xdns/udphop settings the core refuses to start without. Keys
 * and types a line does not know are left to those tables, so nothing here
 * repeats a finding the version check already reports. Types the line does
 * not register are skipped for the same reason.
 */
export const finalmaskIssues = (finalmask: unknown, version: CoreVersionId, direction: MaskSide): FinalmaskIssue[] => {
    if (!isObject(finalmask)) return [];
    const { tag } = coreVersion(version);
    const out: FinalmaskIssue[] = [];
    // Runtime failures: a listener that cannot start takes the core down with
    // it; a dial that fails only loses that connection.
    const runtime: FinalmaskIssue['severity'] = direction === 'inbound' ? 'critical' : 'warning';
    const lists: MaskList[] = ['udp', 'tcp'];

    for (const list of lists) {
        const masks = Array.isArray(finalmask[list]) ? finalmask[list] as unknown[] : [];
        if (masks.length < 2) continue;
        // The wrapping order flipped in 26.7: v26.3.27:finalmask/finalmask.go:31/207
        // walk forward, v26.7.28:finalmask.go:32/216 walk backward and
        // v26.9.9:finalmask.go:22/204 reverse first — the same list is a
        // different wire format on either side of 26.3 → 26.7.
        const name = list.toUpperCase();
        out.push({
            path: `${FINALMASK_PATH}.${list}`,
            severity: 'info',
            message: version === '26.3'
                ? t("Xray {tag} applies the first {list} mask nearest the socket; 26.7 and later apply the last one there. A peer on 26.7 or later needs this list in reverse order.", { tag, list: name })
                : t("Xray {tag} applies the last {list} mask nearest the socket; 26.3 applied the first one there. A peer on 26.3 needs this list in reverse order.", { tag, list: name }),
        });
    }

    const udp = Array.isArray(finalmask.udp) ? finalmask.udp as unknown[] : [];
    const registered = new Set(allowedValues(version, 'finalmask.udp.type').map(type => type.toLowerCase()));
    const quicParams = isObject(finalmask.quicParams) ? finalmask.quicParams : {};
    const hopPorts = isObject(quicParams.udpHop) ? quicParams.udpHop.ports : undefined;
    const hopping = hopPorts !== undefined && hopPorts !== null && hopPorts !== '' && hopPorts !== 0;

    udp.forEach((mask, index) => {
        const type = typeOf(mask);
        if (!registered.has(type)) return;
        const at = `${FINALMASK_PATH}.udp[${index}]`;
        const last = udp.length - 1;

        // With one mask, level 0 is also the last level: nothing to place.
        const outer = OUTERMOST[type]?.[version];
        if (outer && udp.length > 1 && index !== (outer === 'first' ? 0 : last)) {
            out.push({
                path: at,
                severity: runtime,
                message: outer === 'first'
                    ? t("{type} has to be the first UDP mask on Xray {tag}. Anywhere else the core stops with \"requires being at the outermost level\" when it sets the connection up.", { type, tag })
                    : t("{type} has to be the last UDP mask on Xray {tag}. Anywhere else the core stops with \"requires being at the outermost level\" when it sets the connection up.", { type, tag }),
            });
        }
        const inner = INNERMOST[type]?.[version];
        if (inner && udp.length > 1 && index !== (inner === 'first' ? 0 : last)) {
            out.push({
                path: at,
                severity: runtime,
                message: inner === 'first'
                    ? t("A UDP sudoku mask has to be the first in the list on Xray {tag}. Anywhere else the core stops with \"must be the innermost mask in chain\".", { tag })
                    : t("A UDP sudoku mask has to be the last in the list on Xray {tag}. Anywhere else the core stops with \"must be the innermost mask in chain\".", { tag }),
            });
        }

        // Before 26.9 a client also refuses these on top of quicParams.udpHop:
        // the hop conn is what they would wrap (v26.3.27:finalmask/xicmp/client.go:60,
        // v26.7.28:finalmask/xicmp/config.go:17, realm/config.go:16), and a hop conn
        // exists once ports are set (v26.7.28:transport/internet/hysteria/dialer.go:162).
        if (direction === 'outbound' && hopping && version !== '26.9' && (type === 'xicmp' || type === 'realm')) {
            out.push({
                path: at,
                severity: 'warning',
                message: t("{type} cannot run over quicParams.udpHop on Xray {tag}: with hop ports set, every dial fails with \"requires being at the outermost level\".", { type, tag }),
            });
        }

        const settings = settingsOf(mask);
        if (type === 'xdns') out.push(...xdnsIssues(settings, `${at}.settings`, version, direction, tag));
        if (type === 'udphop') out.push(...udphopIssues(settings, at, direction, tag));
    });

    return out;
};

const xdnsIssues = (
    settings: Record<string, unknown>,
    at: string,
    version: CoreVersionId,
    direction: MaskSide,
    tag: string,
): FinalmaskIssue[] => {
    if (version === '26.3') {
        // v26.3.27:transport_internet.go:1667 — "empty domain" at load.
        return typeof settings.domain === 'string' && settings.domain !== ''
            ? []
            : [{
                path: `${at}.domain`,
                severity: 'critical',
                message: t("xdns needs a domain on Xray {tag}; without one the config does not load (\"empty domain\").", { tag }),
            }];
    }
    const out: FinalmaskIssue[] = [];
    const domains = nonEmptyStrings(settings.domains);
    const resolvers = nonEmptyStrings(settings.resolvers);
    if (domains.length === 0 && resolvers.length === 0) {
        // v26.7.28:transport_finalmask.go:707, v26.9.9:transport_finalmask.go:710
        out.push({
            path: at,
            severity: 'critical',
            message: t("xdns needs domains (server) or resolvers (client) on Xray {tag}; with neither the config does not load.", { tag }),
        });
        return out;
    }
    // v26.7.28:transport_finalmask.go:712, v26.9.9:transport_finalmask.go:715
    for (const resolver of resolvers) {
        if (!resolver.includes('+udp://')) {
            out.push({
                path: `${at}.resolvers`,
                severity: 'critical',
                message: t("Resolver \"{value}\" has no \"+udp://\" part, so Xray {tag} refuses the config. The form is domain+udp://IP:port.", { value: resolver, tag }),
            });
        }
    }
    // Each side reads only its own list: finalmask/xdns/server.go:69 and client.go:58.
    if (direction === 'inbound' && domains.length === 0) {
        out.push({
            path: `${at}.domains`,
            severity: 'critical',
            message: t("An xdns server answers for its domains, and this one has none: the inbound fails to start (\"empty domains\")."),
        });
    }
    if (direction === 'outbound' && resolvers.length === 0) {
        out.push({
            path: `${at}.resolvers`,
            severity: 'warning',
            message: t("An xdns client sends through its resolvers, and this one has none: every connection fails (\"empty resolvers\")."),
        });
    }
    return out;
};

const udphopIssues = (settings: Record<string, unknown>, at: string, direction: MaskSide, tag: string): FinalmaskIssue[] => {
    const out: FinalmaskIssue[] = [];
    // v26.9.9:finalmask/udphop/config.go:19
    if (direction === 'inbound') {
        out.push({
            path: at,
            severity: 'critical',
            message: t("udphop only works on the client side; on an inbound Xray {tag} fails to start (\"udphop: client only\").", { tag }),
        });
    }
    // v26.9.9:transport_finalmask.go:929 — split on commas, lower-cased, and an
    // empty string splits into one empty entry, so a missing mode fails too.
    const mode = typeof settings.mode === 'string' ? settings.mode : '';
    if (mode === '') {
        out.push({
            path: `${at}.settings.mode`,
            severity: 'critical',
            message: t("udphop needs a mode on Xray {tag}: intervalLocal, intervalRemote or perConnRemote, comma-separated. Without one the config does not load.", { tag }),
        });
    } else {
        for (const entry of mode.split(',')) {
            if (!UDPHOP_MODES.includes(entry.toLowerCase())) {
                out.push({
                    path: `${at}.settings.mode`,
                    severity: 'critical',
                    message: t("\"{value}\" is not a udphop mode, so Xray {tag} refuses the config. It takes intervalLocal, intervalRemote and perConnRemote, comma-separated without spaces.", { value: entry, tag }),
                });
            }
        }
    }
    // v26.9.9:finalmask/udphop/conn.go:62 — checked when the mask is built for
    // a dial, with no default: a missing interval is 0 and fails.
    const interval = parseInt32Range(settings.interval);
    if (direction === 'outbound' && interval && (interval[0] < 5 || interval[1] < 5)) {
        out.push({
            path: `${at}.settings.interval`,
            severity: 'warning',
            message: t("udphop needs an interval of at least 5 seconds at both ends (10, or \"5-30\"); otherwise every connection fails (\"invalid interval\")."),
        });
    }
    return out;
};
