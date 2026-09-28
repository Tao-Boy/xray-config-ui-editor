// ============================================================
// Inbound Schema (wrapper) — src/core/xray/schemas/inbound.schema.ts
// Source: docs/config/inbound.md
// ============================================================

import { z } from 'zod';
import { PortSchema, DestOverrideSchema, InboundProtocolSchema } from './primitives';
import { StreamSettingsSchema } from './transport/stream.schema';

// --- Sniffing ---
export const SniffingSchema = z.object({
  /** Enable content sniffing */
  enabled: z.boolean().optional(),
  /** Override destination based on sniffed protocol */
  destOverride: z.array(z.union([DestOverrideSchema, z.string()])).optional(),
  /** Only use metadata for sniffing (no deep inspection) */
  metadataOnly: z.boolean().optional(),
  /**
   * Domains whose sniffed name must not replace the destination. A plain
   * entry is an exact match on 26.3 and a substring match from 26.7, where
   * the routing prefixes (`full:`, `domain:`, `geosite:`...) also work.
   */
  domainsExcluded: z.array(z.string()).optional(),
  /** Destination IPs sniffing must not override. 26.7+; 26.3 drops the key. */
  ipsExcluded: z.array(z.string()).optional(),
  /** Only route, don't override destination */
  routeOnly: z.boolean().optional(),
}).passthrough();

// --- Allocate ---
/**
 * Not a key on any supported line: InboundDetourConfig has no such field
 * (v26.3.27:infra/conf/xray.go:126, v26.9.9:infra/conf/xray.go:127), so the
 * core drops it without a word. Kept only because the schema index still
 * re-exports it; nothing here declares it on an inbound any more, and the
 * editor shows an existing one as doing nothing.
 * @deprecated
 */
export const AllocateSchema = z.object({
  /** Allocation strategy: "always" or "random" */
  strategy: z.enum(['always', 'random']).optional(),
  /** Refresh interval in minutes */
  refresh: z.number().int().optional(),
  /** Number of concurrent ports to use */
  concurrency: z.number().int().optional(),
}).passthrough();

// --- Inbound Object ---
// Settings are intentionally z.record for maximum flexibility.
// Protocol-specific validation should use the individual inbound schemas.
export const InboundSchema = z.object({
  /** Inbound tag for routing identification */
  tag: z.string().optional(),
  /** Listen port. Supports: number, string (range "1080-1090"), env ("env:PORT") */
  port: PortSchema.optional(),
  /** Listen address. Default: "0.0.0.0" */
  listen: z.string().optional(),
  /** Protocol name */
  protocol: z.union([InboundProtocolSchema, z.string()]),
  /** Protocol-specific settings (passthrough to avoid dropping unknown fields) */
  settings: z.record(z.string(), z.unknown()).optional(),
  /** Transport settings */
  streamSettings: StreamSettingsSchema.optional(),
  /** Content sniffing configuration */
  sniffing: SniffingSchema.optional(),
}).passthrough();

export type InboundConfig = z.infer<typeof InboundSchema>;
