/**
 * Version checks that are not a key or a value.
 *
 * FEATURES and VALUE_SETS answer "does this line know this key / take this
 * value". A few things a core refuses depend on how several fields combine —
 * a plaintext VLESS outbound is fine to a LAN address and refused to a public
 * one — and those live here, each as a plain function of the config and the
 * line, each citing where the core does it.
 */
import type { Diagnostic } from '../../diagnostics';
import { isSnippetRef } from '../../snippets';
import { t } from '../../../i18n';
import { compareCoreVersions, coreVersion, type CoreVersionId } from './index';
import { finalmaskIssues } from './finalmask-rules';
import { effectiveNetwork, hysteriaUdpIdleProblem, kcpProblems, REALITY_NETWORKS } from '../transport-networks';

// ── What the core calls a private address ─────────────────────────────
// common/geodata/consts.go (v26.7.28, same in v26.9.9): privateIPMatcher and
// privateDomainMatcher, used by requiresTransportSecurity in infra/conf/xray.go.

const PRIVATE_V4: [number, number][] = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
    ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
].map(([base, bits]) => [ipv4ToInt(base as string)!, bits as number]);

function ipv4ToInt(ip: string): number | null {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    let out = 0;
    for (const part of parts) {
        if (!/^\d{1,3}$/.test(part)) return null;
        const n = Number(part);
        if (n > 255) return null;
        out = out * 256 + n;
    }
    return out;
}

const inV4 = (ip: number, base: number, bits: number): boolean => {
    const size = 2 ** (32 - bits);
    return Math.floor(ip / size) === Math.floor(base / size);
};

/** ::/127, fc00::/7, fe80::/10, ff00::/8 — checked on the leading hextets. */
const isPrivateV6 = (ip: string): boolean => {
    const bare = ip.replace(/^\[|\]$/g, '').toLowerCase();
    if (bare === '::' || bare === '::1') return true;
    const first = parseInt(bare.split(':')[0] || '0', 16);
    if (Number.isNaN(first)) return false;
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00;
};

const PRIVATE_SUFFIXES = ['lan', 'localdomain', 'example', 'invalid', 'localhost', 'test', 'local', 'home.arpa', 'internal'];

/**
 * Whether the core would demand transport security for this server address.
 * Mirrors `requiresTransportSecurity`: a private IP, a name under one of the
 * private suffixes, or a dotless name is exempt; everything else is not.
 */
export const requiresTransportSecurity = (address: unknown): boolean => {
    if (typeof address !== 'string' || address.trim() === '') return false;
    const value = address.trim();
    const v4 = ipv4ToInt(value);
    if (v4 !== null) return !PRIVATE_V4.some(([base, bits]) => inV4(v4, base, bits));
    if (value.includes(':')) return !isPrivateV6(value);
    const domain = value.toLowerCase().replace(/\.$/, '');
    if (/^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/.test(domain)) return false; // dotless
    return !PRIVATE_SUFFIXES.some(suffix => domain === suffix || domain.endsWith(`.${suffix}`));
};

// ── The rules ──────────────────────────────────────────────────────────

const list = (value: unknown): any[] => (Array.isArray(value) ? value : []);

const hasTransportSecurity = (outbound: any): boolean => {
    const security = String(outbound?.streamSettings?.security ?? '').toLowerCase();
    return security !== '' && security !== 'none';
};

/**
 * Plaintext VLESS and Trojan to a public address, refused from 26.7.
 *
 * `validateOutboundTransportSecurity` (infra/conf/xray.go, v26.7.28 and
 * v26.9.9) runs after the protocol's Build(). Build() copies a flat
 * `address` into vnext/servers, never the other way, so what it sees:
 *   - VLESS on 26.7: the flat `settings.address` only — the vnext form is
 *     never checked. On 26.9 Build() also copies `vnext[0].address` and the
 *     user's `encryption` into the fields the check reads ("needs to see
 *     these", v26.9.9:infra/conf/vless.go:315), so both forms are checked.
 *     Exempt when the encryption is anything but "" / "none".
 *   - Trojan: the flat `settings.address` on 26.7; `servers[0].address`
 *     (flat copied in) on 26.9.
 */
const plaintextOutbounds = (config: any, version: CoreVersionId): Diagnostic[] => {
    if (compareCoreVersions(version, '26.7') < 0) return [];
    const { tag } = coreVersion(version);
    const out: Diagnostic[] = [];

    list(config.outbounds).forEach((outbound, index) => {
        if (!outbound || isSnippetRef(outbound) || hasTransportSecurity(outbound)) return;
        const settings = outbound.settings ?? {};
        let address: unknown;

        if (outbound.protocol === 'vless') {
            const vnextToo = compareCoreVersions(version, '26.9') >= 0 && settings.address === undefined;
            const entry = vnextToo ? list(settings.vnext)[0] : undefined;
            const encryption = String((vnextToo ? list(entry?.users)[0]?.encryption : settings.encryption) ?? '');
            if (encryption !== '' && encryption !== 'none') return;
            address = vnextToo ? entry?.address : settings.address;
        } else if (outbound.protocol === 'trojan') {
            address = settings.address
                ?? (compareCoreVersions(version, '26.9') >= 0 ? list(settings.servers)[0]?.address : undefined);
        } else {
            return;
        }

        if (!requiresTransportSecurity(address)) return;
        out.push({
            section: 'outbounds',
            itemIndex: index,
            field: 'streamSettings.security',
            severity: 'critical',
            message: t("A {protocol} outbound without TLS or REALITY to the public address {address} is refused by Xray {tag} — the config will not load.", {
                protocol: outbound.protocol === 'vless' ? 'VLESS' : 'Trojan',
                address: String(address),
                tag,
            }),
            suggestion: t("Set security to tls or reality. Private and LAN addresses are exempt."),
        });
    });
    return out;
};

/**
 * A blackhole `response` with no `type`, refused before 26.9: the response
 * is looked up by its type id there, and a missing one is not "none".
 */
const untypedBlackholeResponse = (config: any, version: CoreVersionId): Diagnostic[] => {
    if (compareCoreVersions(version, '26.9') >= 0) return [];
    const { tag } = coreVersion(version);
    const out: Diagnostic[] = [];
    list(config.outbounds).forEach((outbound, index) => {
        if (!['blackhole', 'block'].includes(outbound?.protocol)) return;
        const response = outbound?.settings?.response;
        if (!response || typeof response !== 'object' || response.type) return;
        out.push({
            section: 'outbounds',
            itemIndex: index,
            field: 'settings.response.type',
            severity: 'critical',
            message: t("A blackhole response without a type is refused by Xray {tag} — the config will not load.", { tag }),
            suggestion: t("Set the type to none or http, or remove the response."),
        });
    });
    return out;
};

/**
 * Two routing rules with one `ruleTag`, or two balancers with one `tag`:
 * started quietly before 26.9, a startup error on 26.9
 * (app/router, v26.9.9 — see findings/toplevel.json).
 */
const duplicateRoutingTags = (config: any, version: CoreVersionId): Diagnostic[] => {
    if (compareCoreVersions(version, '26.9') < 0) return [];
    const { tag } = coreVersion(version);
    const out: Diagnostic[] = [];
    const flag = (items: any[], key: string, label: string) => {
        const seen = new Map<string, number>();
        items.forEach((item, index) => {
            const value = item?.[key];
            if (typeof value !== 'string' || value === '' || isSnippetRef(item)) return;
            if (seen.has(value)) {
                out.push({
                    section: 'routing',
                    itemIndex: index,
                    field: key,
                    severity: 'critical',
                    message: t("{what} \"{value}\" is used twice; Xray {tag} refuses to start with a duplicate.", { what: label, value, tag }),
                });
            } else {
                seen.set(value, index);
            }
        });
    };
    flag(list(config.routing?.rules), 'ruleTag', 'ruleTag');
    flag(list(config.routing?.balancers), 'tag', t("Balancer tag"));
    return out;
};

/**
 * Hysteria's `version` and address.
 *
 * The outbound config is flat — version, address, port — on every supported
 * line, and Build() answers "version != 2" for anything but 2, then
 * dereferences the address it was given: one left in a `servers[]` entry is
 * dropped by the decoder and the core does not start (infra/conf/hysteria.go).
 * The inbound only started checking `version` in 26.7, where a missing one
 * fails too.
 */
const hysteriaShape = (config: any, version: CoreVersionId): Diagnostic[] => {
    const { tag } = coreVersion(version);
    const out: Diagnostic[] = [];
    list(config.outbounds).forEach((outbound, index) => {
        if (outbound?.protocol !== 'hysteria') return;
        const settings = outbound.settings ?? {};
        if (settings.version !== 2) {
            out.push({
                section: 'outbounds', itemIndex: index, field: 'settings.version', severity: 'critical',
                message: t("A hysteria outbound needs version 2; Xray {tag} refuses anything else.", { tag }),
                suggestion: t("Set settings.version to 2."),
            });
        }
        if (!settings.address) {
            out.push({
                section: 'outbounds', itemIndex: index, field: 'settings.address', severity: 'critical',
                message: t("A hysteria outbound takes its server as settings.address; without it Xray {tag} does not start.", { tag }),
                suggestion: list(settings.servers)[0]?.address
                    ? t("Move the address out of servers[] into settings.address and settings.port.")
                    : undefined,
            });
        }
    });
    if (compareCoreVersions(version, '26.7') >= 0) {
        list(config.inbounds).forEach((inbound, index) => {
            if (inbound?.protocol !== 'hysteria' || inbound.settings?.version === 2) return;
            out.push({
                section: 'inbounds', itemIndex: index, field: 'settings.version', severity: 'critical',
                message: t("A hysteria inbound needs version 2; Xray {tag} refuses it missing or different.", { tag }),
                suggestion: t("Set settings.version to 2."),
            });
        });
    }
    return out;
};

/**
 * Finalmask chains: mask positions, chain order and required settings, per
 * side — see finalmask-rules.ts, which owns the evidence. Its paths start at
 * `streamSettings.finalmask`, relative to the inbound or outbound.
 */
const finalmaskChains = (config: any, version: CoreVersionId): Diagnostic[] => {
    const out: Diagnostic[] = [];
    for (const [section, direction] of [['inbounds', 'inbound'], ['outbounds', 'outbound']] as const) {
        list(config[section]).forEach((item, index) => {
            if (!item || isSnippetRef(item)) return;
            const finalmask = item.streamSettings?.finalmask;
            if (!finalmask) return;
            for (const issue of finalmaskIssues(finalmask, version, direction)) {
                out.push({ section, itemIndex: index, field: issue.path, severity: issue.severity, message: issue.message });
            }
        });
    }
    return out;
};

/**
 * Stream settings that fail on how fields combine rather than on one key:
 *   - REALITY over anything but RAW, XHTTP or gRPC — "REALITY only supports
 *     RAW, XHTTP and gRPC for now", every line (StreamConfig.Build()).
 *   - `hysteriaSettings` whose version is not 2 — "version != 2", every line
 *     (v26.7.28:infra/conf/transport_method.go:776) — and a UDP idle timeout
 *     outside 0 / 2–600 (:784).
 *   - mKCP numeric limits per line: tti, and from 26.7 mtu, cwndMultiplier and
 *     a sending window of at least one MTU (transport_method.go:562-571).
 * The editors say the same next to the fields; the words come from
 * transport-networks.ts so the two cannot drift.
 */
const streamRules = (config: any, version: CoreVersionId): Diagnostic[] => {
    const { tag } = coreVersion(version);
    const out: Diagnostic[] = [];
    for (const section of ['inbounds', 'outbounds'] as const) {
        list(config[section]).forEach((item, index) => {
            if (!item || isSnippetRef(item) || !item.streamSettings) return;
            const stream = item.streamSettings;
            const network = effectiveNetwork(stream, version);
            const security = String(stream.security ?? '').toLowerCase();
            const push = (field: string, severity: Diagnostic['severity'], message: string) =>
                out.push({ section, itemIndex: index, field, severity, message });

            if (security === 'reality' && !REALITY_NETWORKS.includes(network)) {
                push('streamSettings.security', 'critical',
                    t("REALITY runs only over RAW, XHTTP or gRPC — Xray {tag} refuses it over {network}.", { tag, network }));
            }

            const hysteria = stream.hysteriaSettings;
            if (hysteria && typeof hysteria === 'object') {
                if (hysteria.version !== 2) {
                    push('streamSettings.hysteriaSettings.version', 'critical',
                        t("hysteriaSettings needs version 2; Xray {tag} refuses anything else.", { tag }));
                }
                const idle = hysteriaUdpIdleProblem(hysteria.udpIdleTimeout, version);
                if (idle) push('streamSettings.hysteriaSettings.udpIdleTimeout', 'critical', idle);
            }

            if (network === 'kcp' || network === 'mkcp') {
                const kcp = stream.kcpSettings ?? {};
                for (const [key, message] of Object.entries(kcpProblems(kcp, version))) {
                    push(`streamSettings.kcpSettings.${key}`, 'critical', message);
                }
            }
        });
    }
    return out;
};

/** Every rule here, for one config and line. */
export const ruleDiagnostics = (config: unknown, version: CoreVersionId): Diagnostic[] => {
    if (!config || typeof config !== 'object') return [];
    return [
        ...plaintextOutbounds(config, version),
        ...untypedBlackholeResponse(config, version),
        ...duplicateRoutingTags(config, version),
        ...hysteriaShape(config, version),
        ...finalmaskChains(config, version),
        ...streamRules(config, version),
    ];
};
