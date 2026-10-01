import React from 'react';
import { Button } from '../../ui/Button';
import { Help } from '../../ui/Help';
import { Icon } from '../../ui/Icon';
import type { Step, Template } from '../../../core/noise/recipe';
import { formatAwgSpec } from '../../../core/noise/awg-tags';
import { t } from '../../../i18n';

/**
 * The datagrams in the order they go out, which is the only order that means
 * anything: the first row is the first thing on the wire.
 */

const KIND_ICON: Record<Template['kind'], string> = {
    sip: 'Phone',
    quic: 'LockKey',
    dns: 'Globe',
    stun: 'Broadcast',
    awg: 'Wrench',
    hex: 'Code',
};

const KIND_LABEL = (kind: Template['kind']): string => ({
    sip: t("SIP call"),
    quic: t("QUIC Initial"),
    dns: t("DNS query"),
    stun: t("STUN binding"),
    awg: t("AmneziaWG chain"),
    hex: t("Raw bytes"),
}[kind]);

/**
 * One line per kind, shown where the choice is made. Each says what the packet
 * is and the port that protocol normally runs on — the decoys go to the same
 * address and port as the real traffic, so a DNS query arriving at :2408 is
 * odd in a way the packet itself cannot fix.
 */
const KIND_HINT = (kind: Template['kind']): string => ({
    sip: t("The opening of a VoIP call. A text protocol, so it reads as words in the dump. Normally port 5060."),
    quic: t("The first packet of a QUIC connection, carrying a real TLS ClientHello. The server name inside it travels in the clear — it is the one field anyone on the path reads. Normally port 443."),
    dns: t("The most ordinary UDP packet there is, and the smallest of these. Normally port 53."),
    stun: t("How a WebRTC call starts. Without the SOFTWARE attribute it is a bare 20-byte header, which is the commonest shape on the wire. Normally port 3478."),
    awg: t("An I1-I5 line from an AmneziaWG profile, kept as its tags so it can be written back unchanged."),
    hex: t("Bytes exactly as entered — for repeating a packet from someone else's capture or profile."),
}[kind]);

/** What the row says under its title: enough to tell two steps of a kind apart. */
const detail = (template: Template): string => {
    switch (template.kind) {
        case 'sip': return `${template.params.method} → ${template.params.toUser}@${template.params.toHost}`;
        case 'quic': return template.params.serverName;
        case 'dns': return `${template.params.recordType} ${template.params.name}`;
        case 'stun': return template.params.software || t("no SOFTWARE attribute");
        case 'awg': return formatAwgSpec(template.tags) || t("empty chain");
        case 'hex': return '';
    }
};

const Row = ({ step, index, active, onSelect, onMove, onRemove, last }: {
    step: Step;
    index: number;
    active: boolean;
    last: boolean;
    onSelect: () => void;
    onMove: (by: -1 | 1) => void;
    onRemove: () => void;
}) => {
    const isPacket = step.kind === 'packet';
    const bytes = isPacket ? step.hex.length / 2 : 0;
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onSelect}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(); } }}
            className={`group w-full text-left p-2.5 rounded-lg border transition-all cursor-pointer ${active
                ? 'border-indigo-500 bg-indigo-900/20'
                : 'border-slate-800 bg-slate-900 hover:border-slate-600'}`}
        >
            <div className="flex items-center gap-2.5">
                <span className="text-[10px] font-mono text-slate-600 w-4 shrink-0 text-right">{index + 1}</span>
                <div className={`p-1.5 rounded shrink-0 ${isPacket ? 'bg-indigo-900/30 text-indigo-400' : 'bg-slate-800 text-slate-400'}`}>
                    <Icon name={isPacket ? KIND_ICON[step.template.kind] : 'Shuffle'} size={14} />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-slate-200 truncate">
                        {isPacket ? KIND_LABEL(step.template.kind) : t("Random junk")}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono truncate">
                        {isPacket
                            ? [detail(step.template), t("{n} B", { n: bytes })].filter(Boolean).join(' · ')
                            : t("×{count}, {size} B", { count: step.count, size: step.size })}
                    </div>
                </div>
                {/* Reordering is an edit, so it stays reachable rather than hover-only on a phone. */}
                <div className="flex items-center shrink-0">
                    <Button variant="ghost" size="sm" icon="ArrowUp" aria-label={t("Move up")}
                        disabled={index === 0} onClick={event => { event.stopPropagation(); onMove(-1); }} />
                    <Button variant="ghost" size="sm" icon="ArrowDown" aria-label={t("Move down")}
                        disabled={last} onClick={event => { event.stopPropagation(); onMove(1); }} />
                    <Button variant="ghost" size="sm" icon="Trash" aria-label={t("Remove")}
                        className="text-rose-400 hover:text-rose-300"
                        onClick={event => { event.stopPropagation(); onRemove(); }} />
                </div>
            </div>
        </div>
    );
};

export const NoiseStepList = ({ steps, selected, onSelect, onMove, onRemove, onAddPacket, onAddJunk, busy }: {
    steps: Step[];
    selected: number;
    busy: boolean;
    onSelect: (index: number) => void;
    onMove: (index: number, by: -1 | 1) => void;
    onRemove: (index: number) => void;
    onAddPacket: (kind: Template['kind']) => void;
    onAddJunk: () => void;
}) => (
    <div className="flex flex-col h-full min-h-0 gap-3">
        <div className="flex-1 min-h-0 overflow-y-auto custom-scroll space-y-2 pr-1">
            {steps.length === 0 ? (
                <div className="text-center py-8 px-4 bg-slate-950/50 border border-dashed border-slate-800 rounded-xl text-slate-500 text-xs space-y-2">
                    <Icon name="Shuffle" className="text-2xl mx-auto opacity-20" />
                    <p className="font-bold text-slate-400">{t("No decoys yet. Add one below.")}</p>
                    <p className="leading-relaxed">
                        {t("These are datagrams sent ahead of the real traffic, once per destination. They change nothing about the real packets — the core sends the list, then carries on as usual.")}
                    </p>
                </div>
            ) : steps.map((step, index) => (
                <Row
                    key={index}
                    step={step}
                    index={index}
                    last={index === steps.length - 1}
                    active={index === selected}
                    onSelect={() => onSelect(index)}
                    onMove={by => onMove(index, by)}
                    onRemove={() => onRemove(index)}
                />
            ))}
        </div>

        {/* Controls at the foot of the pane, where a thumb reaches. */}
        <div className="shrink-0 space-y-1.5">
            <div className="label-xs flex items-center gap-1.5">
                {t("Add a decoy")}
                <Help>{t("Every decoy goes to the same address and port as the real traffic, one after another, before a single real byte. So the list reads as one flow to one endpoint: a single kind plus junk usually looks more like an application than a mixture does.")}</Help>
            </div>
            <div className="flex flex-wrap gap-1.5">
                {(['sip', 'quic', 'dns', 'stun', 'hex', 'awg'] as const).map(kind => (
                    <button
                        key={kind}
                        type="button"
                        disabled={busy}
                        title={KIND_HINT(kind)}
                        onClick={() => onAddPacket(kind)}
                        className="px-2 py-1.5 text-[10px] rounded-md border bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-all flex items-center gap-1 disabled:opacity-40"
                    >
                        <Icon name={KIND_ICON[kind]} size={11} />
                        {KIND_LABEL(kind)}
                    </button>
                ))}
                <button
                    type="button"
                    onClick={onAddJunk}
                    className="px-2 py-1.5 text-[10px] rounded-md border bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-all flex items-center gap-1"
                >
                    <Icon name="Shuffle" size={11} />
                    {t("Random junk")}
                </button>
            </div>
        </div>
    </div>
);
