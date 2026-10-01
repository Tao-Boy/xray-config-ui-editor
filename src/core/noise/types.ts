/**
 * Shared shapes for the noise module: what a finalmask `noise` layer holds,
 * where randomness comes from, and how a builder reports what it could not do.
 *
 * Xray's noise layer (infra/conf NoiseMask, v26.3.27:transport_internet.go:1427,
 * v26.9.9:transport_finalmask.go:298 — the same struct on every line) is a
 * list of items, each sent as its own UDP datagram before the first real
 * packet to a destination:
 *
 *   packet + type   fixed bytes; type is hex | str | base64 | array ("" = array)
 *   rand            a random datagram whose length is drawn from [from, to)
 *                   (common/crypto RandBetween: the upper bound is exclusive)
 *   randRange       the byte values `rand` draws from, [from, to] inclusive
 *                   (RandBytesBetween), 0-255 when unset
 *   delay           milliseconds to wait after the item, [from, to)
 *
 * The layer's `reset` (seconds) re-arms it after that much silence to the
 * destination; with no reset it is sent once (finalmask/noise/conn.go:30).
 */

export interface NoiseItem {
    type?: string;
    packet?: unknown;
    rand?: string | number;
    randRange?: string | number;
    delay?: string | number;
}

/**
 * A source of random bytes. Builders take one instead of calling the
 * platform, so a seed reproduces a packet exactly — in tests, and when a
 * parameter changes and everything else should stay put.
 */
export type Rng = (length: number) => Uint8Array;

export type NoteSeverity = 'info' | 'warning' | 'critical';

/** Something a conversion could not carry over, or a caveat about what it made. */
export interface Note {
    severity: NoteSeverity;
    message: string;
}
