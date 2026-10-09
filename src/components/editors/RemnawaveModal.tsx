import React from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Checkbox } from '../ui/Checkbox';
import { useRemnawaveEditor } from '../../hooks/useRemnawaveEditor';
import { RemnawaveTokenAdvice } from './remnawave/RemnawaveTokenAdvice';
import { t } from '../../i18n';

export const RemnawaveModal = ({ onClose }: { onClose: () => void }) => {
    const {
        remnawave,
        step,
        setStep,
        loading,
        url,
        setUrl,
        apiToken,
        setApiToken,
        remember,
        setRemember,
        profiles,
        handleRefreshProfiles,
        handleConnect,
        handleSelectProfile,
        disconnectRemnawave,
        accounts,
        activeAccountId,
        handleSwitchAccount,
        handleForgetAccount,
        renameRemnawaveAccount,
    } = useRemnawaveEditor(onClose);

    // Which saved panel is having its name changed, if any.
    const [renaming, setRenaming] = React.useState<string | null>(null);
    const [draftLabel, setDraftLabel] = React.useState('');

    const activePanel = accounts.find(account => account.id === activeAccountId);

    const savedPanels = accounts.length > 0 && (
        <div className="mb-6">
            <h3 className="label-xs mb-2">{t("Saved panels")}</h3>
            <div className="space-y-1.5">
                {accounts.map(account => {
                    const isActive = account.id === activeAccountId;
                    if (renaming === account.id) {
                        return (
                            <div key={account.id} className="flex items-center gap-2">
                                <input
                                    autoFocus
                                    className="input-base text-xs"
                                    value={draftLabel}
                                    onChange={e => setDraftLabel(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                            renameRemnawaveAccount(account.id, draftLabel);
                                            setRenaming(null);
                                        }
                                        if (e.key === 'Escape') setRenaming(null);
                                    }}
                                />
                                <Button
                                    variant="secondary"
                                    className="text-xs py-1.5 shrink-0"
                                    onClick={() => { renameRemnawaveAccount(account.id, draftLabel); setRenaming(null); }}
                                >
                                    {t("Save")}
                                </Button>
                            </div>
                        );
                    }
                    return (
                        <div
                            key={account.id}
                            className={`flex items-center gap-2 rounded-xl border px-3 py-2 transition-all ${
                                isActive
                                    ? 'bg-indigo-600/20 border-indigo-500'
                                    : 'bg-slate-900 border-slate-800 hover:border-slate-600'
                            }`}
                        >
                            <button
                                type="button"
                                onClick={() => handleSwitchAccount(account.id)}
                                className="flex-1 min-w-0 text-left"
                                title={account.url}
                            >
                                <div className={`text-sm truncate ${isActive ? 'text-white font-bold' : 'text-slate-300'}`}>
                                    {account.label}
                                </div>
                                <div className="text-[10px] text-slate-500 font-mono truncate">{account.url}</div>
                                {/* A panel whose token was not kept is still one tap away — it
                                    just needs the token typed again, and saying so up front
                                    beats a failed connection. */}
                                {!account.token && (
                                    <div className="text-[10px] text-amber-400/80 flex items-center gap-1 mt-0.5">
                                        <Icon name="Key" className="text-[9px]" />
                                        {t("token not stored — paste it again")}
                                    </div>
                                )}
                            </button>
                            {isActive && <Icon name="CheckCircle" weight="fill" className="text-emerald-400 shrink-0" />}
                            <button
                                type="button"
                                onClick={() => { setRenaming(account.id); setDraftLabel(account.label); }}
                                title={t("Rename")}
                                className="p-2 rounded-lg text-slate-600 hover:text-indigo-300 hover:bg-slate-800/60 shrink-0 transition-colors"
                            >
                                <Icon name="PencilSimple" className="text-sm" />
                            </button>
                            <button
                                type="button"
                                onClick={() => handleForgetAccount(account.id)}
                                title={t("Forget this panel")}
                                className="p-2 rounded-lg text-slate-600 hover:text-rose-400 hover:bg-slate-800/60 shrink-0 transition-colors"
                            >
                                <Icon name="Trash" className="text-sm" />
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );

    return (
        <Modal
            title={step === 'login' ? t("Connect Remnawave") : t("Select Profile")}
            onClose={onClose}
            className="max-w-md"
            onSave={onClose}
        >
            <div className="space-y-5">
                {step === 'login' ? (
                    <div className="animate-in fade-in duration-300">
                        {savedPanels}
                        <div className="bg-slate-800/40 p-3 rounded-xl border border-slate-700 text-[11px] text-slate-400 mb-3 flex gap-3">
                            <Icon name="Key" className="text-xl shrink-0 text-slate-500" />
                            <p> {t("Password login is disabled. Use the API token from your panel settings.")}
</p>
                        </div>

                        <RemnawaveTokenAdvice />

                        <div className="space-y-4">
                            <div>
                                <label className="label-xs">{t("Panel URL")}</label>
                                <input className="input-base"
                                    placeholder="https://panel.example.com"
                                    value={url} onChange={e => setUrl(e.target.value)}
                                />
                            </div>

                            <div>
                                <label className="label-xs">{t("API Token")}</label>
                                <input className="input-base font-mono text-xs"
                                    type="password"
                                    placeholder={t("Paste your token here...")}
                                    value={apiToken} onChange={e => setApiToken(e.target.value)}
                                />
                            </div>

                            <Checkbox
                                checked={remember}
                                onChange={setRemember}
                                label={t("Remember this token")}
                                description={t("Off, the token lives only until this tab is closed — the panel stays on the list and asks for it again. On, it is written to this browser's storage as plain text, readable by anything that can reach the profile.")}
                            />

                            <Button className="w-full mt-2 py-3" onClick={handleConnect} disabled={loading}>
                                {loading ? <Icon name="Spinner" className="animate-spin" /> : t("Connect & Fetch Profiles")}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="animate-in slide-in-from-right-4 duration-300">
                        {activePanel && (
                            <div className="flex items-center gap-2 mb-4 text-[11px] text-slate-400">
                                <Icon name="CloudCheck" weight="fill" className="text-emerald-400" />
                                <span className="font-bold text-slate-300 truncate">{activePanel.label}</span>
                                {accounts.length > 1 && (
                                    <button
                                        type="button"
                                        onClick={() => setStep('login')}
                                        className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2 shrink-0"
                                    >
                                        {t("switch")}
                                    </button>
                                )}
                            </div>
                        )}

                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">{t("Available Profiles")}</h3>
                            <button onClick={handleRefreshProfiles} className="p-1 hover:bg-slate-800 rounded transition-colors text-indigo-400">
                                <Icon name="ArrowsClockwise" className={loading ? "animate-spin" : ""} />
                            </button>
                        </div>

                        <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scroll pr-1">
                            {profiles.map(p => (
                                <div key={p.uuid}
                                    onClick={() => handleSelectProfile(p.uuid)}
                                    className={`p-3 border rounded-xl cursor-pointer transition-all flex justify-between items-center group
                                        ${remnawave.activeProfileUuid === p.uuid
                                            ? 'bg-indigo-600/20 border-indigo-500 shadow-[0_0_15px_rgba(79,70,229,0.1)]'
                                            : 'bg-slate-900 border-slate-800 hover:border-slate-600'}
                                    `}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`w-2 h-2 rounded-full ${remnawave.activeProfileUuid === p.uuid ? 'bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.6)]' : 'bg-slate-700'}`}></div>
                                        <span className={`font-mono text-sm ${remnawave.activeProfileUuid === p.uuid ? 'text-white font-bold' : 'text-slate-300'}`}>
                                            {p.name}
                                        </span>
                                    </div>
                                    {remnawave.activeProfileUuid === p.uuid ? (
                                        <Icon name="CheckCircle" weight="fill" className="text-emerald-400" />
                                    ) : (
                                        <Icon name="ArrowRight" className="text-slate-600 md:opacity-0 md:group-hover:opacity-100 transition-opacity" />
                                    )}
                                </div>
                            ))}
                        </div>

                        <div className="mt-6 pt-4 border-t border-slate-800 flex justify-between gap-3">
                             <Button variant="ghost" onClick={() => disconnectRemnawave()} className="text-xs text-rose-400 hover:bg-rose-500/10">
                                <Icon name="LinkBreak" />
{t("Disconnect")}
</Button>
                             <Button variant="secondary" onClick={() => setStep('login')} className="text-xs">
                                <Icon name="UserSwitch" />
{t("Change URL")}
</Button>
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    );
};
