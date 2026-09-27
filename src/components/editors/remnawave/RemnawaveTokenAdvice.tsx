import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Icon } from '../../ui/Icon';
import {
    formatScopesForPanel,
    OVERREACHING_SCOPES,
    readScopes,
    REMNAWAVE_SCOPES,
    scopesByResource,
    type RemnawaveScope,
} from '../../../core/api/remnawave-scopes';
import { t } from '../../../i18n';

/**
 * What each resource is here for, in the terms the panel's token form uses.
 *
 * Keyed by the resource name so the prose cannot drift from the scope list: a
 * resource added to `remnawave-scopes.ts` with nothing to say about it renders
 * its own name and no more, rather than silently vanishing from this panel.
 */
const purpose = (): Record<string, string> => ({
    'config-profiles': t("Read a profile and write the edited config back. Without the write half this editor is a viewer."),
    hosts: t("Read a host to mirror it into a client outbound. The balancer builder also creates, edits and removes hosts."),
    'subscription-template': t("Read and write the XRAY JSON a subscriber's client receives."),
    snippets: t("Read snippet bodies, and write or sync one when you ask for it."),
});

const STORAGE_KEY = 'xray-ui-token-advice';

const copy = async (text: string, what: string) => {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            toast.success(what);
            return;
        }
    } catch {
        // Falls through to the same message as a blocked clipboard.
    }
    toast.error(t("Clipboard is not available here"));
};

const ScopeRow = ({ entry }: { entry: RemnawaveScope }) => (
    <li className="flex items-center gap-2 text-[10px]">
        <code
            className={`px-1.5 py-0.5 rounded border font-mono whitespace-nowrap ${
                entry.kind === 'read'
                    ? 'bg-slate-900/60 border-slate-700 text-slate-300'
                    : 'bg-amber-500/10 border-amber-500/40 text-amber-200'
            }`}
        >
            {entry.scope}
        </code>
        <span className="text-slate-500 font-mono truncate">{entry.endpoint}</span>
    </li>
);

/**
 * Which rights to put on the token before pasting it in here.
 *
 * Remnawave issues scoped tokens, and the honest version of "keep your panel
 * safe" is a list someone can act on: these scopes, nothing else, short
 * expiry. The list is derived from the client's own endpoints
 * (`core/api/remnawave-scopes.ts`), so it stays true as this app grows rather
 * than becoming advice that no longer matches what the app does.
 *
 * Open on a first visit and remembered once closed — the same bargain as
 * RemnawaveGuide, for the same reason.
 */
export const RemnawaveTokenAdvice = () => {
    const [open, setOpen] = useState(() => {
        try {
            return localStorage.getItem(STORAGE_KEY) !== 'closed';
        } catch {
            return true;
        }
    });

    const toggle = useCallback(() => {
        setOpen(prev => {
            try {
                localStorage.setItem(STORAGE_KEY, prev ? 'closed' : 'open');
            } catch {
                // Not remembering it is survivable.
            }
            return !prev;
        });
    }, []);

    const groups = scopesByResource();
    const purposes = purpose();

    return (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 mb-4">
            <button
                onClick={toggle}
                className="w-full flex items-center gap-2 px-3 py-2 text-left"
                aria-expanded={open}
            >
                <Icon name="ShieldCheck" weight="fill" className="text-amber-400 shrink-0" />
                <span className="text-xs font-bold text-amber-200">{t("Which rights this token needs")}</span>
                <Icon
                    name={open ? 'CaretUp' : 'CaretDown'}
                    weight="bold"
                    className="text-slate-500 shrink-0 text-xs ml-auto"
                />
            </button>

            {open && (
                <div className="px-3 pb-3 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                        {t("Your panel can issue a token limited to a list of scopes. This editor calls four resources and nothing else — a token scoped to them cannot read a subscriber, reach a node's shell or mint another token, even if it leaks out of this browser.")}
                    </p>

                    <div className="space-y-2.5">
                        {groups.map(group => (
                            <div key={group.resource}>
                                {/* Stacked rather than side by side: on a phone the
                                    description squeezes the resource name into a
                                    two-line hyphenated stub. */}
                                <code className="block text-[11px] font-mono font-bold text-amber-200">
                                    {group.resource}
                                </code>
                                <p className="text-[10px] text-slate-400 leading-snug">
                                    {purposes[group.resource]}
                                </p>
                                <ul className="mt-1 space-y-1">
                                    {group.scopes.map(entry => <ScopeRow key={entry.scope} entry={entry} />)}
                                </ul>
                            </div>
                        ))}
                    </div>

                    <div className="flex items-start gap-2 text-[10px] text-slate-400 leading-relaxed">
                        <Icon name="Eye" className="text-slate-500 shrink-0 mt-0.5" />
                        <span>
                            {t("Only importing configs to look at them? The plain scopes above are read-only; leave out every amber one and nothing on the panel can be changed.")}
                        </span>
                    </div>

                    <div className="flex items-start gap-2 text-[10px] text-rose-300/80 leading-relaxed">
                        <Icon name="Prohibit" className="text-rose-400 shrink-0 mt-0.5" />
                        <span>
                            {t("Never on a token for this app:")}{' '}
                            <code className="font-mono text-rose-200">{OVERREACHING_SCOPES.join('  ')}</code>
                        </span>
                    </div>

                    <div className="flex items-start gap-2 text-[10px] text-slate-400 leading-relaxed">
                        <Icon name="Clock" className="text-slate-500 shrink-0 mt-0.5" />
                        <span>
                            {t("Give it a short expiry as well. On a panel too old for scoped tokens, every token can call everything — there the expiry is the only limit you have.")}
                        </span>
                    </div>

                    <p className="text-[10px] text-slate-500 leading-relaxed pt-1">
                        {t("Copies a JSON array, which is what the scopes field wants when you create the token.")}
                    </p>

                    <div className="flex flex-col sm:flex-row gap-2">
                        <button
                            type="button"
                            onClick={() => copy(formatScopesForPanel(readScopes()), t("Read-only scopes copied"))}
                            className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg border border-slate-700 bg-slate-900 text-[11px] font-bold text-slate-300 hover:border-slate-500 transition-colors"
                        >
                            <Icon name="Copy" />
                            {t("Copy read-only")}
                        </button>
                        <button
                            type="button"
                            onClick={() => copy(formatScopesForPanel(REMNAWAVE_SCOPES), t("Scopes copied"))}
                            className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg border border-amber-500/40 bg-amber-500/10 text-[11px] font-bold text-amber-200 hover:border-amber-400 transition-colors"
                        >
                            <Icon name="Copy" />
                            {t("Copy all {count}", { count: REMNAWAVE_SCOPES.length })}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
