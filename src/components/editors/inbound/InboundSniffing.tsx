import React from 'react';
import { Card } from '../../ui/Card';
import { FormField } from '../../ui/FormField';
import { Switch } from '../../ui/Switch';
import { SchemaForm } from '../../ui/SchemaForm';
import { TagSelector } from '../../ui/TagSelector';
import { SniffingSchema } from '../../../core/xray/schemas';
import { DEST_OVERRIDE_ALIASES } from '../../../core/xray/versions/features.inbound';
import { compareCoreVersions } from '../../../core/xray/versions';
import { useField, type FieldPath } from '../../../hooks/useField';
import { useCoreVersion } from '../../../hooks/useCoreVersion';
import { t } from '../../../i18n';

interface InboundSniffingProps {
    sniffing: any;
    onChange: (path: FieldPath, value: any) => void;
    errors?: any[];
}

export const InboundSniffing = ({ sniffing = {}, onChange, errors = [] }: InboundSniffingProps) => {
    const enabled = sniffing.enabled || false;
    const { version, values, offersAt } = useCoreVersion();

    // This card only receives the `sniffing` object, so it is wrapped back
    // under its key to bind paths through the editor's updateField.
    const local = { sniffing };
    const destOverride = useField<string[] | undefined>(local, onChange, ['sniffing', 'destOverride']);

    // Map errors of format 'sniffing.field' to 'field'
    const sniffingErrors: Record<string, string | undefined> = {};
    if (Array.isArray(errors)) {
        errors.forEach((err: any) => {
            if (err.field && err.field.startsWith('sniffing.')) {
                const key = err.field.replace('sniffing.', '');
                sniffingErrors[key] = err.message;
            }
        });
    }

    const handleSniffingChange = (newSniffing: any) => {
        onChange('sniffing', newSniffing);
    };

    const handleToggleEnabled = (val: boolean) => {
        if (!val) {
            onChange('sniffing', { enabled: false });
        } else {
            onChange('sniffing', { ...sniffing, enabled: true });
        }
    };

    // Every line takes the same five names, case-insensitively, and fails the
    // load on anything else (v26.9.9:infra/conf/xray.go:79). https/ssl are the
    // core's aliases of tls: accepted, not offered.
    const selected: string[] = Array.isArray(destOverride.value) ? destOverride.value : [];
    const offered = values('inbound.sniffing.destOverride').filter(name => !DEST_OVERRIDE_ALIASES.has(name));
    const choices = [...offered, ...selected.filter(name => !offered.includes(name))];

    // ipsExcluded arrived in 26.7; 26.3 drops it. Offered where it works,
    // drawn where a config already has it (the notes above say it is dead).
    const showIps = offersAt('inbound', 'sniffing.ipsExcluded') || sniffing.ipsExcluded !== undefined;

    // domainsExcluded kept its name and changed its meaning in 26.7: a plain
    // entry was an exact domain (v26.3.27:app/dispatcher/default.go:252) and
    // became a substring, parsed with the routing syntax, where a bad regexp
    // or unknown geosite now fails the load (v26.7.28:infra/conf/xray.go:82).
    const domainsHelp = compareCoreVersions(version, '26.7') >= 0
        ? t("A plain entry matches every domain that contains it; full: matches one exact domain, and domain:, keyword:, regexp: and geosite: work as in routing rules. A bad regexp or an unknown geosite stops the config from loading. 26.3 read a plain entry as an exact domain.")
        : t("A plain entry matches that exact domain, and regexp: is understood. From 26.7 a plain entry matches as a substring instead — regexp:^name$ stays exact on every version.");

    return (
        <Card title={t("Traffic Sniffing")} icon="MagnifyingGlass" className="mt-4">
            <div className="space-y-4">
                <FormField label={t("Enable Sniffing")} help={t("Analyze traffic to determine destination domain and protocol.")} horizontal>
                    <Switch
                        checked={enabled}
                        onChange={handleToggleEnabled}
                    />
                </FormField>

                {enabled && (
                    <div className="pt-4 border-t border-slate-800 space-y-4 animate-in fade-in zoom-in-95 duration-200">
                        <FormField
                            label={t("Destination Override")}
                            help={t("Override target destination based on sniffed protocol (e.g., redirect HTTP to FakeDNS).")}
                            error={sniffingErrors.destOverride}
                        >
                            <TagSelector
                                multi
                                availableTags={choices}
                                selected={selected}
                                onChange={value => {
                                    const list = value as string[];
                                    destOverride.onChange(list.length ? list : undefined);
                                }}
                            />
                        </FormField>
                        <SchemaForm
                            schema={SniffingSchema}
                            value={sniffing}
                            onChange={handleSniffingChange}
                            errors={sniffingErrors}
                            excludeKeys={['enabled', 'destOverride', ...(showIps ? [] : ['ipsExcluded'])]}
                            fieldConfigs={{ domainsExcluded: { help: domainsHelp } }}
                        />
                    </div>
                )}
            </div>
        </Card>
    );
};
