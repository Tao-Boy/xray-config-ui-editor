/**
 * The parameter form for one decoy datagram.
 *
 * Fields only: the pane around this owns the kind picker, the preview of the
 * bytes and every button. Nothing here keeps a copy of the parameters —
 * `template` is read straight and `onChange` is called on every keystroke —
 * because the caller rebuilds the packet from exactly these values, and a
 * second copy here would drift from the bytes on screen.
 *
 * What *is* held locally is text: the characters typed since the last value a
 * builder could actually use. A connection id mid-paste is not hex yet, and
 * `buildQuic` throws rather than guessing what was meant — so a field whose
 * text cannot be built is shown, said out loud, and not written. See
 * `useBuffered`.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';
import { ExtendedSection, FormField, Help, Icon, Input, NumberInput, Select, Switch, Textarea } from '../../ui';
import { t } from '../../../i18n';
import { fromHex } from '../../../core/noise/bytes';
import type { Template } from '../../../core/noise/recipe';
import type { Note } from '../../../core/noise/types';
import { sipProblems, type SipMethod, type SipParams } from '../../../core/noise/packets/sip';
import type { DnsParams } from '../../../core/noise/packets/dns';
import type { StunParams } from '../../../core/noise/packets/stun';
import type { QuicParams } from '../../../core/noise/packets/quic';
import { formatAwgSpec, parseAwgSpec, type AwgTag } from '../../../core/noise/awg-tags';

/** RFC 9000 s14.1 — a client MUST pad an Initial datagram to at least this. */
const MIN_DATAGRAM = 1200;

/** What this packet is, said once above its fields rather than per field. */
const KIND_INTRO = (kind: Template['kind']): string => ({
    sip: t("A SIP call opening. Everything below ends up in the packet as plain text, which is what makes it read as somebody's softphone."),
    quic: t("A real QUIC client Initial: encrypted the way the protocol says, carrying a TLS ClientHello. Only the server name below is readable on the path."),
    dns: t("A DNS query. It is never resolved — the datagram goes to the peer, not to a resolver — so the name only has to read like a name."),
    stun: t("A STUN Binding request, the packet a WebRTC call starts with."),
    awg: t("A tag chain copied from an AmneziaWG profile. AmneziaWG redraws its random tags before every handshake; carried here they are frozen at one draw."),
    hex: t("Raw bytes. Nothing is generated and nothing is checked beyond the hex itself."),
}[kind]);

const Intro = ({ kind }: { kind: Template['kind'] }) => (
    <p className="text-[11px] text-slate-400 leading-relaxed bg-slate-950/40 border border-slate-800 rounded-lg p-2.5">
        {KIND_INTRO(kind)}
    </p>
);

export const TemplateFields = ({ template, onChange }: {
    template: Template;
    onChange: (next: Template) => void;
}) => (
    <div className="space-y-3">
        <Intro kind={template.kind} />
        <Fields template={template} onChange={onChange} />
    </div>
);

const Fields = ({ template, onChange }: {
    template: Template;
    onChange: (next: Template) => void;
}) => {
    switch (template.kind) {
        case 'sip':
            return <SipFields params={template.params} onChange={params => onChange({ kind: 'sip', params })} />;
        case 'quic':
            return <QuicFields params={template.params} onChange={params => onChange({ kind: 'quic', params })} />;
        case 'dns':
            return <DnsFields params={template.params} onChange={params => onChange({ kind: 'dns', params })} />;
        case 'stun':
            return <StunFields params={template.params} onChange={params => onChange({ kind: 'stun', params })} />;
        case 'awg':
            return <AwgFields tags={template.tags} onChange={tags => onChange({ kind: 'awg', tags })} />;
        case 'hex':
            return <HexFields hex={template.hex} onChange={hex => onChange({ kind: 'hex', hex })} />;
    }
};

// ── Text over a value ────────────────────────────────────────────────────

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * A text box over a value the builders have to be able to use.
 *
 * The state is not a draft of the value: it is only the characters typed
 * since the last one that parsed, and it is dropped the moment the text is
 * exactly how that value writes itself. So "h3," and "0xAB" stay as typed
 * (both already mean something, and both get written), while "abc" is kept on
 * screen and *not* written — `read` returns null and the template holds its
 * last buildable value, which the field says next to itself rather than
 * hiding.
 */
const useBuffered = <T,>(value: T, show: (value: T) => string, read: (text: string) => T | null, write: (value: T) => void) => {
    const [typed, setTyped] = useState<string | null>(null);
    const [seen, setSeen] = useState(value);

    // The value moved underneath the box — another step selected, a fresh
    // draw — so the buffer only survives if it still means what is there now.
    if (value !== seen) {
        setSeen(value);
        const parsed = typed === null ? null : read(typed);
        if (parsed === null || !same(parsed, value)) setTyped(null);
    }

    const text = typed ?? show(value);
    const onText = (next: string) => {
        const parsed = read(next);
        setTyped(parsed !== null && show(parsed) === next ? null : next);
        if (parsed !== null) write(parsed);
    };
    return [text, onText, read(text) === null] as const;
};

// ── Shared bits ──────────────────────────────────────────────────────────

const TONES = {
    critical: { box: 'border-rose-500/40 bg-rose-950/20 text-rose-200/90', icon: 'WarningOctagon', color: 'text-rose-400' },
    warning: { box: 'border-amber-500/40 bg-amber-950/20 text-amber-200/90', icon: 'Warning', color: 'text-amber-400' },
    info: { box: 'border-blue-500/30 bg-blue-950/20 text-blue-200/90', icon: 'Info', color: 'text-blue-400' },
} as const;

const Notes = ({ notes }: { notes: Note[] }) => notes.length === 0 ? null : (
    <div className="md:col-span-2 space-y-1.5">
        {notes.map((note, i) => {
            const tone = TONES[note.severity];
            return (
                <div key={i} className={`flex gap-2 p-2.5 rounded-lg border text-[11px] leading-relaxed ${tone.box}`} data-tone={note.severity}>
                    <Icon name={tone.icon} weight="fill" className={`shrink-0 mt-0.5 ${tone.color}`} />
                    <span>{note.message}</span>
                </div>
            );
        })}
    </div>
);

/** A field across both columns: anything long enough that half a row truncates it. */
const Wide = ({ children }: { children: ReactNode }) => <div className="md:col-span-2">{children}</div>;

const Grid = ({ children }: { children: ReactNode }) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{children}</div>
);

const GroupTitle = ({ children, help }: { children: ReactNode; help?: string }) => (
    <div className="label-xs mb-0 flex items-center gap-1 text-slate-400">
        {children}
        {help && <Help>{help}</Help>}
    </div>
);

// ── SIP ──────────────────────────────────────────────────────────────────

const SipFields = ({ params, onChange }: { params: SipParams; onChange: (params: SipParams) => void }) => {
    const set = (patch: Partial<SipParams>) => onChange({ ...params, ...patch });

    return (
        <div className="space-y-4">
            <section className="space-y-2.5">
                <GroupTitle help={t("The call this datagram claims to be part of. Every one of these ends up in the plain text a middlebox reads, so they are what make the packet look like somebody's softphone rather than ours.")}>
                    {t("Who is calling whom")}
                </GroupTitle>
                <Grid>
                    <Select<SipMethod>
                        className="md:col-span-2"
                        label={t("Method")}
                        value={params.method}
                        onChange={method => set({ method })}
                        options={[
                            { value: 'invite', label: 'INVITE', description: t("A new call — what a softphone opens with.") },
                            { value: 'trying', label: '100 Trying', description: t("A proxy's provisional answer to an INVITE.") },
                            { value: 'ringing', label: '180 Ringing', description: t("The callee's phone is alerting.") },
                            { value: 'register', label: 'REGISTER', description: t("A client binding its address with a registrar.") },
                            { value: 'options', label: 'OPTIONS', description: t("The capability probe proxies trade as a keep-alive.") },
                        ]}
                        help={t("A request (INVITE, REGISTER, OPTIONS) carries Max-Forwards and a Contact; 100 and 180 are responses to an INVITE and carry neither.")}
                    />
                    <Input
                        label={t("Caller")}
                        value={params.fromUser}
                        onChange={e => set({ fromUser: e.target.value })}
                        placeholder="alice"
                        spellCheck={false}
                    />
                    <Input
                        label={t("Caller's host")}
                        value={params.fromHost}
                        onChange={e => set({ fromHost: e.target.value })}
                        placeholder="sip.example.com"
                        spellCheck={false}
                    />
                    <Input
                        label={t("Callee")}
                        value={params.toUser}
                        onChange={e => set({ toUser: e.target.value })}
                        placeholder="bob"
                        spellCheck={false}
                    />
                    <Input
                        label={t("Callee's host")}
                        value={params.toHost}
                        onChange={e => set({ toHost: e.target.value })}
                        placeholder="voip.example.net"
                        spellCheck={false}
                    />
                    <Wide>
                        <Input
                            label={t("Via host")}
                            value={params.viaHost}
                            onChange={e => set({ viaHost: e.target.value })}
                            placeholder="pc33.sip.example.com"
                            spellCheck={false}
                            help={t("The Via sent-by: the endpoint this datagram claims to come from, inside the caller's own domain.")}
                        />
                    </Wide>
                    <Notes notes={sipProblems(params)} />
                </Grid>
            </section>

            {/*
              * Collapsed by default: these are drawn per call and a receiver
              * only ever checks that they are unique, so they are noise the
              * reader scrolls past — until they want one packet pinned down
              * byte for byte.
              */}
            <ExtendedSection
                title={t("Call identifiers")}
                description={t("Drawn fresh for every call. Edit them to pin this packet down exactly.")}
                badgeText=""
            >
                <Grid>
                    <Wide>
                        <Input
                            label={t("Via branch")}
                            className="font-mono text-xs"
                            value={params.branch}
                            onChange={e => set({ branch: e.target.value })}
                            spellCheck={false}
                            help={t("The transaction id. RFC 3261 s8.1.1.7 requires the magic cookie z9hG4bK in front of it — without it a receiver reads the whole packet under the older RFC 2543 rules.")}
                        />
                    </Wide>
                    <Input
                        label={t("From tag")}
                        className="font-mono text-xs"
                        value={params.fromTag}
                        onChange={e => set({ fromTag: e.target.value })}
                        spellCheck={false}
                        help={t("RFC 3261 s19.3 asks for at least 32 bits of randomness here.")}
                    />
                    <FormField
                        label={t("CSeq")}
                        help={t("The sequence number of this request. Real stacks start anywhere below 2^31, so a large number is as plausible as a small one.")}
                    >
                        <NumberInput value={params.cseq} onChange={cseq => set({ cseq: cseq ?? 0 })} min={0} />
                    </FormField>
                    <Wide>
                        <Input
                            label={t("Call-ID")}
                            className="font-mono text-xs"
                            value={params.callId}
                            onChange={e => set({ callId: e.target.value })}
                            spellCheck={false}
                            help={t("RFC 3261 s8.1.1.4: a cryptographically random local id, then @ and the host it was made on.")}
                        />
                    </Wide>
                </Grid>
            </ExtendedSection>
        </div>
    );
};

// ── QUIC ─────────────────────────────────────────────────────────────────

const showAlpn = (alpn: string[]): string => alpn.join(', ');
const readAlpn = (text: string): string[] => text.split(',').map(id => id.trim()).filter(Boolean);

/** Hex a connection id can be built from. Anything else stays in the box. */
const readCid = (text: string): string | null => (fromHex(text) === null ? null : text);

/**
 * A size the builder can work with. Below the RFC's floor there is no room
 * for a ClientHello and `buildQuic` throws, so an unfinished "12" is held in
 * the box rather than written through.
 */
const readSize = (text: string): number | null => {
    const trimmed = text.trim();
    if (trimmed === '') return null;
    const size = Number(trimmed);
    return Number.isInteger(size) && size >= MIN_DATAGRAM ? size : null;
};

const QuicFields = ({ params, onChange }: { params: QuicParams; onChange: (params: QuicParams) => void }) => {
    const set = (patch: Partial<QuicParams>) => onChange({ ...params, ...patch });

    const [alpnText, setAlpnText] = useBuffered(params.alpn, showAlpn, readAlpn, alpn => set({ alpn }));
    const [dcidText, setDcidText, dcidBad] = useBuffered(params.dcidHex, id => id, readCid, dcidHex => set({ dcidHex }));
    const [scidText, setScidText, scidBad] = useBuffered(params.scidHex, id => id, readCid, scidHex => set({ scidHex }));
    const [sizeText, setSizeText, sizeBad] = useBuffered(params.size, String, readSize, size => set({ size }));

    const notHex = t("Not hex — the packet keeps the last id that was.");

    return (
        <Grid>
            <Wide>
                <Input
                    label={t("Server name (SNI)")}
                    value={params.serverName}
                    onChange={e => set({ serverName: e.target.value })}
                    placeholder="www.cloudflare.com"
                    spellCheck={false}
                    hint={t("The name that travels in the clear inside the ClientHello — the one field anyone on the path actually reads. Pick a host an ordinary browser would be opening.")}
                />
            </Wide>
            <Input
                label={t("ALPN")}
                className="font-mono text-xs"
                value={alpnText}
                onChange={e => setAlpnText(e.target.value)}
                placeholder="h3, h3-29"
                spellCheck={false}
                hint={t("Comma-separated protocol ids. QUIC makes ALPN mandatory (RFC 9001 s8.1); h3 is what a browser sends.")}
            />
            <FormField
                label={t("Datagram size")}
                help={t("The whole datagram, padding included: RFC 9000 s14.1 requires a client Initial of at least {n} bytes. The ClientHello is a few hundred — everything past it is PADDING frames, exactly as a real client sends them.", { n: MIN_DATAGRAM })}
                error={sizeBad ? t("A whole number, at least {n} — until then the packet keeps its last valid size.", { n: MIN_DATAGRAM }) : undefined}
            >
                {/* Not NumberInput: that holds a number, and this box has to be
                  * able to show a half-typed "12" without writing it. */}
                <input
                    type="number"
                    inputMode="numeric"
                    className={`input-base text-xs ${sizeBad ? 'border-rose-500/70' : ''}`}
                    aria-label={t("Datagram size")}
                    value={sizeText}
                    min={MIN_DATAGRAM}
                    onChange={e => setSizeText(e.target.value)}
                />
            </FormField>
            <Input
                label={t("Destination connection ID")}
                className="font-mono text-xs"
                value={dcidText}
                onChange={e => setDcidText(e.target.value)}
                placeholder="8394c8f03e515708"
                spellCheck={false}
                error={dcidBad ? notHex : undefined}
                hint={t("Hex, 8 bytes in a real client's first packet. The initial keys are derived from it, which is why anyone can decrypt this datagram — it buys camouflage, never privacy.")}
            />
            <Input
                label={t("Source connection ID")}
                className="font-mono text-xs"
                value={scidText}
                onChange={e => setScidText(e.target.value)}
                placeholder={t("empty")}
                spellCheck={false}
                error={scidBad ? notHex : undefined}
                hint={t("Hex. May be empty — plenty of clients send no source id at all.")}
            />
        </Grid>
    );
};

// ── DNS ──────────────────────────────────────────────────────────────────

const DnsFields = ({ params, onChange }: { params: DnsParams; onChange: (params: DnsParams) => void }) => {
    const set = (patch: Partial<DnsParams>) => onChange({ ...params, ...patch });

    return (
        <Grid>
            <Wide>
                <Input
                    label={t("Name")}
                    value={params.name}
                    onChange={e => set({ name: e.target.value })}
                    placeholder="www.example.com"
                    spellCheck={false}
                    hint={t("The question this query asks. It is never resolved — the datagram goes to the peer, not to a resolver — so it only has to read like a name.")}
                />
            </Wide>
            <Select<DnsParams['recordType']>
                label={t("Record type")}
                value={params.recordType}
                onChange={recordType => set({ recordType })}
                options={[
                    { value: 'A', label: 'A', description: t("An IPv4 address: the commonest query there is.") },
                    { value: 'AAAA', label: 'AAAA', description: t("An IPv6 address.") },
                    { value: 'HTTPS', label: 'HTTPS', description: t("What a browser asks for before it connects (RFC 9460).") },
                    { value: 'TXT', label: 'TXT', description: t("Free text — the least ordinary of the four on a fresh flow.") },
                ]}
            />
            <div className="flex md:items-end md:pb-2.5">
                <Switch
                    checked={params.recursionDesired}
                    onChange={recursionDesired => set({ recursionDesired })}
                    label={
                        <span className="inline-flex items-center">
                            {t("Recursion desired")}
                            <Help>{t("The RD flag of the header. A stub resolver asking a recursive server always sets it, so leaving it off is the unusual choice.")}</Help>
                        </span>
                    }
                />
            </div>
        </Grid>
    );
};

// ── STUN ─────────────────────────────────────────────────────────────────

const StunFields = ({ params, onChange }: { params: StunParams; onChange: (params: StunParams) => void }) => (
    <Grid>
        <Wide>
            <Input
                label={t("SOFTWARE")}
                value={params.software}
                onChange={e => onChange({ ...params, software: e.target.value })}
                placeholder="libnice 0.1.21"
                spellCheck={false}
                hint={t("Names the ICE agent, the way a real one does. Leave it empty and the attribute is left out entirely — a bare 20-byte header, which is still a complete Binding request and the commonest shape on the wire.")}
            />
        </Wide>
    </Grid>
);

// ── AmneziaWG tag chain ──────────────────────────────────────────────────

/** A chip's text. A long `<b>` argument is cut: the chain's shape is the point here. */
const chipText = (tag: AwgTag): string => {
    if (tag.value === undefined || tag.value === '') return tag.key;
    const value = tag.value.length > 14 ? `${tag.value.slice(0, 13)}…` : tag.value;
    return `${tag.key} ${value}`;
};

const AwgFields = ({ tags, onChange }: { tags: AwgTag[]; onChange: (tags: AwgTag[]) => void }) => {
    const [text, setText] = useBuffered(tags, formatAwgSpec, spec => parseAwgSpec(spec).tags, onChange);
    // Re-parsed from the text rather than read off `tags`, so a chain that was
    // refused shows *why* instead of just emptying the chip row.
    const parsed = parseAwgSpec(text);

    return (
        <div className="space-y-2.5">
            <Input
                label={t("Tag chain")}
                className="font-mono text-xs"
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="<b 0xdeadbeef><r 16><t>"
                spellCheck={false}
                help={t("An AmneziaWG I1..I5 line. <b hex> writes those bytes, <r n> n random ones, <rc n> and <rd n> n random letters or digits, <t> a four-byte timestamp. <d>, <ds> and <dz n> splice in the real WireGuard payload, which a standalone decoy has none of.")}
            />

            {parsed.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5" data-testid="awg-chips">
                    {parsed.tags.map((tag, i) => (
                        <span
                            key={i}
                            className="px-2 py-1 rounded-md border border-slate-700 bg-slate-950 text-[10px] font-mono text-slate-300"
                        >
                            {chipText(tag)}
                        </span>
                    ))}
                </div>
            )}

            {parsed.tags.length === 0 && parsed.notes.length === 0 && (
                <div className="text-[11px] text-slate-500 italic">
                    {t("No tags yet — a chain is written as <b 0x…><r 16>, and anything outside the brackets is ignored.")}
                </div>
            )}

            <Notes notes={parsed.notes} />
        </div>
    );
};

// ── Raw bytes ────────────────────────────────────────────────────────────

const HexFields = ({ hex, onChange }: { hex: string; onChange: (hex: string) => void }) => {
    const bytes = fromHex(hex);

    return (
        <div className="space-y-2.5">
            {/*
              * Written through as typed, valid or not: these bytes are the
              * whole template, so there is nothing for a builder to throw on,
              * and a field that swallows half a paste is worse than a red one.
              */}
            <Textarea
                label={t("Bytes")}
                monospace
                rows={6}
                spellCheck={false}
                value={hex}
                onChange={e => onChange(e.target.value)}
                placeholder="16 03 01 00 a5 01 00 00 a1"
                error={bytes === null ? t("Not hex — expected pairs of 0-9 and a-f.") : undefined}
                hint={t("{n} bytes. Whitespace and a leading 0x are ignored, so pasting a dump works.", { n: bytes?.length ?? 0 })}
            />
        </div>
    );
};
