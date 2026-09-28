import React from 'react';
import { Card } from '../../ui/Card';
import { SchemaForm } from '../../ui/SchemaForm';
import { InboundSchema, InboundProtocolSchema } from '../../../core/xray/schemas';
import { useCoreVersion } from '../../../hooks/useCoreVersion';
import { protocolsFor } from '../../../core/xray/versions/protocols';
import { t } from '../../../i18n';

export const InboundGeneral = ({ inbound, onChange, onProtocolChange, errors = {} }: any) => {
    const isTun = inbound.protocol === 'tun';
    // Only what the target core registers, plus whatever this inbound already is.
    const { version } = useCoreVersion();
    const protocols = protocolsFor(version, 'inbound', InboundProtocolSchema.options, inbound.protocol);

    const handleFormChange = (newInbound: any) => {
        if (newInbound.protocol !== inbound.protocol) {
            onProtocolChange(newInbound.protocol);
        }
        
        // Find modified or added keys
        Object.keys(newInbound).forEach(key => {
            if (newInbound[key] !== inbound[key]) {
                // A cleared listen field is left out, never written as "":
                // an empty listen panics the loader before 26.9
                // (v26.7.28:infra/conf/xray.go:152), and leaving it out
                // means "every address" on all three lines.
                const value = key === 'listen' && newInbound[key] === '' ? undefined : newInbound[key];
                onChange(key, value);
            }
        });
        
        // Find deleted keys
        Object.keys(inbound).forEach(key => {
            if (newInbound[key] === undefined && inbound[key] !== undefined) {
                onChange(key, undefined);
            }
        });
    };

    const excludeKeys = ['settings', 'streamSettings', 'sniffing'];
    if (isTun) {
        excludeKeys.push('port', 'listen');
    }

    return (
        <Card title={t("Inbound Connectivity")} icon="Globe">
            <SchemaForm
                schema={InboundSchema}
                value={inbound}
                onChange={handleFormChange}
                errors={errors}
                excludeKeys={excludeKeys}
                fieldConfigs={{
                    protocol: {
                        label: t("Protocol"),
                        help: t("Xray supports multiple protocols like VLESS, VMess, Trojan, and Shadowsocks."),
                        options: protocols
                    },
                    listen: {
                        label: t("Listen IP"),
                        help: t("IP address for the inbound to listen on. Default is 0.0.0.0 (all interfaces).")
                    },
                    tag: {
                        label: t("Tag"),
                        help: t("A unique name for this inbound to refer to it in routing rules.")
                    }
                }}
            />
        </Card>
    );
};