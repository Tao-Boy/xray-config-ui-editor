import { t } from '../../../i18n';

/**
 * The eleven values `DomainStrategy` takes, as `xray.go` spells them.
 *
 * One list, two choosers: the outbound's own `targetStrategy` and freedom's
 * `targetStrategy`/`domainStrategy`, which the core folds into
 * `sockopt.domainStrategy` anyway. WireGuard has its own, shorter list — see
 * `wireguard-strategies.ts` — because the core matches that one separately and
 * refuses everything outside it.
 *
 * `Use*` resolves and connects by IP, falling back to the domain when nothing
 * resolves; `Force*` fails instead of falling back.
 */
export const DOMAIN_STRATEGY_OPTIONS = (): { value: string; label: string; description?: string }[] => [
    { value: 'AsIs', label: t("AsIs (Default)"), description: t("Leave domain as is without prior resolution") },
    { value: 'UseIP', label: 'UseIP', description: t("Resolve and connect via IP") },
    { value: 'UseIPv4', label: 'UseIPv4', description: t("Resolve and prefer IPv4 only") },
    { value: 'UseIPv6', label: 'UseIPv6', description: t("Resolve and prefer IPv6 only") },
    { value: 'UseIPv4v6', label: 'UseIPv4v6', description: t("Prefer IPv4, fallback to IPv6") },
    { value: 'UseIPv6v4', label: 'UseIPv6v4', description: t("Prefer IPv6, fallback to IPv4") },
    { value: 'ForceIP', label: 'ForceIP', description: t("Enforce IP connection (fails if unresolved)") },
    { value: 'ForceIPv4', label: 'ForceIPv4', description: t("Enforce IPv4 connection") },
    { value: 'ForceIPv6', label: 'ForceIPv6', description: t("Enforce IPv6 connection") },
    { value: 'ForceIPv4v6', label: 'ForceIPv4v6', description: t("Enforce IPv4, fallback to IPv6") },
    { value: 'ForceIPv6v4', label: 'ForceIPv6v4', description: t("Enforce IPv6, fallback to IPv4") },
];
