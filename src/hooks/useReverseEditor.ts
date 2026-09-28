import { useState, useCallback, useMemo } from 'react';
import { useConfigStore } from '../store/configStore';

export const useReverseEditor = () => {
    // One slice each, not the whole store: destructuring useConfigStore()
    // re-rendered this modal on every change anywhere in the app — a panel
    // fetch, a history entry, a toast-driven flag.
    const rawReverse = useConfigStore(state => state.config?.reverse);
    const updateSection = useConfigStore(state => state.updateSection);
    const toggleSection = useConfigStore(state => state.toggleSection);
    /** Whether the config has a reverse section at all — `null` decodes to nil, which every line ignores. */
    const hasReverse = rawReverse !== undefined && rawReverse !== null;
    // Memoised so the callbacks below keep their identity between renders.
    const reverse = useMemo(() => rawReverse || { bridges: [], portals: [] }, [rawReverse]);
    const [activeTab, setActiveTab] = useState<'bridges' | 'portals'>('bridges');

    const updateList = useCallback((type: 'bridges' | 'portals', newList: any[]) => {
        updateSection('reverse', { ...reverse, [type]: newList });
    }, [reverse, updateSection]);

    const addItem = useCallback((type: 'bridges' | 'portals') => {
        updateList(type, [...(reverse[type] || []), { tag: "reverse-" + type, domain: "example.com" }]);
    }, [reverse, updateList]);

    const removeItem = useCallback((type: 'bridges' | 'portals', idx: number) => {
        const n = [...(reverse[type] || [])];
        n.splice(idx, 1);
        updateList(type, n);
    }, [reverse, updateList]);

    const updateItem = useCallback((type: 'bridges' | 'portals', idx: number, field: string, val: string) => {
        const n = [...(reverse[type] || [])];
        const current = n[idx];
        // An index past the end would otherwise write a half-formed entry
        // with neither tag nor domain.
        if (!current) return;
        n[idx] = { ...current, [field]: val };
        updateList(type, n);
    }, [reverse, updateList]);

    const updateReverse = useCallback((newReverse: any, rawText?: string) => {
        updateSection('reverse', newReverse, rawText);
    }, [updateSection]);

    /**
     * Take the whole section out.
     *
     * From 26.7 any non-null `reverse`, even `{}`, stops the config loading
     * (v26.7.28:infra/conf/xray.go:607), so emptying the lists is not enough.
     * toggleSection deletes a section that is there; the guard keeps it from
     * doing the other half of its job and creating one.
     */
    const removeReverse = useCallback(() => {
        if (hasReverse) toggleSection('reverse', undefined);
    }, [hasReverse, toggleSection]);

    return {
        reverse,
        hasReverse,
        activeTab,
        setActiveTab,
        addItem,
        removeItem,
        updateItem,
        updateReverse,
        removeReverse,
    };
};
