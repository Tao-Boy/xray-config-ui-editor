// ============================================================
// MASQUE Outbound — Source: infra/conf/masque.go (MasqueClientConfig)
// ============================================================
import { z } from 'zod';

/**
 * MASQUE: CONNECT-IP over HTTP/3, so the tunnel is an ordinary QUIC web
 * request as far as anything watching is concerned.
 *
 * Three fields, all of them checked at startup: the core refuses the config
 * when `address` or `port` is missing, and when any `remoteDNS` entry is not
 * an IP literal (`netip.ParseAddr`) — a hostname there does not fail later, it
 * fails immediately.
 *
 * It is the only outbound that may use the `masque` transport, and the only
 * one that may not use `mux` — both are refused by name in
 * `OutboundDetourConfig.Build()`.
 */
export const MasqueOutboundSettingsSchema = z.object({
  /** Server address. Required. */
  address: z.string().optional(),
  /** Server port. Required. */
  port: z.number().int().optional(),
  /** Resolvers reachable through the tunnel. IP literals only. */
  remoteDNS: z.array(z.string()).optional(),
}).passthrough();
