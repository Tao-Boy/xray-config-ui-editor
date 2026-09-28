import React from 'react';
import { Card } from '../../ui/Card';
import { SchemaForm } from '../../ui/SchemaForm';
import { OutboundSchema, OutboundProtocolSchema } from '../../../core/xray/schemas';
import { useCoreVersion } from '../../../hooks/useCoreVersion';
import { protocolsFor } from '../../../core/xray/versions/protocols';
import { t } from '../../../i18n';

export const OutboundGeneral = ({ outbound, onChange, onProtocolChange, errors = {}, showSendThrough = true }: any) => {
    // Only what the target core registers, plus whatever this outbound
    // already is — an unknown protocol fails the whole config, not one field.
    const { version } = useCoreVersion();
    const protocols = protocolsFor(version, 'outbound', OutboundProtocolSchema.options, outbound.protocol);

    const handleFormChange = (newOutbound: any) => {
        if (newOutbound.protocol !== outbound.protocol) {
            onProtocolChange(newOutbound.protocol);
        }
        
        // Find modified or added keys
        Object.keys(newOutbound).forEach(key => {
            if (newOutbound[key] !== outbound[key]) {
                onChange(key, newOutbound[key]);
            }
        });
        
        // Find deleted keys
        Object.keys(outbound).forEach(key => {
            if (newOutbound[key] === undefined && outbound[key] !== undefined) {
                onChange(key, undefined);
            }
        });
    };

    return (
        <Card title={t("Outbound Protocol")} icon="PaperPlaneTilt">
            <SchemaForm
                schema={OutboundSchema}
                value={outbound}
                onChange={handleFormChange}
                errors={errors}
                // `sendThrough` picks the local address a connection leaves
                // from, so a protocol that never opens one has no use for it.
                excludeKeys={[
                    'sendIP', 'streamSettings', 'settings', 'mux', 'proxySettings', 'targetStrategy',
                    ...(showSendThrough ? [] : ['sendThrough']),
                ]}
                fieldConfigs={{
                    protocol: {
                        label: t("Protocol"),
                        help: t("Xray supports VLESS, VMess, Trojan, Shadowsocks, Hysteria, etc."),
                        options: protocols
                    },
                    tag: {
                        label: t("Tag"),
                        help: t("Unique name for this outbound (used in routing rules).")
                    }
                }}
            />
        </Card>
    );
};
