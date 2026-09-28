// ============================================================
// MASQUE Inbound Settings — Source: infra/conf/masque.go (MasqueServerConfig)
// ============================================================

import { z } from 'zod';
import { UserLevelSchema } from '../primitives';

export const MasqueInboundUserSchema = z.object({
  /** Password. Required — the core rejects an empty one by email. */
  pass: z.string().optional(),
  /** Required, unique, and may not contain a colon. */
  email: z.string().optional(),
  level: UserLevelSchema,
}).passthrough();

/**
 * The server end of CONNECT-IP over HTTP/3.
 *
 * `address` is the prefix pool handed to clients, not a listen address, and
 * the core is strict about it: at most one IPv4 and one IPv6 prefix, each a
 * valid CIDR, and at least one of them. `mtu` is either absent or 1280–65535.
 */
export const MasqueInboundSettingsSchema = z.object({
  /** Newer spelling; `users` is the same list. */
  clients: z.array(MasqueInboundUserSchema).optional(),
  users: z.array(MasqueInboundUserSchema).optional(),
  /** CIDR prefixes assigned to clients — one IPv4 and/or one IPv6. */
  address: z.array(z.string()).optional(),
  /** 1280–65535, or absent for the default. */
  mtu: z.number().int().min(1280).max(65535).optional(),
}).passthrough();
