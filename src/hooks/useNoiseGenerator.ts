/**
 * State for the noise generator: a recipe being edited, the bytes it renders
 * to, and what is wrong with it.
 *
 * Building a packet is asynchronous (the QUIC Initial is encrypted through
 * WebCrypto), so an edit lands in two parts: the parameter is stored at once,
 * which is what keeps typing responsive, and the bytes follow. A counter
 * drops the result of an edit that a newer one has already replaced, so a
 * slow draw cannot overwrite a fast one that came after it.
 *
 * The parameters live here and never reach the config — `toNoiseItems` is the
 * only thing the outbound ever sees.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { cryptoRng } from '../core/noise/bytes';
import {
    combinationNotes,
    datagramCount,
    fromNoiseItems,
    largestDatagram,
    newTemplate,
    packetStep,
    recipeProblems,
    redrawRecipe,
    redrawStep,
    renderStep,
    renderTemplate,
    toNoiseItems,
    type JunkStep,
    type PacketStep,
    type Recipe,
    type Step,
    type Template,
    type TemplateKind,
} from '../core/noise/recipe';
import { awgObfuscationFromRecipe, recipeFromAwgInterface } from '../core/noise/awg';
import type { Note } from '../core/noise/types';
import { t } from '../i18n';

/** A junk step as it reads when first added: AmneziaWG's own defaults. */
const DEFAULT_JUNK: JunkStep = { kind: 'junk', count: 4, size: '40-70' };

/**
 * A build that threw, as something to read rather than an unhandled
 * rejection. The step keeps whatever it last built successfully.
 */
const buildFailed = (error: unknown): Note => ({
    severity: 'warning',
    message: t("This packet could not be built, so it still holds the last version that worked: {reason}", {
        reason: error instanceof Error ? error.message : String(error),
    }),
});

const replaceStep = (recipe: Recipe, index: number, next: (step: Step) => Step): Recipe => {
    const steps = recipe.steps.map((step, at) => (at === index ? next(step) : step));
    return { ...recipe, steps };
};

export const useNoiseGenerator = (initialItems?: unknown, initialReset?: unknown) => {
    const [recipe, setRecipe] = useState<Recipe>(() => fromNoiseItems(initialItems, initialReset));
    const [selected, setSelected] = useState(0);
    const [renderNotes, setRenderNotes] = useState<Note[]>([]);
    const [busy, setBusy] = useState(false);
    // One counter per edit, so a draw that has been superseded is discarded
    // rather than landing on top of a newer one.
    const latest = useRef(0);

    const draw = useCallback((index: number, update: (step: PacketStep) => PacketStep) => {
        const current = recipe.steps[index];
        if (current?.kind !== 'packet') return;
        const edited = update(current);
        const token = ++latest.current;
        // The parameter first: the form must not wait on a packet build.
        setRecipe(value => replaceStep(value, index, step => (step.kind === 'packet' ? edited : step)));
        setBusy(true);
        void (async () => {
            try {
                const drawn = await renderStep(edited);
                if (latest.current !== token) return;
                setRecipe(value => replaceStep(value, index, step => (step.kind === 'packet' ? drawn.step : step)));
                setRenderNotes(drawn.notes);
            } catch (error) {
                if (latest.current !== token) return;
                setRenderNotes([buildFailed(error)]);
            } finally {
                if (latest.current === token) setBusy(false);
            }
        })();
    }, [recipe]);

    const addPacket = useCallback(async (kind: TemplateKind) => {
        setBusy(true);
        try {
            const { step, notes } = await packetStep(newTemplate(kind, cryptoRng), cryptoRng);
            setRecipe(value => ({ ...value, steps: [...value.steps, step] }));
            setSelected(recipe.steps.length);
            setRenderNotes(notes);
        } catch (error) {
            setRenderNotes([buildFailed(error)]);
        } finally {
            setBusy(false);
        }
    }, [recipe.steps.length]);

    const addJunk = useCallback(() => {
        setRecipe(value => ({ ...value, steps: [...value.steps, { ...DEFAULT_JUNK }] }));
        setSelected(recipe.steps.length);
    }, [recipe.steps.length]);

    const removeStep = useCallback((index: number) => {
        setRecipe(current => ({ ...current, steps: current.steps.filter((_, at) => at !== index) }));
        setSelected(current => (index < current ? current - 1 : current));
    }, []);

    /** Order is what goes on the wire first, so moving a step is a real edit. */
    const moveStep = useCallback((index: number, by: -1 | 1) => {
        setRecipe(current => {
            const target = index + by;
            if (target < 0 || target >= current.steps.length) return current;
            const steps = [...current.steps];
            const moved = steps[index];
            const other = steps[target];
            if (!moved || !other) return current;
            steps[index] = other;
            steps[target] = moved;
            return { ...current, steps };
        });
        setSelected(current => (current === index ? index + by : current));
    }, []);

    const setTemplate = useCallback((index: number, template: Template) => {
        draw(index, step => ({ ...step, template }));
    }, [draw]);

    /** A different packet of the same kind: a new identity and a new seed. */
    const redraw = useCallback((index: number) => {
        const current = recipe.steps[index];
        if (current?.kind !== 'packet') return;
        const token = ++latest.current;
        setBusy(true);
        void (async () => {
            try {
                const drawn = await redrawStep(current, cryptoRng);
                if (latest.current !== token) return;
                setRecipe(value => replaceStep(value, index, step => (step.kind === 'packet' ? drawn.step : step)));
                setRenderNotes(drawn.notes);
            } catch (error) {
                if (latest.current !== token) return;
                setRenderNotes([buildFailed(error)]);
            } finally {
                if (latest.current === token) setBusy(false);
            }
        })();
    }, [recipe]);

    const redrawAll = useCallback(() => {
        setBusy(true);
        const token = ++latest.current;
        void (async () => {
            try {
                const drawn = await redrawRecipe(recipe, cryptoRng);
                if (latest.current !== token) return;
                setRecipe(drawn.recipe);
                setRenderNotes(drawn.notes);
            } catch (error) {
                if (latest.current !== token) return;
                setRenderNotes([buildFailed(error)]);
            } finally {
                if (latest.current === token) setBusy(false);
            }
        })();
    }, [recipe]);

    const setDelay = useCallback((index: number, delay: string) => {
        setRecipe(current => replaceStep(current, index, step => {
            const next = { ...step };
            if (delay.trim() === '') delete next.delay;
            else next.delay = delay;
            return next;
        }));
    }, []);

    const setJunk = useCallback((index: number, patch: Partial<JunkStep>) => {
        setRecipe(current => replaceStep(current, index, step => (step.kind === 'junk' ? { ...step, ...patch } : step)));
    }, []);

    const setReset = useCallback((reset: string) => {
        setRecipe(current => {
            const next = { ...current };
            if (reset.trim() === '') delete next.reset;
            else next.reset = reset;
            return next;
        });
    }, []);

    /** Replace the whole recipe — a preset, or an imported AmneziaWG profile. */
    const load = useCallback((next: Recipe, notes: Note[] = []) => {
        setRecipe(next);
        setRenderNotes(notes);
        setSelected(0);
    }, []);

    /** The `[Interface]` half of an AmneziaWG .conf, as a recipe. */
    const loadAwgInterface = useCallback(async (iface: Record<string, string>) => {
        setBusy(true);
        const { recipe: next, notes } = await recipeFromAwgInterface(iface, cryptoRng);
        load(next, notes);
        setBusy(false);
    }, [load]);

    const items = useMemo(() => toNoiseItems(recipe), [recipe]);
    const problems = useMemo(() => [...recipeProblems(recipe), ...combinationNotes(recipe)], [recipe]);
    const awg = useMemo(() => awgObfuscationFromRecipe(recipe), [recipe]);

    const step = recipe.steps[selected];

    return {
        recipe,
        step,
        selected,
        select: setSelected,
        busy,
        /** What the layer will hold once this is applied. */
        items,
        /**
         * What is wrong with the recipe itself. The AmneziaWG notes are
         * deliberately not folded in: they are about what an export would
         * lose, not about these datagrams, and they are shown beside the
         * export where they mean something — in both places they would read
         * as two problems instead of one.
         */
        notes: useMemo(() => [...problems, ...renderNotes], [problems, renderNotes]),
        awg,
        stats: useMemo(
            () => ({ count: datagramCount(recipe), largest: largestDatagram(recipe) }),
            [recipe],
        ),
        addPacket,
        addJunk,
        removeStep,
        moveStep,
        setTemplate,
        redrawStep: redraw,
        redrawAll,
        setDelay,
        setJunk,
        setReset,
        load,
        loadAwgInterface,
        renderTemplate,
    };
};

export type NoiseGenerator = ReturnType<typeof useNoiseGenerator>;
