import React from 'react';
import { SchemaForm } from '../../ui/SchemaForm';
import { TunInboundSettingsSchema } from '../../../core/xray/schemas';
import { useCoreVersion } from '../../../hooks/useCoreVersion';
import { t } from '../../../i18n';

interface InboundTunProps {
    inbound: any;
    onChange: (path: string | (string | number)[], value: any) => void;
    errors?: any[];
}

export const InboundTun = ({ inbound, onChange, errors = [] }: InboundTunProps) => {
    const settings = inbound.settings || {};
    const { offersAt } = useCoreVersion();

    // Map errors of format 'settings.field' to 'field'
    const settingsErrors: Record<string, string | undefined> = {};
    if (Array.isArray(errors)) {
        errors.forEach((err: any) => {
            if (err.field && err.field.startsWith('settings.')) {
                const key = err.field.replace('settings.', '');
                settingsErrors[key] = err.message;
            }
        });
    }

    // 26.3 reads name, MTU and userLevel only (v26.3.27:infra/conf/tun.go:8);
    // desc, gateway, dns and the two auto* switches arrived in 26.7. A field
    // the line drops is not offered — but one the config already has stays
    // visible, and the notes at the top of the editor say it does nothing.
    const hidden = Object.keys(TunInboundSettingsSchema.shape).filter(key =>
        settings[key] === undefined && !offersAt('inbound', `settings.${key}`, 'tun'));

    return (
        <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 mt-4 animate-in fade-in">
            <h4 className="text-xs font-bold text-slate-400 uppercase mb-4 border-b border-slate-700/50 pb-2">
                {t("TUN Interface Settings")}
                </h4>
            <SchemaForm
                schema={TunInboundSettingsSchema}
                value={settings}
                onChange={newSettings => onChange('settings', newSettings)}
                errors={settingsErrors}
                excludeKeys={hidden}
                fieldConfigs={{
                    autoOutboundsInterface: {
                        help: t("\"auto\" picks the interface outbound traffic leaves by, a name pins one, and an empty value turns it off. With routing-table entries set and this left out, the core uses \"auto\"."),
                        placeholder: 'auto',
                    },
                }}
            />
        </div>
    );
};
