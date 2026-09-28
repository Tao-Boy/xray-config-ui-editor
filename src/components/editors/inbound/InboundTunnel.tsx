import React from 'react';
import { Card } from '../../ui/Card';
import { Input } from '../../ui/Input';
import { NumberInput } from '../../ui/NumberInput';
import { Select } from '../../ui/Select';
import { Switch } from '../../ui/Switch';
import { FormField } from '../../ui/FormField';
import { useField, type FieldPath } from '../../../hooks/useField';
import { t } from '../../../i18n';

interface InboundTunnelProps {
    inbound: any;
    /** The editor's updateField(path, value) — see InboundModal. */
    onChange: (path: FieldPath, value: any) => void;
}

const NETWORKS = ['tcp', 'udp', 'tcp,udp'];

/**
 * The forwarding target of a dokodemo-door / tunnel inbound.
 *
 * Written as `address`/`port`/`network`: the only names 26.3 reads
 * (v26.3.27:infra/conf/dokodemo.go:10), and on 26.7+ the legacy aliases of
 * rewriteAddress/rewritePort/allowedNetwork that win whenever they are set
 * (v26.7.28:infra/conf/dokodemo.go:23). One spelling, the same meaning on
 * every line; useInboundEditor moves a lone new-style key over on open.
 */
export const InboundTunnel = ({ inbound, onChange }: InboundTunnelProps) => {
    const address = useField<string | undefined>(inbound, onChange, ['settings', 'address']);
    const port = useField<number | undefined>(inbound, onChange, ['settings', 'port']);
    const network = useField<string | string[] | undefined>(inbound, onChange, ['settings', 'network']);
    const followRedirect = useField<boolean | undefined>(inbound, onChange, ['settings', 'followRedirect']);

    // NetworkList takes "tcp,udp" or ["tcp","udp"]; shown one way, written as the string.
    const networkValue = Array.isArray(network.value) ? network.value.join(',') : network.value || 'tcp';
    const networkOptions = NETWORKS.includes(networkValue) ? NETWORKS : [...NETWORKS, networkValue];

    return (
        <Card title={t("Forwarding Target")} icon="ArrowsLeftRight" className="mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                    label={t("Address")}
                    help={t("Where every connection arriving here is sent. Left empty, the original destination is kept — which is what transparent proxying with Follow Redirect needs.")}
                    className="font-mono"
                    placeholder="1.1.1.1"
                    value={address.value ?? ''}
                    onChange={e => address.onChange(e.target.value || undefined)}
                />
                <FormField label={t("Target Port")} help={t("Left empty, the original port is kept.")}>
                    <NumberInput
                        value={port.value ?? ''}
                        onChange={val => port.onChange(val || undefined)}
                        placeholder="53"
                        min={0}
                        max={65535}
                    />
                </FormField>
                <Select
                    label={t("Network")}
                    help={t("Which traffic this inbound accepts. Left out, only TCP.")}
                    value={networkValue}
                    onChange={val => network.onChange(val)}
                    options={networkOptions.map(value => ({ value, label: value }))}
                />
                <FormField label={t("Follow Redirect")} help={t("Send redirected (TPROXY / REDIRECT) traffic to its original destination instead of the address above.")} horizontal>
                    <Switch
                        checked={followRedirect.value === true}
                        onChange={checked => followRedirect.onChange(checked || undefined)}
                    />
                </FormField>
            </div>
        </Card>
    );
};
