// ============================================================
// Tunnel (dokodemo-door) Inbound Settings — Source: infra/conf/dokodemo.go (DokodemoConfig)
// ============================================================

import { z } from 'zod';
import { UserLevelSchema } from '../primitives';

/** "tcp", "udp", "tcp,udp" or ["tcp", "udp"]; omitted means TCP only. */
const NetworkListSchema = z.union([z.string(), z.array(z.string())]);

/**
 * `address`/`port`/`network` are the only spelling 26.3 reads. 26.7 added
 * `rewriteAddress`/`rewritePort`/`allowedNetwork` and kept the old names as
 * aliases that win whenever set (v26.7.28:infra/conf/dokodemo.go:23), so the
 * old names are the ones that work on every line — and the ones the editor
 * writes.
 */
export const TunnelInboundSettingsSchema = z.object({
  /** Where traffic is forwarded. */
  address: z.string().optional(),
  /** Port traffic is forwarded to; 0 or omitted keeps the original port. */
  port: z.number().int().optional(),
  /** Allowed networks. */
  network: NetworkListSchema.optional(),
  /** 26.7+ name for `address`; 26.3 ignores it. */
  rewriteAddress: z.string().optional(),
  /** 26.7+ name for `port`; 26.3 ignores it. */
  rewritePort: z.number().int().optional(),
  /** 26.7+ name for `network`; 26.3 ignores it. */
  allowedNetwork: NetworkListSchema.optional(),
  /** Per-port targets, each "host:port" (host may be empty); anything else fails the load. */
  portMap: z.record(z.string(), z.string()).optional(),
  /** Follow redirect target from transparent proxy */
  followRedirect: z.boolean().optional(),
  /** User level for policy */
  userLevel: UserLevelSchema,
}).passthrough();
