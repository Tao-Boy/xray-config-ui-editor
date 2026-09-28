import { describe, expect, it } from 'bun:test';
import { migrateProxySettings, outboundShape, shapedProtocols } from './outbound-shape';
import { OutboundProtocolSchema } from './schemas/primitives';

/**
 * The table decides what the outbound editor draws, so a protocol missing from
 * it silently gets the full set of blocks again — which is the bug the table
 * exists to fix.
 */

describe('the table against the protocol list', () => {
    it('has an entry for every protocol the editor offers', () => {
        const offered = OutboundProtocolSchema.options as unknown as string[];
        const missing = offered.filter(protocol => !shapedProtocols().includes(protocol));
        expect(missing).toEqual([]);
    });

    it('names no protocol the editor cannot produce', () => {
        const offered = new Set<string>(OutboundProtocolSchema.options as unknown as string[]);
        // `shadowsocks-2022` is this app's name for shadowsocks with the 2022
        // ciphers, not a protocol of its own, so it is the one exception.
        const extra = shapedProtocols().filter(p => !offered.has(p) && p !== 'shadowsocks-2022');
        expect(extra).toEqual([]);
    });
});

describe('a protocol that never dials', () => {
    // proxy/loopback/loopback.go: Process(ctx, link, _ internet.Dialer)
    // proxy/blackhole/blackhole.go: takes `dialer`, never references it
    it.each(['loopback', 'blackhole'])('has no transport, server or mux: %s', protocol => {
        expect(outboundShape(protocol)).toEqual({ server: false, transport: false, mux: false });
    });
});

describe('a protocol that dials', () => {
    it.each(['vless', 'vmess', 'trojan', 'shadowsocks', 'socks', 'http', 'hysteria', 'freedom', 'dns', 'wireguard'])(
        'keeps its transport block: %s',
        protocol => {
            expect(outboundShape(protocol).transport).toBe(true);
        },
    );

    it('offers a server card only where there is a server to describe', () => {
        // freedom dials the destination, dns dials the resolver, wireguard has
        // peers — none of them has an address-and-credentials card.
        for (const protocol of ['freedom', 'dns', 'wireguard']) {
            expect(outboundShape(protocol).server).toBe(false);
        }
        for (const protocol of ['vless', 'vmess', 'trojan', 'shadowsocks', 'socks', 'http', 'hysteria']) {
            expect(outboundShape(protocol).server).toBe(true);
        }
    });

    it('offers mux only where the far end can demultiplex it', () => {
        for (const protocol of ['vless', 'vmess', 'trojan', 'shadowsocks']) {
            expect(outboundShape(protocol).mux).toBe(true);
        }
        // A plain SOCKS or HTTP proxy does not speak Mux.Cool.
        for (const protocol of ['socks', 'http', 'freedom', 'dns', 'wireguard', 'hysteria']) {
            expect(outboundShape(protocol).mux).toBe(false);
        }
    });
});

describe('masque', () => {
    it('is never offered mux, which the core refuses for it by name', () => {
        // xray.go: `masque outbound does not support "mux"`
        expect(outboundShape('masque')).toEqual({ server: true, transport: true, mux: false });
    });
});

describe('a protocol nobody told it about', () => {
    it('is drawn in full rather than losing a field to a missing entry', () => {
        expect(outboundShape('something-new')).toEqual({ server: true, transport: true, mux: true });
        expect(outboundShape(undefined)).toEqual({ server: true, transport: true, mux: true });
    });
});

describe('moving a removed proxySettings to sockopt', () => {
    it('carries the tag over to dialerProxy and drops the old key', () => {
        const migrated = migrateProxySettings<any>({
            tag: 'proxy',
            protocol: 'vless',
            proxySettings: { tag: 'warp', transportLayer: true },
        });

        expect(migrated.streamSettings.sockopt.dialerProxy).toBe('warp');
        expect('proxySettings' in migrated).toBe(false);
    });

    it('keeps the rest of streamSettings and of sockopt', () => {
        const migrated = migrateProxySettings<any>({
            protocol: 'vless',
            proxySettings: { tag: 'warp' },
            streamSettings: {
                network: 'ws',
                security: 'tls',
                sockopt: { mark: 255, tcpFastOpen: true },
            },
        });

        expect(migrated.streamSettings.network).toBe('ws');
        expect(migrated.streamSettings.security).toBe('tls');
        expect(migrated.streamSettings.sockopt.mark).toBe(255);
        expect(migrated.streamSettings.sockopt.dialerProxy).toBe('warp');
    });

    it('does not overrule a dialerProxy someone already chose', () => {
        const migrated = migrateProxySettings<any>({
            proxySettings: { tag: 'old' },
            streamSettings: { sockopt: { dialerProxy: 'current' } },
        });
        expect(migrated.streamSettings.sockopt.dialerProxy).toBe('current');
        expect('proxySettings' in migrated).toBe(false);
    });

    it('leaves an outbound without one exactly as it was', () => {
        const outbound = { protocol: 'freedom', settings: {} };
        expect(migrateProxySettings(outbound)).toBe(outbound);
    });

    it('does not touch the outbound it was given', () => {
        const outbound: any = { proxySettings: { tag: 'warp' } };
        migrateProxySettings(outbound);
        expect(outbound.proxySettings.tag).toBe('warp');
        expect(outbound.streamSettings).toBeUndefined();
    });
});
