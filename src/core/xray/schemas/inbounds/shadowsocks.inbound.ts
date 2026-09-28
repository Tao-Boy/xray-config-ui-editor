// ============================================================
// Shadowsocks Inbound Settings — Source: infra/conf/shadowsocks.go (ShadowsocksServerConfig)
// ============================================================

import { z } from 'zod';
import { UserLevelSchema } from '../primitives';

export const ShadowsocksInboundUserSchema = z.object({
  /** Per-user password; with a 2022 method, the user's base64 key. */
  password: z.string(),
  /**
   * Per-user cipher. Required for classic multi-user (an AEAD cipher), and
   * must be empty with a 2022 method (v26.7.28:infra/conf/shadowsocks.go:139).
   */
  method: z.string().optional(),
  /** User email for statistics */
  email: z.string().optional(),
  /** User level for policy */
  level: UserLevelSchema,
}).passthrough();

export const ShadowsocksInboundSettingsSchema = z.object({
  /** Allowed network: "tcp", "udp", "tcp,udp". Omitted means TCP only. */
  network: z.string().optional(),
  /**
   * Cipher. Which names a line takes is a version fact — "none"/"plain" went
   * away in 26.7 — so it is checked against the `inbound.shadowsocks.method`
   * value set rather than pinned here; classic names are also matched
   * case-insensitively and have `aead_*` aliases an enum would wrongly refuse.
   */
  method: z.string().optional(),
  /** Server password */
  password: z.string().optional(),
  /** User level */
  level: UserLevelSchema,
  /** User email */
  email: z.string().optional(),
  /**
   * Users for multi-user mode. The only spelling 26.3 reads, and on 26.7+ it
   * wins over `users` whenever present, even empty (v26.7.28:infra/conf/shadowsocks.go:54).
   */
  clients: z.array(ShadowsocksInboundUserSchema).optional(),
  /** 26.7+ alias of `clients`; 26.3 ignores it. */
  users: z.array(ShadowsocksInboundUserSchema).optional(),
}).passthrough();
