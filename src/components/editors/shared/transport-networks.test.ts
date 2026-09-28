import { describe, expect, it } from 'bun:test';
import { isRemovedNetwork, networkOptions } from './transport-networks';

/**
 * Two of the transports this chooser used to offer are removed features: the
 * core answers `PrintRemovedFeatureError` and the config does not load. An
 * option that cannot be picked without breaking the config has no business
 * sitting in the list beside the working ones.
 */

const values = (protocol?: string, current?: string) =>
    networkOptions(protocol, current).map(option => option.value);

describe('what the chooser offers', () => {
    it('does not offer a transport the core removed', () => {
        expect(values('vless')).not.toContain('http');
        expect(values('vless')).not.toContain('quic');
    });

    it('offers the ones the core still builds', () => {
        const offered = values('vless');
        for (const network of ['tcp', 'raw', 'xhttp', 'splithttp', 'ws', 'httpupgrade', 'grpc', 'kcp', 'hysteria']) {
            expect(offered).toContain(network);
        }
    });

    it('offers masque to the masque outbound and to nobody else', () => {
        // "the masque transport can only be used by the masque outbound"
        expect(values('masque')).toContain('masque');
        expect(values('vless')).not.toContain('masque');
        expect(values(undefined)).not.toContain('masque');
    });
});

describe('a config that already holds a removed one', () => {
    it('shows it rather than leaving an empty chooser', () => {
        expect(values('vless', 'quic')).toContain('quic');
        expect(values('vless', 'http')).toContain('http');
    });

    it('says what it is and what replaced it', () => {
        const quic = networkOptions('vless', 'quic').find(option => option.value === 'quic')!;
        expect(quic.description).toContain('XHTTP');
    });

    it('does not add one the config does not have', () => {
        expect(values('vless', 'ws')).not.toContain('quic');
    });

    it('knows which names the core refuses', () => {
        for (const network of ['http', 'h2', 'h3', 'quic']) {
            expect(isRemovedNetwork(network)).toBe(true);
        }
        for (const network of ['tcp', 'ws', 'xhttp', 'hysteria', 'masque', undefined]) {
            expect(isRemovedNetwork(network)).toBe(false);
        }
    });
});
