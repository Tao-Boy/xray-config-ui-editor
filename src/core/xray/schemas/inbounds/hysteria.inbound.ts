// ============================================================
// Hysteria Inbound Settings — Source: infra/conf/hysteria.go (HysteriaServerConfig)
// ============================================================

import { z } from 'zod';
import { UserLevelSchema } from '../primitives';

/** {auth, level, email} on every line (v26.3.27:infra/conf/hysteria.go:33). */
export const HysteriaInboundUserSchema = z.object({
  /** The user's password — the key is `auth`; `password` is read by no line. */
  auth: z.string().optional(),
  /** User level for policy */
  level: UserLevelSchema,
  /** User email for statistics */
  email: z.string().optional(),
}).passthrough();

export const HysteriaInboundSettingsSchema = z.object({
  /** Must be 2. 26.7+ refuse a missing or other value; 26.3 never checks it. */
  version: z.literal(2).optional(),
  /** The users. The only spelling 26.3 reads, and it wins over `users` on 26.7+. */
  clients: z.array(HysteriaInboundUserSchema).optional(),
  /** 26.7+ alias of `clients`; 26.3 ignores it. */
  users: z.array(HysteriaInboundUserSchema).optional(),
}).passthrough();
