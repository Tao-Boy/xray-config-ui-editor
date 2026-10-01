import React from 'react';
import { t } from '../../../i18n';

/**
 * A datagram as `xxd` would print it: offset, hex, and the printable bytes.
 *
 * Both halves earn their place. The hex is what the config carries, and the
 * text column is how you tell at a glance that a decoy really does look like
 * the protocol it claims — a SIP packet reads as SIP, and a QUIC Initial
 * reads as the few plaintext header bytes followed by noise, which is exactly
 * what it should look like once it is encrypted.
 */

const PER_ROW = 16;

/** Printable ASCII, and a dot for everything else — the usual hex-dump convention. */
const printable = (byte: number): string =>
    byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '·';

export const HexDump = ({ hex, max = 512 }: { hex: string; max?: number }) => {
    const bytes = React.useMemo(() => {
        const clean = hex.replace(/\s+/g, '');
        const pairs = Math.floor(clean.length / 2);
        const out = new Uint8Array(pairs);
        for (let i = 0; i < pairs; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16) || 0;
        return out;
    }, [hex]);

    if (bytes.length === 0) {
        return (
            <div className="text-[11px] text-slate-600 italic py-6 text-center">
                {t("Nothing to send yet.")}
            </div>
        );
    }

    const shown = bytes.subarray(0, max);
    const rows: React.ReactElement[] = [];
    for (let at = 0; at < shown.length; at += PER_ROW) {
        const row = shown.subarray(at, at + PER_ROW);
        rows.push(
            <div key={at} className="flex gap-3 whitespace-pre">
                <span className="text-slate-600 select-none">{at.toString(16).padStart(4, '0')}</span>
                <span className="text-emerald-300/80">
                    {Array.from(row, byte => byte.toString(16).padStart(2, '0')).join(' ').padEnd(PER_ROW * 3 - 1, ' ')}
                </span>
                <span className="text-slate-400">{Array.from(row, printable).join('')}</span>
            </div>,
        );
    }

    return (
        <div className="font-mono text-[10px] leading-[1.35] overflow-x-auto custom-scroll">
            {rows}
            {bytes.length > max && (
                <div className="text-slate-600 pt-1">
                    {t("… {n} more bytes", { n: bytes.length - max })}
                </div>
            )}
        </div>
    );
};
