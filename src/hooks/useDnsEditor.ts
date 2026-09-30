import { useState, useCallback, useMemo } from 'react';
import { useConfigStore } from '../store/configStore';
import { useShallow } from 'zustand/react/shallow';

/**
 * Where the entry at `index` sits after the one at `from` moved to `to`:
 * the moved entry lands on `to`, the ones it passed shift one place back
 * toward where it came from.
 */
export const indexAfterMove = (index: number, from: number, to: number): number => {
    if (index === from) return to;
    if (from < index && index <= to) return index - 1;
    if (to <= index && index < from) return index + 1;
    return index;
};

/** Where the entry at `index` sits after the one at `removed` is deleted; null if it was that one. */
export const indexAfterRemove = (index: number, removed: number): number | null =>
    index === removed ? null : index > removed ? index - 1 : index;

export const useDnsEditor = () => {
    const { config, updateSection } = useConfigStore(useShallow(state => ({ config: state.config, updateSection: state.updateSection })));
    // Memoised so the callbacks below keep their identity between renders.
    const dns = useMemo(() => config?.dns || {}, [config?.dns]);
    const fakedns = useMemo(() => config?.fakedns || [], [config?.fakedns]);

    const [activeTab, setActiveTab] = useState<'general' | 'servers' | 'hosts' | 'fakedns'>('servers');
    const [editingServerIdx, setEditingServerIdx] = useState<number | null>(null);
    const [rawMode, setRawMode] = useState(false);
    const [mobileEditMode, setMobileEditMode] = useState(false);

    const handleUpdateDns = useCallback((newDns: any) => {
        updateSection('dns', newDns);
    }, [updateSection]);

    const handleAddServer = useCallback((initialVal: any) => {
        const newServers = [...(dns.servers || []), initialVal];
        handleUpdateDns({ ...dns, servers: newServers });
        if (typeof initialVal !== 'string') {
            setEditingServerIdx(newServers.length - 1);
            setMobileEditMode(true);
        }
    }, [dns, handleUpdateDns]);

    const handleSelectServer = useCallback((idx: number) => {
        setEditingServerIdx(idx);
        setMobileEditMode(true);
    }, []);

    // The open pane is an index into the list, so anything that shifts the
    // list has to carry it along — or the pane quietly starts editing the
    // server that slid into its slot.
    const handleDeleteServer = useCallback((idx: number) => {
        const newServers = [...(dns.servers || [])];
        newServers.splice(idx, 1);
        handleUpdateDns({ ...dns, servers: newServers });
        if (editingServerIdx === null) return;
        const next = indexAfterRemove(editingServerIdx, idx);
        setEditingServerIdx(next);
        if (next === null) setMobileEditMode(false);
    }, [dns, handleUpdateDns, editingServerIdx]);

    const handleMoveServer = useCallback((from: number, to: number) => {
        const servers = [...(dns.servers || [])];
        if (from === to || to < 0 || to >= servers.length) return;
        const [moved] = servers.splice(from, 1);
        if (moved === undefined) return;
        servers.splice(to, 0, moved);
        handleUpdateDns({ ...dns, servers });
        if (editingServerIdx !== null) setEditingServerIdx(indexAfterMove(editingServerIdx, from, to));
    }, [dns, handleUpdateDns, editingServerIdx]);

    const handleUpdateServer = useCallback((val: any) => {
        if (editingServerIdx === null) return;
        const newServers = [...(dns.servers || [])];
        newServers[editingServerIdx] = val;
        handleUpdateDns({ ...dns, servers: newServers });
    }, [dns, editingServerIdx, handleUpdateDns]);

    const handleCompositeUpdate = useCallback((newVal: any, rawText?: string) => {
        if (!newVal) return;
        if (newVal.dns) updateSection('dns', newVal.dns, rawText);
        if (newVal.fakedns) updateSection('fakedns', newVal.fakedns);
    }, [updateSection]);

    const updateHosts = useCallback((h: any) => {
        handleUpdateDns({ ...dns, hosts: h });
    }, [dns, handleUpdateDns]);

    const updateFakedns = useCallback((val: any) => {
        updateSection('fakedns', val);
    }, [updateSection]);

    return {
        dns,
        fakedns,
        activeTab,
        setActiveTab,
        editingServerIdx,
        setEditingServerIdx,
        rawMode,
        setRawMode,
        mobileEditMode,
        setMobileEditMode,
        handleUpdateDns,
        handleAddServer,
        handleSelectServer,
        handleDeleteServer,
        handleMoveServer,
        handleUpdateServer,
        handleCompositeUpdate,
        updateHosts,
        updateFakedns
    };
};
