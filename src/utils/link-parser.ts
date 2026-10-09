import { t, tn } from '../i18n';
import { cryptoRng } from '../core/noise/bytes';
import { awgProtocolNotes, isAwgInterface, recipeFromAwgInterface } from '../core/noise/awg';
import { toNoiseItems } from '../core/noise/recipe';
import type { Note } from '../core/noise/types';

/**
 * An mKCP link's header type, as the finalmask mask that carries it now.
 *
 * `kcpSettings.header` is refused outright on 26.3 and 26.7 — any header
 * object, even `{type: "none"}` — and ignored on 26.9 (infra/conf, KCPConfig
 * Build). The obfuscation moved to finalmask: `mkcp-legacy` with the header's
 * name (v26.7.28:infra/conf/transport_finalmask.go, MkcpLegacy), where the old
 * `wechat-video` is spelled `wechat`. `none` gives nothing — whether the far
 * end still expects the old framing cannot be told from a link.
 */
const kcpHeaderMask = (type: unknown): { udp: { type: string; settings: { header: string } }[] } | undefined => {
    const name = String(type ?? '').toLowerCase();
    const header = name === 'wechat-video' ? 'wechat' : name;
    if (!['dns', 'dtls', 'srtp', 'utp', 'wechat', 'wireguard'].includes(header)) return undefined;
    return { udp: [{ type: 'mkcp-legacy', settings: { header } }] };
};

/**
 * A WireGuard or AmneziaWG `.conf` as an outbound, plus everything about the
 * profile that Xray cannot do. The notes are why this entry exists: an AWG
 * profile can ask for padded handshakes or renumbered message types, and
 * without a word about them the result is a config that looks right and never
 * completes a handshake.
 */
export const parseWireguardConfigDetailed = (
    text: string,
    mode: 'direct' | 'chained' = 'direct',
): { result: any; notes: Note[] } => {
    const lines = text.split('\n');
    const config: any = {
        Interface: {},
        Peers: [] as any[]
    };

    const notes: Note[] = [];
    let currentSection = "";
    for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith('#')) continue;

        if (line.startsWith('[Interface]')) {
            currentSection = "Interface";
            continue;
        } else if (line.startsWith('[Peer]')) {
            config.Peers.push({});
            currentSection = "Peer";
            continue;
        }

        const parts = line.split('=');
        if (parts.length < 2) continue;
        const key = (parts[0] ?? '').trim();
        const value = parts.slice(1).join('=').trim();

        if (currentSection === "Interface") {
            config.Interface[key] = value;
        } else if (currentSection === "Peer") {
            config.Peers[config.Peers.length - 1][key] = value;
        }
    }

    if (!config.Interface.PrivateKey) return { result: null, notes };

    const outbound: any = {
        tag: "wg-imported-" + Math.floor(Math.random() * 1000),
        protocol: "wireguard",
        settings: {
            secretKey: config.Interface.PrivateKey,
            address: config.Interface.Address ? config.Interface.Address.split(',').map((s: string) => s.trim()) : [],
            mtu: config.Interface.MTU ? parseInt(config.Interface.MTU) : 1280,
            peers: config.Peers.map((p: any) => ({
                publicKey: p.PublicKey,
                endpoint: p.Endpoint,
                allowedIPs: p.AllowedIPs ? p.AllowedIPs.split(',').map((s: string) => s.trim()) : ["0.0.0.0/0", "::/0"],
                keepAlive: p.PersistentKeepalive ? parseInt(p.PersistentKeepalive) : 0
            }))
        },
        streamSettings: {
            // Not "udp": that is no transport name, and every supported core
            // refuses the config with "unknown transport protocol". WireGuard
            // dials UDP on its own; the stream is only here for finalmask.
            network: "raw",
            security: "none"
        }
    };

    // --- AmneziaWG: the decoys it sends, and what could not come with them ---
    if (isAwgInterface(config.Interface)) {
        const { recipe, notes: decoyNotes } = recipeFromAwgInterface(config.Interface, cryptoRng);
        const noise = toNoiseItems(recipe);
        notes.push(...awgProtocolNotes(config.Interface), ...decoyNotes);

        // Cloudflare WARP substitutes three bytes of the WireGuard header, which
        // is what `reserved` is for. S1/S2 are not that: they are padding lengths
        // on handshake messages (device/send.go:149,199). Writing them here, as
        // this importer used to, corrupted the header on every non-WARP profile.
        const isWARP = outbound.settings.peers.some((p: any) =>
            p.endpoint?.includes('cloudflare') || p.endpoint?.includes('162.159.')
        );
        if (isWARP) {
            outbound.settings.reserved = [0, 0, 0];
        }

        // A profile whose decoys all failed to parse still imports as plain
        // WireGuard; the notes say what was dropped.
        if (noise.length === 0) {
            return { result: outbound, notes };
        }

        if (mode === 'direct') {
            // Finalmask inside the WireGuard outbound itself.
            outbound.streamSettings.network = "raw";
            outbound.streamSettings.finalmask = {
                udp: [{ type: "noise", settings: { noise } }]
            };
        } else {
            // A separate freedom outbound carries the decoys, reached through
            // dialerProxy — for a core whose WireGuard has no finalmask.
            const noiseTag = outbound.tag + "-obfuscator";
            outbound.streamSettings.sockopt = { dialerProxy: noiseTag };

            const obfuscator = {
                tag: noiseTag,
                protocol: "freedom",
                settings: {},
                streamSettings: {
                    network: "raw",
                    finalmask: { udp: [{ type: "noise", settings: { noise } }] }
                }
            };
            return { result: { multiple: true, outbounds: [outbound, obfuscator] }, notes };
        }
    }

    return { result: outbound, notes };
};

/** The outbound alone, for the callers that have nowhere to show a note. */
export const parseWireguardConfig = (text: string, mode: 'direct' | 'chained' = 'direct'): any =>
    parseWireguardConfigDetailed(text, mode).result;

const decodeBase64Safe = (b64: string): string => {
  try {
    const cleaned = b64.trim().replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(cleaned);
    try {
      return decodeURIComponent(escape(decoded));
    } catch {
      return decoded;
    }
  } catch {
    return "";
  }
};

export const parseXrayLink = (link: string): any => {
  try {
    const trimmed = link.trim();

    // --- VMess (Base64 JSON format) ---
    if (trimmed.startsWith('vmess://')) {
      const base64Part = (trimmed.substring(8).split('#')[0] ?? '').trim();
      const decoded = decodeBase64Safe(base64Part);
      if (!decoded) return null;
      const data = JSON.parse(decoded);

      const tag = data.ps || `vmess-${Math.floor(Math.random() * 1000)}`;
      const outbound: any = {
        tag: tag,
        protocol: "vmess",
        settings: {
          vnext: [{
            address: data.add,
            port: parseInt(data.port) || 443,
            users: [{
              id: data.id,
              alterId: parseInt(data.aid) || 0,
              security: data.scy || "auto",
              level: 0
            }]
          }]
        },
        streamSettings: {
          network: data.net || "tcp",
          security: data.tls || "none"
        }
      };

      const network = outbound.streamSettings.network;
      const security = outbound.streamSettings.security;

      if (security === 'tls' || security === 'reality') {
        const tlsSettings: any = {
          serverName: data.sni || data.host || data.add,
          fingerprint: data.fp || "chrome",
          alpn: data.alpn ? data.alpn.split(',').map((s: string) => s.trim()) : undefined
        };

        if (security === 'reality') {
          tlsSettings.publicKey = data.pbk || "";
          tlsSettings.shortId = data.sid || "";
          tlsSettings.spiderX = data.spx || data.path || "/";
          outbound.streamSettings.realitySettings = tlsSettings;
        } else {
          outbound.streamSettings.tlsSettings = tlsSettings;
        }
      }

      if (network === 'ws') {
        // `host`, not `headers.Host`: the header spelling loads, and every
        // supported core logs it as deprecated.
        outbound.streamSettings.wsSettings = {
          path: data.path || "/",
          ...(data.host ? { host: data.host } : {})
        };
      } else if (network === 'grpc') {
        outbound.streamSettings.grpcSettings = {
          serviceName: data.path || data.serviceName || ""
        };
      } else if (network === 'h2' || network === 'http') {
        outbound.streamSettings.httpSettings = {
          path: data.path || "/",
          host: data.host ? data.host.split(',').map((s: string) => s.trim()) : []
        };
      } else if (network === 'xhttp' || network === 'splithttp') {
        const settings = {
          path: data.path || "/",
          mode: data.mode || "auto",
          host: data.host || ""
        };
        if (network === 'xhttp') outbound.streamSettings.xhttpSettings = settings;
        else outbound.streamSettings.splithttpSettings = settings;
      } else if (network === 'httpupgrade') {
        outbound.streamSettings.httpUpgradeSettings = {
          path: data.path || "/",
          host: data.host || ""
        };
      } else if (network === 'kcp') {
        outbound.streamSettings.kcpSettings = {};
        const mask = kcpHeaderMask(data.type);
        if (mask) outbound.streamSettings.finalmask = mask;
      } else if (network === 'tcp' && data.type === 'http') {
        outbound.streamSettings.tcpSettings = {
          header: {
            type: "http",
            request: {
              version: "1.1",
              method: "GET",
              path: [data.path || "/"],
              headers: {
                Host: data.host ? data.host.split(',').map((s: string) => s.trim()) : []
              }
            }
          }
        };
      }

      return outbound;
    }

    // --- URI-based protocols (VLESS, Shadowsocks, Trojan) ---
    const url = new URL(trimmed);
    let protocol = url.protocol.replace(':', '');

    if (protocol === 'ss') {
        protocol = 'shadowsocks';
    }

    const hashPart = trimmed.includes('#') ? (trimmed.split('#')[1] ?? '') : '';
    const tag = decodeURIComponent(hashPart);
    const query = Object.fromEntries(url.searchParams.entries());

    const baseOutbound = {
      tag: tag || `${protocol}-${Math.floor(Math.random() * 1000)}`,
      protocol: protocol,
      settings: {} as Record<string, any>,
      // Transport settings are filled in per protocol below, so the literal's
      // inferred shape would be wrong from the second assignment onward.
      streamSettings: {
        network: "tcp",
        security: "none",
      } as Record<string, any>,
    };

    // --- VLESS ---
    if (protocol === 'vless') {
      baseOutbound.settings = {
        vnext: [{
          address: url.hostname,
          port: parseInt(url.port) || 443,
          users: [{
            id: url.username,
            email: "generated@xray",
            flow: query.flow || "",
            encryption: query.encryption || "none"
          }]
        }]
      };
    }
    // --- TROJAN ---
    else if (protocol === 'trojan') {
      baseOutbound.settings = {
        servers: [{
          address: url.hostname,
          port: parseInt(url.port) || 443,
          password: url.username,
          email: "generated@xray",
          level: 0
        }]
      };
    }

    // --- SHADOWSOCKS ---
    else if (protocol === 'shadowsocks') {
      let method = "";
      let password = "";
      let serverAddr = "";
      let serverPort = 443;

      // 1. Try to parse as ss://BASE64(method:password@host:port)
      const linkBody = (trimmed.split('://')[1] ?? '').split('#')[0] ?? '';

      try {
        // If it's a legacy all-in-one base64 link
        if (!linkBody.includes('@')) {
            const decoded = atob(linkBody.replace(/-/g, '+').replace(/_/g, '/'));
            if (decoded.includes('@')) {
                const [userInfo = '', hostPort = ''] = decoded.split('@');
                const [m = '', p = ''] = userInfo.split(':');
                method = m;
                password = p;
                if (hostPort.includes(':')) {
                    const [h = '', port = ''] = hostPort.split(':');
                    serverAddr = h;
                    serverPort = parseInt(port) || serverPort;
                } else {
                    serverAddr = hostPort;
                }
            }
        }
      } catch {
        // Not a full base64 link
      }

      // 2. Try SIP002 format: ss://BASE64(method:password)@host:port
      if (!serverAddr) {
        const lastAtIndex = linkBody.lastIndexOf('@');
        if (lastAtIndex !== -1) {
          const userInfoRaw = linkBody.substring(0, lastAtIndex);
          const hostPortPart = linkBody.substring(lastAtIndex + 1);
          let decodedUserInfo = "";
          try {
              decodedUserInfo = atob(userInfoRaw.replace(/-/g, '+').replace(/_/g, '/'));
          } catch {
              decodedUserInfo = userInfoRaw;
          }

          if (decodedUserInfo.includes(':')) {
              const parts = decodedUserInfo.split(':');
              method = parts[0] ?? '';
              password = parts.slice(1).join(':');
          }

          // Handle host:port?query
          const [hostPort = ''] = hostPortPart.split('?');
          if (hostPort.includes(':')) {
              const hp = hostPort.split(':');
              serverAddr = hp[0] ?? '';
              serverPort = parseInt(hp[1] ?? '') || serverPort;
          } else {
              serverAddr = hostPort;
          }
        }
      }

      baseOutbound.settings = {
        servers: [{
          address: serverAddr || url.hostname,
          port: serverPort || parseInt(url.port) || 443,
          method: method || "aes-256-gcm",
          password: password,
          // No `uot`: an ss:// link does not carry it, 26.7 and later drop the
          // key, and on 26.3 it switches on UDP-over-TCP, which a plain
          // Shadowsocks server does not speak.
        }]
      };
    } else {
        throw new Error(t("Unsupported protocol"));
    }

    // --- (Network, TLS, Reality) ---
    const network = query.type || query.net || "tcp";
    baseOutbound.streamSettings.network = network;

    if (query.security) baseOutbound.streamSettings.security = query.security;

    if (query.security === 'tls' || query.security === 'reality') {
      const tlsSettings: any = {
        serverName: query.sni || url.hostname,
        fingerprint: query.fp || "chrome",
        alpn: query.alpn ? query.alpn.split(',') : undefined
      };

      if (query.security === 'reality') {
        tlsSettings.publicKey = query.pbk;
        tlsSettings.shortId = query.sid;
        tlsSettings.spiderX = query.spx || query.path || query.serviceName || "/";
        baseOutbound.streamSettings.realitySettings = tlsSettings;
      } else {
        baseOutbound.streamSettings.tlsSettings = tlsSettings;
      }
    }

    if (network === 'ws') {
      // `host`, not `headers.Host`, which every supported core logs as deprecated.
      baseOutbound.streamSettings.wsSettings = {
          path: query.path || "/",
          ...(query.host ? { host: query.host } : {})
      };
    }
    else if (network === 'grpc') {
      baseOutbound.streamSettings.grpcSettings = { serviceName: query.serviceName || query.path || "" };
    }
    else if (network === 'h2' || network === 'http') {
      baseOutbound.streamSettings.httpSettings = {
        path: query.path || "/",
        host: query.host ? query.host.split(',').map((s: string) => s.trim()) : []
      };
    }
    else if (network === 'xhttp' || network === 'splithttp') {
      const settings = {
          path: query.path || "/",
          mode: query.mode || "auto",
          host: query.host || ""
      };
      if (network === 'xhttp') baseOutbound.streamSettings.xhttpSettings = settings;
      else baseOutbound.streamSettings.splithttpSettings = settings;
    }
    else if (network === 'httpupgrade') {
      baseOutbound.streamSettings.httpUpgradeSettings = {
        path: query.path || "/",
        host: query.host || ""
      };
    }
    else if (network === 'kcp') {
      baseOutbound.streamSettings.kcpSettings = {};
      const mask = kcpHeaderMask(query.headerType || query.type);
      if (mask) baseOutbound.streamSettings.finalmask = mask;
    }
    else if (network === 'tcp' && (query.headerType === 'http' || query.type === 'http')) {
      baseOutbound.streamSettings.tcpSettings = {
        header: {
          type: "http",
          request: {
            version: "1.1",
            method: "GET",
            path: [query.path || "/"],
            headers: {
              Host: query.host ? query.host.split(',').map((s: string) => s.trim()) : []
            }
          }
        }
      };
    }

    return baseOutbound;
  } catch (e: any) {
    console.error("Parse error:", e);
    return null;
  }
};

/**
 * Universal Subscription & Raw Links Parser
 * Handles:
 * 1. Single or Array of JSON Xray Configs
 * 2. Base64-encoded subscription containing links or JSON
 * 3. Line-by-line proxy links (vless://, vmess://, ss://, trojan://, etc.)
 * 4. Wireguard .conf text
 */
export const parseRawSubscriptionText = (text: string): any[] => {
    let clean = (text || "").trim();
    if (!clean) throw new Error(t("Input is empty"));

    // 1. Try to decode Base64 if not already JSON or plain links
    if (!clean.startsWith('{') && !clean.startsWith('[') && !clean.includes('://')) {
        try {
            const b64 = clean.replace(/\s/g, '');
            const decoded = decodeBase64Safe(b64);
            if (decoded && (decoded.includes('://') || decoded.startsWith('{') || decoded.startsWith('['))) {
                clean = decoded.trim();
            }
        } catch {}
    }

    // 2. Try JSON
    if (clean.startsWith('{') || clean.startsWith('[')) {
        try {
            const data = JSON.parse(clean);
            if (Array.isArray(data)) {
                return data.filter(c => c && typeof c === 'object');
            }
            if (data && typeof data === 'object') {
                return [data];
            }
        } catch {}
    }

    // 3. Try Wireguard .conf
    if (clean.includes('[Interface]') && clean.includes('[Peer]')) {
        const wg = parseWireguardConfig(clean);
        if (wg) {
            const outbounds = wg.multiple && wg.outbounds ? wg.outbounds : [wg];
            return [{
                remarks: t("WireGuard Configuration"),
                outbounds
            }];
        }
    }

    // 4. Try Line-by-line Links (vless://, vmess://, ss://, trojan://)
    const lines = clean.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
    const parsedOutbounds: any[] = [];

    for (const line of lines) {
        if (line.includes('://')) {
            const ob = parseXrayLink(line);
            if (ob) {
                parsedOutbounds.push(ob);
            }
        }
    }

    if (parsedOutbounds.length > 0) {
        return [{
            remarks: tn(parsedOutbounds.length, "Imported Node List ({n} node)", "Imported Node List ({n} nodes)"),
            outbounds: parsedOutbounds
        }];
    }

    throw new Error(t("Could not parse as JSON config or valid proxy links"));
};

/**
 * Парсит JSON-подписку (массив полных конфигов или объектов с remarks)
 * Возвращает массив Outbounds
 */
export const parseJsonSubscription = (jsonText: string): any[] => {
    try {
        const data = JSON.parse(jsonText);
        const outbounds: any[] = [];

        const processConfig = (conf: any) => {
            if (!conf || typeof conf !== 'object') return;

            if (Array.isArray(conf.outbounds)) {
                const proxies = conf.outbounds.filter((o: any) =>
                    !['freedom', 'dns', 'blackhole', 'direct', 'block'].includes(o.protocol)
                );

                proxies.forEach((proxy: any, idx: number) => {
                    if (conf.remarks) {
                        const baseTag = conf.remarks.trim();
                        proxy.tag = proxies.length > 1 ? `${baseTag}-${idx + 1}` : baseTag;
                    }
                    outbounds.push(proxy);
                });

                if (proxies.length === 0 && conf.outbounds.length > 0) {
                    outbounds.push(conf.outbounds[0]);
                }
            } else if (conf.protocol && conf.settings) {
                outbounds.push(conf);
            }
        };

        if (Array.isArray(data)) {
            data.forEach(processConfig);
        } else {
            processConfig(data);
        }

        return outbounds;
    } catch {
        return [];
    }
};
