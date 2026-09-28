import { useState } from 'react';
import { useXrayEditor } from './useXrayEditor';
import { validateInbound } from '../core/validators';
import { createDefaultInbound, normalizeInbound } from '../core/generators/endpoint-factory';
import type { Inbound } from '../store/configStore';

/**
 * The inbound editor's state.
 *
 * What it opens is first brought onto the spellings every supported core
 * reads (normalizeInbound): a lone 26.7 `users` list becomes `clients`, a
 * hysteria user's `password` becomes the `auth` the core reads, and so on —
 * rewrites that keep the meaning where the config already loads and make it
 * load everywhere else. Nothing is written until the user saves; anything
 * that would need a judgement call is left alone and shown by InboundCoreNotes.
 *
 * The factory needs no core version: every default it writes means the same
 * thing on all supported lines (endpoint-factory.test.ts holds it to that).
 */
export const useInboundEditor = (data: Inbound, onSave: (data: Inbound, rawText?: string | null) => void) => {
    const [initial] = useState<Inbound>(() => (data ? normalizeInbound(data) : createDefaultInbound()));
    return useXrayEditor<Inbound>({
        data: initial,
        onSave,
        validate: validateInbound,
        onProtocolChange: (proto) => createDefaultInbound(proto)
    });
};
