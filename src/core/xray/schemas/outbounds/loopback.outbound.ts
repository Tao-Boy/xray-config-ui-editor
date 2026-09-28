// ============================================================
// Loopback Outbound — Source: infra/conf/loopback.go (LoopbackConfig)
// ============================================================
import { z } from 'zod';
import { SniffingSchema } from '../inbound.schema';

/**
 * Two fields, and that is the whole protocol.
 *
 * `LoopbackConfig` is `{ InboundTag, Sniffing }` and `Process()` takes its
 * dialer as `_` — nothing is dialled, so there is no server, no transport and
 * nothing to multiplex. See `core/xray/outbound-shape.ts`.
 */
export const LoopbackOutboundSettingsSchema = z.object({
  /** Inbound tag the traffic re-enters routing as. */
  inboundTag: z.string().optional(),
  /** Sniffing applied on the way back in — same object as an inbound's. */
  sniffing: SniffingSchema.optional(),
}).passthrough();
