// ============================================================
// MASQUE Transport — Source: infra/conf/transport_method.go (MasqueConfig)
// ============================================================
import { z } from 'zod';

/**
 * How the tunnel dresses itself up as a web request.
 *
 * `path` falls back to `masque.DefaultPath` when empty; `user`/`pass` are the
 * credentials the proxy asks for, separate from the inbound's own user list.
 * Only the masque outbound may carry this, and it may carry no other transport.
 */
export const MasqueTransportSchema = z.object({
  /** Host header sent with the request. */
  host: z.string().optional(),
  /** Request path. Empty means the core's default. */
  path: z.string().optional(),
  user: z.string().optional(),
  pass: z.string().optional(),
  /** Extra request headers. */
  headers: z.record(z.string(), z.string()).optional(),
}).passthrough();
