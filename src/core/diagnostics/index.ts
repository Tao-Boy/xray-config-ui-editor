import { t } from '../../i18n';
import type { XrayConfig } from '../types';
import {
    collectSnippetRefs,
    indexSnippets,
    isSnippetRef,
    snippetProvidedOutboundTags,
    type SnippetDefinition,
} from '../snippets';
import { versionDiagnostics } from '../xray/versions/check';
import type { CoreVersionId } from '../xray/versions';

export type DiagnosticSeverity = 'critical' | 'warning' | 'info';

export interface Diagnostic {
    section: string;
    itemIndex?: number;
    field?: string;
    message: string;
    severity: DiagnosticSeverity;
    suggestion?: string;
}

/**
 * @param snippets Known snippet/template definitions (panel + local). Passing
 * them lets diagnostics see the outbounds a `{ "snippet": "NAME" }` reference
 * will contribute once Remnawave expands it, so rules pointing at those tags
 * are not reported as dangling. Omit it and references are simply treated as
 * opaque — never as errors.
 */
export const runFullDiagnostics = (
    config: XrayConfig | null,
    snippets: SnippetDefinition[] = [],
    /**
     * The core the config is meant for. Given, the result also says what that
     * core would refuse or silently drop — see core/xray/versions. Omitted,
     * nothing version-specific is checked.
     */
    version?: CoreVersionId,
): Diagnostic[] => {
    const diagnostics: Diagnostic[] = [];

    if (!config) return diagnostics;

    const inbounds = config.inbounds || [];
    const outbounds = config.outbounds || [];
    const routing = config.routing || {};
    const rules = routing.rules || [];
    const balancers = routing.balancers || [];

    const allOutboundTags = new Set(outbounds.map((o: any) => o.tag).filter(Boolean));
    const allBalancerTags = new Set(balancers.map((b: any) => b.tag).filter(Boolean));

    // Tags that may exist in external systems (e.g. Remnawave)
    const KNOWN_EXTERNAL_TAGS = new Set(['TORRENT', 'DIRECT', 'REJECT', 'BLOCK', 'DNS']);

    // Outbounds that only materialise once the panel expands the config's
    // snippet references. Without these a perfectly valid profile reports
    // "Rule targets unknown outbound" for every snippet-provided node.
    const snippetDefs = indexSnippets(snippets);
    const snippetTags = snippetProvidedOutboundTags(config, snippetDefs);

    const allTargetTags = new Set([
        ...allOutboundTags,
        ...allBalancerTags,
        ...KNOWN_EXTERNAL_TAGS,
        ...snippetTags,
    ]);

    const checkOutbound = (o: any, i: number) => {
        if (isSnippetRef(o)) return;
        const stream = o.streamSettings || {};
        const net = stream.network || 'tcp';
        const sec = stream.security || 'none';

        if (net === 'grpc') {
            const grpc = stream.grpcSettings || {};
            if (!grpc.serviceName) {
                diagnostics.push({
                    section: 'outbounds', itemIndex: i, field: 'grpcSettings',
                    severity: 'critical', message: t("gRPC requires \"serviceName\" to be set."),
                    suggestion: t("Add a service name (e.g., \"GunService\")."),
                });
            }
        }

        if (sec === 'reality') {
            const r = stream.realitySettings || {};
            if (!r.publicKey) {
                diagnostics.push({
                    section: 'outbounds', itemIndex: i, field: 'realitySettings',
                    severity: 'critical', message: t("REALITY requires \"publicKey\" for outbounds."),
                });
            }
            if (!r.serverName) {
                diagnostics.push({
                    section: 'outbounds', itemIndex: i, field: 'realitySettings',
                    severity: 'warning', message: t("REALITY usually requires \"serverName\" (SNI) to match the destination."),
                });
            }
        }

        const flow = (o.settings?.vnext?.[0]?.users?.[0]?.flow) || (o.settings?.users?.[0]?.flow);
        const mux = o.mux || {};

        if (flow === 'xtls-rprx-vision' && mux.enabled) {
            diagnostics.push({
                section: 'outbounds', itemIndex: i, field: 'mux',
                severity: 'critical', message: t("XTLS-Vision is incompatible with Mux/XUDP."),
                suggestion: t("Disable Mux for this outbound to use Vision flow."),
            });
        }

        if (sec === 'reality' && mux.enabled) {
            diagnostics.push({
                section: 'outbounds', itemIndex: i, field: 'mux',
                severity: 'warning', message: t("Using Mux with REALITY is not recommended (affects fingerprint)."),
                suggestion: t("Consider disabling Mux for Reality outbounds."),
            });
        }

        if (net === 'xhttp') {
            const x = stream.xhttpSettings || {};
            if (x.mode === 'stream-up' && sec === 'none') {
                diagnostics.push({
                    section: 'outbounds', itemIndex: i,
                    severity: 'critical', message: t("XHTTP \"stream-up\" mode MANDATORY requires TLS or REALITY."),
                    suggestion: t("Enable Security or change mode to \"packet-up\"."),
                });
            }
        }
    };

    const checkInbound = (inb: any, i: number) => {
        const stream = inb.streamSettings || {};
        const sec = stream.security || 'none';

        if (sec === 'reality') {
            const r = stream.realitySettings || {};
            // Xray-core names the fallback destination `target`; `dest` is the
            // legacy alias and both are accepted (see reality.schema.ts).
            // Requiring `dest` alone reported every current REALITY inbound as
            // critical, which in turn blocked the cloud push in
            // configStore.saveToRemnawave.
            if ((!r.target && !r.dest) || !r.privateKey) {
                diagnostics.push({
                    section: 'inbounds', itemIndex: i, field: 'realitySettings',
                    severity: 'critical', message: t("REALITY Inbound requires \"target\" (or legacy \"dest\") and \"privateKey\"."),
                    suggestion: t("Configure a fallback destination and generate a private key."),
                });
            }
        }

        if (sec === 'tls') {
            const tls = stream.tlsSettings || {};
            if (!tls.certificates || tls.certificates.length === 0) {
                diagnostics.push({
                    section: 'inbounds', itemIndex: i, field: 'tlsSettings',
                    severity: 'critical', message: t("TLS Inbound requires at least one certificate."),
                });
            }
        }
    };

    inbounds.forEach(checkInbound);
    outbounds.forEach(checkOutbound);

    const seenDomains = new Map<string, { index: number; name: string }>();
    const seenIPs = new Map<string, { index: number; name: string }>();

    rules.forEach((rule: any, i: number) => {
        if (isSnippetRef(rule)) return;
        const ruleName = rule.ruleTag || rule.outboundTag || rule.balancerTag || `Rule #${i + 1}`;

        if (rule.outboundTag && !allTargetTags.has(rule.outboundTag)) {
            diagnostics.push({
                section: 'routing', itemIndex: i, field: 'outboundTag',
                severity: 'critical', message: t("Rule targets unknown outbound: \"{value1}\"", { value1: String(rule.outboundTag) }),
            });
        }
        if (rule.balancerTag && !allTargetTags.has(rule.balancerTag)) {
            diagnostics.push({
                section: 'routing', itemIndex: i, field: 'balancerTag',
                severity: 'critical', message: t("Rule targets unknown balancer: \"{value1}\"", { value1: String(rule.balancerTag) }),
            });
        }

        // Check duplicate domain / geosite matchers
        if (Array.isArray(rule.domain)) {
            rule.domain.forEach((d: string) => {
                if (!d || typeof d !== 'string') return;
                const key = d.trim().toLowerCase();
                if (seenDomains.has(key)) {
                    const first = seenDomains.get(key)!;
                    diagnostics.push({
                        section: 'routing',
                        itemIndex: i,
                        field: 'domain',
                        severity: 'warning',
                        message: t("Duplicate matcher \"{value1}\" in {value2} — already matched in {value3} (Rule #{value4}). Traffic for \"{value1}\" will be shadowed by Rule #{value4}.", { value1: String(d), value2: String(ruleName), value3: String(first.name), value4: String(first.index + 1) }),
                        suggestion: t("Remove duplicate \"{value1}\" or reorder routing rules.", { value1: String(d) })
                    });
                } else {
                    seenDomains.set(key, { index: i, name: ruleName });
                }
            });
        }

        // Check duplicate IP / geoip matchers
        if (Array.isArray(rule.ip)) {
            rule.ip.forEach((ip: string) => {
                if (!ip || typeof ip !== 'string') return;
                const key = ip.trim().toLowerCase();
                if (seenIPs.has(key)) {
                    const first = seenIPs.get(key)!;
                    diagnostics.push({
                        section: 'routing',
                        itemIndex: i,
                        field: 'ip',
                        severity: 'warning',
                        message: t("Duplicate IP matcher \"{value1}\" in {value2} — already matched in {value3} (Rule #{value4}). Traffic for \"{value1}\" will be shadowed by Rule #{value4}.", { value1: String(ip), value2: String(ruleName), value3: String(first.name), value4: String(first.index + 1) }),
                        suggestion: t("Remove duplicate \"{value1}\" or reorder routing rules.", { value1: String(ip) })
                    });
                } else {
                    seenIPs.set(key, { index: i, name: ruleName });
                }
            });
        }
    });

    // Snippet references we could not resolve. Severity depends on whether a
    // library was supplied at all: with an empty library this is "we have not
    // fetched your snippets yet" (info), with a populated one it is a name
    // that genuinely is not there (warning). Never critical — the panel, not
    // this editor, is what expands them, and a false critical would block the
    // push in configStore.saveToRemnawave.
    const seenUnresolved = new Set<string>();
    collectSnippetRefs(config).forEach(ref => {
        if (snippetDefs.has(ref.name) || seenUnresolved.has(ref.name)) return;
        seenUnresolved.add(ref.name);
        diagnostics.push({
            section: ref.section === 'rules' ? 'routing' : 'outbounds',
            itemIndex: ref.index,
            field: 'snippet',
            severity: snippets.length > 0 ? 'warning' : 'info',
            message: snippets.length > 0
                ? t("Snippet \"{value1}\" is not in your snippet library — the panel may not be able to expand it.", { value1: String(ref.name) })
                : t("Snippet \"{value1}\" is resolved by Remnawave; its contents are not loaded here yet.", { value1: String(ref.name) }),
            suggestion: snippets.length > 0
                ? t("Open Snippets to refresh the library, or check the name against the panel.")
                : t("Open Snippets and refresh to load snippet bodies from the panel."),
        });
    });

    if (version) diagnostics.push(...versionDiagnostics(config, version));

    return diagnostics;
};
