import { useCallback } from 'react';
import { useConfigStore } from '../store/configStore';
import { coreVersion } from '../core/xray/versions';
import {
    allowedValues,
    featureStatus,
    featureStatusAt,
    offersFeature,
    type FeatureScope,
    type FeatureStatus,
} from '../core/xray/versions/features';

/**
 * The core version configs are being written for, and questions about it.
 *
 * Editors ask `offers(id)` before suggesting something new and `status(id)`
 * to decide how to present something a config already has. Components under
 * `src/components/ui` cannot import the store, so they take the answer as a
 * prop from the editor that asked.
 */
export const useCoreVersion = () => {
    const version = useConfigStore(state => state.coreVersion);
    const offers = useCallback((id: string) => offersFeature(version, id), [version]);
    const status = useCallback((id: string): FeatureStatus => featureStatus(version, id), [version]);
    /** Status by the path an editor writes; see featureStatusAt. */
    const statusAt = useCallback(
        (scope: FeatureScope, path: string, protocol?: string, value?: string): FeatureStatus =>
            featureStatusAt(version, { scope, path, protocol, value }),
        [version],
    );
    /** Offer only what this line accepts — a deprecated field is shown, never suggested. */
    const offersAt = useCallback(
        (scope: FeatureScope, path: string, protocol?: string, value?: string): boolean =>
            featureStatusAt(version, { scope, path, protocol, value }) === 'accepted',
        [version],
    );
    /** The values a chooser should list for a value set, on this line. */
    const values = useCallback((id: string): string[] => allowedValues(version, id), [version]);
    return { version, tag: coreVersion(version).tag, offers, status, statusAt, offersAt, values };
};
