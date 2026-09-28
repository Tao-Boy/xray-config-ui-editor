// ============================================================
// Hysteria Transport — `HysteriaConfig` in infra/conf
// ============================================================
//
// The transport half of Hysteria 2. The proxy half (`protocol: "hysteria"`)
// needs it from 26.7 — see the `hysteria.stream.network` value set — and it
// needs `security: "tls"` on every line.
//
// `congestion`, `up`, `down` and `udphop` are not here: 26.3 and 26.7 decode
// them, warn that they moved to finalmask/quicParams and never use them; 26.9
// removed them (v26.7.28:infra/conf/transport_method.go:780,
// v26.9.9:infra/conf/transport_method.go:752). Passthrough keeps an existing
// one so the editor can show it and offer to remove it.
import { z } from 'zod';

/**
 * What the listener serves to anything that is not a Hysteria client. Build()
 * copies `type` through unchecked, and the listener answers "unknown masq
 * type" for anything but these (v26.7.28:transport/internet/hysteria/hub.go:211-253);
 * it lower-cases first, and empty means 404. Its own enum rather than the
 * shared primitive, which lacks `404`.
 */
const MasqueradeTypeSchema = z.enum(['', '404', 'file', 'proxy', 'string']);

/** Server side only: the dialer never reads it. */
export const HysteriaMasqueradeSchema = z.object({
  type: MasqueradeTypeSchema.optional(),
  /** type file: the directory to serve. */
  dir: z.string().optional(),
  /** type proxy: the upstream URL (26.9 also takes a unix socket path). */
  url: z.string().optional(),
  rewriteHost: z.boolean().optional(),
  /** type proxy, 26.9 only (v26.9.9:infra/conf/transport_method.go:744): add X-Forwarded-* headers. */
  xForwarded: z.boolean().optional(),
  /** type proxy: skip verifying the upstream's certificate. */
  insecure: z.boolean().optional(),
  /** type string: the body. */
  content: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  statusCode: z.number().int().optional(),
}).passthrough();

export const HysteriaTransportSchema = z.object({
  /**
   * Must be exactly 2 whenever hysteriaSettings is present — "version != 2"
   * fails the load on every line (v26.7.28:infra/conf/transport_method.go:776).
   * Optional here only so a half-written object still types while it is
   * being edited; the editor writes it with every change.
   */
  version: z.literal(2).optional(),
  /**
   * Client: the password it sends. Server: checked only when the inbound has
   * no users (v26.7.28:transport/internet/hysteria/hub.go:63).
   */
  auth: z.string().optional(),
  /**
   * Seconds, server side: 0 means the default 60, otherwise 2-600 or the
   * load fails (v26.7.28:infra/conf/transport_method.go:784).
   */
  udpIdleTimeout: z.number().int().refine(
    value => value === 0 || (value >= 2 && value <= 600),
    { message: '0 (default 60) or 2-600 seconds' },
  ).optional(),
  masquerade: HysteriaMasqueradeSchema.optional(),
}).passthrough();
