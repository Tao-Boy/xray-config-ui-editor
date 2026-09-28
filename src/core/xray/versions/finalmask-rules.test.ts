import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { CORE_VERSIONS, type CoreVersionId } from './index';
import { allowedValues, FEATURES } from './features';
import { versionDiagnostics } from './check';
import {
    finalmaskIssues,
    MASK_KEYS,
    maskKeyStatus,
    maskTypeChoices,
    maskTypeStatus,
    offeredMaskKeys,
    offeredQuicKeys,
    parseInt32Range,
    QUIC_KEYS,
    quicKeyStatus,
    toMkcpLegacy,
    type MaskList,
} from './finalmask-rules';

const LINES = CORE_VERSIONS.map(version => version.id);
const TAG: Record<CoreVersionId, string> = { '26.3': 'v26.3.27', '26.7': 'v26.7.28', '26.9': 'v26.9.9' };

const registered = (version: CoreVersionId, list: MaskList, type: string) =>
    allowedValues(version, `finalmask.${list}.type`).includes(type);

// ── The key table against its sources ───────────────────────────────────

describe('the finalmask key table', () => {
    const findings = JSON.parse(readFileSync('scripts/core-versions/findings/finalmask.json', 'utf8'));
    const perVersion: Record<string, Record<string, string[] | null>> = findings.perVersionKeys;

    /** Which findings entry describes each mask's settings. */
    const entryFor = (list: MaskList, type: string): string | undefined =>
        Object.keys(perVersion).find(name => {
            const match = /^(tcp|udp|tcp\|udp)\[type=([^\]]+)\]\.settings$/.exec(name);
            return match && match[1]!.split('|').includes(list) && match[2]!.split('|').includes(type);
        });

    it('lists every key each struct decodes, on each line, as the findings read them', () => {
        for (const list of ['tcp', 'udp'] as const) {
            for (const [type, keys] of Object.entries(MASK_KEYS[list])) {
                const entry = entryFor(list, type);
                expect(entry, `${list}:${type}`).toBeDefined();
                for (const version of LINES) {
                    const expected = perVersion[entry!]![`v${TAG[version].slice(1)}`];
                    const ours = keys.filter(spec => spec.lines.includes(version)).map(spec => spec.key).sort();
                    expect(ours, `${list}:${type} on ${version}`).toEqual([...(expected ?? [])].sort());
                }
            }
        }
    });

    it('lists the quicParams keys each line decodes', () => {
        const entry = perVersion['streamSettings.finalmask.quicParams']!;
        for (const version of LINES) {
            const ours = QUIC_KEYS.filter(spec => spec.lines.includes(version)).map(spec => spec.key).sort();
            expect(ours, version).toEqual([...entry[`v${TAG[version].slice(1)}`]!].sort());
        }
    });

    it('has a form for every type any line registers, and no type none does', () => {
        for (const list of ['tcp', 'udp'] as const) {
            const known = new Set(LINES.flatMap(version => allowedValues(version, `finalmask.${list}.type`)));
            expect(new Set(Object.keys(MASK_KEYS[list]))).toEqual(known);
        }
    });

    it('agrees with every FEATURES row about a mask setting', () => {
        const rows = FEATURES.filter(row => row.path.startsWith('streamSettings.finalmask.'));
        let compared = 0;
        for (const row of rows) {
            const setting = /^streamSettings\.finalmask\.(tcp|udp)\[type=([^\]]+)\]\.settings\.(\w+)$/.exec(row.path);
            const quic = /^streamSettings\.finalmask\.quicParams\.(\w+)$/.exec(row.path);
            for (const version of LINES) {
                const status = row.status[version];
                let listed: boolean;
                if (setting) {
                    const [, list, type, key] = setting as unknown as [string, MaskList, string, string];
                    // A type the line does not register has no settings to speak of.
                    if (!registered(version, list, type)) continue;
                    listed = (MASK_KEYS[list][type] ?? []).some(spec => spec.key === key && spec.lines.includes(version));
                } else if (quic) {
                    listed = QUIC_KEYS.some(spec => spec.key === quic[1] && spec.lines.includes(version));
                } else {
                    continue;
                }
                compared++;
                expect(listed, `${row.id} on ${version}`).toBe(status === 'accepted' || status === 'deprecated');
            }
        }
        expect(compared).toBeGreaterThan(20);
    });
});

// ── Per-key answers ─────────────────────────────────────────────────────

describe('what a line does with one setting', () => {
    it('refuses the single xdns domain from 26.7 on, and reads it on 26.3', () => {
        expect(maskKeyStatus('26.3', 'udp', 'xdns', 'domain').status).toBe('accepted');
        expect(maskKeyStatus('26.7', 'udp', 'xdns', 'domain').status).toBe('rejected');
        expect(maskKeyStatus('26.9', 'udp', 'xdns', 'domain', 'inbound').status).toBe('rejected');
    });

    it('says which side reads a one-sided key', () => {
        expect(maskKeyStatus('26.7', 'udp', 'xdns', 'domains', 'outbound')).toEqual({ status: 'accepted', readBy: 'inbound' });
        expect(maskKeyStatus('26.7', 'udp', 'xdns', 'resolvers', 'inbound')).toEqual({ status: 'accepted', readBy: 'outbound' });
        expect(maskKeyStatus('26.7', 'udp', 'xdns', 'resolvers', 'outbound')).toEqual({ status: 'accepted' });
        expect(maskKeyStatus('26.9', 'udp', 'xicmp', 'dgram', 'inbound').readBy).toBe('outbound');
    });

    it('calls a key the line dropped absent', () => {
        expect(maskKeyStatus('26.7', 'udp', 'xicmp', 'listenIp').status).toBe('absent');
        expect(maskKeyStatus('26.3', 'udp', 'salamander', 'packetSize').status).toBe('absent');
        expect(maskKeyStatus('26.7', 'udp', 'realm', 'ipMode').status).toBe('absent');
        expect(maskKeyStatus('26.9', 'udp', 'noise', 'made-up').status).toBe('absent');
    });

    it('marks the fallback spellings as such', () => {
        expect(maskKeyStatus('26.9', 'tcp', 'sudoku', 'custom_table')).toEqual({ status: 'accepted', legacy: true });
    });

    it('knows the quicParams keys this editor used to write do nothing anywhere', () => {
        for (const version of LINES) {
            expect(quicKeyStatus(version, 'max_idle_timeout').status).toBe('absent');
            expect(quicKeyStatus(version, 'handshake_timeout').status).toBe('absent');
            expect(quicKeyStatus(version, 'maxIdleTimeout').status).toBe('accepted');
        }
        expect(quicKeyStatus('26.7', 'max_idle_timeout').replacement).toBe('streamSettings.finalmask.quicParams.maxIdleTimeout');
        expect(quicKeyStatus('26.9', 'udpHop', 'inbound').replacement).toBe('streamSettings.finalmask.udp udphop');
    });

    it('offers bbrProfile from 26.7, the four switches on 26.9 only, and udpHop until 26.9 took it away', () => {
        const offered = (version: CoreVersionId) => offeredQuicKeys(version).map(spec => spec.key);
        expect(offered('26.3')).not.toContain('bbrProfile');
        expect(offered('26.7')).toContain('bbrProfile');
        expect(offered('26.7')).not.toContain('disableGSO');
        expect(offered('26.9')).toEqual(expect.arrayContaining(['brutalDisableLossCompensation', 'disableChromeParrot', 'disableGSO', 'disableStatelessReset']));
        expect(offered('26.7')).toContain('udpHop');
        expect(offered('26.9')).not.toContain('udpHop');
        expect(quicKeyStatus('26.9', 'udpHop').status).toBe('absent');
        expect(quicKeyStatus('26.3', 'bbrProfile').status).toBe('absent');
    });

    it('offers each side only the xdns list it reads, and both when the side is unknown', () => {
        const keys = (side?: 'inbound' | 'outbound') => offeredMaskKeys('26.7', 'udp', 'xdns', side).map(spec => spec.key);
        expect(keys('inbound')).toEqual(['domains']);
        expect(keys('outbound')).toEqual(['resolvers']);
        expect(keys()).toEqual(['domains', 'resolvers']);
        expect(offeredMaskKeys('26.3', 'udp', 'xdns').map(spec => spec.key)).toEqual(['domain']);
    });

    it('never offers a fallback spelling', () => {
        expect(offeredMaskKeys('26.9', 'udp', 'sudoku').map(spec => spec.key)).not.toContain('custom_table');
    });
});

describe('mask types per line', () => {
    it('points each removed 26.3 mask at mkcp-legacy', () => {
        expect(maskTypeStatus('26.3', 'udp', 'header-dns')).toEqual({ accepted: true });
        expect(maskTypeStatus('26.7', 'udp', 'header-dns')).toEqual({ accepted: false, replacement: 'mkcp-legacy' });
        expect(maskTypeStatus('26.9', 'udp', 'mkcp-aes128gcm').replacement).toBe('mkcp-legacy');
    });

    it('refuses a type in the wrong list without inventing a replacement', () => {
        expect(maskTypeStatus('26.9', 'udp', 'fragment')).toEqual({ accepted: false });
        expect(maskTypeStatus('26.9', 'tcp', 'noise')).toEqual({ accepted: false });
    });

    it('flags udphop on an inbound', () => {
        expect(maskTypeStatus('26.9', 'udp', 'udphop', 'inbound')).toEqual({ accepted: true, clientOnly: true });
        expect(maskTypeStatus('26.9', 'udp', 'udphop', 'outbound')).toEqual({ accepted: true });
    });

    it('offers each list its own types, per line', () => {
        expect(maskTypeChoices('26.3', 'tcp')).toEqual(['header-custom', 'fragment', 'sudoku']);
        expect(maskTypeChoices('26.7', 'tcp')).toContain('xmc');
        expect(maskTypeChoices('26.7', 'udp')).not.toContain('header-dns');
        expect(maskTypeChoices('26.7', 'udp')).toContain('mkcp-legacy');
        expect(maskTypeChoices('26.7', 'udp')).not.toContain('udphop');
        expect(maskTypeChoices('26.9', 'udp', 'outbound')).toContain('udphop');
        expect(maskTypeChoices('26.9', 'udp', 'inbound')).not.toContain('udphop');
    });

    it('keeps the current type in the list even when the line refuses it', () => {
        expect(maskTypeChoices('26.7', 'udp', 'outbound', 'header-wechat')).toContain('header-wechat');
        expect(maskTypeChoices('26.9', 'udp', 'inbound', 'udphop')).toContain('udphop');
    });
});

describe('moving a 26.3 mask onto mkcp-legacy', () => {
    it('builds what the old mask built', () => {
        expect(toMkcpLegacy('mkcp-original', {})).toEqual({ type: 'mkcp-legacy', settings: {} });
        expect(toMkcpLegacy('mkcp-aes128gcm', { password: 'pw' })).toEqual({ type: 'mkcp-legacy', settings: { value: 'pw' } });
        expect(toMkcpLegacy('header-dns', { domain: 'example.com' })).toEqual({ type: 'mkcp-legacy', settings: { header: 'dns', value: 'example.com' } });
        expect(toMkcpLegacy('header-dns', undefined)).toEqual({ type: 'mkcp-legacy', settings: { header: 'dns' } });
        expect(toMkcpLegacy('header-wireguard', {})).toEqual({ type: 'mkcp-legacy', settings: { header: 'wireguard' } });
    });

    it('declines a type it does not replace', () => {
        expect(toMkcpLegacy('noise', {})).toBeNull();
    });
});

describe('Int32Range', () => {
    it('reads what the core reads', () => {
        expect(parseInt32Range(10)).toEqual([10, 10]);
        expect(parseInt32Range('10')).toEqual([10, 10]);
        expect(parseInt32Range('5-30')).toEqual([5, 30]);
        expect(parseInt32Range('30-5')).toEqual([5, 30]);
        expect(parseInt32Range(undefined)).toEqual([0, 0]);
        expect(parseInt32Range('')).toEqual([0, 0]);
        expect(parseInt32Range('soon')).toBeNull();
    });
});

// ── Chain rules ─────────────────────────────────────────────────────────

const udp = (...types: string[]) => ({ udp: types.map(type => ({ type, settings: {} })) });
const paths = (issues: { path: string }[]) => issues.map(issue => issue.path);

describe('where a mask may sit', () => {
    it('puts xicmp first until 26.9 and last from then on', () => {
        const first = udp('xicmp', 'noise');
        const last = udp('noise', 'xicmp');
        expect(paths(finalmaskIssues(first, '26.3', 'outbound'))).not.toContain('streamSettings.finalmask.udp[0]');
        expect(paths(finalmaskIssues(first, '26.7', 'outbound'))).not.toContain('streamSettings.finalmask.udp[0]');
        expect(paths(finalmaskIssues(first, '26.9', 'outbound'))).toContain('streamSettings.finalmask.udp[0]');
        expect(paths(finalmaskIssues(last, '26.7', 'outbound'))).toContain('streamSettings.finalmask.udp[1]');
        expect(paths(finalmaskIssues(last, '26.9', 'outbound'))).not.toContain('streamSettings.finalmask.udp[1]');
    });

    it('does the same for realm and udphop, on the lines that have them', () => {
        expect(paths(finalmaskIssues(udp('noise', 'realm'), '26.7', 'outbound'))).toContain('streamSettings.finalmask.udp[1]');
        expect(paths(finalmaskIssues(udp('realm', 'noise'), '26.9', 'outbound'))).toContain('streamSettings.finalmask.udp[0]');
        // realm does not exist on 26.3: the type check reports it, not this.
        expect(paths(finalmaskIssues(udp('noise', 'realm'), '26.3', 'outbound'))).not.toContain('streamSettings.finalmask.udp[1]');
        const hop = { udp: [{ type: 'udphop', settings: { mode: 'intervalLocal', interval: 10 } }, { type: 'noise', settings: {} }] };
        expect(paths(finalmaskIssues(hop, '26.9', 'outbound'))).toContain('streamSettings.finalmask.udp[0]');
    });

    it('puts a UDP sudoku last until 26.9 and first from then on', () => {
        expect(paths(finalmaskIssues(udp('sudoku', 'noise'), '26.7', 'outbound'))).toContain('streamSettings.finalmask.udp[0]');
        expect(paths(finalmaskIssues(udp('sudoku', 'noise'), '26.9', 'outbound'))).not.toContain('streamSettings.finalmask.udp[0]');
        expect(paths(finalmaskIssues(udp('noise', 'sudoku'), '26.9', 'outbound'))).toContain('streamSettings.finalmask.udp[1]');
    });

    it('lets a lone mask sit anywhere', () => {
        for (const version of LINES) {
            expect(finalmaskIssues(udp('xicmp'), version, 'inbound')).toEqual([]);
        }
    });

    it('stops an inbound, but only fails an outbound\'s own dials', () => {
        const wrong = udp('noise', 'xicmp');
        const at = (direction: 'inbound' | 'outbound') =>
            finalmaskIssues(wrong, '26.7', direction).find(issue => issue.path.endsWith('udp[1]'))!.severity;
        expect(at('inbound')).toBe('critical');
        expect(at('outbound')).toBe('warning');
    });

    it('refuses xicmp over quicParams.udpHop on a client before 26.9', () => {
        const config = { udp: [{ type: 'xicmp', settings: {} }], quicParams: { udpHop: { ports: '20000-30000' } } };
        expect(finalmaskIssues(config, '26.7', 'outbound')).toHaveLength(1);
        expect(finalmaskIssues(config, '26.7', 'inbound')).toEqual([]);
        expect(finalmaskIssues({ ...config, quicParams: { udpHop: {} } }, '26.7', 'outbound')).toEqual([]);
    });

    it('notes that a chain of two reads the other way round across 26.3 → 26.7', () => {
        for (const version of LINES) {
            const issues = finalmaskIssues({ tcp: [{ type: 'fragment' }, { type: 'sudoku' }] }, version, 'outbound');
            expect(issues).toHaveLength(1);
            expect(issues[0]!.severity).toBe('info');
            expect(issues[0]!.path).toBe('streamSettings.finalmask.tcp');
        }
        expect(finalmaskIssues({ tcp: [{ type: 'fragment' }] }, '26.9', 'outbound')).toEqual([]);
    });

    it('reads a type the way the loader does, lower-cased', () => {
        expect(paths(finalmaskIssues(udp('Noise', 'XICMP'), '26.7', 'outbound'))).toContain('streamSettings.finalmask.udp[1]');
    });

    it('ignores what is not a finalmask', () => {
        expect(finalmaskIssues(null, '26.9', 'outbound')).toEqual([]);
        expect(finalmaskIssues({ udp: 'noise' }, '26.9', 'outbound')).toEqual([]);
    });
});

describe('what xdns needs', () => {
    const xdns = (settings: unknown) => ({ udp: [{ type: 'xdns', settings }] });

    it('needs a domain on 26.3', () => {
        expect(finalmaskIssues(xdns({}), '26.3', 'outbound')[0]).toMatchObject({ severity: 'critical', path: 'streamSettings.finalmask.udp[0].settings.domain' });
        expect(finalmaskIssues(xdns({ domain: 't.example.com' }), '26.3', 'outbound')).toEqual([]);
    });

    it('needs domains or resolvers from 26.7 on', () => {
        expect(finalmaskIssues(xdns({}), '26.7', 'outbound')[0]!.severity).toBe('critical');
        expect(finalmaskIssues(xdns({ domains: [], resolvers: [] }), '26.9', 'inbound')).toHaveLength(1);
    });

    it('refuses a resolver without +udp://', () => {
        const issues = finalmaskIssues(xdns({ resolvers: ['t.example.com'] }), '26.7', 'outbound');
        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatchObject({ severity: 'critical', path: 'streamSettings.finalmask.udp[0].settings.resolvers' });
        expect(finalmaskIssues(xdns({ resolvers: ['t.example.com+udp://1.1.1.1:53'] }), '26.7', 'outbound')).toEqual([]);
    });

    it('asks each side for its own list', () => {
        const serverOnly = xdns({ domains: ['t.example.com'] });
        const clientOnly = xdns({ resolvers: ['t.example.com+udp://1.1.1.1:53'] });
        expect(finalmaskIssues(serverOnly, '26.7', 'inbound')).toEqual([]);
        expect(finalmaskIssues(serverOnly, '26.7', 'outbound')[0]).toMatchObject({ severity: 'warning', path: 'streamSettings.finalmask.udp[0].settings.resolvers' });
        expect(finalmaskIssues(clientOnly, '26.7', 'outbound')).toEqual([]);
        expect(finalmaskIssues(clientOnly, '26.7', 'inbound')[0]).toMatchObject({ severity: 'critical', path: 'streamSettings.finalmask.udp[0].settings.domains' });
    });
});

describe('what udphop needs', () => {
    const hop = (settings: unknown) => ({ udp: [{ type: 'udphop', settings }] });

    it('is happy with a mode and an interval of at least 5', () => {
        expect(finalmaskIssues(hop({ mode: 'intervalLocal,perConnRemote', interval: '5-30' }), '26.9', 'outbound')).toEqual([]);
        expect(finalmaskIssues(hop({ mode: 'INTERVALREMOTE', interval: 10 }), '26.9', 'outbound')).toEqual([]);
    });

    it('refuses a missing or unknown mode at load', () => {
        const missing = finalmaskIssues(hop({ interval: 10 }), '26.9', 'outbound');
        expect(missing).toHaveLength(1);
        expect(missing[0]).toMatchObject({ severity: 'critical', path: 'streamSettings.finalmask.udp[0].settings.mode' });
        // Spaces are not trimmed: " intervalRemote" is not a mode.
        expect(finalmaskIssues(hop({ mode: 'intervalLocal, intervalRemote', interval: 10 }), '26.9', 'outbound')).toHaveLength(1);
    });

    it('warns a client about an interval under 5, including none at all', () => {
        expect(finalmaskIssues(hop({ mode: 'intervalLocal' }), '26.9', 'outbound')[0]).toMatchObject({ severity: 'warning', path: 'streamSettings.finalmask.udp[0].settings.interval' });
        expect(finalmaskIssues(hop({ mode: 'intervalLocal', interval: '3-30' }), '26.9', 'outbound')).toHaveLength(1);
    });

    it('refuses to run on an inbound', () => {
        const issues = finalmaskIssues(hop({ mode: 'intervalLocal', interval: 10 }), '26.9', 'inbound');
        expect(issues).toEqual([expect.objectContaining({ severity: 'critical', path: 'streamSettings.finalmask.udp[0]' })]);
    });

    it('says nothing before 26.9, where the type itself is the problem', () => {
        expect(finalmaskIssues(hop({}), '26.7', 'outbound')).toEqual([]);
    });
});

describe('the version check on finalmask', () => {
    it('reports a bbrProfile the core refuses, and none on 26.3 where the key does not exist', () => {
        const config = { outbounds: [{ tag: 'h', protocol: 'hysteria', streamSettings: { finalmask: { quicParams: { bbrProfile: 'turbo' } } } }] };
        // Only what this area says: other rows have views on a bare hysteria outbound.
        const at = (version: CoreVersionId) => versionDiagnostics(config, version)
            .filter(d => d.field?.startsWith('streamSettings.finalmask'))
            .map(d => [d.field, d.severity]);
        expect(at('26.7')).toContainEqual(['streamSettings.finalmask.quicParams.bbrProfile', 'critical']);
        expect(at('26.3')).toEqual([['streamSettings.finalmask.quicParams.bbrProfile', 'warning']]);
        const standard = { outbounds: [{ tag: 'h', protocol: 'hysteria', streamSettings: { finalmask: { quicParams: { bbrProfile: '' } } } }] };
        expect(versionDiagnostics(standard, '26.9').filter(d => d.field?.startsWith('streamSettings.finalmask'))).toEqual([]);
    });

    it('flags the keys the old editor wrote into quicParams', () => {
        const config = { inbounds: [{ tag: 'in', protocol: 'hysteria', streamSettings: { finalmask: { quicParams: { max_idle_timeout: 30, handshake_timeout: 20 } } } }] };
        const fields = versionDiagnostics(config, '26.7').map(d => d.field);
        expect(fields).toContain('streamSettings.finalmask.quicParams.max_idle_timeout');
        expect(fields).toContain('streamSettings.finalmask.quicParams.handshake_timeout');
    });
});
