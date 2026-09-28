/**
 * Which parts of an outbound a protocol actually uses.
 *
 * The editor used to draw the same four blocks for every protocol — server
 * address, proxy chain, mux, and the whole transport stack — which is how a
 * loopback outbound ended up offering a TLS fingerprint and a UUID box while
 * hiding the one field it has. This table says what each protocol can use, and
 * the editor draws only that.
 *
 * "Cannot use" is not an opinion here. An outbound handler is handed an
 * `internet.Dialer`; a protocol that never touches it can have no transport,
 * no sendThrough and nothing to multiplex, because there is no connection for
 * any of that to apply to:
 *
 *   proxy/loopback/loopback.go   Process(ctx, link, _ internet.Dialer)
 *   proxy/blackhole/blackhole.go takes `dialer` and never references it
 *
 * Both hand the traffic back to the router or drop it on the spot. Everything
 * else here dials, so the transport stack applies to it.
 */

export interface OutboundShape {
    /** A remote address and credentials of its own. */
    server: boolean;
    /** Dials out, so `streamSettings` (transport, security, sockopt) applies. */
    transport: boolean;
    /** Worth offering Mux.Cool: a stream the far end can demultiplex. */
    mux: boolean;
}

/**
 * Mux is not refused by the core for any protocol but masque, so this column
 * is about what the far end can answer. Mux.Cool needs an Xray server on the
 * other side; a plain SOCKS or HTTP proxy, a direct connection or a dropped
 * one has nobody to speak it with.
 */
const SHAPES: Record<string, OutboundShape> = {
    vless: { server: true, transport: true, mux: true },
    vmess: { server: true, transport: true, mux: true },
    trojan: { server: true, transport: true, mux: true },
    shadowsocks: { server: true, transport: true, mux: true },
    'shadowsocks-2022': { server: true, transport: true, mux: true },
    socks: { server: true, transport: true, mux: false },
    http: { server: true, transport: true, mux: false },
    hysteria: { server: true, transport: true, mux: false },
    // Its own device and peers rather than a server card, and its own
    // encrypted transport underneath.
    wireguard: { server: false, transport: true, mux: false },
    // Dials the destination itself. No protocol of its own to multiplex, but
    // sockopt — mark, interface, dialerProxy — is exactly how it is steered.
    freedom: { server: false, transport: true, mux: false },
    // Dials the DNS server it forwards to, so sockopt applies here too.
    dns: { server: false, transport: true, mux: false },
    blackhole: { server: false, transport: false, mux: false },
    loopback: { server: false, transport: false, mux: false },
};

/** Anything unknown is assumed to be a full proxy — better too much than a hidden field. */
const DEFAULT_SHAPE: OutboundShape = { server: true, transport: true, mux: true };

export const outboundShape = (protocol: unknown): OutboundShape =>
    (typeof protocol === 'string' ? SHAPES[protocol] : undefined) ?? DEFAULT_SHAPE;

/** The protocols this table knows, for the test that keeps it beside the schema. */
export const shapedProtocols = (): string[] => Object.keys(SHAPES);

/**
 * Move an outbound's `proxySettings.tag` to `streamSettings.sockopt.dialerProxy`.
 *
 * `proxySettings` is a removed feature: `OutboundDetourConfig.Build()` answers
 * `PrintRemovedFeatureError("outbound \"proxySettings\"",
 * "\"streamSettings.sockopt.dialerProxy\"")`, so a config still carrying it
 * does not start on a current core — it is not ignored the way an unknown
 * field would be. Cores up to 26.3 still accept it, which is why this is
 * offered rather than done silently.
 *
 * Pure: returns a new outbound and leaves the original alone. An existing
 * `dialerProxy` wins, because something already made that choice deliberately.
 */
export const migrateProxySettings = <T extends Record<string, any>>(outbound: T): T => {
    const tag = outbound?.proxySettings?.tag;
    if (!tag) return outbound;

    const sockopt = { ...(outbound.streamSettings?.sockopt ?? {}) };
    if (!sockopt.dialerProxy) sockopt.dialerProxy = tag;

    const next = {
        ...outbound,
        streamSettings: { ...(outbound.streamSettings ?? {}), sockopt },
    } as Record<string, any>;
    // `transportLayer` goes with it: sockopt chaining is transport-level by
    // definition, so there is nothing left for the flag to say.
    delete next.proxySettings;
    return next as T;
};
