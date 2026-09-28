/**
 * The Xray-core releases this editor targets.
 *
 * A config is only right or wrong relative to the core that loads it: the same
 * `proxySettings` block runs on 26.7.28 and stops 26.9.9 from starting, and the
 * shadowsocks `uot` switch that does something on 26.3.27 is silently ignored
 * from 26.7.28 on. So every "does this field exist / is this value allowed"
 * question in the app is asked of a version, and this is the list of versions.
 *
 * One entry per major.minor. A patch release is assumed to keep the config
 * surface of its line — when that stops being true, it gets its own entry.
 *
 * The oldest entry is the support floor. Older cores are not modelled: a config
 * written for them may well work, but nothing here will say so.
 */

export type CoreVersionId = '26.3' | '26.7' | '26.9';

export interface CoreVersion {
    id: CoreVersionId;
    /** The release tag the facts for this line were read from. */
    tag: string;
    /** Why this line is on the list, in a word or two. */
    role: 'minimum' | 'remnawave' | 'latest';
}

/** Oldest first — the order `compareCoreVersions` relies on. */
export const CORE_VERSIONS: CoreVersion[] = [
    { id: '26.3', tag: 'v26.3.27', role: 'minimum' },
    { id: '26.7', tag: 'v26.7.28', role: 'remnawave' },
    { id: '26.9', tag: 'v26.9.9', role: 'latest' },
];

/**
 * What a config is checked against until someone says otherwise.
 *
 * The line Remnawave nodes run: this editor exists mostly to write configs for
 * a panel, so the default answers "will my nodes start with this", not "is
 * this the newest syntax".
 */
export const DEFAULT_CORE_VERSION: CoreVersionId = '26.7';

const IDS = new Set<string>(CORE_VERSIONS.map(version => version.id));

export const isCoreVersionId = (value: unknown): value is CoreVersionId =>
    typeof value === 'string' && IDS.has(value);

/**
 * Read a stored version back.
 *
 * The setting used to hold `v1.8.10`, `v1.8.0` or `v1.5.0` — options that
 * changed nothing, because nothing read them. Those, a bare tag like
 * `v26.7.28`, and anything else unrecognised land on a supported line: the
 * matching one when the tag names it, the default otherwise.
 */
export const coreVersionId = (value: unknown): CoreVersionId => {
    if (isCoreVersionId(value)) return value;
    if (typeof value === 'string') {
        const match = /^v?(\d+)\.(\d+)/.exec(value.trim());
        if (match) {
            const candidate = `${match[1]}.${match[2]}`;
            if (isCoreVersionId(candidate)) return candidate;
        }
    }
    return DEFAULT_CORE_VERSION;
};

export const coreVersion = (id: CoreVersionId): CoreVersion =>
    CORE_VERSIONS.find(version => version.id === id)!;

/** Negative when `a` is older than `b`. */
export const compareCoreVersions = (a: CoreVersionId, b: CoreVersionId): number =>
    CORE_VERSIONS.findIndex(version => version.id === a) - CORE_VERSIONS.findIndex(version => version.id === b);

export const MINIMUM_CORE_VERSION: CoreVersionId = CORE_VERSIONS[0]!.id;
export const LATEST_CORE_VERSION: CoreVersionId = CORE_VERSIONS[CORE_VERSIONS.length - 1]!.id;
