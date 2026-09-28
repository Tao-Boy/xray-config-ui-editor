import { describe, expect, it } from 'bun:test';
import { versionDiagnostics } from './check';
import { allowedValues } from './features';
import { TRANSPORT_FEATURES, TRANSPORT_VALUE_SETS } from './features.transport';
import type { CoreVersionId } from './index';

/**
 * The transport rows and value sets, held to what the core does with a
 * config: each case is a config and the severity the chosen line earns it.
 */

const outbound = (protocol: string, streamSettings: any) => ({ outbounds: [{ tag: 'o', protocol, streamSettings }] });
const inbound = (protocol: string, streamSettings: any) => ({ inbounds: [{ tag: 'i', protocol, port: 443, streamSettings }] });

/** The findings for one field path, as `severity` strings. */
const at = (config: unknown, version: CoreVersionId, field: string) =>
    versionDiagnostics(config, version).filter(d => d.field === field).map(d => d.severity);

describe('transport rows', () => {
    it('cite a tag:file:line for every row and set', () => {
        for (const row of [...TRANSPORT_FEATURES, ...TRANSPORT_VALUE_SETS]) {
            expect(row.evidence.length).toBeGreaterThan(0);
            for (const cite of row.evidence) expect(cite).toMatch(/^v26\.\d+\.\d+:[\w/.-]+\.go:\d+$/);
        }
    });

    it('flag a Host header the way each transport treats it', () => {
        // ws moves it with a warning; httpupgrade and xhttp refuse the config.
        expect(at(outbound('vless', { network: 'ws', wsSettings: { headers: { Host: 'a' } } }), '26.7', 'streamSettings.wsSettings.headers.Host'))
            .toEqual(['info']);
        expect(at(outbound('vless', { network: 'httpupgrade', httpupgradeSettings: { headers: { Host: 'a' } } }), '26.7', 'streamSettings.httpupgradeSettings.headers.Host'))
            .toEqual(['critical']);
        expect(at(inbound('vless', { network: 'xhttp', xhttpSettings: { headers: { host: 'a' } } }), '26.9', 'streamSettings.xhttpSettings.headers.host'))
            .toEqual(['critical']);
    });

    it('know echForceQuery is a 26.3 key', () => {
        const config = outbound('vless', { security: 'tls', tlsSettings: { echForceQuery: 'full' } });
        expect(at(config, '26.3', 'streamSettings.tlsSettings.echForceQuery')).toEqual([]);
        expect(at(config, '26.7', 'streamSettings.tlsSettings.echForceQuery')).toEqual(['warning']);
    });
});

describe('transport value sets', () => {
    it('refuse legacy xtls, and let an empty security through', () => {
        expect(at(outbound('vless', { security: 'xtls' }), '26.7', 'streamSettings.security')).toEqual(['critical']);
        expect(at(outbound('vless', { security: '' }), '26.7', 'streamSettings.security')).toEqual([]);
        expect(at(outbound('vless', { security: 'TLS' }), '26.7', 'streamSettings.security')).toEqual([]);
    });

    it('refuse a hysteria proxy off the hysteria transport from 26.7', () => {
        const config = outbound('hysteria', { network: 'tcp', security: 'tls' });
        expect(at(config, '26.3', 'streamSettings.network')).toEqual([]);
        expect(at(config, '26.7', 'streamSettings.network')).toEqual(['critical']);
        expect(at(inbound('hysteria', { network: 'grpc', security: 'tls' }), '26.9', 'streamSettings.network')).toContain('critical');
        expect(at(config, '26.7', 'streamSettings.network').length).toBe(1);
    });

    it('refuse a hysteria inbound without TLS', () => {
        expect(at(inbound('hysteria', { network: 'hysteria', security: 'none' }), '26.7', 'streamSettings.security')).toEqual(['critical']);
        expect(at(inbound('hysteria', { network: 'hysteria', security: 'tls' }), '26.7', 'streamSettings.security')).toEqual([]);
    });

    it('refuse the addressPortStrategy values this editor used to offer', () => {
        // "same", "different" and "random" were never values the core knew.
        for (const value of ['same', 'different', 'random']) {
            expect(at(outbound('vless', { sockopt: { addressPortStrategy: value } }), '26.7', 'streamSettings.sockopt.addressPortStrategy'))
                .toEqual(['critical']);
        }
        expect(at(outbound('vless', { sockopt: { addressPortStrategy: 'srvportonly' } }), '26.7', 'streamSettings.sockopt.addressPortStrategy'))
            .toEqual([]);
    });

    it('refuse addressPortStrategy on a 26.9 freedom outbound only', () => {
        const config = outbound('freedom', { sockopt: { addressPortStrategy: 'SrvPortOnly' } });
        expect(at(config, '26.7', 'streamSettings.sockopt.addressPortStrategy')).toEqual([]);
        expect(at(config, '26.9', 'streamSettings.sockopt.addressPortStrategy')).toEqual(['critical']);
        expect(at(outbound('freedom', { sockopt: { addressPortStrategy: 'none' } }), '26.9', 'streamSettings.sockopt.addressPortStrategy'))
            .toEqual([]);
    });

    it('know all eleven domain strategies', () => {
        const offered = allowedValues('26.7', 'stream.sockopt.domainStrategy').filter(Boolean);
        expect(offered).toHaveLength(11);
        expect(at(outbound('vless', { sockopt: { domainStrategy: 'forceipv6v4' } }), '26.7', 'streamSettings.sockopt.domainStrategy')).toEqual([]);
        expect(at(outbound('vless', { sockopt: { domainStrategy: 'IPIfNonMatch' } }), '26.7', 'streamSettings.sockopt.domainStrategy')).toEqual(['critical']);
    });

    it('know the fingerprints 26.7 added', () => {
        const config = outbound('vless', { security: 'tls', tlsSettings: { fingerprint: 'hellochrome_133' } });
        expect(at(config, '26.3', 'streamSettings.tlsSettings.fingerprint')).toEqual(['critical']);
        expect(at(config, '26.7', 'streamSettings.tlsSettings.fingerprint')).toEqual([]);
    });

    it('compare the xhttp mode as written', () => {
        expect(at(outbound('vless', { network: 'xhttp', xhttpSettings: { mode: 'stream-one' } }), '26.7', 'streamSettings.xhttpSettings.mode')).toEqual([]);
        expect(at(outbound('vless', { network: 'xhttp', xhttpSettings: { mode: 'Stream-One' } }), '26.7', 'streamSettings.xhttpSettings.mode')).toEqual(['critical']);
    });

    it('refuse an unknown masquerade on a hysteria server', () => {
        const config = inbound('hysteria', { network: 'hysteria', security: 'tls', hysteriaSettings: { version: 2, masquerade: { type: 'redirect' } } });
        expect(at(config, '26.7', 'streamSettings.hysteriaSettings.masquerade.type')).toEqual(['critical']);
    });
});
