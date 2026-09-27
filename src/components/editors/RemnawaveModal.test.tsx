import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { RemnawaveModal } from './RemnawaveModal';
import { useConfigStore } from '../../store/configStore';
import { __resetBackLayers } from '../../hooks/useBackToClose';

/**
 * Two panels, and getting from one to the other without pasting a token.
 */

const seed = (
    accounts: { id: string; label: string; url: string; token: string; remember: boolean }[],
    activeId: string | null,
) =>
    useConfigStore.setState({
        remnawave: {
            url: accounts.find(a => a.id === activeId)?.url ?? '',
            token: accounts.find(a => a.id === activeId)?.token ?? null,
            connected: activeId !== null,
            activeProfileUuid: null,
            profiles: [],
            accounts,
            activeAccountId: activeId,
        },
    } as any);

const PANELS = [
    { id: 'a', label: 'bropines.remna.ru', url: 'https://bropines.remna.ru', token: 'token-a', remember: true },
    { id: 'b', label: 'olsg.vpn.ru', url: 'https://olsg.vpn.ru', token: 'token-b', remember: true },
];

// Switching asks the panel for its profiles. No test should reach for a
// network, and these panels do not exist.
const realFetch = globalThis.fetch;

beforeEach(() => {
    globalThis.fetch = (async () => {
        throw new Error('no network in tests');
    }) as unknown as typeof fetch;
    seed(PANELS, null);
});

afterEach(() => {
    globalThis.fetch = realFetch;
    cleanup();
    __resetBackLayers();
});

describe('the panel picker', () => {
    it('lists every panel this browser has seen', () => {
        render(<RemnawaveModal onClose={() => {}} />);
        expect(screen.getByText('bropines.remna.ru')).toBeDefined();
        expect(screen.getByText('olsg.vpn.ru')).toBeDefined();
    });

    it('is not shown at all before there is one', () => {
        seed([], null);
        render(<RemnawaveModal onClose={() => {}} />);
        expect(document.body.textContent).not.toContain('bropines.remna.ru');
    });

    it('switches the connection to the panel that was clicked', () => {
        render(<RemnawaveModal onClose={() => {}} />);
        fireEvent.click(screen.getByText('olsg.vpn.ru'));

        const { url, token, activeAccountId, connected } = useConfigStore.getState().remnawave;
        expect(url).toBe('https://olsg.vpn.ru');
        expect(token).toBe('token-b');
        expect(activeAccountId).toBe('b');
        expect(connected).toBe(true);
    });

    it('forgets one without touching the other', () => {
        render(<RemnawaveModal onClose={() => {}} />);
        const rows = screen.getAllByTitle(/Forget this panel|Забыть эту панель/);
        fireEvent.click(rows[0]!);

        const { accounts } = useConfigStore.getState().remnawave;
        expect(accounts.map(a => a.label)).toEqual(['olsg.vpn.ru']);
    });

    it('renames one, so two panels on similar hosts can be told apart', () => {
        render(<RemnawaveModal onClose={() => {}} />);
        fireEvent.click(screen.getAllByTitle(/Rename|Переимен/)[0]!);

        const input = screen.getByDisplayValue('bropines.remna.ru') as HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(input, 'Прод');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(useConfigStore.getState().remnawave.accounts[0]!.label).toBe('Прод');
    });
});

describe('what happens to the token', () => {
    it('comes up ready to remember it, since that is what the list is for', () => {
        seed([], null);
        render(<RemnawaveModal onClose={() => {}} />);
        const checkbox = screen.getAllByRole('checkbox')[0] as HTMLInputElement;
        expect(checkbox.checked).toBe(true);
    });

    it('stays off for a panel that was set not to be remembered', () => {
        seed([{ ...PANELS[0]!, remember: false }], 'a');
        render(<RemnawaveModal onClose={() => {}} />);
        fireEvent.click(screen.getByText(/^(Change URL|Сменить URL)$/));
        const checkbox = screen.getAllByRole('checkbox')[0] as HTMLInputElement;
        expect(checkbox.checked).toBe(false);
    });

    it('follows the panel already selected rather than resetting it', () => {
        seed(PANELS, 'a');
        render(<RemnawaveModal onClose={() => {}} />);
        // Panel 'a' is remembered, so the switch comes up on.
        fireEvent.click(screen.getByText(/^(Change URL|Сменить URL)$/));
        const checkbox = screen.getAllByRole('checkbox')[0] as HTMLInputElement;
        expect(checkbox.checked).toBe(true);
    });

    it('says which saved panels will need one pasted again', () => {
        seed([
            { ...PANELS[0]!, token: '', remember: false },
            PANELS[1]!,
        ], null);
        render(<RemnawaveModal onClose={() => {}} />);
        expect(document.body.textContent).toMatch(/not stored|не сохранён/);
    });

    it('asks for the token instead of pretending to connect', () => {
        seed([{ ...PANELS[0]!, token: '', remember: false }], null);
        render(<RemnawaveModal onClose={() => {}} />);
        fireEvent.click(screen.getByText('bropines.remna.ru'));

        const { connected, url } = useConfigStore.getState().remnawave;
        expect(connected).toBe(false);
        expect(url).toBe('https://bropines.remna.ru');
        // Still on the login step: the URL box is filled in, waiting for a token.
        expect(screen.getByDisplayValue('https://bropines.remna.ru')).toBeDefined();
    });
});

describe('the advice about token rights', () => {
    it('names the scopes to grant, not just "be careful"', () => {
        seed([], null);
        render(<RemnawaveModal onClose={() => {}} />);
        expect(document.body.textContent).toContain('config-profiles:update');
        expect(document.body.textContent).toContain('hosts:list');
    });

    it('spells out what must never be on the token', () => {
        seed([], null);
        render(<RemnawaveModal onClose={() => {}} />);
        expect(document.body.textContent).toContain('users:*');
        expect(document.body.textContent).toContain('api-tokens:*');
    });
});
