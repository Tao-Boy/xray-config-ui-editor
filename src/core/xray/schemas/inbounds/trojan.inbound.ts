// ============================================================
// Trojan Inbound Settings — Source: docs/config/inbounds/trojan.md
// ============================================================

import { z } from 'zod';
import { UserLevelSchema } from '../primitives';
import { FallbackObjectSchema } from '../fallback.schema';

export const TrojanInboundUserSchema = z.object({
  /** User password */
  password: z.string(),
  /** User email for statistics */
  email: z.string().optional(),
  /** User level for policy */
  level: UserLevelSchema,
}).passthrough();

export const TrojanInboundSettingsSchema = z.object({
  /**
   * Authorized users. The only spelling 26.3 reads, and on 26.7+ it wins over
   * `users` whenever present, even empty (v26.7.28:infra/conf/trojan.go:124).
   */
  clients: z.array(TrojanInboundUserSchema).optional(),
  /** 26.7+ alias of `clients`; 26.3 ignores it and loads the inbound with no users. */
  users: z.array(TrojanInboundUserSchema).optional(),
  /** Fallback configurations */
  fallbacks: z.array(FallbackObjectSchema).optional(),
}).passthrough();
