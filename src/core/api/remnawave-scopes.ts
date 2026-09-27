/**
 * The Remnawave API-token scopes this editor needs — and nothing else.
 *
 * A panel grants a token scopes shaped `resource:action`: `hosts:*` for a whole
 * resource, `hosts:read` / `hosts:write` for one half of it, or `hosts:list`
 * for a single endpoint. A token created with no scopes — or by a panel older
 * than the feature — can call *everything*, which is the reason this list
 * exists: a token built from it cannot read a subscriber, restart a node or
 * touch billing even if the token itself leaks out of this browser.
 *
 * Every entry is an endpoint `remnawave-client.ts` actually calls. A new call
 * there means a new line here, and `remnawave-scopes.test.ts` fails until it
 * is added — the list is checked against the client, not maintained by hope.
 *
 * Scope names come from Remnawave's own contract (`libs/contract/commands/**`,
 * `{ scope, kind }` on each command's `endpointDetails`), so they are what the
 * panel's token form accepts verbatim.
 */

export type RemnawaveScopeKind = 'read' | 'write';

export interface RemnawaveScope {
    /** What goes into the panel's token form, verbatim. */
    scope: string;
    /** The panel resource it belongs to — the part before the colon. */
    resource: string;
    kind: RemnawaveScopeKind;
    /** The request it unlocks, `METHOD /path` with `{uuid}` for a path param. */
    endpoint: string;
}

/**
 * Written as whole `resource:action` strings rather than assembled from parts:
 * this is the text someone copies into the panel, and it should be greppable
 * here exactly as it appears there.
 */
const scope = (scope: string, kind: RemnawaveScopeKind, endpoint: string): RemnawaveScope => ({
    scope,
    resource: scope.split(':')[0]!,
    kind,
    endpoint,
});

/** Reading a config profile and writing one back — the app's whole point. */
export const CONFIG_PROFILE_SCOPES: RemnawaveScope[] = [
    scope('config-profiles:list', 'read', 'GET /api/config-profiles'),
    scope('config-profiles:get', 'read', 'GET /api/config-profiles/{uuid}'),
    scope('config-profiles:update', 'write', 'PATCH /api/config-profiles'),
];

/** Hosts: read to mirror one into a client outbound, write for the builder. */
export const HOST_SCOPES: RemnawaveScope[] = [
    scope('hosts:list', 'read', 'GET /api/hosts'),
    scope('hosts:create', 'write', 'POST /api/hosts'),
    scope('hosts:update', 'write', 'PATCH /api/hosts'),
    scope('hosts:delete', 'write', 'DELETE /api/hosts/{uuid}'),
];

/** Subscription templates: the XRAY_JSON config a subscriber is handed. */
export const SUBSCRIPTION_TEMPLATE_SCOPES: RemnawaveScope[] = [
    scope('subscription-template:list', 'read', 'GET /api/subscription-templates'),
    scope('subscription-template:get', 'read', 'GET /api/subscription-templates/{uuid}'),
    scope('subscription-template:create', 'write', 'POST /api/subscription-templates'),
    scope('subscription-template:update', 'write', 'PATCH /api/subscription-templates'),
    scope('subscription-template:delete', 'write', 'DELETE /api/subscription-templates/{uuid}'),
];

/** Snippets: the `{ "snippet": "NAME" }` bodies a profile references. */
export const SNIPPET_SCOPES: RemnawaveScope[] = [
    scope('snippets:list', 'read', 'GET /api/snippets'),
    scope('snippets:create', 'write', 'POST /api/snippets'),
    scope('snippets:update', 'write', 'PATCH /api/snippets'),
    scope('snippets:delete', 'write', 'DELETE /api/snippets'),
    // Restarts every node using a profile that references the snippet, so the
    // app only ever sends it from an explicit user action.
    scope('snippets:sync', 'write', 'POST /api/snippets/actions/sync'),
];

export const REMNAWAVE_SCOPES: RemnawaveScope[] = [
    ...CONFIG_PROFILE_SCOPES,
    ...HOST_SCOPES,
    ...SUBSCRIPTION_TEMPLATE_SCOPES,
    ...SNIPPET_SCOPES,
];

/**
 * The read half.
 *
 * A token with only these can browse and import, and cannot change anything on
 * the panel — the setting to hand someone who is here to look at a config.
 */
export const readScopes = (scopes: RemnawaveScope[] = REMNAWAVE_SCOPES): RemnawaveScope[] =>
    scopes.filter(entry => entry.kind === 'read');

/** Grouped the way the panel's own token form groups them: by resource. */
export const scopesByResource = (
    scopes: RemnawaveScope[] = REMNAWAVE_SCOPES,
): { resource: string; scopes: RemnawaveScope[] }[] => {
    const groups: { resource: string; scopes: RemnawaveScope[] }[] = [];
    for (const entry of scopes) {
        const group = groups.find(candidate => candidate.resource === entry.resource);
        if (group) group.scopes.push(entry);
        else groups.push({ resource: entry.resource, scopes: [entry] });
    }
    return groups;
};

/**
 * The scopes in the shape the panel's token form takes them: a JSON array of
 * strings. A list separated by newlines looks the same to a reader and is
 * rejected by the field, which is the only opinion that counts here.
 */
export const formatScopesForPanel = (scopes: RemnawaveScope[]): string =>
    JSON.stringify(scopes.map(entry => entry.scope), null, 2);

/**
 * Scopes that must never be on a token pasted in here.
 *
 * Not a security boundary — nothing stops someone pasting an unrestricted
 * token — but the list names what is actually at stake, which is the part a
 * warning usually leaves out: subscriber data, node shells, and the ability to
 * mint further tokens.
 */
export const OVERREACHING_SCOPES: string[] = [
    '*',
    'api-tokens:*',
    'users:*',
    'nodes:*',
    'node-ssh:*',
    'system:*',
    'infra-billing:*',
    'remnawave-settings:*',
];
