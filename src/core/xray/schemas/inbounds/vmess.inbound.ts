// ============================================================
// VMess Inbound Settings — Source: docs/config/inbounds/vmess.md
// ============================================================

import { z } from 'zod';
import { UserLevelSchema } from '../primitives';

export const VmessInboundUserSchema = z.object({
  /** User UUID */
  id: z.string(),
  /** User level for policy. Default: 0 */
  level: UserLevelSchema,
  /** User email for statistics */
  email: z.string().optional(),
}).passthrough();

export const VmessInboundSettingsSchema = z.object({
  /**
   * Authorized users. The only spelling 26.3 reads, and on 26.7+ it wins over
   * `users` whenever present, even empty (v26.7.28:infra/conf/vmess.go:73).
   */
  clients: z.array(VmessInboundUserSchema).optional(),
  /** 26.7+ alias of `clients`; 26.3 ignores it and loads the inbound with no users. */
  users: z.array(VmessInboundUserSchema).optional(),
  /** Default policy settings */
  default: z.object({
    level: UserLevelSchema,
  }).passthrough().optional(),
}).passthrough();
