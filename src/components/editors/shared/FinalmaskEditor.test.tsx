import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import React from 'react';
import { FinalmaskEditor } from './FinalmaskEditor';
import { useFinalmaskEditor } from '../../../hooks/useFinalmaskEditor';
import { useConfigStore } from '../../../store/configStore';
import { getPresets, noiseItems, noiseMask } from '../../../core/presets';
import type { CoreVersionId } from '../../../core/xray/versions';

/**
 * The finalmask form draws what the chosen core line takes, and keeps on
 * screen what the config holds that the line does not — refused types,
 * dropped keys, keys only the other side reads — so none of it disappears
 * or gets rewritten behind the user's back.
 */

// Inside act: a hook rendered earlier in the test is subscribed to the store.
// A block body, because the persisting store's setState hands back a promise
// that would turn this into an unawaited async act.
const onLine = (version: CoreVersionId) => {
    act(() => {
        useConfigStore.setState({ coreVersion: version });
    });
};

beforeEach(() => {
    onLine('26.7');
});
afterEach(cleanup);

/** Renders the editor and records what it writes. */
const draw = (finalmask: any, side?: 'inbound' | 'outbound') => {
    const writes: any[] = [];
    const view = render(<FinalmaskEditor finalmask={finalmask} onChange={next => writes.push(next)} side={side} />);
    return { ...view, writes, last: () => writes[writes.length - 1] };
};

const fieldsIn = (container: HTMLElement, within = '') =>
    Array.from(container.querySelectorAll(`${within} [data-field]`.trim())).map(node => node.getAttribute('data-field'));

const UDP0 = '[data-testid="finalmask-udp-0"]';

const extrasIn = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('[data-extra]')).map(node => node.getAttribute('data-extra'));

const hook = (finalmask: any, side?: 'inbound' | 'outbound') => {
    const writes: any[] = [];
    const { result } = renderHook(() => useFinalmaskEditor(finalmask, next => writes.push(next), side));
    return { editor: result.current, writes };
};

describe('mask types per line', () => {
    it('offers each list its own types on the chosen line', () => {
        onLine('26.7');
        const { editor } = hook({ udp: [{ type: 'noise' }], tcp: [{ type: 'fragment' }] }, 'outbound');
        const [udp, tcp] = editor.chains;
        expect(udp!.layers[0]!.typeOptions).toContain('mkcp-legacy');
        expect(udp!.layers[0]!.typeOptions).toContain('realm');
        expect(udp!.layers[0]!.typeOptions).not.toContain('header-dns');
        expect(udp!.layers[0]!.typeOptions).not.toContain('udphop');
        expect(tcp!.layers[0]!.typeOptions).toEqual(['header-custom', 'fragment', 'sudoku', 'xmc']);
    });

    it('offers the 26.3 masks on 26.3, and udphop to a 26.9 client only', () => {
        onLine('26.3');
        expect(hook({ udp: [{ type: 'noise' }] }).editor.chains[0]!.layers[0]!.typeOptions).toContain('header-wechat');
        onLine('26.9');
        expect(hook({ udp: [{ type: 'noise' }] }, 'outbound').editor.chains[0]!.layers[0]!.typeOptions).toContain('udphop');
        expect(hook({ udp: [{ type: 'noise' }] }, 'inbound').editor.chains[0]!.layers[0]!.typeOptions).not.toContain('udphop');
    });

    it('keeps a type the line refuses on screen, marked, with its replacement and a way over', () => {
        onLine('26.7');
        const { container, last } = draw({ udp: [{ type: 'header-dns', settings: { domain: 'example.com' } }] }, 'outbound');
        expect(container.textContent).toContain('header-dns — refused by Xray v26.7.28');
        expect(container.textContent).toContain('Use mkcp-legacy instead.');
        // Its settings stay visible too, for removal or conversion.
        expect(extrasIn(container)).toEqual(['domain']);
        fireEvent.click(screen.getByText('Convert to mkcp-legacy'));
        expect(last()).toEqual({ udp: [{ type: 'mkcp-legacy', settings: { header: 'dns', value: 'example.com' } }] });
    });

    it('adds noise to UDP and a TCP type to TCP — never noise to TCP', () => {
        const { writes, editor } = hook({}, 'outbound');
        act(() => editor.addLayer('udp'));
        act(() => editor.addLayer('tcp'));
        expect(writes[0].udp[0].type).toBe('noise');
        expect(writes[1].tcp[0].type).toBe('header-custom');
    });

    it('moves a layer, since which end a mask sits at decides whether it runs', () => {
        const { writes, editor } = hook({ udp: [{ type: 'noise' }, { type: 'xicmp' }] });
        act(() => editor.moveLayer('udp', 1, -1));
        expect(writes[0].udp.map((mask: any) => mask.type)).toEqual(['xicmp', 'noise']);
    });
});

describe('mask settings per line and side', () => {
    it('draws xdns as the line and side read it', () => {
        onLine('26.3');
        expect(fieldsIn(draw({ udp: [{ type: 'xdns', settings: {} }] }, 'outbound').container, UDP0)).toEqual(['domain']);
        cleanup();
        onLine('26.7');
        expect(fieldsIn(draw({ udp: [{ type: 'xdns', settings: {} }] }, 'inbound').container, UDP0)).toEqual(['domains']);
        cleanup();
        expect(fieldsIn(draw({ udp: [{ type: 'xdns', settings: {} }] }, 'outbound').container, UDP0)).toEqual(['resolvers']);
    });

    it('shows a key the line refuses, says so, and removes it on request', () => {
        onLine('26.9');
        const { container, last } = draw({ udp: [{ type: 'xdns', settings: { domain: 'old.example.com', resolvers: ['a+udp://1.1.1.1:53'] } }] }, 'outbound');
        expect(extrasIn(container)).toEqual(['domain']);
        expect(container.textContent).toContain('refused by Xray v26.9.9');
        fireEvent.click(screen.getByText('Remove'));
        expect(last().udp[0].settings).toEqual({ resolvers: ['a+udp://1.1.1.1:53'] });
    });

    it('shows a key only the other side reads', () => {
        onLine('26.7');
        const { container } = draw({ udp: [{ type: 'xdns', settings: { domains: ['t.example.com'] } }] }, 'outbound');
        expect(extrasIn(container)).toEqual(['domains']);
        expect(container.textContent).toContain('only the server side reads this');
    });

    it('draws the 26.3 xicmp keys on 26.3 and the new ones after', () => {
        onLine('26.3');
        expect(fieldsIn(draw({ udp: [{ type: 'xicmp' }] }, 'outbound').container, UDP0)).toEqual(['listenIp', 'id']);
        cleanup();
        onLine('26.9');
        const { container } = draw({ udp: [{ type: 'xicmp', settings: { listenIp: '0.0.0.0', id: 0 } }] }, 'outbound');
        expect(fieldsIn(container, UDP0)).toEqual(['ips', 'dgram']);
        expect(extrasIn(container)).toEqual(['listenIp', 'id']);
        expect(container.textContent).toContain('ignored by Xray v26.9.9');
    });

    it('shows where a mask has to sit', () => {
        onLine('26.7');
        const { container } = draw({ udp: [{ type: 'noise' }, { type: 'xicmp' }] }, 'inbound');
        expect(container.querySelector('[data-testid="finalmask-udp-1"] [data-tone="critical"]')?.textContent)
            .toContain('xicmp has to be the first UDP mask');
    });
});

describe('the WARP noise masks', () => {
    const warp = () => {
        const preset = getPresets().find(candidate => candidate.name === 'WARP Profile A')!;
        return (preset.config as any).outbounds[0].streamSettings.finalmask;
    };

    it('render with every item', () => {
        const finalmask = warp();
        const { container } = draw(finalmask, 'outbound');
        const values = Array.from(container.querySelectorAll('input')).map(input => (input as HTMLInputElement).value);
        expect(values).toContain(finalmask.udp[0].settings.noise[0].packet);
        expect(values.filter(value => value === '40-70')).toHaveLength(4);
        expect(values.filter(value => value === '5-15')).toHaveLength(4);
    });

    it('edit one item and leave the rest as they were', () => {
        const finalmask = warp();
        const { container, last } = draw(finalmask, 'outbound');
        const rand = Array.from(container.querySelectorAll('input')).find(input => (input as HTMLInputElement).value === '40-70')!;
        fireEvent.change(rand, { target: { value: '50-80' } });
        const noise = last().udp[0].settings.noise;
        expect(noise[0]).toEqual(finalmask.udp[0].settings.noise[0]);
        expect(noise[1]).toEqual({ rand: '50-80', delay: '5-15' });
        expect(noise).toHaveLength(5);
    });
});

describe('noise presets', () => {
    const pressed = (label: string) => screen.getByText(label).closest('button')!.getAttribute('aria-pressed');

    it('give a transport with no finalmask a working noise layer in one press', () => {
        const { last } = draw(undefined, 'outbound');
        fireEvent.click(screen.getByText('WARP A · QUIC'));
        expect(last()).toEqual({ udp: [noiseMask('warp-a')] });
    });

    it('replace the packets of the noise layer already there', () => {
        const finalmask = { udp: [{ type: 'noise', settings: { reset: '30-60', noise: [{ rand: '10-20' }] } }] };
        const { last } = draw(finalmask, 'outbound');
        fireEvent.click(screen.getByText('WARP C · SIP'));
        expect(last()).toEqual({ udp: [{ type: 'noise', settings: { reset: '30-60', noise: noiseItems('warp-c') } }] });
    });

    it('mark the preset the layer holds', () => {
        const preset = getPresets().find(candidate => candidate.name === 'WARP Profile B')!;
        draw((preset.config as any).outbounds[0].streamSettings.finalmask, 'outbound');
        expect(pressed('WARP B · QUIC')).toBe('true');
        expect(pressed('WARP A · QUIC')).toBe('false');
    });

    it('sit with the UDP chain, not the TCP one', () => {
        const { container } = draw({ udp: [], tcp: [] }, 'outbound');
        expect(container.querySelector('[data-testid="finalmask-udp"] [data-testid="noise-presets"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="finalmask-tcp"] [data-testid="noise-presets"]')).toBeNull();
    });
});

describe('writing several settings at once', () => {
    it('keeps both, where two separate writes lost one', () => {
        // Each setSetting reads the mask out of the `finalmask` prop, so two
        // calls in one handler both start from the value before either ran and
        // the second discards the first. The generator applies `noise` and
        // `reset` together, which is exactly that case.
        const { editor, writes } = hook({ udp: [{ type: 'noise', settings: { noise: [{ rand: '1-2' }] } }] }, 'outbound');
        editor.patchSettings('udp', 0, { noise: [{ type: 'hex', packet: 'aa' }], reset: '120-180' });
        expect(writes[writes.length - 1].udp[0].settings).toEqual({
            noise: [{ type: 'hex', packet: 'aa' }],
            reset: '120-180',
        });
    });

    it('removes a key the patch clears, and keeps the ones it does not mention', () => {
        const { editor, writes } = hook({ udp: [{ type: 'noise', settings: { noise: [{ rand: '1-2' }], reset: '60' } }] }, 'outbound');
        editor.patchSettings('udp', 0, { reset: undefined });
        expect(writes[writes.length - 1].udp[0].settings).toEqual({ noise: [{ rand: '1-2' }] });
    });
});

describe('QUIC parameters', () => {
    it('offers bbrProfile from 26.7, the four switches on 26.9, and udpHop until 26.9 took it away', () => {
        onLine('26.3');
        let fields = fieldsIn(draw({}).container);
        expect(fields).not.toContain('bbrProfile');
        expect(fields).toContain('udpHop');
        cleanup();
        onLine('26.7');
        fields = fieldsIn(draw({}).container);
        expect(fields).toContain('bbrProfile');
        expect(fields).not.toContain('disableGSO');
        cleanup();
        onLine('26.9');
        fields = fieldsIn(draw({}).container);
        expect(fields).toEqual(expect.arrayContaining(['disableGSO', 'disableChromeParrot', 'disableStatelessReset', 'brutalDisableLossCompensation']));
        expect(fields).not.toContain('udpHop');
    });

    it('writes the keys the core reads, and never the ones it does not', () => {
        const { container, last } = draw({}, 'outbound');
        const idle = container.querySelector('[data-field="maxIdleTimeout"] input') as HTMLInputElement;
        fireEvent.change(idle, { target: { value: '30' } });
        expect(last()).toEqual({ quicParams: { maxIdleTimeout: 30 } });
        expect(fieldsIn(container)).not.toContain('max_idle_timeout');
        expect(fieldsIn(container)).not.toContain('handshake_timeout');
    });

    it('shows the keys the old editor wrote as ignored, with a way to remove them', () => {
        const { container, last } = draw({ quicParams: { max_idle_timeout: 30, handshake_timeout: 20 } }, 'outbound');
        expect(extrasIn(container)).toEqual(['max_idle_timeout', 'handshake_timeout']);
        expect(container.textContent).toContain('Use streamSettings.finalmask.quicParams.maxIdleTimeout instead.');
        fireEvent.click(screen.getAllByText('Remove')[1]!);
        expect(last()).toEqual({ quicParams: { max_idle_timeout: 30 } });
    });

    it('shows udpHop on 26.9 as ignored, pointing at the udphop mask', () => {
        onLine('26.9');
        const { container } = draw({ quicParams: { udpHop: { ports: '20000-30000', interval: '5-10' } } }, 'outbound');
        expect(extrasIn(container)).toEqual(['udpHop']);
        expect(container.textContent).toContain('Use streamSettings.finalmask.udp udphop instead.');
    });

    it('treats the default congestion as no key, not an empty string', () => {
        const { writes, editor } = hook({ quicParams: { congestion: 'bbr', brutalUp: '100 mbps' } });
        act(() => editor.setQuic('congestion', undefined));
        expect(writes[0]).toEqual({ quicParams: { brutalUp: '100 mbps' } });
        const cleared = hook({ quicParams: { congestion: 'bbr' } });
        act(() => cleared.editor.setQuic('congestion', undefined));
        expect(cleared.writes[0]).toEqual({});
    });
});
