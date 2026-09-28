// ============================================================
// TUN Inbound Settings — Source: infra/conf/tun.go (TunConfig)
// ============================================================

import { z } from 'zod';
import { UserLevelSchema } from '../primitives';

/**
 * 26.3 reads only name, MTU and userLevel (v26.3.27:infra/conf/tun.go:8);
 * everything else arrived in 26.7 (v26.7.28:infra/conf/tun.go:14). Which of
 * these an editor offers is a version question, answered by the feature table.
 * There is no `stack` key on any line.
 */
export const TunInboundSettingsSchema = z.object({
  /** TUN device name. Default "xray0" on 26.3, a free "utunN" from 26.7. */
  name: z.string().optional(),
  /** Adapter description (Windows). 26.7+. */
  desc: z.string().optional(),
  /** MTU size; the 26.3 tag is "MTU", matched case-insensitively. Default 1500. */
  mtu: z.number().int().optional(),
  /** Gateway prefixes (CIDR, e.g. "10.0.0.1/24"). 26.7+. */
  gateway: z.array(z.string()).optional(),
  /** DNS server addresses. 26.7+. */
  dns: z.array(z.string()).optional(),
  /** User level for policy */
  userLevel: UserLevelSchema,
  /** Routing-table entries to add for the device. 26.7+. */
  autoSystemRoutingTable: z.array(z.string()).optional(),
  /**
   * "auto", an interface name, or "" to switch it off — a string, not a
   * switch: a boolean fails to decode (v26.7.28:infra/conf/tun.go:22). 26.7+.
   */
  autoOutboundsInterface: z.string().optional(),
}).passthrough();
