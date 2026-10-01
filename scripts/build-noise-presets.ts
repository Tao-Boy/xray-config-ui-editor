/**
 * Rebuilds the fixed QUIC packets in `src/core/presets/noise.ts`.
 *
 * The two that shipped before were truncated: each declared a 1232-byte
 * payload in its header and carried only 976, so anything that actually
 * parses QUIC — rather than glancing at the first byte — saw a malformed
 * packet. These are built by the same code the generator uses, so they are
 * real QUIC v1 client Initials: correct length, correct header protection,
 * and a payload that AEAD-opens to a TLS ClientHello.
 *
 * Seeded, so re-running writes the same bytes and the diff stays empty unless
 * the builder itself changed. They are the same for every user of this editor
 * by design — a preset is a known-good starting point. Anyone who wants
 * packets nobody else sends uses the generator, which draws fresh ones.
 *
 *   bun run scripts/build-noise-presets.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import { seededRng, toHex } from '../src/core/noise/bytes';
import { buildQuic, quicProblems, type QuicParams } from '../src/core/noise/packets/quic';

const TARGET = 'src/core/presets/noise.ts';

/**
 * Two different-looking openings. The names are ordinary high-traffic hosts a
 * QUIC Initial would plausibly carry; the sizes differ so the two presets do
 * not share a length fingerprint.
 */
const PACKETS: { marker: string; seed: string; params: QuicParams }[] = [
    {
        marker: 'QUIC_INITIAL_A',
        seed: 'warp-a',
        params: { serverName: 'www.cloudflare.com', alpn: ['h3'], dcidHex: '', scidHex: '', size: 1232 },
    },
    {
        marker: 'QUIC_INITIAL_B',
        seed: 'warp-b',
        params: { serverName: 'www.google.com', alpn: ['h3'], dcidHex: '', scidHex: '', size: 1252 },
    },
];

const run = async (): Promise<void> => {
    let source = readFileSync(TARGET, 'utf8');

    for (const { marker, seed, params } of PACKETS) {
        const rng = seededRng(seed);
        // The connection ids are part of the packet's randomness, drawn from
        // the same seed so the whole thing is reproducible.
        const full: QuicParams = { ...params, dcidHex: toHex(rng(8)), scidHex: toHex(rng(8)) };

        const problems = quicProblems(full);
        if (problems.some(note => note.severity === 'critical')) {
            throw new Error(`${marker}: ${problems.map(note => note.message).join('; ')}`);
        }

        const bytes = await buildQuic(full, rng);
        if (bytes.length !== full.size) throw new Error(`${marker}: built ${bytes.length} bytes, wanted ${full.size}`);

        // Replace the hex literal that follows the marker's `const NAME =`.
        const at = source.indexOf(`const ${marker} =`);
        if (at === -1) throw new Error(`${marker}: not found in ${TARGET}`);
        const open = source.indexOf("'", at);
        const close = source.indexOf("'", open + 1);
        if (open === -1 || close === -1) throw new Error(`${marker}: no string literal after it`);
        source = source.slice(0, open + 1) + toHex(bytes) + source.slice(close);

        console.log(`${marker}: ${bytes.length} bytes, SNI ${full.serverName}`);
    }

    writeFileSync(TARGET, source);
    console.log(`wrote ${TARGET}`);
};

void run();
