import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { DnsModal } from './DnsModal';
import { indexAfterMove, indexAfterRemove } from '../../hooks/useDnsEditor';
import { useConfigStore } from '../../store/configStore';
import { __resetBackLayers } from '../../hooks/useBackToClose';

/**
 * The servers tab is a list with one server open beside it. The pane used to
 * copy its server once, on opening, and keep showing that copy whichever row
 * was picked next — so it looked as if picking did nothing — and whatever was
 * typed into it waited for a "Save & Close" that neither the next pick nor
 * the modal's own Save ever pressed.
 */

const SERVERS = [
    { address: '77.88.8.8', tag: 'dns-yandex', domains: [] },
    { address: 'https://8.8.8.8/dns-query', tag: 'dns-doh2', domains: [] },
    '1.1.1.1',
];

const withServers = (servers: any[]) => {
    const config = { dns: { servers }, outbounds: [] };
    act(() => {
        useConfigStore.setState({ config, rawConfigText: JSON.stringify(config, null, 2) });
    });
};

const servers = () => useConfigStore.getState().config?.dns?.servers as any[];

/** The address field of whichever server the pane has open. */
const openAddress = () => screen.getByPlaceholderText('8.8.8.8') as HTMLInputElement;

const pick = (address: string) => fireEvent.click(screen.getAllByText(address)[0]!);

beforeEach(() => withServers(SERVERS));
afterEach(() => {
    cleanup();
    __resetBackLayers();
});

describe('DNS servers pane', () => {
    it('shows the server that was picked, every time', () => {
        render(<DnsModal onClose={() => {}} />);
        pick('77.88.8.8');
        expect(openAddress().value).toBe('77.88.8.8');
        pick('https://8.8.8.8/dns-query');
        expect(openAddress().value).toBe('https://8.8.8.8/dns-query');
        pick('77.88.8.8');
        expect(openAddress().value).toBe('77.88.8.8');
    });

    it('writes an edit into the config as it is typed, not on a later save', () => {
        render(<DnsModal onClose={() => {}} />);
        pick('77.88.8.8');
        fireEvent.change(openAddress(), { target: { value: '77.88.8.1' } });
        expect(servers()[0].address).toBe('77.88.8.1');
        // Moving on keeps it: there is no draft to lose.
        pick('https://8.8.8.8/dns-query');
        expect(servers()[0].address).toBe('77.88.8.1');
        expect(servers()[0].tag).toBe('dns-yandex');
    });

    it('marks the open server in the list', () => {
        render(<DnsModal onClose={() => {}} />);
        pick('https://8.8.8.8/dns-query');
        const row = screen.getAllByText('https://8.8.8.8/dns-query')[0]!.closest('[role="button"]')!;
        expect(row.className).toContain('border-indigo-500');
        const other = screen.getByText('77.88.8.8').closest('[role="button"]')!;
        expect(other.className).not.toContain('border-indigo-500');
    });

    it('stays on its server when a row above it is deleted', () => {
        render(<DnsModal onClose={() => {}} />);
        pick('https://8.8.8.8/dns-query');
        const firstRow = screen.getByText('77.88.8.8').closest('[role="button"]')!;
        fireEvent.click(firstRow.querySelector('button')!);
        expect(servers()).toHaveLength(2);
        expect(openAddress().value).toBe('https://8.8.8.8/dns-query');
    });
});

describe('the open index across list changes', () => {
    it('follows the moved entry and shifts the ones it passed', () => {
        // [a, b, c, d]: b (1) moves to 3 → [a, c, d, b]
        expect(indexAfterMove(1, 1, 3)).toBe(3);
        expect(indexAfterMove(2, 1, 3)).toBe(1);
        expect(indexAfterMove(3, 1, 3)).toBe(2);
        expect(indexAfterMove(0, 1, 3)).toBe(0);
        // d (3) moves to 0 → [d, a, b, c]
        expect(indexAfterMove(3, 3, 0)).toBe(0);
        expect(indexAfterMove(0, 3, 0)).toBe(1);
        expect(indexAfterMove(2, 3, 0)).toBe(3);
    });

    it('closes on the deleted entry and shifts the ones after it', () => {
        expect(indexAfterRemove(2, 2)).toBeNull();
        expect(indexAfterRemove(3, 1)).toBe(2);
        expect(indexAfterRemove(0, 1)).toBe(0);
    });
});
