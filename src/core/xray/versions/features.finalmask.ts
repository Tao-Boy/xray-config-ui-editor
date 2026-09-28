/**
 * Hand-written feature rows and value sets for the finalmask editors.
 *
 * Kept apart from features.ts so each editor area owns its own rows; they are
 * merged there and win over generated rows for the same place. Same rules as
 * the rest of the table: every row cites `tag:file:line`.
 *
 * These are the presence facts the finalmask form relies on that the
 * generated table does not carry. The per-mask key lists the form draws from
 * live in finalmask-rules.ts; its test holds them to these rows.
 */
import type { CoreFeature, CoreValueSet, FeatureStatus } from './features';
import type { CoreVersionId } from './index';

const s = (v263: FeatureStatus, v267: FeatureStatus, v269: FeatureStatus): Record<CoreVersionId, FeatureStatus> =>
    ({ '26.3': v263, '26.7': v267, '26.9': v269 });

/** finalmask is the same struct on either side, so every row is written for both. */
const bothSides = (row: Omit<CoreFeature, 'id' | 'scope'> & { id: string }): CoreFeature[] =>
    (['outbound', 'inbound'] as const).map(scope => ({ ...row, id: `${scope}.${row.id}`, scope }));

const FM = 'streamSettings.finalmask';

export const FINALMASK_FEATURES: CoreFeature[] = [
    ...bothSides({
        id: 'finalmask.quicParams.bbrProfile',
        path: `${FM}.quicParams.bbrProfile`,
        status: s('absent', 'accepted', 'accepted'),
        detail: 'The BBR profile arrived in 26.7; 26.3 has no such field and runs the standard profile.',
        evidence: ['v26.3.27:infra/conf/transport_internet.go:630', 'v26.7.28:infra/conf/transport_finalmask.go:933', 'v26.9.9:infra/conf/transport_finalmask.go:996'],
    }),
    // Two keys this editor used to write. QuicParamsConfig never had either:
    // the idle timeout is maxIdleTimeout, and there is no handshake timeout.
    ...bothSides({
        id: 'finalmask.quicParams.max_idle_timeout',
        path: `${FM}.quicParams.max_idle_timeout`,
        status: s('absent', 'absent', 'absent'),
        replacement: `${FM}.quicParams.maxIdleTimeout`,
        detail: 'Not a QuicParamsConfig key on any line; the idle timeout is maxIdleTimeout, in seconds.',
        evidence: ['v26.3.27:infra/conf/transport_internet.go:640', 'v26.7.28:infra/conf/transport_finalmask.go:941', 'v26.9.9:infra/conf/transport_finalmask.go:1004'],
    }),
    ...bothSides({
        id: 'finalmask.quicParams.handshake_timeout',
        path: `${FM}.quicParams.handshake_timeout`,
        status: s('absent', 'absent', 'absent'),
        detail: 'QuicParamsConfig has no handshake timeout on any line.',
        evidence: ['v26.3.27:infra/conf/transport_internet.go:630', 'v26.7.28:infra/conf/transport_finalmask.go:930', 'v26.9.9:infra/conf/transport_finalmask.go:993'],
    }),
    ...bothSides({
        id: 'finalmask.udp.xdns.resolvers',
        path: `${FM}.udp[type=xdns].settings.resolvers`,
        status: s('absent', 'accepted', 'accepted'),
        detail: 'The client-side resolver list arrived with the 26.7 xdns split; 26.3 read a single domain.',
        evidence: ['v26.3.27:infra/conf/transport_internet.go:1662', 'v26.7.28:infra/conf/transport_finalmask.go:699', 'v26.9.9:infra/conf/transport_finalmask.go:702'],
    }),
    ...bothSides({
        id: 'finalmask.udp.xicmp.ips',
        path: `${FM}.udp[type=xicmp].settings.ips`,
        status: s('absent', 'accepted', 'accepted'),
        detail: 'xicmp peer addresses arrived in 26.7; every entry must be a plain IP or the config does not load.',
        evidence: ['v26.3.27:infra/conf/transport_internet.go:1676', 'v26.7.28:infra/conf/transport_finalmask.go:800', 'v26.9.9:infra/conf/transport_finalmask.go:803'],
    }),
    ...bothSides({
        id: 'finalmask.udp.realm.ipMode',
        path: `${FM}.udp[type=realm].settings.ipMode`,
        status: s('absent', 'absent', 'accepted'),
        detail: 'The realm IP mode arrived in 26.9; 26.7 ignores it.',
        evidence: ['v26.7.28:infra/conf/transport_finalmask.go:818', 'v26.9.9:infra/conf/transport_finalmask.go:825'],
    }),
    ...bothSides({
        id: 'finalmask.udp.header-custom.mode',
        path: `${FM}.udp[type=header-custom].settings.mode`,
        status: s('absent', 'accepted', 'accepted'),
        detail: 'The UDP header-custom mode arrived in 26.7; 26.3 is always prefix-style.',
        evidence: ['v26.3.27:infra/conf/transport_internet.go:1484', 'v26.7.28:infra/conf/transport_finalmask.go:505', 'v26.9.9:infra/conf/transport_finalmask.go:508'],
    }),
];

export const FINALMASK_VALUE_SETS: CoreValueSet[] = [
    // Congestion takes "", reno, bbr, brutal and force-brutal on all three
    // lines (v26.3.27:transport_internet.go:1913, v26.9.9:transport_internet.go:245),
    // so it has no value set: nothing about it differs by line.
    {
        id: 'finalmask.quicParams.bbrProfile',
        scope: 'outbound',
        path: `${FM}.quicParams.bbrProfile`,
        // Lower-cased before the switch; "" is the standard profile.
        allowed: {
            '26.3': null,
            '26.7': ['', 'conservative', 'standard', 'aggressive'],
            '26.9': ['', 'conservative', 'standard', 'aggressive'],
        },
        outside: 'rejected',
        detail: 'Any other profile fails the config with "unknown bbr profile".',
        evidence: ['v26.7.28:infra/conf/transport_internet.go:219', 'v26.7.28:infra/conf/transport_internet.go:226', 'v26.9.9:infra/conf/transport_internet.go:219'],
    },
];
