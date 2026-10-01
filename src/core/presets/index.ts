export {
    RUSSIAN_DOMAINS,
    LEAK_CHECK_DOMAINS,
    DEFAULT_BYPASS_DOMAINS,
    BYPASS_LISTS,
    splitBypassDomains,
    composeBypassDomains,
} from './bypass-domains';
export type { BypassList } from './bypass-domains';
export {
    DNS_RESOLVERS,
    DEFAULT_DNS_UPSTREAM,
    DEFAULT_QUERY_STRATEGY,
    DEFAULT_DNS_TAG,
    createDefaultDns,
    matchResolverPreset,
} from './dns';
export type { DnsResolverPreset } from './dns';
export {
    getNoisePresets,
    noiseItems,
    noiseMask,
    matchNoisePreset,
    withNoisePreset,
} from './noise';
export type { NoiseItem, NoisePreset, NoisePresetId } from './noise';

import { generateUUID, generateRealityKeyPair } from '../generators/crypto';
import { DEFAULT_DNS_UPSTREAM, DEFAULT_QUERY_STRATEGY } from './dns';
import { noiseMask } from './noise';
import type { XrayConfig } from '../types';
import { t } from '../../i18n';

export interface Preset {
    name: string;
    description: string;
    icon: string;
    config: Partial<XrayConfig>;
}

/** Cloudflare's WARP peer — what a registration hands back, and where a profile without one points. */
export const WARP_ENDPOINT = 'engage.cloudflareclient.com:2408';

const AWG_WARP_BASE = {
    tag: 'warp-amnezia',
    protocol: 'wireguard',
    settings: {
        secretKey: '', // Users must generate this later
        address: ['10.0.0.1/32', 'fd00::1/128'],
        mtu: 1280,
        reserved: [0, 0, 0], // Replaced by S1/S2 later if needed
        peers: [{
            endpoint: WARP_ENDPOINT,
            publicKey: '', // Users must generate this later
            keepAlive: 15,
            allowedIPs: ['0.0.0.0/0', '::/0']
        }]
    },
    streamSettings: {
        network: 'raw',
        finalmask: {
            udp: [] as any[]
        }
    }
};

export const getPresets = (): Preset[] => {
    const keys = generateRealityKeyPair();

    return [
        {
            name: 'WARP Profile A',
            description: t("Cloudflare WARP connectivity with standard AmneziaWG optimization."),
            icon: 'Cloud',
            config: {
                log: { loglevel: 'warning' },
                dns: { servers: [...DEFAULT_DNS_UPSTREAM], queryStrategy: DEFAULT_QUERY_STRATEGY },
                inbounds: [{ tag: 'socks-in', port: 10808, listen: '127.0.0.1', protocol: 'socks', settings: { auth: 'noauth', udp: true } }],
                outbounds: [
                    {
                        ...AWG_WARP_BASE,
                        tag: 'warp-a',
                        streamSettings: {
                            network: 'raw',
                            finalmask: {
                                udp: [noiseMask('warp-a')]
                            }
                        }
                    },
                    { tag: 'direct', protocol: 'freedom', settings: {} },
                ],
                routing: { domainStrategy: 'AsIs', rules: [{ type: 'field', outboundTag: 'warp-a', network: 'tcp,udp' }] },
            }
        },
        {
            name: 'WARP Profile B',
            description: t("Cloudflare WARP connectivity with alternative AmneziaWG optimization."),
            icon: 'CloudCheck',
            config: {
                log: { loglevel: 'warning' },
                dns: { servers: [...DEFAULT_DNS_UPSTREAM], queryStrategy: DEFAULT_QUERY_STRATEGY },
                inbounds: [{ tag: 'socks-in', port: 10808, listen: '127.0.0.1', protocol: 'socks', settings: { auth: 'noauth', udp: true } }],
                outbounds: [
                    {
                        ...AWG_WARP_BASE,
                        tag: 'warp-b',
                        streamSettings: {
                            network: 'raw',
                            finalmask: {
                                udp: [noiseMask('warp-b')]
                            }
                        }
                    },
                    { tag: 'direct', protocol: 'freedom', settings: {} },
                ],
                routing: { domainStrategy: 'AsIs', rules: [{ type: 'field', outboundTag: 'warp-b', network: 'tcp,udp' }] },
            }
        },
        {
            name: 'WARP Profile C',
            description: t("Cloudflare WARP connectivity with aggressive AmneziaWG optimization."),
            icon: 'CloudFog',
            config: {
                log: { loglevel: 'warning' },
                dns: { servers: [...DEFAULT_DNS_UPSTREAM], queryStrategy: DEFAULT_QUERY_STRATEGY },
                inbounds: [{ tag: 'socks-in', port: 10808, listen: '127.0.0.1', protocol: 'socks', settings: { auth: 'noauth', udp: true } }],
                outbounds: [
                    {
                        ...AWG_WARP_BASE,
                        tag: 'warp-c',
                        streamSettings: {
                            network: 'raw',
                            finalmask: {
                                udp: [noiseMask('warp-c')]
                            }
                        }
                    },
                    { tag: 'direct', protocol: 'freedom', settings: {} },
                ],
                routing: { domainStrategy: 'AsIs', rules: [{ type: 'field', outboundTag: 'warp-c', network: 'tcp,udp' }] },
            }
        },
        {
            name: 'Minimal (Skeleton)',
            description: t("Basic structure with Direct & Block outbounds. Best for starting from scratch."),
            icon: 'Square',
            config: {
                log: { loglevel: 'warning' },
                inbounds: [],
                outbounds: [
                    { tag: 'direct', protocol: 'freedom', settings: {} },
                    { tag: 'block', protocol: 'blackhole', settings: {} },
                ],
                routing: {
                    domainStrategy: 'AsIs',
                    rules: [],
                    balancers: [],
                },
            },
        },
        {
            name: 'Standard Client',
            description: t("Socks5/HTTP inbounds + VLESS Proxy. Includes basic routing rules."),
            icon: 'Laptop',
            config: {
                log: { loglevel: 'warning' },
                dns: {
                    servers: ['1.1.1.1', '8.8.8.8', 'localhost'],
                    queryStrategy: 'UseIP',
                },
                inbounds: [
                    {
                        tag: 'socks-in',
                        port: 10808,
                        listen: '127.0.0.1',
                        protocol: 'socks',
                        sniffing: { enabled: true, destOverride: ['http', 'tls'] },
                        settings: { auth: 'noauth', udp: true },
                    },
                    {
                        tag: 'http-in',
                        port: 10809,
                        listen: '127.0.0.1',
                        protocol: 'http',
                        sniffing: { enabled: true, destOverride: ['http', 'tls'] },
                        settings: { allowTransparent: false },
                    },
                ],
                outbounds: [
                    {
                        tag: 'proxy',
                        protocol: 'vless',
                        settings: {
                            vnext: [{
                                address: 'example.com',
                                port: 443,
                                users: [{ id: generateUUID(), encryption: 'none', flow: 'xtls-rprx-vision' }],
                            }],
                        },
                        streamSettings: {
                            network: 'tcp',
                            security: 'tls',
                            tlsSettings: { serverName: 'example.com', fingerprint: 'chrome' },
                        },
                    },
                    { tag: 'direct', protocol: 'freedom', settings: {} },
                    { tag: 'block', protocol: 'blackhole', settings: {} },
                ],
                routing: {
                    domainStrategy: 'IPIfNonMatch',
                    rules: [
                        { type: 'field', outboundTag: 'block', domain: ['geosite:category-ads-all'] },
                        { type: 'field', outboundTag: 'direct', domain: ['geosite:cn'] },
                        { type: 'field', outboundTag: 'direct', ip: ['geoip:cn', 'geoip:private'] },
                        { type: 'field', outboundTag: 'proxy', network: 'tcp,udp' },
                    ],
                },
            },
        },
        {
            name: 'Reality Server',
            description: t("VLESS-Reality Inbound configuration for server side."),
            icon: 'HardDrives',
            config: {
                log: {
                    loglevel: 'warning',
                    access: '/var/log/xray/access.log',
                    error: '/var/log/xray/error.log',
                },
                inbounds: [
                    {
                        tag: 'vless-reality',
                        port: 443,
                        protocol: 'vless',
                        settings: {
                            clients: [{ id: generateUUID(), flow: 'xtls-rprx-vision', email: 'user1' }],
                            decryption: 'none',
                            fallbacks: [],
                        },
                        streamSettings: {
                            network: 'tcp',
                            security: 'reality',
                            realitySettings: {
                                show: false,
                                dest: 'www.google.com:443',
                                serverNames: ['www.google.com', 'google.com'],
                                privateKey: keys.privateKey,
                                shortIds: ['', Math.random().toString(16).substring(2, 10)],
                            },
                        },
                        sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] },
                    },
                ],
                outbounds: [
                    { tag: 'direct', protocol: 'freedom', settings: {} },
                    { tag: 'block', protocol: 'blackhole', settings: {} },
                ],
            },
        },
    ];
};
