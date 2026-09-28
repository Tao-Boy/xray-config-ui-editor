import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { NetworkSection } from './NetworkSection';
import { TransportSettings } from './TransportSettings';
import { useConfigStore } from '../../../store/configStore';
import type { CoreVersionId } from '../../../core/xray/versions';

/**
 * Six transports, each with its own block of fields and none of them sharing
 * a field name. Nothing rendered any of these until now, which is how a form
 * could be wired to the wrong path — or to none — without a test noticing.
 *
 * What each block offers also depends on the core line the user picked, so
 * the version-specific cases set it the way the settings screen does.
 */

// A block body: the persisting store's setState hands back a promise that
// would otherwise turn this into an unawaited async act.
const onLine = (version: CoreVersionId) => {
    act(() => {
        useConfigStore.setState({ coreVersion: version });
    });
};

beforeEach(() => onLine('26.7'));
afterEach(cleanup);

const noop = () => {};

/** The value each transport must show, proving it is bound to its own path. */
const CASES: [string, any, string][] = [
    // TCP's own value is a chooser, so the heading is what proves the block.
    ['tcp', { network: 'tcp', tcpSettings: { header: { type: 'http' } } }, 'TCP (RAW) Settings'],
    ['ws', { network: 'ws', wsSettings: { path: '/ws-probe' } }, '/ws-probe'],
    ['grpc', { network: 'grpc', grpcSettings: { serviceName: 'GunService' } }, 'GunService'],
    ['kcp', { network: 'kcp', kcpSettings: { mtu: 1234 } }, '1234'],
    ['httpupgrade', { network: 'httpupgrade', httpupgradeSettings: { path: '/upgrade-probe' } }, '/upgrade-probe'],
    ['hysteria', { network: 'hysteria', hysteriaSettings: { version: 2, auth: 'hy-auth-probe' } }, 'hy-auth-probe'],
];

const valuesIn = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('input')).map(i => (i as HTMLInputElement).value);

const labelsIn = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('label')).map(l => l.textContent ?? '');

const noticesIn = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('[data-version-notice]')).map(node => node.getAttribute('data-version-notice'));

/** Types into an input the way React sees it. */
const typeInto = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
};

const draw = (streamSettings: any, net: string, isClient = false, protocol?: string) => {
    const writes: any[] = [];
    const view = render(
        <NetworkSection streamSettings={streamSettings} onChange={next => writes.push(next)} net={net} isClient={isClient} protocol={protocol} />,
    );
    return { ...view, writes, last: () => writes[writes.length - 1] };
};

describe('NetworkSection', () => {
    for (const [net, streamSettings, expected] of CASES) {
        it(`shows the ${net} settings, bound to the ${net} path`, () => {
            const { container } = render(
                <NetworkSection streamSettings={streamSettings} onChange={noop} net={net} isClient={false} />,
            );
            const text = container.textContent ?? '';
            expect(valuesIn(container).includes(expected) || text.includes(expected)).toBe(true);
        });
    }

    it('shows one transport at a time, not all of them', () => {
        const { container } = render(
            <NetworkSection
                streamSettings={{ network: 'ws', wsSettings: { path: '/ws-probe' }, grpcSettings: { serviceName: 'GunService' } }}
                onChange={noop}
                net="ws"
                isClient={false}
            />,
        );
        expect(valuesIn(container)).toContain('/ws-probe');
        expect(valuesIn(container)).not.toContain('GunService');
    });

    it('writes back to the path the field belongs to', () => {
        let received: any = null;
        const { container } = render(
            <NetworkSection
                streamSettings={{ network: 'ws', wsSettings: { path: '/old' } }}
                onChange={next => { received = next; }}
                net="ws"
                isClient={false}
            />,
        );
        const input = Array.from(container.querySelectorAll('input'))
            .find(i => (i as HTMLInputElement).value === '/old') as HTMLInputElement;
        expect(input).toBeDefined();
        typeInto(input, '/new');
        expect(received?.wsSettings?.path).toBe('/new');
    });

    it('opens the same block for both names of a transport', () => {
        const { container } = draw({ network: 'websocket', wsSettings: { path: '/alias-probe' } }, 'websocket');
        expect(valuesIn(container)).toContain('/alias-probe');
    });

    it('edits rawSettings when that is the object the core reads', () => {
        // rawSettings wins over tcpSettings when both are there.
        const { container, last } = draw({ network: 'raw', rawSettings: { header: { type: 'none' } } }, 'raw');
        const toggle = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
        fireEvent.click(toggle);
        expect(last().rawSettings.acceptProxyProtocol).toBe(true);
        expect(last().tcpSettings).toBeUndefined();
    });
});

describe('WebSocket host', () => {
    it('reads a Host header the old editor wrote, and moves it into host', () => {
        // Every line logs Host-in-headers as deprecated and moves it itself.
        const { container, last } = draw({ network: 'ws', wsSettings: { path: '/', headers: { Host: 'old.example' } } }, 'ws');
        const input = Array.from(container.querySelectorAll('input'))
            .find(i => (i as HTMLInputElement).value === 'old.example') as HTMLInputElement;
        expect(input).toBeDefined();
        typeInto(input, 'new.example');
        expect(last().wsSettings.host).toBe('new.example');
        expect(last().wsSettings.headers).toBeUndefined();
    });
});

describe('mKCP per line', () => {
    it('never offers header or seed', () => {
        const { container } = draw({ network: 'kcp', kcpSettings: {} }, 'kcp');
        expect(labelsIn(container).join('|')).not.toMatch(/Seed|Header Type/);
    });

    it('shows a seed the config has as refused on 26.7, and removes it', () => {
        const { container, last } = draw({ network: 'kcp', kcpSettings: { seed: 'kcp-seed', mtu: 1350 } }, 'kcp');
        expect(noticesIn(container)).toEqual(['kcpSettings.seed']);
        expect(container.textContent).toContain('refused');
        // Points at what replaced it on this line.
        expect(container.textContent).toContain('mkcp-legacy');
        fireEvent.click(screen.getByText('Remove it'));
        expect(last().kcpSettings).toEqual({ mtu: 1350 });
    });

    it('says a 26.9 core ignores it rather than refusing it', () => {
        onLine('26.9');
        const { container } = draw({ network: 'kcp', kcpSettings: { header: { type: 'wechat-video' } } }, 'kcp');
        expect(noticesIn(container)).toEqual(['kcpSettings.header']);
        expect(container.textContent).toContain('drops it silently');
    });

    it('offers the 26.3 keys on 26.3 and the 26.7 keys after', () => {
        onLine('26.3');
        let view = draw({ network: 'kcp', kcpSettings: {} }, 'kcp');
        let labels = labelsIn(view.container).join('|');
        expect(labels).toContain('Write Buffer Size');
        expect(view.container.textContent).toContain('Enable Congestion Control');
        expect(labels).not.toContain('Max Sending Window');
        cleanup();

        onLine('26.7');
        view = draw({ network: 'kcp', kcpSettings: {} }, 'kcp');
        labels = labelsIn(view.container).join('|');
        expect(labels).not.toContain('Write Buffer Size');
        expect(view.container.textContent).not.toContain('Enable Congestion Control');
        expect(labels).toContain('Max Sending Window');
        expect(labels).toContain('Congestion Window Multiplier');
    });

    it('shows a 26.3 key on a 26.7 core as ignored, with a way to remove it', () => {
        const { container, last } = draw({ network: 'kcp', kcpSettings: { writeBufferSize: 4 } }, 'kcp');
        expect(noticesIn(container)).toEqual(['kcpSettings.writeBufferSize']);
        expect(container.textContent).toContain('maxSendingWindow');
        fireEvent.click(screen.getByText('Remove it'));
        expect(last().kcpSettings).toEqual({});
    });

    it('says when TTI is out of the line\'s range', () => {
        const { container } = draw({ network: 'kcp', kcpSettings: { tti: 2000 } }, 'kcp');
        expect(container.textContent).toContain('10–1000');
    });
});

describe('removed transports', () => {
    it('shows quic as refused, with nothing to edit', () => {
        const { container } = draw({ network: 'quic', quicSettings: { key: 'quic-key-value' } }, 'quic');
        expect(noticesIn(container)).toEqual(['network = "quic"']);
        expect(container.textContent).toContain('refused');
        expect(container.textContent).toContain('XHTTP');
        expect(container.querySelectorAll('input')).toHaveLength(0);
    });
});

describe('hysteria', () => {
    it('writes version 2 with whatever else it writes', () => {
        const { container, last } = draw({ network: 'hysteria', security: 'tls' }, 'hysteria', true, 'hysteria');
        const auth = container.querySelector('input') as HTMLInputElement;
        typeInto(auth, 'secret');
        expect(last().hysteriaSettings).toEqual({ version: 2, auth: 'secret' });
    });

    it('offers masquerade and the UDP idle timeout to a server only', () => {
        const server = draw({ network: 'hysteria', hysteriaSettings: { version: 2 } }, 'hysteria', false, 'hysteria');
        expect(server.container.textContent).toContain('Masquerade');
        expect(labelsIn(server.container).join('|')).toContain('UDP Idle Timeout');
        cleanup();
        const client = draw({ network: 'hysteria', hysteriaSettings: { version: 2 } }, 'hysteria', true, 'hysteria');
        expect(client.container.textContent).not.toContain('Masquerade');
        expect(labelsIn(client.container).join('|')).not.toContain('UDP Idle Timeout');
    });

    it('offers X-Forwarded headers on 26.9 only', () => {
        const stream = { network: 'hysteria', hysteriaSettings: { version: 2, masquerade: { type: 'proxy', url: 'https://a.example' } } };
        let view = draw(stream, 'hysteria', false, 'hysteria');
        expect(view.container.textContent).not.toContain('X-Forwarded');
        cleanup();
        onLine('26.9');
        view = draw(stream, 'hysteria', false, 'hysteria');
        expect(view.container.textContent).toContain('X-Forwarded');
    });

    it('never offers congestion, bandwidth or hopping, and shows old ones as moved', () => {
        const { container, last } = draw(
            { network: 'hysteria', hysteriaSettings: { version: 2, up: '100 mbps', congestion: 'bbr' } },
            'hysteria', true, 'hysteria',
        );
        expect(noticesIn(container).sort()).toEqual(['hysteriaSettings.congestion', 'hysteriaSettings.up']);
        expect(container.textContent).toContain('finalmask.quicParams');
        fireEvent.click(screen.getAllByText('Remove it')[0]!);
        expect(Object.keys(last().hysteriaSettings)).not.toContain('congestion');
    });

    it('says a missing version is refused, and sets it', () => {
        const { container, last } = draw({ network: 'hysteria', hysteriaSettings: { auth: 'x' } }, 'hysteria', true, 'hysteria');
        expect(noticesIn(container)).toContain('hysteriaSettings.version');
        fireEvent.click(screen.getByText('Set version 2'));
        expect(last().hysteriaSettings).toEqual({ auth: 'x', version: 2 });
    });
});

describe('TransportSettings', () => {
    it('still draws the chosen transport through the section it delegates to', () => {
        const { container } = render(
            <TransportSettings
                streamSettings={{ network: 'grpc', grpcSettings: { serviceName: 'GunService' } }}
                onChange={noop}
                isClient={false}
            />,
        );
        expect(valuesIn(container)).toContain('GunService');
    });

    it('renders the security half for REALITY', () => {
        render(
            <TransportSettings
                streamSettings={{ network: 'tcp', security: 'reality', realitySettings: { serverNames: ['example.com'] } }}
                onChange={noop}
                isClient={false}
            />,
        );
        expect(screen.getAllByText(/REALITY/i).length).toBeGreaterThan(0);
    });

    it('says REALITY over WebSocket will not load', () => {
        const { container } = render(
            <TransportSettings
                streamSettings={{ network: 'ws', security: 'reality', realitySettings: {} }}
                onChange={noop}
                protocol="vless"
            />,
        );
        expect(container.textContent).toContain('RAW, XHTTP or gRPC');
    });

    it('says a hysteria transport without TLS cannot run', () => {
        const { container } = render(
            <TransportSettings streamSettings={{ network: 'hysteria' }} onChange={noop} isClient protocol="hysteria" />,
        );
        expect(container.textContent).toContain('only with TLS');
    });

    it('does not offer allowInsecure, and shows a true one as refused with its replacement', () => {
        const writes: any[] = [];
        const { container } = render(
            <TransportSettings
                streamSettings={{ network: 'tcp', security: 'tls', tlsSettings: { serverName: 'a.example', allowInsecure: true } }}
                onChange={next => writes.push(next)}
                isClient
                protocol="vless"
            />,
        );
        expect(container.textContent).not.toContain('Allow Insecure');
        expect(noticesIn(container)).toContain('allowInsecure: true');
        expect(container.textContent).toContain('pinnedPeerCertSha256');
        fireEvent.click(screen.getByText('Remove it'));
        expect(writes[writes.length - 1].tlsSettings).toEqual({ serverName: 'a.example' });
    });

    it('shows verifyPeerCertInNames as refused on 26.3 and ignored after', () => {
        const stream = { network: 'tcp', security: 'tls', tlsSettings: { verifyPeerCertInNames: ['a.example'] } };
        onLine('26.3');
        let view = render(<TransportSettings streamSettings={stream} onChange={noop} isClient />);
        expect(view.container.textContent).toContain('refused');
        cleanup();
        onLine('26.9');
        view = render(<TransportSettings streamSettings={stream} onChange={noop} isClient />);
        expect(view.container.textContent).toContain('drops it silently');
        expect(noticesIn(view.container)).toContain('tlsSettings.verifyPeerCertInNames');
    });

    it('shows a method the config has, and folds it into network', () => {
        const writes: any[] = [];
        const { container } = render(
            <TransportSettings
                streamSettings={{ network: 'ws', method: 'xhttp' }}
                onChange={next => writes.push(next)}
                isClient
                protocol="vless"
            />,
        );
        expect(noticesIn(container)).toContain('method');
        // 26.7 runs method, so the XHTTP block is the one on screen.
        expect(container.textContent).toContain('XHTTP configuration');
        fireEvent.click(screen.getByText('Move it to network'));
        expect(writes[writes.length - 1]).toEqual({ network: 'xhttp' });
    });

    it('names settings left over from another transport', () => {
        const writes: any[] = [];
        const { container } = render(
            <TransportSettings
                streamSettings={{ network: 'ws', wsSettings: {}, kcpSettings: { seed: 'x' } }}
                onChange={next => writes.push(next)}
                protocol="vless"
            />,
        );
        expect(noticesIn(container)).toContain('kcpSettings');
        fireEvent.click(screen.getByText('Remove them'));
        expect(writes[writes.length - 1]).toEqual({ network: 'ws', wsSettings: {} });
    });
});
