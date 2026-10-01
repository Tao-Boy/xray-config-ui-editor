import { describe, it, expect } from 'bun:test';
import { parseAwgSpec, formatAwgSpec, renderAwgSpec, awgSpecForBytes, type AwgTag } from './awg-tags';
import { toHex } from './bytes';
import type { Rng } from './types';

/** xorshift32 — any deterministic generator will do, it just has to repeat. */
const seededRng = (seed: number): Rng => {
    let state = seed >>> 0;
    return length => {
        const out = new Uint8Array(length);
        for (let i = 0; i < length; i++) {
            state ^= (state << 13) >>> 0;
            state >>>= 0;
            state ^= state >>> 17;
            state ^= (state << 5) >>> 0;
            state >>>= 0;
            out[i] = state & 0xff;
        }
        return out;
    };
};

/** An rng that hands back exactly these bytes, to pin the alphabet folding. */
const fixedRng = (...bytes: number[]): Rng => length => Uint8Array.from({ length }, (_, i) => bytes[i] ?? 0);

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const render = (spec: string, rng: Rng = seededRng(1)) => renderAwgSpec(parseAwgSpec(spec).tags, rng);

describe('parseAwgSpec — the eight tags of obfBuilders', () => {
    it('reads a hex payload tag, keeping the argument as written', () => {
        expect(parseAwgSpec('<b 0x494e56495445>')).toEqual({
            tags: [{ key: 'b', value: '0x494e56495445' }],
            notes: [],
        });
    });

    it('accepts hex without the 0x prefix too', () => {
        expect(parseAwgSpec('<b deadbeef>').tags).toEqual([{ key: 'b', value: 'deadbeef' }]);
    });

    it('keeps a length for r/rc/rd/dz and drops the ignored argument of t/d/ds', () => {
        expect(parseAwgSpec('<r 16><rc 8><rd 4><dz 2>').tags).toEqual([
            { key: 'r', value: '16' },
            { key: 'rc', value: '8' },
            { key: 'rd', value: '4' },
            { key: 'dz', value: '2' },
        ]);
        // device/obf_timestamp.go:8, obf_data.go:3, obf_datastring.go:7 all
        // take the argument and throw it away.
        expect(parseAwgSpec('<t 99><d><ds>').tags).toEqual([{ key: 't' }, { key: 'd' }, { key: 'ds' }]);
    });

    it('skips anything outside the brackets instead of complaining about it', () => {
        expect(parseAwgSpec('I1 = <b 0xff> then <t> ok').tags).toEqual([{ key: 'b', value: '0xff' }, { key: 't' }]);
    });

    it('gives an empty chain, with no notes, for a string that is not a chain at all', () => {
        expect(parseAwgSpec('')).toEqual({ tags: [], notes: [] });
        expect(parseAwgSpec('just some words')).toEqual({ tags: [], notes: [] });
    });

    it('splits the tag on whitespace and ignores fields past the argument', () => {
        expect(parseAwgSpec('<   b    0xff   junk >').tags).toEqual([{ key: 'b', value: '0xff' }]);
    });
});

describe('parseAwgSpec — what it got wrong', () => {
    const problem = (spec: string): string => {
        const { tags, notes } = parseAwgSpec(spec);
        // One bad tag rejects the whole chain (device/obf.go:85-87): half a
        // decoy is not the decoy AWG would send.
        expect(tags).toEqual([]);
        expect(notes).toHaveLength(1);
        expect(notes[0]?.severity).toBe('critical');
        return notes[0]?.message ?? '';
    };

    it('reports an unknown key rather than skipping it silently', () => {
        expect(problem('<zz>')).toBe('unknown tag <zz>');
        expect(problem('<b 0xff><zz 4>')).toBe('unknown tag <zz>');
    });

    it('reports a missing closing bracket and stops scanning there', () => {
        expect(problem('<b 0xff><r')).toContain('missing enclosing >');
    });

    it('reports an odd number of hex digits', () => {
        expect(problem('<b 0xabc>')).toBe('failed to build <b>: odd amount of symbols');
    });

    it('reports an empty <b> argument', () => {
        expect(problem('<b>')).toBe('failed to build <b>: empty argument');
        expect(problem('<b 0x>')).toBe('failed to build <b>: empty argument');
    });

    it('reports hex that is not hex — including the 0X that TrimPrefix will not strip', () => {
        expect(problem('<b 0xzz>')).toContain('is not hex');
        // device/obf_bytes.go:11 is a case-sensitive TrimPrefix, so the X stays
        // in and the decode fails.
        expect(problem('<b 0Xff>')).toContain('is not hex');
    });

    it('reports a length that Atoi would refuse, and a negative one it would not', () => {
        expect(problem('<r>')).toContain('is not a number');
        expect(problem('<rc abc>')).toContain('is not a number');
        expect(problem('<dz 1.5>')).toContain('is not a number');
        expect(problem('<r -4>')).toContain('negative length');
    });

    it('reports an empty tag', () => {
        expect(problem('<>')).toBe('empty tag <>');
        expect(problem('<   >')).toBe('empty tag <>');
    });

    it('collects every error in the chain', () => {
        const { tags, notes } = parseAwgSpec('<zz><b 0xabc><b>');
        expect(tags).toEqual([]);
        expect(notes.map(note => note.message)).toEqual([
            'unknown tag <zz>',
            'failed to build <b>: odd amount of symbols',
            'failed to build <b>: empty argument',
        ]);
    });

    it('never throws, whatever it is handed', () => {
        for (const spec of ['<', '>', '<<>>', '<b', '<b 0x', '<<b 0xff>', '< t >', '<b 0xff', '>>><<<']) {
            expect(() => parseAwgSpec(spec)).not.toThrow();
        }
    });
});

describe('formatAwgSpec', () => {
    it('round-trips a well-formed spec through the parser unchanged', () => {
        for (const spec of [
            '<b 0xdeadbeef><r 16><t><rc 8>',
            '<b 0x494e56495445>',
            '<t><d><ds><dz 4><rd 6>',
            '<b deadbeef>',
        ]) {
            expect(formatAwgSpec(parseAwgSpec(spec).tags)).toBe(spec);
        }
    });

    it('writes the argument-less tags bare', () => {
        expect(formatAwgSpec([{ key: 't' }, { key: 'b', value: '0xff' }])).toBe('<t><b 0xff>');
    });
});

describe('renderAwgSpec — the fixed tags', () => {
    it('renders a chain of only <b> faithfully, with nothing to warn about', () => {
        const { bytes, notes } = render('<b 0x494e56495445><b 0xff00>');
        expect(toHex(bytes)).toBe('494e56495445ff00');
        expect(text(bytes.subarray(0, 6))).toBe('INVITE');
        expect(notes).toEqual([]);
    });
});

describe('renderAwgSpec — the tags AWG redraws per handshake', () => {
    it('freezes the timestamp at four big-endian bytes of now, and says so', () => {
        const before = Math.floor(Date.now() / 1000);
        const { bytes, notes } = render('<t>');
        expect(bytes).toHaveLength(4);
        const stamp = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, false);
        expect(stamp).toBeGreaterThanOrEqual(before);
        expect(stamp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 1);
        expect(notes).toHaveLength(1);
        expect(notes[0]?.severity).toBe('warning');
        expect(notes[0]?.message).toContain('<t>');
        expect(notes[0]?.message).toContain('freezes');
    });

    it('draws <r> straight from the rng and warns that the draw is frozen', () => {
        const { bytes, notes } = render('<r 8>', fixedRng(1, 2, 3, 4, 5, 6, 7, 8));
        expect(toHex(bytes)).toBe('0102030405060708');
        expect(notes).toHaveLength(1);
        expect(notes[0]).toEqual({ severity: 'warning', message: expect.stringContaining('<r>') });
    });

    it('folds <rc> into the 52 latin letters exactly as chars52[b % 52] does', () => {
        // device/obf_randchars.go:9 + :29 — 0→a, 25→z, 26→A, 51→Z, 52 wraps to
        // a, 255 % 52 = 47 → V.
        const { bytes } = render('<rc 7>', fixedRng(0, 1, 25, 26, 51, 52, 255));
        expect(text(bytes)).toBe('abzAZaV');
    });

    it('folds <rd> into the 10 digits exactly as digits10[b % 10] does', () => {
        const { bytes } = render('<rd 4>', fixedRng(0, 9, 10, 255));
        expect(text(bytes)).toBe('0905');
    });

    it('gives a reproducible, in-alphabet result from a seeded rng', () => {
        const first = render('<rc 24><rd 24>', seededRng(0xc0ffee));
        const second = render('<rc 24><rd 24>', seededRng(0xc0ffee));
        expect(toHex(first.bytes)).toBe(toHex(second.bytes));
        expect(first.bytes).toHaveLength(48);

        const letters = text(first.bytes.subarray(0, 24));
        const digits = text(first.bytes.subarray(24));
        expect(letters).toMatch(/^[a-zA-Z]{24}$/);
        expect(digits).toMatch(/^[0-9]{24}$/);
        // A different seed has to move it, or the rng is not reaching the tags.
        expect(text(render('<rc 24>', seededRng(1)).bytes)).not.toBe(letters);
    });

    it('files one note per tag kind, however many of that kind there are', () => {
        const { notes } = render('<r 4><r 4><r 4><rc 2>');
        expect(notes.map(note => note.severity)).toEqual(['warning', 'warning']);
    });
});

describe('renderAwgSpec — the tags that stand for a payload there is none of', () => {
    it('renders <d> as nothing and names it in a warning', () => {
        const { bytes, notes } = render('<b 0xff><d>');
        expect(toHex(bytes)).toBe('ff');
        expect(notes).toHaveLength(1);
        expect(notes[0]?.severity).toBe('warning');
        expect(notes[0]?.message).toContain('<d>');
    });

    it('renders <ds> as nothing — base64 of an empty payload is empty', () => {
        const { bytes, notes } = render('<ds>');
        expect(bytes).toHaveLength(0);
        expect(notes[0]?.message).toContain('<ds>');
    });

    it('renders <dz> as its own length in zero bytes, keeping the width', () => {
        const { bytes, notes } = render('<b 0xaa><dz 4>');
        expect(toHex(bytes)).toBe('aa00000000');
        expect(notes).toHaveLength(1);
        expect(notes[0]?.severity).toBe('warning');
        expect(notes[0]?.message).toContain('<dz>');
    });
});

describe('renderAwgSpec — a mixed chain', () => {
    const spec = '<b 0xdeadbeef><r 4><t>';

    it('lays the tags down in order at their combined width', () => {
        const { bytes } = render(spec, fixedRng(0xaa, 0xbb, 0xcc, 0xdd));
        expect(bytes).toHaveLength(4 + 4 + 4);
        expect(toHex(bytes.subarray(0, 4))).toBe('deadbeef');
        expect(toHex(bytes.subarray(4, 8))).toBe('aabbccdd');
    });

    it('warns about both of the tags it had to freeze', () => {
        const { notes } = render(spec);
        expect(notes).toHaveLength(2);
        expect(notes.every(note => note.severity === 'warning')).toBe(true);
        expect(notes.map(note => note.message).join(' ')).toContain('<r>');
        expect(notes.map(note => note.message).join(' ')).toContain('<t>');
    });

    it('reports a hand-built tag whose argument is unusable instead of guessing', () => {
        const tags: AwgTag[] = [{ key: 'b', value: '0xff' }, { key: 'r', value: 'nope' }];
        const { bytes, notes } = renderAwgSpec(tags, seededRng(1));
        expect(toHex(bytes)).toBe('ff');
        expect(notes.some(note => note.severity === 'critical')).toBe(true);
    });
});

describe('awgSpecForBytes', () => {
    it('writes fixed bytes as the one <b> tag that reproduces them', () => {
        const tags = awgSpecForBytes(Uint8Array.from([0xde, 0xad, 0xbe, 0xef]));
        expect(tags).toEqual([{ key: 'b', value: '0xdeadbeef' }]);
        expect(formatAwgSpec(tags)).toBe('<b 0xdeadbeef>');
    });

    it('round-trips through the parser and the renderer', () => {
        const original = Uint8Array.from([0, 1, 127, 128, 255]);
        const spec = formatAwgSpec(awgSpecForBytes(original));
        const { tags, notes } = parseAwgSpec(spec);
        expect(notes).toEqual([]);
        const rendered = renderAwgSpec(tags, seededRng(1));
        expect(toHex(rendered.bytes)).toBe(toHex(original));
        expect(rendered.notes).toEqual([]);
    });

    it('gives no chain for no bytes — <b> with an empty argument is what AWG refuses', () => {
        expect(awgSpecForBytes(new Uint8Array(0))).toEqual([]);
    });
});
