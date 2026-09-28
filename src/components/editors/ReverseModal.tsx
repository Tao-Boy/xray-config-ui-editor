import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { JsonField } from '../ui/JsonField';
import { useReverseEditor } from '../../hooks/useReverseEditor';
import { useCoreVersion } from '../../hooks/useCoreVersion';
import { useConfigStore } from '../../store/configStore';
import { t } from '../../i18n';

/**
 * The top-level `reverse` section: legacy bridges and portals.
 *
 * 26.3 runs it (v26.3.27:infra/conf/reverse.go:32). From 26.7 `Config.Build`
 * answers any non-null `reverse` — even `{}` — with PrintRemovedFeatureError
 * pointing at VLESS reverse proxy (v26.7.28:infra/conf/xray.go:607,
 * v26.9.9:infra/conf/xray.go:605), and the config does not load. So on those
 * lines this screen does not offer to build one; it shows what the config
 * has, why it stops the node, and a Remove that takes the section out whole.
 * Nothing is removed without that press.
 */
export const ReverseModal = ({ onClose }: any) => {
    const {
        reverse,
        hasReverse,
        activeTab,
        setActiveTab,
        addItem,
        removeItem,
        updateItem,
        updateReverse,
        removeReverse,
    } = useReverseEditor();
    const { statusAt, tag: coreTag } = useCoreVersion();
    const refused = statusAt('config', 'reverse') === 'rejected';

    const [rawMode, setRawMode] = useState(false);
    const [localRawText, setLocalRawText] = useState<string | null>(null);
    const rawConfigText = useConfigStore(state => state.rawConfigText);

    // --- JSON MODE VIEW ---
    // On a refusing line it is there to inspect a section that exists, not
    // to start one: the button is only offered when there is something to see.
    if (rawMode && (!refused || hasReverse)) {
        return (
            <Modal
                title={t("Reverse Proxy (JSON)")}
                onClose={onClose}
                onSave={() => onClose()}
                extraButtons={<Button variant="secondary" className="text-xs py-1" onClick={() => setRawMode(false)} icon="Layout">{t("Form Mode")}</Button>}
            >
                <div className="flex-1 min-h-0 md:flex-none md:h-[500px] flex flex-col gap-2">
                    <div className="bg-slate-800/50 border border-slate-700/50 p-2 rounded text-[10px] text-slate-400 font-mono">
                        {t("This editor edits the reverse root section directly.")}
                    </div>
                    <JsonField
                        label={t("Reverse Proxy Configuration")}
                        value={reverse}
                        onChange={(val: any, raw?: string) => {
                            updateReverse(val, raw);
                            if (raw !== undefined) setLocalRawText(raw);
                        }}
                        className="flex-1"
                        schemaMode="reverse"
                        rawText={localRawText}
                        rawConfigText={rawConfigText}
                        onSaveShortcut={() => useConfigStore.getState().saveActiveProfile()}
                        onCommitShortcut={() => useConfigStore.getState().recordSnapshot("Manual Commit (Ctrl+Shift+S)")}
                    />
                </div>
            </Modal>
        );
    }

    // --- REFUSED: 26.7 and later ---
    if (refused) {
        const bridges: any[] = Array.isArray(reverse.bridges) ? reverse.bridges : [];
        const portals: any[] = Array.isArray(reverse.portals) ? reverse.portals : [];
        const tagsOf = (list: any[]) => list.map(item => item?.tag || '—').join(', ');
        return (
            <Modal
                title={t("Reverse Proxy")}
                onClose={onClose}
                onSave={() => onClose()}
                className="md:max-w-[800px]"
                extraButtons={hasReverse ? (
                    <div className="flex gap-2 w-full md:w-auto">
                        <Button variant="danger" className="text-xs py-1 shrink-0" onClick={removeReverse} icon="Trash">
                            {t("Remove the reverse section")}
                        </Button>
                        <Button variant="secondary" className="text-xs py-1 shrink-0" onClick={() => setRawMode(true)} icon="Code">JSON</Button>
                    </div>
                ) : null}
            >
                <div className="max-w-2xl mx-auto w-full flex-1 min-h-0 md:flex-none overflow-y-auto custom-scroll p-1 space-y-4">
                    <div className="p-5 bg-rose-950/20 border border-rose-500/30 rounded-2xl space-y-3">
                        <h4 className="font-bold flex items-center gap-2 text-sm text-rose-300">
                            <Icon name="WarningOctagon" weight="fill" className="text-lg shrink-0" />
                            {t("Legacy reverse is refused by Xray {tag}", { tag: coreTag })}
                        </h4>
                        <p className="text-xs text-rose-100/80 leading-relaxed">
                            {t("Bridges and portals were removed in 26.7. Any reverse section — even an empty one — stops the config from loading, and the core's error points at VLESS reverse proxy.")}
                        </p>
                        <p className="text-xs text-slate-400 leading-relaxed">
                            {t("VLESS reverse proxy replaces it: the server gives a VLESS client a reverse tag, and the far end dials in with a VLESS outbound carrying settings.reverse. This editor does not build that yet.")}
                        </p>
                    </div>

                    {hasReverse ? (
                        <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
                            <h4 className="label-xs">{t("What this config has")}</h4>
                            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
                                <dt className="text-slate-500">{t("Bridges")}</dt>
                                <dd className="font-mono text-slate-300 break-all">{bridges.length ? tagsOf(bridges) : '—'}</dd>
                                <dt className="text-slate-500">{t("Portals")}</dt>
                                <dd className="font-mono text-slate-300 break-all">{portals.length ? tagsOf(portals) : '—'}</dd>
                            </dl>
                            <p className="text-[11px] text-slate-500 leading-relaxed">
                                {t("Removing the section is what lets this config load on {tag}. To keep editing it instead, set the target Xray version to 26.3 in Settings.", { tag: coreTag })}
                            </p>
                        </div>
                    ) : (
                        <p className="text-center py-10 bg-slate-950/50 border border-dashed border-slate-800 rounded-2xl text-slate-500 text-sm">
                            {t("This config has no reverse section, and nothing here will add one.")}
                        </p>
                    )}
                </div>
            </Modal>
        );
    }

    const renderList = (type: 'bridges' | 'portals') => (
        <div className="space-y-4">
            {(reverse[type] || []).map((item: any, i: number) => (
                <div key={i} className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex flex-col md:flex-row items-end gap-4 relative group shadow-lg">
                    <div className="flex-1 w-full">
                        <label className="label-xs text-indigo-400">{t("Tag")}</label>
                        <input className="input-base"
                            placeholder={t("e.g. reverse-tag")}
                            value={item.tag}
                            onChange={e => updateItem(type, i, 'tag', e.target.value)}
                        />
                    </div>
                    <div className="flex-1 w-full">
                        <label className="label-xs text-indigo-400">{t("Domain")}</label>
                        <input className="input-base font-mono"
                            placeholder={t("e.g. portal.example.com")}
                            value={item.domain}
                            onChange={e => updateItem(type, i, 'domain', e.target.value)}
                        />
                    </div>
                    <button
                        onClick={() => removeItem(type, i)}
                        className="bg-rose-500/10 border border-rose-500/20 p-2.5 rounded-xl text-rose-500 hover:bg-rose-500 hover:text-white transition-all shadow-sm"
                        title={t("Delete")}
                    >
                        <Icon name="Trash" weight="bold" />
                    </button>
                </div>
            ))}
            {(reverse[type] || []).length === 0 && (
                <div className="text-center py-16 bg-slate-950/50 border border-dashed border-slate-800 rounded-2xl text-slate-500 text-sm">
                    <Icon name="ArrowsLeftRight" className="text-3xl mx-auto mb-3 opacity-20" />
                    No {type} configured yet.
                </div>
            )}
            <Button variant="secondary" className="w-full h-12 rounded-xl border-dashed border-2 border-slate-800 hover:border-indigo-500/50" onClick={() => addItem(type)} icon="Plus">
                Add New {type === 'bridges' ? 'Bridge' : 'Portal'}
            </Button>
        </div>
    );

    return (
        <Modal
            title={t("Reverse Proxy")}
            onClose={onClose}
            onSave={() => onClose()}
            className="md:max-w-[800px]"
            extraButtons={
                <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0 hide-scrollbar">
                    <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 shrink-0">
                        <button onClick={() => setActiveTab('bridges')} className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${activeTab === 'bridges' ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-white'}`}>{t("Bridges")}</button>
                        <button onClick={() => setActiveTab('portals')} className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${activeTab === 'portals' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'}`}>{t("Portals")}</button>
                    </div>
                    <Button variant="secondary" className="text-xs py-1 shrink-0" onClick={() => setRawMode(true)} icon="Code">JSON</Button>
                </div>
            }
        >
            <div className="max-w-2xl mx-auto w-full flex-1 min-h-0 md:flex-none md:h-[500px] overflow-y-auto custom-scroll p-1">
                {/* Accepted here, refused from 26.7: say so before anyone builds on it. */}
                <div className="mb-4 p-3 bg-amber-950/20 border border-amber-500/30 rounded-xl text-[11px] text-amber-200/80 leading-relaxed flex gap-2">
                    <Icon name="Warning" weight="fill" className="text-amber-400 shrink-0 mt-0.5" />
                    <span>{t("Works on 26.3 only. From 26.7 any reverse section stops the config from loading — VLESS reverse proxy replaces it.")}</span>
                </div>

                {activeTab === 'bridges' && renderList('bridges')}
                {activeTab === 'portals' && renderList('portals')}

                <div className="mt-8 p-5 bg-indigo-900/20 border border-indigo-500/30 rounded-2xl text-xs text-indigo-100 shadow-xl">
                    <h4 className="font-bold flex items-center gap-2 mb-3 text-sm text-indigo-300">
                        <Icon name="Info" weight="fill" className="text-lg" />
                        {t("Internal Logic")}
                        </h4>
                    <div className="space-y-3 opacity-90 leading-relaxed">
                        <p>
                            <b className="text-indigo-300 uppercase tracking-wider text-[10px]">{t("Bridge:")}</b>
{t("The active end (behind NAT). Initiates connection to the Portal.")}
</p>
                        <p>
                            <b className="text-indigo-300 uppercase tracking-wider text-[10px]">{t("Portal:")}</b>
{t("The passive end (public server). Listens for and accepts Bridge connections.")}
</p>
                        <div className="pt-2 border-t border-indigo-500/20 text-[10px] text-indigo-400/80 italic">
                            {t("Traffic flow: User → Portal (Passive) ↔ Bridge (Active) → Target Service.")}
                            </div>
                    </div>
                </div>
            </div>
        </Modal>
    );
};
