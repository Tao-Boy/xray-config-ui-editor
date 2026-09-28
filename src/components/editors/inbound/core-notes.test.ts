import { describe, expect, it } from 'bun:test';
import { inboundNotes, topKeyOf, withoutPath } from './core-notes';
import { createDefaultInbound } from '../../../core/generators/endpoint-factory';
import { CORE_VERSIONS } from '../../../core/xray/versions';

const kinds = (notes: ReturnType<typeof inboundNotes>) =>
    notes.map(note => note.kind === 'feature' ? `${note.status}:${note.feature.path}:${note.action}` : note.kind === 'value' ? `value:${note.set.path}=${note.value}` : `conflict:${note.pair.alias}`);

describe('inboundNotes', () => {
    it('has nothing to say about what the factory builds, on any line', () => {
        for (const line of CORE_VERSIONS) {
            for (const protocol of ['vless', 'vmess', 'trojan', 'shadowsocks', 'socks', 'http', 'hysteria', 'tun', 'dokodemo-door', 'tunnel', 'wireguard']) {
                expect(inboundNotes(createDefaultInbound(protocol), line.id)).toEqual([]);
            }
        }
    });

    it('calls allocate a key no line reads, and offers to remove it', () => {
        const notes = inboundNotes({ protocol: 'vless', port: 443, settings: { clients: [], decryption: 'none' }, allocate: { strategy: 'always' } }, '26.7');
        expect(kinds(notes)).toEqual(['absent:allocate:remove']);
        expect(notes[0]!.kind === 'feature' && notes[0]!.everywhere).toBe(true);
    });

    it('flags the Hysteria 1 keys the editor used to write', () => {
        const notes = inboundNotes({ protocol: 'hysteria', port: 443, settings: { version: 2, clients: [{ auth: 'x' }], up_mbps: 100, down_mbps: 100 } }, '26.9');
        expect(kinds(notes)).toEqual(['absent:settings.up_mbps:remove', 'absent:settings.down_mbps:remove']);
    });

    it('offers to rename a 26.7-only spelling on 26.3 rather than delete the users', () => {
        const notes = inboundNotes({ protocol: 'vless', port: 443, settings: { users: [{ id: 'a' }], decryption: 'none' } }, '26.3');
        expect(kinds(notes)).toEqual(['absent:settings.users:adopt']);
    });

    it('reports both spellings once, as a conflict', () => {
        const notes = inboundNotes({ protocol: 'vless', port: 443, settings: { clients: [], users: [{ id: 'a' }], decryption: 'none' } }, '26.3');
        expect(kinds(notes)).toEqual(['conflict:users']);
        expect(notes[0]!.kind === 'conflict' && notes[0]!.keyEmpty).toBe(true);
    });

    it('reports a value the line refuses, worst first', () => {
        const notes = inboundNotes({
            protocol: 'shadowsocks', port: 1, settings: { method: 'none', password: 'x' },
            sniffing: { enabled: true, ipsExcluded: ['10.0.0.0/8'] },
        }, '26.3');
        // "none" still works on 26.3; the exclusion list does not exist there.
        expect(kinds(notes)).toEqual(['absent:sniffing.ipsExcluded:remove']);
        // On 26.7 "none" stops the load, which outranks a key that does nothing.
        expect(kinds(inboundNotes({ protocol: 'shadowsocks', port: 1, settings: { method: 'none', password: 'x' }, allocate: {} }, '26.7')))
            .toEqual(['value:settings.method=none', 'absent:allocate:remove']);
    });

    it('leaves transport keys to the transport editor', () => {
        const notes = inboundNotes({ protocol: 'vless', port: 443, settings: { clients: [], decryption: 'none' }, streamSettings: { network: 'grpc' } }, '26.7');
        expect(notes).toEqual([]);
    });

    it('never offers to remove the protocol itself', () => {
        const notes = inboundNotes({ protocol: 'masque', port: 443, settings: {} }, '26.7');
        expect(kinds(notes)).toEqual(['rejected:protocol:none']);
    });
});

describe('withoutPath', () => {
    it('drops a key through arrays without touching the rest', () => {
        const before = { settings: { clients: [{ password: 'a', email: 'x' }, { auth: 'b' }], version: 2 } };
        expect(withoutPath(before, 'settings.clients[].password')).toEqual({ settings: { clients: [{ email: 'x' }, { auth: 'b' }], version: 2 } });
        expect(before.settings.clients[0]!.password).toBe('a');
    });

    it('drops a top-level key, and leaves a missing one alone', () => {
        expect(withoutPath({ allocate: {}, port: 1 }, 'allocate')).toEqual({ port: 1 });
        const same = { port: 1 };
        expect(withoutPath(same, 'sniffing.ipsExcluded')).toBe(same);
    });

    it('names the top-level key a path starts at', () => {
        expect(topKeyOf('settings.clients[].password')).toBe('settings');
        expect(topKeyOf('allocate')).toBe('allocate');
    });
});
