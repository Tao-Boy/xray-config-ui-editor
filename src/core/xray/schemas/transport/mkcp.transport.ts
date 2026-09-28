// ============================================================
// mKCP Transport — `KCPConfig` in infra/conf
// ============================================================
//
// The supported lines disagree about this object more than about any other
// transport, so every key says which lines read it; the feature table in
// core/xray/versions is what the editor and the diagnostics ask. The schema
// takes the union — a key valid on some line — and leaves per-line limits to
// the form (see kcpProblems in core/xray/transport-networks.ts), because
// one schema serves every line and must not call a 26.3 config broken for
// using a 26.3 key.
//
// `header` and `seed` are not here on purpose. 26.3 and 26.7 refuse the config
// when either key is present at all — `if c.HeaderConfig != nil || c.Seed !=
// nil` (v26.3.27:infra/conf/transport_internet.go:110,
// v26.7.28:infra/conf/transport_method.go:537) — and 26.9 still declares them
// but never reads them. Their job is done by finalmask UDP masks. Passthrough
// keeps one a config already has, so it can be shown and removed.
import { z } from 'zod';

export const MkcpTransportSchema = z.object({
  /**
   * Default 1350. 26.3 does not check it (the check is commented out,
   * v26.3.27:infra/conf/transport_internet.go:73); 26.7+ refuse anything
   * below 21 (v26.7.28:infra/conf/transport_method.go:562).
   */
  mtu: z.number().int().min(0).optional(),
  /**
   * Transmission time interval in ms, default 50. 26.3 takes 10-5000
   * (transport_internet.go:80); 26.7+ take 10-1000 (transport_method.go:565).
   */
  tti: z.number().int().min(10).max(5000).optional(),
  /** MB/s, default 5. */
  uplinkCapacity: z.number().int().min(0).optional(),
  /** MB/s, default 20. */
  downlinkCapacity: z.number().int().min(0).optional(),

  // ── 26.3 only; 26.7 removed them from the struct and drops them silently.
  /** Congestion control switch (v26.3.27:infra/conf/transport_internet.go:60). */
  congestion: z.boolean().optional(),
  /** MB, 0 meaning 512 KB. Decoded by 26.3 and never used by its kcp core. */
  readBufferSize: z.number().int().min(0).optional(),
  /** MB, 0 meaning 512 KB, default 2. Replaced by maxSendingWindow in 26.7. */
  writeBufferSize: z.number().int().min(0).optional(),

  // ── 26.7 and later; 26.3 does not know them.
  /**
   * Sending window in bytes, default 2097152. Must be at least mtu or the
   * load fails (v26.7.28:infra/conf/transport_method.go:571).
   */
  maxSendingWindow: z.number().int().min(0).optional(),
  /** Default 1; below 1 fails the load (v26.7.28:infra/conf/transport_method.go:569). */
  cwndMultiplier: z.number().int().min(1).optional(),
}).passthrough();
