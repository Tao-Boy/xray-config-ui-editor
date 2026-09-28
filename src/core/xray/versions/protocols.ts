/**
 * Which protocols a core line registers, for the protocol choosers.
 *
 * A protocol the loader does not know is not ignored the way an unknown key
 * is: `LoadWithID` fails on it and the config does not load. So a protocol
 * whose `<direction>.protocol.<name>` entry says `rejected` for the chosen
 * line is left out of the list — unless the config already uses it, in which
 * case it stays, so the chooser shows what the config holds rather than going
 * blank. Diagnostics say the rest.
 */
import type { CoreVersionId } from './index';
import { featureStatus } from './features';

export const protocolsFor = (
    version: CoreVersionId,
    direction: 'inbound' | 'outbound',
    candidates: readonly string[],
    current?: string,
): string[] =>
    candidates.filter(name =>
        name === current || featureStatus(version, `${direction}.protocol.${name}`) !== 'rejected',
    );
