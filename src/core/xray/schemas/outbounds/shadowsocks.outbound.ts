// ============================================================
// Shadowsocks Outbound Settings — Source: docs/config/outbounds/shadowsocks.md
// ============================================================
import { z } from 'zod';
import { UserLevelSchema, ShadowsocksMethodSchema } from '../primitives';

/** One server in the grouped form. */
export const ShadowsocksServerSchema = z.object({
  address: z.string().optional(),
  port: z.number().int().optional(),
  method: ShadowsocksMethodSchema.optional(),
  password: z.string().optional(),
  email: z.string().optional(),
  level: UserLevelSchema,
  /**
   * UDP over TCP, gone from the core.
   *
   * `ShadowsocksServerTarget` carried `uot` and `uotVersion` up to v25.1.30
   * and neither survives into 26.x, where the client config is address, port,
   * level, email, method, password and servers — nothing else. Declared so an
   * older config still reads as understood; nothing writes them.
   *
   * The spelling matters: the core's tag was `uotVersion`, and this schema
   * used to say `UoTVersion`, which matched nothing at either end.
   */
  uot: z.boolean().optional(),
  uotVersion: z.number().int().optional(),
}).passthrough();

export const ShadowsocksOutboundSettingsSchema = z.object({
  /** Servers in grouped form. The flat fields below are the newer spelling. */
  servers: z.array(ShadowsocksServerSchema).optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  port: z.number().int().optional(),
  method: ShadowsocksMethodSchema.optional(),
  password: z.string().optional(),
  level: UserLevelSchema,
}).passthrough();
