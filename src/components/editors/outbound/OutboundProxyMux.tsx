import React from 'react';
import { Switch } from '../../ui/Switch';
import { Select } from '../../ui/Select';
import { Help } from '../../ui/Help';
import { ExtendedSection } from '../../ui/ExtendedSection';
import { useField } from '../../../hooks/useField';
import { migrateProxySettings } from '../../../core/xray/outbound-shape';
import { DOMAIN_STRATEGY_OPTIONS } from './domain-strategies';
import { useCoreVersion } from '../../../hooks/useCoreVersion';
import { t } from '../../../i18n';

export const OutboundProxyMux = ({ outbound, onChange, showMux = true }: any) => {
    /** Where chaining lives now; the card below reports it rather than duplicating its editor. */
    const dialerProxy: string | undefined = outbound.streamSettings?.sockopt?.dialerProxy;
    /**
     * `proxySettings`, which 26.9 refuses.
     *
     * `OutboundDetourConfig.Build()` answers `PrintRemovedFeatureError` for it
     * on 26.9, so the config does not load there; 26.3 and 26.7 still run it.
     * An existing one is therefore shown on every line — red where the chosen
     * core refuses it, amber where it works but will not survive an upgrade —
     * and nothing offers to add a new one: `sockopt.dialerProxy` does the same
     * job on all three.
     */
    const { status, tag: coreTag } = useCoreVersion();
    const proxySettingsRefused = status('outbound.proxySettings') === 'rejected';
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
                <div className={`p-4 rounded-xl border space-y-3 ${
                    proxySettingsRefused ? 'bg-rose-950/20 border-rose-500/30' : 'bg-amber-950/20 border-amber-500/30'
                }`}>
                    <h4 className={`label-xs flex items-center gap-1 ${proxySettingsRefused ? 'text-rose-300' : 'text-amber-300'}`}>
                        {proxySettingsRefused
                            ? t("Proxy chaining (refused by Xray {tag})", { tag: coreTag })
                            : t("Proxy chaining (removed in Xray 26.9)")}
                        <Help>{t("26.9 answers \"this feature has been removed\" and refuses to start. 26.3 and 26.7 still run it.")}</Help>
                    </h4>
                    <p className={`text-[11px] leading-relaxed ${proxySettingsRefused ? 'text-rose-200/70' : 'text-amber-200/70'}`}>
                        {proxySettingsRefused
                            ? t("This outbound chains through {tag} via proxySettings, which a current Xray refuses to load. The replacement is sockopt.dialerProxy and does the same job.", { tag: legacyProxyTag })
                            : t("This outbound chains through {tag} via proxySettings. It works on {core}, and stops the config from loading on 26.9 — sockopt.dialerProxy does the same job on every supported version.", { tag: legacyProxyTag, core: coreTag })}
                    </p>
                    <div className={`flex items-center justify-between gap-3 pt-2 border-t ${proxySettingsRefused ? 'border-rose-500/20' : 'border-amber-500/20'}`}>
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
                        options={DOMAIN_STRATEGY_OPTIONS()}
                    />
                </div>
            </ExtendedSection>
        </div>
    );
};
