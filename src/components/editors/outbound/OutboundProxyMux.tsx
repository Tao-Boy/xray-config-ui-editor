import React from 'react';
import { Switch } from '../../ui/Switch';
import { Select } from '../../ui/Select';
import { Help } from '../../ui/Help';
import { ExtendedSection } from '../../ui/ExtendedSection';
import { useField } from '../../../hooks/useField';
import { migrateProxySettings } from '../../../core/xray/outbound-shape';
import { t } from '../../../i18n';

export const OutboundProxyMux = ({ outbound, onChange, showMux = true }: any) => {
    /** Where chaining lives now; the card below reports it rather than duplicating its editor. */
    const dialerProxy: string | undefined = outbound.streamSettings?.sockopt?.dialerProxy;
    /**
     * `proxySettings` is a removed feature.
     *
     * Xray-core stopped accepting it — `OutboundDetourConfig.Build()` answers
     * `PrintRemovedFeatureError("outbound \"proxySettings\"",
     * "\"streamSettings.sockopt.dialerProxy\"")`, so a config carrying it does
     * not start at all on a current core. It still works on 26.3 and older,
     * which is why an existing one is shown rather than hidden — but nothing
     * offers to add a new one, and the replacement is one click away in
     * Sockopt below.
     */
    const legacyProxyTag: string | undefined = outbound.proxySettings?.tag;
    const migrateToDialerProxy = () => {
        const migrated = migrateProxySettings(outbound);
        if (migrated === outbound) return;
        onChange('streamSettings', migrated.streamSettings);
        onChange('proxySettings', undefined);
    };
    // `outbound` is the editor's `local` state and `onChange` is its
    // `updateField(path, value)` (see OutboundModal.tsx).
    const transportLayer = useField<boolean>(outbound, onChange, ['proxySettings', 'transportLayer']);
    const concurrency = useField<number>(outbound, onChange, ['mux', 'concurrency']);
    const xudpConcurrency = useField<number>(outbound, onChange, ['mux', 'xudpConcurrency']);
    const xudpProxyUDP443 = useField<string>(outbound, onChange, ['mux', 'xudpProxyUDP443']);
    const targetStrategy = useField<string | undefined>(outbound, onChange, ['targetStrategy']);
    // Enabling seeds a full set of mux defaults; disabling drops the whole
    // `mux` object rather than just flipping `enabled` to false.
    const updateMux = (enabled: boolean) => {
        if (!enabled) {
            onChange('mux', undefined);
        } else {
            onChange('mux', { enabled: true, concurrency: 8, xudpConcurrency: 8, xudpProxyUDP443: "reject" });
        }
    };
    const hasExtendedValues = !!outbound.targetStrategy || !!outbound.proxySettings?.transportLayer;
    return (
        <div className="space-y-4 mt-4">
            {legacyProxyTag && (
                <div className="bg-rose-950/20 p-4 rounded-xl border border-rose-500/30 space-y-3">
                    <h4 className="label-xs text-rose-300 flex items-center gap-1">
                        {t("Proxy chaining (removed from Xray)")}
                        <Help>{t("The core answers \"this feature has been removed\" and refuses to start. Older cores up to 26.3 still accept it.")}</Help>
                    </h4>
                    <p className="text-[11px] text-rose-200/70 leading-relaxed">
                        {t("This outbound chains through {tag} via proxySettings, which a current Xray refuses to load. The replacement is sockopt.dialerProxy and does the same job.", { tag: legacyProxyTag })}
                    </p>
                    <div className="flex items-center justify-between gap-3 pt-2 border-t border-rose-500/20">
                        <span className="text-[11px] text-slate-400 flex items-center gap-1">
                            Transport Layer Chaining
                            <Help>{t("When enabled, proxy chaining occurs at the transport layer instead of the application layer.")}</Help>
                        </span>
                        <Switch
                            checked={transportLayer.value || false}
                            onChange={checked => transportLayer.onChange(checked)}
                        />
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                        <button
                            type="button"
                            onClick={migrateToDialerProxy}
                            className="flex-1 h-9 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-[11px] font-bold text-emerald-200 hover:border-emerald-400 transition-colors"
                        >
                            {t("Move it to sockopt.dialerProxy")}
                        </button>
                        <button
                            type="button"
                            onClick={() => onChange('proxySettings', undefined)}
                            className="flex-1 h-9 rounded-lg border border-slate-700 bg-slate-900 text-[11px] font-bold text-slate-300 hover:border-slate-500 transition-colors"
                        >
                            {t("Remove it")}
                        </button>
                    </div>
                </div>
            )}
            <div className={`grid grid-cols-1 gap-6 ${showMux ? 'md:grid-cols-2' : ''}`}>
                {/* Proxy chaining, the way the core still takes it. */}
                <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 space-y-2">
                    <h4 className="label-xs text-slate-400 flex items-center gap-1">
                        {t("Proxy Chaining (Optional)")}
                        <Help>{t("Sends this outbound's connection through another one first. Set as streamSettings.sockopt.dialerProxy, in Sockopt under Transport.")}</Help>
                    </h4>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                        {dialerProxy
                            ? t("Chaining through {tag}, set in Sockopt under Transport.", { tag: dialerProxy })
                            : t("Not chained. Set a dialerProxy in Sockopt under Transport to send this outbound through another one.")}
                    </p>
                </div>
                {/* Mux. A protocol whose far end cannot demultiplex a
                    Mux.Cool stream — a plain SOCKS or HTTP proxy, a direct
                    connection — is not offered it. */}
                {showMux && (
                <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800">
                    <div className="flex justify-between items-center mb-3">
                        <h4 className="label-xs text-slate-400">{t("Mux (Multiplexing)")}</h4>
                        <Switch
                            checked={outbound.mux?.enabled || false}
                            onChange={checked => updateMux(checked)}
                        />
                    </div>
                    {outbound.mux?.enabled && (
                        <div className="space-y-3 animate-in fade-in">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <div>
                                    <label className="label-xs">{t("TCP Concurrency")}</label>
                                    <input type="number" className="input-base"
                                        value={concurrency.value || 8}
                                        onChange={e => concurrency.onChange(parseInt(e.target.value))}
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">{t("XUDP Concurrency")}</label>
                                    <input type="number" className="input-base"
                                        value={xudpConcurrency.value || 8}
                                        onChange={e => xudpConcurrency.onChange(parseInt(e.target.value))}
                                    />
                                </div>
                            </div>
                            <Select
                                label={t("UDP 443 Strategy (QUIC)")}
                                value={xudpProxyUDP443.value || "reject"}
                                onChange={val => xudpProxyUDP443.onChange(val)}
                                options={[
                                    { value: "reject", label: t("Reject"), description: t("Recommended") },
                                    { value: "allow", label: t("Allow") },
                                    { value: "skip", label: t("Skip") },
                                ]}
                            />
                        </div>
                    )}
                    {!outbound.mux?.enabled && <p className="text-[10px] text-slate-500">{t("Enable to reduce handshake latency.")}</p>}
                </div>
                )}
            </div>
            {/* Extended Outbound Options */}
            <ExtendedSection
                title={t("Extended Outbound Settings")}
                description={t("Target domain resolution strategy and advanced proxy routing.")}
                hasActiveValues={hasExtendedValues}
                activeCount={hasExtendedValues ? 1 : 0}
            >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Select
                        label={t("Target Domain Strategy (targetStrategy)")}
                        hint={t("Resolution behavior when connecting to target domain via this outbound.")}
                        value={targetStrategy.value || "AsIs"}
                        onChange={val => targetStrategy.onChange(val === "AsIs" ? undefined : val)}
                        options={[
                            { value: "AsIs", label: t("AsIs (Default)"), description: t("Leave domain as is without prior resolution") },
                            { value: "UseIP", label: t("UseIP"), description: t("Resolve and connect via IP") },
                            { value: "UseIPv4", label: t("UseIPv4"), description: t("Resolve and prefer IPv4 only") },
                            { value: "UseIPv6", label: t("UseIPv6"), description: t("Resolve and prefer IPv6 only") },
                            { value: "UseIPv4v6", label: t("UseIPv4v6"), description: t("Prefer IPv4, fallback to IPv6") },
                            { value: "UseIPv6v4", label: t("UseIPv6v4"), description: t("Prefer IPv6, fallback to IPv4") },
                            { value: "ForceIP", label: t("ForceIP"), description: t("Enforce IP connection (fails if unresolved)") },
                            { value: "ForceIPv4", label: t("ForceIPv4"), description: t("Enforce IPv4 connection") },
                            { value: "ForceIPv6", label: t("ForceIPv6"), description: t("Enforce IPv6 connection") },
                            { value: "ForceIPv4v6", label: t("ForceIPv4v6"), description: t("Enforce IPv4, fallback to IPv6") },
                            { value: "ForceIPv6v4", label: t("ForceIPv6v4"), description: t("Enforce IPv6, fallback to IPv4") },
                        ]}
                    />
                </div>
            </ExtendedSection>
        </div>
    );
};
