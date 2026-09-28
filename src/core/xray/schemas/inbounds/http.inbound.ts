// ============================================================
// HTTP Inbound Settings — Source: infra/conf/http.go (HTTPServerConfig)
// ============================================================

import { z } from 'zod';
import { UserLevelSchema } from '../primitives';

export const HttpInboundUserSchema = z.object({
  /** Username */
  user: z.string(),
  /** Password */
  pass: z.string(),
}).passthrough();

export const HttpInboundSettingsSchema = z.object({
  /**
   * Accounts for authentication. The only spelling 26.3 reads, and on 26.7+
   * it wins over `users` whenever present, even empty (v26.7.28:infra/conf/http.go:38).
   */
  accounts: z.array(HttpInboundUserSchema).optional(),
  /** 26.7+ alias of `accounts`; 26.3 ignores it and runs without authentication. */
  users: z.array(HttpInboundUserSchema).optional(),
  /** Allow transparent proxy. Default: false */
  allowTransparent: z.boolean().optional(),
  /** User level for policy */
  userLevel: UserLevelSchema,
}).passthrough();
