import { t } from '../../../i18n';

export interface NetworkOption {
    value: string;
    label: string;
    description?: string;
}

/**
 * Transports the core still builds, plus whatever the config already says.
 *
 * `transport_internet.go` maps a network name to a transport and answers with
 * a removed-feature error for two of them:
 *
 *   case "h2", "h3", "http": PrintRemovedFeatureError("HTTP transport", "XHTTP stream-one H2 & H3")
 *   case "quic":             PrintRemovedFeatureError("QUIC transport",  "XHTTP stream-one H3")
 *
 * Those are not ignored the way an unknown field is — the config does not
 * load. They were in this chooser as ordinary options, so picking one was a
 * config the core refuses. Now they appear only when a config already has
 * one, labelled for what they are, so an imported config still shows what it
 * holds instead of an empty chooser.
 *
 * `masque` is the other way round: the core allows the masque transport only
 * on the masque outbound, and that outbound uses no other, so it is offered
 * there and nowhere else.
 */
const REMOVED: Record<string, string> = {
    http: 'XHTTP (stream-one H2/H3)',
    h2: 'XHTTP (stream-one H2/H3)',
    h3: 'XHTTP (stream-one H3)',
    quic: 'XHTTP (stream-one H3)',
};

export const isRemovedNetwork = (network: string | undefined): boolean =>
    !!network && network in REMOVED;

export const networkOptions = (protocol: string | undefined, current: string | undefined): NetworkOption[] => {
    const options: NetworkOption[] = [
        { value: 'tcp', label: 'TCP', description: t("Standard reliable stream") },
        { value: 'raw', label: t("RAW"), description: t("Raw socket access") },
        { value: 'xhttp', label: t("XHTTP"), description: t("Next-gen HTTP transport") },
        { value: 'splithttp', label: t("SplitHTTP"), description: t("High-performance split stream") },
        { value: 'ws', label: t("WebSocket"), description: t("Standard web transport") },
        { value: 'httpupgrade', label: t("HTTP Upgrade"), description: t("Modern WebSocket alternative") },
        { value: 'grpc', label: t("gRPC"), description: t("Modern RPC framework") },
        { value: 'kcp', label: t("mKCP"), description: t("Aggressive UDP transport") },
        { value: 'hysteria', label: t("Hysteria"), description: t("QUIC-based, with its own congestion control") },
    ];

    if (protocol === 'masque') {
        options.push({ value: 'masque', label: 'MASQUE', description: t("CONNECT-IP over HTTP/3 — only the masque outbound may use it") });
    }

    if (current && REMOVED[current]) {
        options.push({
            value: current,
            label: current.toUpperCase(),
            description: t("Removed from Xray — use {replacement}", { replacement: REMOVED[current] }),
        });
    }

    return options;
};
