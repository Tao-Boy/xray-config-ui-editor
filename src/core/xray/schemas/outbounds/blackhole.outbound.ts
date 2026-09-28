// ============================================================
// Blackhole Outbound — Source: infra/conf/blackhole.go (BlackholeConfig)
// ============================================================
import { z } from 'zod';

export const BlackholeOutboundSettingsSchema = z.object({
  /**
   * What the client gets instead of a connection.
   *
   * `none` drops it silently, `http` answers 403, and `custom` writes
   * `customResponseData` verbatim — the core base64-decodes that field and
   * refuses to start if it is not valid base64.
   */
  response: z.object({
    type: z.enum(['none', 'http', 'custom']).optional(),
    /** Base64 of the exact bytes to send. Only read when type is `custom`. */
    customResponseData: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();
