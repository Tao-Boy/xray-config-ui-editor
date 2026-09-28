// ============================================================
// XHTTP Transport — `SplitHTTPConfig` in infra/conf
// ============================================================
//
// One struct serves both the outer object and `extra`: when `extra` is there,
// Build() re-reads the whole config from it and keeps only host, path and mode
// from the outside (v26.7.28:infra/conf/transport_method.go:308-315), so any
// other key written beside `extra` is silently discarded. Both levels
// therefore take the same keys, below.
import { z } from 'zod';
import { XhttpModeSchema, Int32RangeSchema } from '../primitives';

// --- XMUX (multiplexing control for H2/H3) ---
//
// With xmux omitted or all zero, the defaults differ by line: 26.3 uses
// maxConcurrency 1 (v26.3.27:infra/conf/transport_internet.go:395), 26.7+ use
// maxConnections 3 (v26.7.28:infra/conf/transport_method.go:453); both then
// set hMaxRequestTimes 600-900 and hMaxReusableSecs 1800-3000. Write it out
// to get the same behaviour on every core.
export const XmuxSchema = z.object({
  /** Max concurrent requests per connection. Cannot be set together with maxConnections. */
  maxConcurrency: Int32RangeSchema.optional(),
  /** Max simultaneous connections. Cannot be set together with maxConcurrency. */
  maxConnections: Int32RangeSchema.optional(),
  /** Max reuse times per connection. 0 = unlimited. */
  cMaxReuseTimes: Int32RangeSchema.optional(),
  /** Max HTTP requests per connection. */
  hMaxRequestTimes: Int32RangeSchema.optional(),
  /** Max reusable seconds per connection. */
  hMaxReusableSecs: Int32RangeSchema.optional(),
  /** H2/H3 keep-alive period in seconds. 0 = the library default. */
  hKeepAlivePeriod: z.number().optional(),
}).passthrough();

// --- Download Settings (for upload/download separation) ---
// A whole streamSettings object: REALITY is refused over anything but XHTTP
// here too, and it may not be used in mode stream-one.
export const XhttpDownloadSettingsSchema = z.object({
  address: z.string().optional(),
  port: z.number().int().optional(),
  network: z.string().optional(),
  security: z.string().optional(),
  tlsSettings: z.record(z.string(), z.unknown()).optional(),
  realitySettings: z.record(z.string(), z.unknown()).optional(),
  xhttpSettings: z.record(z.string(), z.unknown()).optional(),
  sockopt: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

/**
 * path, cookie, header or query — anything else fails the load; empty means
 * path. Typed as a string rather than an enum of those four: the icon-map
 * scanner reads every quoted word that names a Phosphor icon, and one of
 * these does. Checking the value is the feature table's job anyway.
 */
const PlacementSchema = z.string();

/**
 * Every key `SplitHTTPConfig` takes besides host, path and mode.
 *
 * The session-ID keys were renamed in 26.7 with no migration, and each line
 * silently ignores the other spelling — a config meant for both has to carry
 * both (v26.3.27:infra/conf/transport_internet.go:232-233,
 * v26.7.28:infra/conf/transport_method.go:269-272):
 *
 *   26.3          sessionPlacement, sessionKey
 *   26.7, 26.9    sessionIDPlacement, sessionIDKey, sessionIDTable, sessionIDLength
 */
export const XhttpExtraSchema = z.object({
  /** Custom request headers. A Host entry fails the load — use host. */
  headers: z.record(z.string(), z.string()).optional(),
  /** Padding size range, default "100-1000"; both ends must be > 0 when set. */
  xPaddingBytes: Int32RangeSchema.optional(),
  xPaddingObfsMode: z.boolean().optional(),
  xPaddingKey: z.string().optional(),
  xPaddingHeader: z.string().optional(),
  /** queryInHeader (the default), cookie, header or query; compared as written. */
  xPaddingPlacement: z.string().optional(),
  /** Empty means repeat-x. */
  xPaddingMethod: z.enum(['repeat-x', 'tokenish']).optional(),
  /** Upper-cased, default POST; GET only in mode packet-up. */
  uplinkHTTPMethod: z.string().optional(),

  // --- session ID: 26.3 spelling ---
  sessionPlacement: PlacementSchema.optional(),
  sessionKey: z.string().optional(),
  // --- session ID: 26.7+ spelling ---
  sessionIDPlacement: PlacementSchema.optional(),
  sessionIDKey: z.string().optional(),
  /** A predefined table name or a custom ASCII character set. */
  sessionIDTable: z.string().optional(),
  /** Only used together with sessionIDTable. */
  sessionIDLength: Int32RangeSchema.optional(),

  seqPlacement: PlacementSchema.optional(),
  seqKey: z.string().optional(),
  /** auto (the default), body, cookie or header; the last two only in mode packet-up. */
  uplinkDataPlacement: z.string().optional(),
  uplinkDataKey: z.string().optional(),
  uplinkChunkSize: Int32RangeSchema.optional(),
  /** Client: disable the gRPC Content-Type header for stream-up/one. */
  noGRPCHeader: z.boolean().optional(),
  /** Server: disable the SSE Content-Type header. */
  noSSEHeader: z.boolean().optional(),

  // --- packet-up ---
  /** Max bytes per POST. Default 1000000. */
  scMaxEachPostBytes: Int32RangeSchema.optional(),
  /** Client: min interval between POSTs in ms. Default 30. */
  scMinPostsIntervalMs: Int32RangeSchema.optional(),
  /** Server: max buffered POSTs. Default 30. */
  scMaxBufferedPosts: z.number().int().optional(),

  // --- stream-up ---
  /** Server: keep-alive padding interval in seconds. Default "20-80". */
  scStreamUpServerSecs: Int32RangeSchema.optional(),
  /** Server: must not be negative. */
  serverMaxHeaderBytes: z.number().int().min(0).optional(),

  /** Client: H2/H3 multiplexing. */
  xmux: XmuxSchema.optional(),
  /** Client: a separate connection for the download direction; not in mode stream-one. */
  downloadSettings: XhttpDownloadSettingsSchema.optional(),
}).passthrough();

// --- Top-level XHTTP Transport ---
export const XhttpTransportSchema = XhttpExtraSchema.extend({
  /** HTTP host header. Priority (client): host > serverName > address. */
  host: z.string().optional(),
  /** HTTP path. Must be the same for upload and download. */
  path: z.string().optional(),
  /** auto, packet-up, stream-up or stream-one; empty means auto. */
  mode: XhttpModeSchema.optional(),
  /** When present, every key but host, path and mode is read from here instead. */
  extra: XhttpExtraSchema.optional(),
}).passthrough();
