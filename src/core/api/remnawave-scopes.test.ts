import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    formatScopeList,
    OVERREACHING_SCOPES,
    readScopes,
    REMNAWAVE_SCOPES,
    scopesByResource,
} from './remnawave-scopes';

/**
 * The scope list is advice we give someone about to lock a token down, so it
 * is only worth anything while it matches what the client actually calls. Too
 * few scopes and the app breaks on a token built from the hint; too many and
 * we are telling people to grant rights this app never uses.
 *
 * Both failures are caught by reading the client's own source.
 */

/** `METHOD /path` for every request `remnawave-client.ts` makes. */
const clientEndpoints = (): string[] => {
    const source = readFileSync(join('src', 'core', 'api', 'remnawave-client.ts'), 'utf8');
    const calls = source.split('this.request(').slice(1);

    return calls.map(chunk => {
        const path = /^['"`]([^'"`]+)['"`]/.exec(chunk.trim());
        if (!path) throw new Error(`Could not read the path out of: ${chunk.slice(0, 60)}`);
        const method = /method:\s*'([A-Z]+)'/.exec(chunk);
        // A template literal's `${uuid}` is the same endpoint as `{uuid}`.
        const normalised = path[1]!.replace(/\$\{(\w+)\}/g, '{$1}');
        return `${method ? method[1] : 'GET'} ${normalised}`;
    });
};

// Password login is disabled in the UI; the method is kept only so a panel
// that still wants it is not a code change. No token scope covers it.
const NOT_TOKEN_CALLABLE = ['POST /api/auth/login'];

describe('the scope list against the client', () => {
    it('covers every request the client can make', () => {
        const covered = new Set(REMNAWAVE_SCOPES.map(entry => entry.endpoint));
        const missing = clientEndpoints()
            .filter(endpoint => !NOT_TOKEN_CALLABLE.includes(endpoint))
            .filter(endpoint => !covered.has(endpoint));
        expect(missing).toEqual([]);
    });

    it('claims no scope for a request the client never makes', () => {
        const called = new Set(clientEndpoints());
        const unused = REMNAWAVE_SCOPES.filter(entry => !called.has(entry.endpoint));
        expect(unused.map(entry => entry.scope)).toEqual([]);
    });

    it('names no resource outside the four the app talks to', () => {
        const resources = [...new Set(REMNAWAVE_SCOPES.map(entry => entry.resource))].sort();
        expect(resources).toEqual([
            'config-profiles',
            'hosts',
            'snippets',
            'subscription-template',
        ]);
    });
});

describe('the shape of a scope', () => {
    it('spells each one the way the panel form takes it', () => {
        for (const entry of REMNAWAVE_SCOPES) {
            expect(entry.resource).toBe(entry.scope.split(':')[0]!);
            expect(entry.scope).toMatch(/^[a-z-]+:[a-z-]+$/);
        }
    });

    it('marks every GET as read and everything else as write', () => {
        for (const entry of REMNAWAVE_SCOPES) {
            const expected = entry.endpoint.startsWith('GET ') ? 'read' : 'write';
            expect(entry.kind).toBe(expected);
        }
    });

    it('never suggests a wildcard', () => {
        expect(REMNAWAVE_SCOPES.some(entry => entry.scope.includes('*'))).toBe(false);
    });
});

describe('the read-only set', () => {
    it('is enough to list profiles and open one, which is what importing needs', () => {
        const scopes = readScopes().map(entry => entry.scope);
        expect(scopes).toContain('config-profiles:list');
        expect(scopes).toContain('config-profiles:get');
    });

    it('cannot write the config back', () => {
        expect(readScopes().map(entry => entry.scope)).not.toContain('config-profiles:update');
    });
});

describe('the list as the hint shows it', () => {
    it('groups by resource in the order the resources first appear', () => {
        expect(scopesByResource().map(group => group.resource)).toEqual([
            'config-profiles',
            'hosts',
            'subscription-template',
            'snippets',
        ]);
    });

    it('formats one scope per line, ready to paste', () => {
        const lines = formatScopeList(REMNAWAVE_SCOPES).split('\n');
        expect(lines).toHaveLength(REMNAWAVE_SCOPES.length);
        expect(lines[0]).toBe('config-profiles:list');
    });

    it('warns about scopes that reach past this app, and about none it needs', () => {
        const needed = new Set(REMNAWAVE_SCOPES.map(entry => entry.scope));
        for (const dangerous of OVERREACHING_SCOPES) {
            expect(needed.has(dangerous)).toBe(false);
        }
        expect(OVERREACHING_SCOPES).toContain('*');
    });
});
