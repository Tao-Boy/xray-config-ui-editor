import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { useConfigStore } from '../../store/configStore';
import { __resetBackLayers } from '../../hooks/useBackToClose';
import { t } from '../../i18n';
import { ReverseModal } from './ReverseModal';

const load = (config: any, coreVersion: '26.3' | '26.7' | '26.9') =>
    useConfigStore.setState({ config, rawConfigText: JSON.stringify(config, null, 2), coreVersion } as any);

afterEach(() => {
    cleanup();
    __resetBackLayers();
    useConfigStore.setState({ coreVersion: '26.7' } as any);
});

const WITH_REVERSE = {
    inbounds: [],
    outbounds: [{ tag: 'direct', protocol: 'freedom' }],
    reverse: { bridges: [{ tag: 'bridge', domain: 'reverse.example' }], portals: [] },
};

describe('ReverseModal', () => {
    it('edits bridges and portals on 26.3, and says it stops there', () => {
        load(WITH_REVERSE, '26.3');
        render(<ReverseModal onClose={() => {}} />);
        expect(screen.getByDisplayValue('bridge')).toBeTruthy();
        expect(screen.getByText(t("Works on 26.3 only. From 26.7 any reverse section stops the config from loading — VLESS reverse proxy replaces it."))).toBeTruthy();
    });

    it('on 26.7 shows the section as refused and removes it only when asked', () => {
        load(WITH_REVERSE, '26.7');
        render(<ReverseModal onClose={() => {}} />);
        expect(screen.getByText(t("Legacy reverse is refused by Xray {tag}", { tag: 'v26.7.28' }))).toBeTruthy();
        expect(screen.queryByDisplayValue('bridge')).toBeNull();
        expect(useConfigStore.getState().config?.reverse).toBeDefined();

        fireEvent.click(screen.getAllByText(t("Remove the reverse section"))[0]!);
        expect(useConfigStore.getState().config?.reverse).toBeUndefined();
    });

    it('offers nothing to build on 26.9 when there is no section', () => {
        load({ inbounds: [], outbounds: [] }, '26.9');
        render(<ReverseModal onClose={() => {}} />);
        expect(screen.getByText(t("This config has no reverse section, and nothing here will add one."))).toBeTruthy();
        expect(screen.queryByText(t("Remove the reverse section"))).toBeNull();
        expect(useConfigStore.getState().config?.reverse).toBeUndefined();
    });
});
