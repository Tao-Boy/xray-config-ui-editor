// ============================================================
// Socks Inbound Settings — Source: infra/conf/socks.go (SocksServerConfig)
// ============================================================

import { z } from 'zod';
import { UserLevelSchema } from '../primitives';

export const SocksInboundUserSchema = z.object({
  /** Username */
  user: z.string(),
  /** Password */
  pass: z.string(),
}).passthrough();

export const SocksInboundSettingsSchema = z.object({
  /**
   * "noauth" or "password", compared exactly. Anything else is not an error:
   * the core falls back to noauth (v26.3.27:infra/conf/socks.go:40).
   */
  auth: z.enum(['noauth', 'password']).optional(),
  /**
   * Accounts for password authentication. The only spelling 26.3 reads, and
   * on 26.7+ it wins over `users` whenever present (v26.7.28:infra/conf/socks.go:51).
   */
  accounts: z.array(SocksInboundUserSchema).optional(),
  /** 26.7+ alias of `accounts`; 26.3 ignores it. */
  users: z.array(SocksInboundUserSchema).optional(),
  /** Enable UDP relay. Default: false */
  udp: z.boolean().optional(),
  /** IP address for UDP relay responses. Default: "127.0.0.1" */
  ip: z.string().optional(),
  /** User level for policy */
  userLevel: UserLevelSchema,
}).passthrough();
