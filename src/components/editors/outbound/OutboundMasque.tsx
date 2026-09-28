import React from 'react';
import { Card } from '../../ui/Card';
import { FormField } from '../../ui/FormField';
import { TagSelector } from '../../ui/TagSelector';
import { useField } from '../../../hooks/useField';
import { t } from '../../../i18n';

/**
 * MASQUE — CONNECT-IP over HTTP/3.
 *
 * Its three settings are flat, not wrapped in `servers[]` or `vnext[]`: the
 * core reads `address`, `port` and `remoteDNS` off the settings object itself
 * and refuses the config when the first two are missing.
 *
 * Source: infra/conf/masque.go (MasqueClientConfig).
 */
export const OutboundMasque = ({ outbound, onChange, errors = {} }: any) => {
    const address = useField<string>(outbound, onChange, ['settings', 'address']);
    const port = useField<number>(outbound, onChange, ['settings', 'port']);
    const remoteDNS = useField<string[] | undefined>(outbound, onChange, ['settings', 'remoteDNS']);

    return (
        <Card title={t("MASQUE Server")} icon="Planet" className="mt-4">
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg mb-4">
                <p className="text-[11px] text-slate-400 leading-relaxed italic">
                    {t("MASQUE carries IP packets inside an HTTP/3 request, so on the wire it looks like ordinary QUIC web traffic. It uses the masque transport and nothing else, and it is the one outbound the core refuses to multiplex.")}
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="md:col-span-3">
                    <FormField label={t("Address (IP or Domain)")} error={errors.address}>
                        <input
                            className="input-base"
                            placeholder={t("example.com")}
                            value={address.value || ""}
                            onChange={e => address.onChange(e.target.value)}
                        />
                    </FormField>
                </div>
                <FormField label={t("Port")} error={errors.port}>
                    <input
                        type="number"
                        className="input-base"
                        placeholder="443"
                        value={port.value || ""}
                        onChange={e => port.onChange(parseInt(e.target.value) || 0)}
                    />
                </FormField>
            </div>

            <div className="mt-4">
                <label className="label-xs">{t("Remote DNS")}</label>
                <TagSelector
                    multi
                    availableTags={['1.1.1.1', '8.8.8.8', '9.9.9.9', '2606:4700:4700::1111']}
                    selected={remoteDNS.value || []}
                    onChange={value => {
                        const list = value as string[];
                        remoteDNS.onChange(list.length ? list : undefined);
                    }}
                />
                <p className="text-[10px] text-slate-500 mt-1">
                    {t("Resolvers reached through the tunnel. IP addresses only — the core parses each one at startup and will not run if a hostname is in the list.")}
                </p>
            </div>
        </Card>
    );
};
