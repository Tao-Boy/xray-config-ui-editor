import React, { useState } from 'react';
import { Modal, ModalBottomBar } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Help } from '../../ui/Help';
import { NoiseStepList } from './NoiseStepList';
import { TemplateFields } from './TemplateFields';
import { HexDump } from './HexDump';
import { useNoiseGenerator } from '../../../hooks/useNoiseGenerator';
import type { Note } from '../../../core/noise/types';
import { t, tn } from '../../../i18n';

/**
 * The decoy datagrams a finalmask `noise` layer sends, built from templates
 * rather than pasted as hex.
 *
 * Why this exists: the packets this app shipped as presets were one fixed
 * copy each — the SIP one is the worked example straight out of RFC 3261, the
 * same bytes for every user of this editor, which is a signature rather than
 * a disguise. Everything here is drawn per config instead.
 *
 * `onApply` receives the noise items and the layer's `reset`; nothing else in
 * this screen reaches the config. The parameters behind each packet live for
 * as long as the modal is open and are not written anywhere — a config holds
 * bytes, and reopening this screen reads them back as raw bytes.
 */

const TONE: Record<Note['severity'], { box: string; icon: string; color: string }> = {
    critical: { box: 'border-rose-500/40 bg-rose-950/20 text-rose-200/90', icon: 'WarningOctagon', color: 'text-rose-400' },
    warning: { box: 'border-amber-500/40 bg-amber-950/20 text-amber-200/90', icon: 'Warning', color: 'text-amber-400' },
    info: { box: 'border-blue-500/30 bg-blue-950/20 text-blue-200/90', icon: 'Info', color: 'text-blue-400' },
};

const Notes = ({ notes }: { notes: Note[] }) => {
    if (notes.length === 0) return null;
    const rank = { critical: 0, warning: 1, info: 2 };
    const sorted = [...notes].sort((a, b) => rank[a.severity] - rank[b.severity]);
    return (
        <div className="space-y-1.5">
            {sorted.map((note, i) => (
                <div key={i} className={`flex gap-2 p-2.5 rounded-lg border text-[11px] ${TONE[note.severity].box}`}>
                    <Icon name={TONE[note.severity].icon} weight="fill" className={`shrink-0 mt-0.5 ${TONE[note.severity].color}`} />
                    <div>{note.message}</div>
                </div>
            ))}
        </div>
    );
};

/** The AmneziaWG side of the same recipe, for pasting into an AWG client. */
const AwgView = ({ generator }: { generator: ReturnType<typeof useNoiseGenerator> }) => {
    const { awg } = generator;
    const lines = [
        ...(awg.junk ? [`Jc = ${awg.junk.count}`, `Jmin = ${awg.junk.min}`, `Jmax = ${awg.junk.max}`] : []),
        ...awg.iLines.map((spec, at) => `I${at + 1} = ${spec}`),
    ];
    return (
        <div className="space-y-3">
            <p className="text-[11px] text-slate-400 leading-relaxed">
                {t("The same decoys as AmneziaWG writes them. These lines go in the [Interface] section of a .conf, beside the keys. The rest of the profile — addresses, peer, MTU — comes from the outbound itself; export the whole thing from the outbound's menu.")}
            </p>
            {lines.length === 0 ? (
                <div className="text-[11px] text-slate-600 italic py-4 text-center">{t("Nothing to send yet.")}</div>
            ) : (
                <>
                    <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-[11px] font-mono text-emerald-300/80 overflow-x-auto custom-scroll whitespace-pre">{lines.join('\n')}</pre>
                    <Button variant="secondary" size="sm" icon="Copy" onClick={() => navigator.clipboard?.writeText(lines.join('\n'))}>
                        {t("Copy")}
                    </Button>
                </>
            )}
            <Notes notes={awg.notes} />
        </div>
    );
};

const JunkFields = ({ generator, index }: { generator: ReturnType<typeof useNoiseGenerator>; index: number }) => {
    const step = generator.step;
    if (step?.kind !== 'junk') return null;
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
                <span className="label-xs">{t("How many")}</span>
                <input
                    type="number"
                    min={1}
                    className="input-base text-xs font-mono"
                    value={step.count}
                    onChange={event => generator.setJunk(index, { count: Math.max(0, Number(event.target.value) || 0) })}
                />
            </div>
            <div className="flex flex-col gap-1.5">
                <span className="label-xs flex items-center gap-1.5">
                    {t("Size")}
                    <Help>{t("Bytes per datagram, as a range. The upper bound is exclusive, so 40-70 sends 40 to 69 bytes — the same as AmneziaWG's Jmin/Jmax.")}</Help>
                </span>
                <input
                    className="input-base text-xs font-mono"
                    placeholder="40-70"
                    value={step.size}
                    onChange={event => generator.setJunk(index, { size: event.target.value })}
                />
            </div>
            <div className="flex flex-col gap-1.5">
                <span className="label-xs flex items-center gap-1.5">
                    {t("Byte values")}
                    <Help>{t("Which byte values the random bytes are drawn from, both ends included. Empty means the whole range, 0-255. AmneziaWG has no equivalent, so a narrowed range is dropped on export.")}</Help>
                </span>
                <input
                    className="input-base text-xs font-mono"
                    placeholder="0-255"
                    value={step.randRange ?? ''}
                    onChange={event => generator.setJunk(index, { randRange: event.target.value || undefined })}
                />
            </div>
        </div>
    );
};

export const NoiseGeneratorModal = ({ noise, reset, onApply, onClose }: {
    noise?: unknown;
    reset?: unknown;
    onApply: (items: unknown[], reset?: string) => void;
    onClose: () => void;
}) => {
    const generator = useNoiseGenerator(noise, reset);
    const { recipe, step, selected, busy, notes, stats } = generator;
    const [pane, setPane] = useState<'list' | 'detail'>('list');
    const [view, setView] = useState<'fields' | 'awg'>('fields');

    const select = (index: number) => {
        generator.select(index);
        setPane('detail');
    };

    return (
        <Modal
            title={t("Noise Generator")}
            isSecondary
            className="md:max-w-[1100px] md:h-[88vh] md:max-h-[92dvh]"
            onClose={onClose}
            onSave={() => { onApply(generator.items, recipe.reset); onClose(); }}
            saveText={t("Apply")}
            saveIcon="Check"
            extraButtons={
                <div className="flex gap-2 w-full md:w-auto">
                    <Button variant="secondary" size="sm" icon="DiceFive" onClick={generator.redrawAll} disabled={busy || stats.count === 0}>
                        {t("Redraw all")}
                    </Button>
                </div>
            }
        >
            {/* Which pane a phone shows; at the foot, with everything else you tap. */}
            <ModalBottomBar className="flex-1">
                <div className="flex md:hidden bg-slate-950 p-1 rounded-lg border border-slate-800 gap-1 w-full">
                    {([['list', t("Decoys")], ['detail', t("Settings")]] as const).map(([key, label]) => (
                        <button
                            key={key}
                            onClick={() => setPane(key)}
                            className={`flex-1 px-3 py-2 text-[11px] font-bold rounded-md transition-all ${pane === key ? 'bg-slate-700 text-white' : 'text-slate-400'}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </ModalBottomBar>

            <div className="flex flex-col md:flex-row flex-1 min-h-0 gap-4">
                {/* Left: what goes out, in order. */}
                <div className={`${pane === 'list' ? 'flex' : 'hidden'} md:flex flex-col md:w-[38%] min-h-0 min-w-0`}>
                    <NoiseStepList
                        steps={recipe.steps}
                        selected={selected}
                        busy={busy}
                        onSelect={select}
                        onMove={generator.moveStep}
                        onRemove={generator.removeStep}
                        onAddPacket={kind => { void generator.addPacket(kind); setPane('detail'); }}
                        onAddJunk={() => { generator.addJunk(); setPane('detail'); }}
                    />
                </div>

                {/* Right: the selected decoy, and what it comes out as. */}
                <div className={`${pane === 'detail' ? 'flex' : 'hidden'} md:flex flex-col flex-1 min-h-0 min-w-0 gap-3`}>
                    <div className="flex items-center gap-2 shrink-0">
                        <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
                            {([['fields', t("Settings")], ['awg', t("AmneziaWG")]] as const).map(([key, label]) => (
                                <button
                                    key={key}
                                    onClick={() => setView(key)}
                                    className={`px-3 py-1.5 text-[11px] font-bold rounded-md transition-all ${view === key ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        {view === 'fields' && step?.kind === 'packet' && (
                            <Button variant="secondary" size="sm" icon="DiceFive" onClick={() => generator.redrawStep(selected)} disabled={busy}>
                                {t("Redraw")}
                            </Button>
                        )}
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto custom-scroll pr-1 space-y-4">
                        {view === 'awg' ? (
                            <AwgView generator={generator} />
                        ) : !step ? (
                            <div className="text-center py-10 text-slate-500 text-xs">
                                {t("Pick a decoy on the left, or add one.")}
                            </div>
                        ) : (
                            <>
                                {step.kind === 'packet'
                                    ? <TemplateFields template={step.template} onChange={next => generator.setTemplate(selected, next)} />
                                    : <JunkFields generator={generator} index={selected} />}

                                <div className="flex flex-col gap-1.5 max-w-[16rem]">
                                    <span className="label-xs flex items-center gap-1.5">
                                        {t("Delay after")}
                                        <Help>{t("Milliseconds to wait before the next datagram, as a range. Empty sends them back to back, which is what AmneziaWG does.")}</Help>
                                    </span>
                                    <input
                                        className="input-base text-xs font-mono"
                                        placeholder="5-15"
                                        value={step.delay ?? ''}
                                        onChange={event => generator.setDelay(selected, event.target.value)}
                                    />
                                </div>

                                {step.kind === 'packet' && (
                                    <div className="space-y-1.5">
                                        <div className="label-xs">{t("What goes on the wire")}</div>
                                        <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                                            <HexDump hex={step.hex} />
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* The whole layer, not the selected step: the numbers that decide
                        whether this is a plausible opening or an obvious burst. */}
                    <div className="shrink-0 space-y-3 border-t border-slate-800 pt-3">
                        <Notes notes={notes} />
                        <div className="flex flex-wrap items-end gap-4">
                            <div className="text-[11px] text-slate-400">
                                <span className="text-slate-200 font-bold">{tn(stats.count, "{n} datagram", "{n} datagrams")}</span>
                                {stats.largest > 0 && <> · {t("largest {n} B", { n: stats.largest })}</>}
                                {/* 1232 is the largest UDP payload that fits the 1280-byte
                                    IPv6 minimum MTU once the IPv6 and UDP headers are taken
                                    off, which is why a QUIC Initial is sized to it. Past
                                    that a datagram can be dropped on a path this app cannot
                                    see. */}
                                {stats.largest > 1232 && (
                                    <span className="text-amber-400"> · {t("larger than a 1280-byte path allows")}</span>
                                )}
                            </div>
                            <div className="flex flex-col gap-1.5 ml-auto w-32">
                                <span className="label-xs flex items-center gap-1.5">
                                    {t("Reset")}
                                    <Help>{t("Seconds of silence to a destination after which the decoys are sent again. Empty sends them once per destination; AmneziaWG instead sends them before every handshake, so a value near the key rotation time is the closest match.")}</Help>
                                </span>
                                <input
                                    className="input-base text-xs font-mono"
                                    placeholder="120-180"
                                    value={recipe.reset ?? ''}
                                    onChange={event => generator.setReset(event.target.value)}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Modal>
    );
};
