import React from 'react';
import { Card } from '../../ui/Card';
import { TagSelector } from '../../ui/TagSelector';
import { Switch } from '../../ui/Switch';
import { useField } from '../../../hooks/useField';
import { t } from '../../../i18n';

/**
 * The loopback outbound, which has exactly two fields.
 *
 * It used to be drawn with the generic server card — an address, a port and a
 * dead UUID box, none of which it has — while `inboundTag`, the one thing it
 * needs, had nowhere to be typed. Traffic sent here does not leave the
 * process: it re-enters routing as if it had arrived on the named inbound,
 * which is how a rule can be evaluated a second time.
 */
export const OutboundLoopback = ({ outbound, onChange, inboundTags = [] }: any) => {
    const inboundTag = useField<string>(outbound, onChange, ['settings', 'inboundTag']);
    const sniffingEnabled = useField<boolean | undefined>(outbound, onChange, ['settings', 'sniffing', 'enabled']);
    const destOverride = useField<string[] | undefined>(outbound, onChange, ['settings', 'sniffing', 'destOverride']);
    const routeOnly = useField<boolean | undefined>(outbound, onChange, ['settings', 'sniffing', 'routeOnly']);

    return (
        <Card title={t("Loopback Settings")} icon="ArrowCounterClockwise" className="mt-4">
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg mb-4">
                <p className="text-[11px] text-slate-400 leading-relaxed italic">
                    {t("Traffic sent here never leaves Xray. It re-enters routing carrying the inbound tag below, so a second set of rules can decide where it really goes — which is how one rule's result becomes another rule's input.")}
                </p>
            </div>

            <div className="space-y-2">
                <label className="label-xs">{t("Inbound Tag (re-entry point)")}</label>
                <TagSelector
                    availableTags={inboundTags}
                    selected={inboundTag.value || ''}
                    onChange={value => inboundTag.onChange(value as string)}
                    placeholder={t("Tag the traffic comes back in as...")}
                />
                <p className="text-[10px] text-slate-500">
                    {t("Routing rules matching this tag decide where the traffic goes on its second pass. A tag no rule matches means it falls through to the first outbound.")}
                </p>
            </div>

            <div className="mt-5 pt-4 border-t border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                    <div className="min-w-0">
                        <span className="label-xs">{t("Sniffing on re-entry")}</span>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                            {t("Reads the destination out of the traffic itself, the same way an inbound does.")}
                        </p>
                    </div>
                    <Switch
                        checked={sniffingEnabled.value === true}
                        onChange={checked => sniffingEnabled.onChange(checked || undefined)}
                    />
                </div>

                {sniffingEnabled.value && (
                    <div className="space-y-3 animate-in fade-in">
                        <div>
                            <label className="label-xs">{t("Destination Override")}</label>
                            <TagSelector
                                multi
                                availableTags={['http', 'tls', 'quic', 'fakedns']}
                                selected={destOverride.value || []}
                                onChange={value => {
                                    const list = value as string[];
                                    destOverride.onChange(list.length ? list : undefined);
                                }}
                            />
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] text-slate-400">{t("Route only (do not rewrite the destination)")}</span>
                            <Switch
                                checked={routeOnly.value === true}
                                onChange={checked => routeOnly.onChange(checked || undefined)}
                            />
                        </div>
                    </div>
                )}
            </div>
        </Card>
    );
};
