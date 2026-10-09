import { t } from '../../i18n';
import { WARP_ENDPOINT } from '../presets';

export interface WarpAccount {
    id: string;
    token: string;
    privateKey: string;
    publicKey: string;
    peerPublicKey: string;
    endpoint: string;
    ipv4: string;
    ipv6: string;
    reserved: number[];
}

/**
 * Default Cloudflare WARP registration worker.
 */
const DEFAULT_WARP_ENDPOINTS = [
    'https://xcui.bropines.workers.dev/',
];

/**
 * Registers a new WARP device and returns account credentials.
 * Supports custom Cloudflare Workers and includes automatic retry with backoff on rate limits.
 */
export async function generateWarpAccount(customWorkerUrl?: string): Promise<WarpAccount> {
    const endpoints = customWorkerUrl?.trim() ? [customWorkerUrl.trim()] : DEFAULT_WARP_ENDPOINTS;
    let lastError: any;

    for (const url of endpoints) {
        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // By default use GET for standard workers, fallback to POST if needed
                let method = 'GET';
                if (url.includes('warp-generator') || url.includes('sub-aggregator')) {
                    method = 'POST';
                }

                const response = await fetch(url, {
                    method,
                    headers: {
                        'Accept': 'application/json',
                    },
                    signal: AbortSignal.timeout(12000),
                });

                const responseText = await response.text();
                let rawData: any;
                try {
                    rawData = JSON.parse(responseText);
                } catch {
                    rawData = null;
                }

                // Check for Cloudflare rate limits (HTTP 429 or CF 1015 error in 500 response)
                const isRateLimit =
                    response.status === 429 ||
                    (response.status === 500 && (responseText.includes('429') || responseText.includes('1015')));

                if (isRateLimit) {
                    if (attempt < maxRetries) {
                        // Exponential backoff
                        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
                        continue;
                    }
                    throw new Error(t("Cloudflare WARP API rate limited (Error 1015/429). Please wait a few seconds and try again."));
                }

                if (!response.ok) {
                    const message = rawData?.message || rawData?.error || responseText.substring(0, 50);
                    throw new Error(t("Worker returned {value1}: {value2}", { value1: String(response.status), value2: String(message) }));
                }

                const data = rawData?.result || (rawData?.success === true ? rawData : rawData);

                if (data && data.privKey && data.peer_pub) {
                    return {
                        id: data.id || '',
                        token: data.token || '',
                        privateKey: data.privKey,
                        publicKey: data.publicKey || '',
                        peerPublicKey: data.peer_pub,
                        endpoint: data.peer_endpoint || WARP_ENDPOINT,
                        ipv4: data.client_ipv4,
                        ipv6: data.client_ipv6,
                        reserved: data.reserved || [0, 0, 0],
                    };
                }

                throw new Error(t("Invalid worker response format. Missing keys in response."));
            } catch (e: any) {
                console.warn(`[WARP Generator] Attempt ${attempt}/${maxRetries} failed for ${url}:`, e.message);
                lastError = e;

                if (attempt < maxRetries) {
                    await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
                }
            }
        }
    }

    throw lastError || new Error(t("WARP registration failed. Please try again."));
}

/** The interface addresses a registration returned — only the families it returned. */
export const warpAddresses = (warp: Pick<WarpAccount, 'ipv4' | 'ipv6'>): string[] => [
    ...(warp.ipv4 ? [`${warp.ipv4}/32`] : []),
    ...(warp.ipv6 ? [`${warp.ipv6}/128`] : []),
];

const firstPeer = (settings: any): [any, any[]] => {
    const peers = Array.isArray(settings?.peers) && settings.peers.length > 0 ? settings.peers : [{}];
    const [first, ...rest] = peers;
    return [first && typeof first === 'object' ? first : {}, rest];
};

/**
 * WireGuard `settings` with a registered WARP account in them: the key, the
 * addresses, `reserved`, and the first peer's endpoint and public key. Only
 * what the registration decides is written — the first peer keeps its
 * allowedIPs (a profile that leaves local networks out stays that way),
 * other peers and the rest of settings (mtu, workers…) stay as they were.
 */
export const withWarpAccount = (settings: any, warp: WarpAccount) => {
    const [first, rest] = firstPeer(settings);
    return {
        ...settings,
        secretKey: warp.privateKey,
        address: warpAddresses(warp),
        reserved: warp.reserved,
        peers: [{ keepAlive: 15, ...first, endpoint: warp.endpoint, publicKey: warp.peerPublicKey }, ...rest],
    };
};

/**
 * WireGuard `settings` for a WARP profile whose registration failed: no key
 * and no peer key — the outbound's Generate WARP button registers it and
 * fills them — but Cloudflare's endpoint, so the peer is not left blank.
 */
export const withoutWarpAccount = (settings: any) => {
    const [first, rest] = firstPeer(settings);
    return {
        ...settings,
        secretKey: '',
        peers: [{ keepAlive: 15, ...first, endpoint: first.endpoint || WARP_ENDPOINT, publicKey: '' }, ...rest],
    };
};
