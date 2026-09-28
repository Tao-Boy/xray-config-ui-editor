// ============================================================
// Freedom Outbound — Source: infra/conf/freedom.go (FreedomConfig)
// ============================================================
import { z } from 'zod';
import { DomainStrategyFullSchema, UserLevelSchema, Int32RangeSchema } from '../primitives';

export const FreedomFinalRuleSchema = z.object({
  action: z.enum(['allow', 'block']).optional(),
  network: z.string().optional(),
  port: z.union([z.number().int(), z.string()]).optional(),
  ip: z.array(z.string()).optional(),
  /** Hold a blocked connection open this long before dropping it. */
  blockDelay: Int32RangeSchema.optional(),
}).passthrough();

export const FreedomNoiseSchema = z.object({
  /**
   * How `packet` is read. The core takes exactly these four and rejects
   * anything else: `rand` reads a length range, `str` bytes as typed, `hex`
   * and `base64` the decoded bytes.
   */
  type: z.enum(['rand', 'str', 'hex', 'base64']).optional(),
  /** The packet itself, in whatever form `type` names. */
  packet: z.string().optional(),
  /** Delay in ms before sending (Int32Range) */
  delay: Int32RangeSchema.optional(),
  /** Which destinations get the noise. Empty and `all` both mean `ip`. */
  applyTo: z.enum(['ip', 'ipv4', 'ipv6', 'all']).optional(),
}).passthrough();

export const FreedomFragmentSchema = z.object({
  /** "tlshello" or "1-3" style TCP stream slice */
  packets: z.string().optional(),
  /** Fragment size in bytes (Int32Range) */
  length: Int32RangeSchema.optional(),
  /** Delay between fragments in ms (Int32Range) */
  interval: Int32RangeSchema.optional(),
  /** Cap on how many pieces one write is cut into. */
  maxSplit: Int32RangeSchema.optional(),
}).passthrough();

export const FreedomOutboundSettingsSchema = z.object({
  /**
   * How a target domain is resolved.
   *
   * `targetStrategy` is the current spelling; `domainStrategy` is the older
   * one and the core logs a deprecation for it. Either way the value ends up
   * as `streamSettings.sockopt.domainStrategy`, which is where freedom reads
   * it from — the core migrates it there itself and says so in the log.
   */
  targetStrategy: DomainStrategyFullSchema.optional(),
  /** Deprecated spelling of `targetStrategy`. */
  domainStrategy: DomainStrategyFullSchema.optional(),
  /** Redirect destination "addr:port" */
  redirect: z.string().optional(),
  /** User level for policy */
  userLevel: UserLevelSchema,
  /** TLS fragment settings */
  fragment: FreedomFragmentSchema.optional(),
  /** Noise packets to send. `noise` is the single-entry legacy form. */
  noises: z.array(FreedomNoiseSchema).optional(),
  noise: FreedomNoiseSchema.optional(),
  /** Send PROXY protocol (0=disabled, 1=v1, 2=v2) */
  proxyProtocol: z.number().int().optional(),
  /** Final rules for allowlisting/blocking */
  finalRules: z.array(FreedomFinalRuleSchema).optional(),
  /**
   * Removed: the core logs that it has been migrated to `finalRules` and
   * otherwise ignores it. Kept so an old config still reads as understood.
   */
  ipsBlocked: z.array(z.string()).optional(),
}).passthrough();
