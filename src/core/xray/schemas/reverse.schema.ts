// ============================================================
// Reverse Schema — src/core/xray/schemas/reverse.schema.ts
// Source: docs/config/reverse.md (DEPRECATED)
// ============================================================

import { z } from 'zod';

export const BridgeObjectSchema = z.object({
  /** Bridge tag, used in routing inboundTag */
  tag: z.string(),
  /** Domain for bridge-portal communication (doesn't need to exist) */
  domain: z.string(),
}).passthrough();

export const PortalObjectSchema = z.object({
  /** Portal tag, used in routing outboundTag */
  tag: z.string(),
  /** Domain for bridge-portal communication (must match bridge domain) */
  domain: z.string(),
}).passthrough();

/**
 * Legacy bridge/portal reverse proxy.
 *
 * Runs on 26.3 (v26.3.27:infra/conf/reverse.go:32). From 26.7 any non-null
 * `reverse` object — `{}` included — is a removed-feature error and the config
 * does not load (v26.7.28:infra/conf/xray.go:607); VLESS reverse proxy
 * replaces it. The shape is still described so a 26.3 config can be edited
 * and a newer one can be shown before it is removed.
 * @deprecated
 */
export const ReverseSchema = z.object({
  bridges: z.array(BridgeObjectSchema).optional(),
  portals: z.array(PortalObjectSchema).optional(),
}).passthrough();

export type ReverseConfig = z.infer<typeof ReverseSchema>;
