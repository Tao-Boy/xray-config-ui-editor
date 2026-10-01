import { describe, expect, it } from 'bun:test';
import { seededRng } from './bytes';
import { awgObfuscationFromRecipe, awgProtocolNotes, isAwgInterface, recipeFromAwgInterface } from './awg';
import { toNoiseItems, type PacketStep, type Recipe } from './recipe';

/**
 * AmneziaWG does two separable things: it sends decoys around an otherwise
 * ordinary WireGuard, and it changes WireGuard itself. Only the first has an
 * equivalent here, and the difference matters more than the support does — a
 * profile whose S or H values are non-default describes a peer this app
 * cannot reach at all, and importing it quietly would produce a config that
 * looks finished and never completes a handshake.
 */

const rng = () => seededRng('awg');

/** The pasted WARP-style profile this work started from. */
const PROFILE: Record<string, string> = {
    PrivateKey: 'ai3XAvbfR3QXACMnn3iTLx6U5g7riUNz6R9kaDog5Sc=',
    Jc: '4', Jmin: '40', Jmax: '70',
    S1: '0', S2: '0', S3: '0', S4: '0',
    H1: '1', H2: '2', H3: '3', H4: '4',
    I1: '<b 0x494e56495445>',
    I2: '<b 0x5349502f322e30>',
};

describe('isAwgInterface', () => {
    it('knows an AmneziaWG profile from a plain WireGuard one', () => {
        expect(isAwgInterface(PROFILE)).toBe(true);
        expect(isAwgInterface({ PrivateKey: 'x', Address: '10.0.0.2/32' })).toBe(false);
    });
});

describe('what cannot come across', () => {
    it('says nothing when S and H are at their defaults', () => {
        // H1..H4 of 1,2,3,4 are WireGuard's own message types, and S of 0 is
        // no padding: this profile changes the protocol in no way at all.
        expect(awgProtocolNotes(PROFILE)).toEqual([]);
    });

    it('warns that padded handshakes are dropped, and says where they do not belong', () => {
        const [note] = awgProtocolNotes({ ...PROFILE, S1: '15', S2: '20' });
        expect(note?.severity).toBe('warning');
        expect(note?.message).toContain('S1 (handshake initiation)');
        expect(note?.message).toContain('S2 (handshake response)');
        // The bug this replaced wrote S1/S2 into `reserved`.
        expect(note?.message).toContain('reserved');
    });

    it('calls a renumbered message type critical, because nothing will connect', () => {
        const notes = awgProtocolNotes({ ...PROFILE, H1: '0x01020304' });
        const renumbered = notes.find(note => note.message.includes('renumbers'));
        expect(renumbered?.severity).toBe('critical');
    });

    it('names a key it does not model rather than ignoring it', () => {
        const [note] = awgProtocolNotes({ ...PROFILE, ContentPaddingAddition: '20' });
        expect(note?.message).toContain('ContentPaddingAddition');
    });
});

describe('reading the decoys', () => {
    it('takes every I line, then the junk — the order AmneziaWG sends them', () => {
        const { recipe } = recipeFromAwgInterface(
            { ...PROFILE, I3: '<b 0xaa>', I4: '<b 0xbb>', I5: '<b 0xcc>' },
            rng(),
        );
        expect(recipe.steps.map(step => step.kind)).toEqual(['packet', 'packet', 'packet', 'packet', 'packet', 'junk']);
        expect((recipe.steps[0] as PacketStep).hex).toBe('494e56495445');
        expect(recipe.steps[5]).toMatchObject({ kind: 'junk', count: 4, size: '40-70' });
    });

    it('keeps every tag of a chain, not just the first', () => {
        // Reading only the first `<b ...>` is what the old importer did, which
        // silently shortened the packet.
        const { recipe } = recipeFromAwgInterface({ I1: '<b 0xdeadbeef><r 4>' }, rng());
        const step = recipe.steps[0] as PacketStep;
        expect(step.hex.startsWith('deadbeef')).toBe(true);
        expect(step.hex).toHaveLength('deadbeef'.length + 8);
    });

    it('says when a chain had to be frozen', () => {
        // AmneziaWG redraws <r> and <t> before every handshake; Xray can only
        // carry one fixed draw, and that difference is worth a word.
        const { notes } = recipeFromAwgInterface({ I1: '<b 0xff><r 8>' }, rng());
        expect(notes.some(note => note.message.startsWith('I1:'))).toBe(true);
    });

    it('sends no delays, because AmneziaWG does not', () => {
        const { recipe } = recipeFromAwgInterface(PROFILE, rng());
        expect(recipe.steps.every(step => step.delay === undefined)).toBe(true);
    });

    it('imports nothing from a profile with no decoys', () => {
        expect(recipeFromAwgInterface({ PrivateKey: 'x' }, rng()).recipe.steps).toEqual([]);
    });
});

describe('writing the decoys back', () => {
    const round = (iface: Record<string, string>) => {
        const { recipe } = recipeFromAwgInterface(iface, rng());
        return awgObfuscationFromRecipe(recipe);
    };

    it('writes back what it read', () => {
        const out = round(PROFILE);
        expect(out.iLines).toEqual(['<b 0x494e56495445>', '<b 0x5349502f322e30>']);
        expect(out.junk).toEqual({ count: 4, min: 40, max: 70 });
        expect(out.notes).toEqual([]);
    });

    it('writes a tag chain back as it came in, random tags included', () => {
        // The chain is kept as tags, so AmneziaWG goes on redrawing <r> per
        // handshake once it has the profile again.
        expect(round({ I1: '<b 0xff><r 8>' }).iLines).toEqual(['<b 0xff><r 8>']);
    });

    it('keeps only five packets, and says how many it left', () => {
        const steps: Recipe['steps'] = Array.from({ length: 7 }, (_, i) => ({
            kind: 'packet', template: { kind: 'hex', hex: 'aa' }, hex: `0${i}`, seed: 's',
        }));
        const out = awgObfuscationFromRecipe({ steps });
        expect(out.iLines).toHaveLength(5);
        expect(out.notes.some(note => note.message.includes('the last 2 were left out'))).toBe(true);
    });

    it('says when a packet would move ahead of junk it was written after', () => {
        const out = awgObfuscationFromRecipe({
            steps: [
                { kind: 'junk', count: 1, size: '40-70' },
                { kind: 'packet', template: { kind: 'hex', hex: 'aa' }, hex: 'aa', seed: 's' },
            ],
        });
        expect(out.notes.some(note => note.message.includes('moves ahead of it'))).toBe(true);
    });

    it('collapses several junk steps into the one triple AmneziaWG has', () => {
        const out = awgObfuscationFromRecipe({
            steps: [
                { kind: 'junk', count: 2, size: '40-70' },
                { kind: 'junk', count: 3, size: '100-200' },
            ],
        });
        expect(out.junk).toEqual({ count: 5, min: 40, max: 200 });
        expect(out.notes.some(note => note.message.includes('2 junk steps became'))).toBe(true);
    });

    it('reports the three settings that have nowhere to go', () => {
        const out = awgObfuscationFromRecipe({
            reset: '120',
            steps: [
                { kind: 'packet', template: { kind: 'hex', hex: 'aa' }, hex: 'aa', seed: 's', delay: '5-10' },
                { kind: 'junk', count: 1, size: '40-70', randRange: '32-126' },
            ],
        });
        const said = (match: string) => out.notes.filter(note => note.message.includes(match));
        expect(said('Delays were dropped')).toHaveLength(1);
        expect(said('"reset" was dropped')).toHaveLength(1);
        expect(said('randRange')).toHaveLength(1);
    });
});

describe('the whole way round', () => {
    it('imports to the same datagrams it exports', () => {
        const { recipe } = recipeFromAwgInterface(PROFILE, rng());
        expect(toNoiseItems(recipe)).toEqual([
            { type: 'hex', packet: '494e56495445' },
            { type: 'hex', packet: '5349502f322e30' },
            { rand: '40-70' }, { rand: '40-70' }, { rand: '40-70' }, { rand: '40-70' },
        ]);
    });
});
