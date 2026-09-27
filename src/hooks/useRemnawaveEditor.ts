import { useState, useEffect, useCallback } from 'react';
import { useConfigStore } from '../store/configStore';
import { RemnawaveClient, type RemnawaveProfile } from '../utils/remnawave-client';
import { toast } from 'sonner';
import { t } from '../i18n';

export const useRemnawaveEditor = (onClose: () => void) => {
    const { 
        remnawave, 
        connectRemnawaveToken, 
        fetchRemnawaveProfiles, 
        loadRemnawaveProfile,
        disconnectRemnawave,
        switchRemnawaveAccount,
        forgetRemnawaveAccount,
        renameRemnawaveAccount,
    } = useConfigStore();
    
    const [step, setStep] = useState<'login' | 'select'>('login');
    const [loading, setLoading] = useState(false);

    // Form State
    const [url, setUrl] = useState(remnawave.url || "");
    const [apiToken, setApiToken] = useState(remnawave.token || "");
    
    // Profiles
    const [profiles, setProfiles] = useState<RemnawaveProfile[]>([]);

    const handleRefreshProfiles = useCallback(async () => {
        setLoading(true);
        try {
            const list = await fetchRemnawaveProfiles();
            setProfiles(list);
        } catch {
            setStep('login');
        } finally {
            setLoading(false);
        }
    }, [fetchRemnawaveProfiles]);

    useEffect(() => {
        if (remnawave.connected) {
            // The connection settles asynchronously; the step it implies
            // cannot be computed during the render that preceded it.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setStep('select');
            handleRefreshProfiles();
        }
    }, [remnawave.connected, handleRefreshProfiles]);

    const handleConnect = useCallback(async () => {
        if (!url || !apiToken) {
            toast.error(t("Please fill URL and API Token"));
            return;
        }
        setLoading(true);
        try {
            const client = new RemnawaveClient(url);
            client.setToken(apiToken);
            
            const loadedProfiles = await client.getConfigProfiles();
            
            // Если профили загрузились — токен валидный
            connectRemnawaveToken(url, apiToken);
            setProfiles(loadedProfiles);
            setStep('select');
        } catch (e: any) {
            console.error(e);
            toast.error(t("Connection failed"), { description: t("Invalid token or panel URL") });
        } finally {
            setLoading(false);
        }
    }, [url, apiToken, connectRemnawaveToken]);

    /**
     * Move to another saved panel.
     *
     * The effect above refreshes when the connection comes up, which a switch
     * never does — it was up already — so the profile list is asked for here.
     */
    const handleSwitchAccount = useCallback((id: string) => {
        const account = remnawave.accounts.find(entry => entry.id === id);
        if (!account) return;
        switchRemnawaveAccount(id);
        setUrl(account.url);
        setApiToken(account.token);
        setStep('select');
        handleRefreshProfiles();
    }, [remnawave.accounts, switchRemnawaveAccount, handleRefreshProfiles]);

    const handleForgetAccount = useCallback((id: string) => {
        const wasActive = remnawave.activeAccountId === id;
        forgetRemnawaveAccount(id);
        if (wasActive) {
            setStep('login');
            setApiToken('');
        }
    }, [remnawave.activeAccountId, forgetRemnawaveAccount]);

    const handleSelectProfile = useCallback(async (uuid: string) => {
        setLoading(true);
        await loadRemnawaveProfile(uuid);
        setLoading(false);
        onClose();
    }, [loadRemnawaveProfile, onClose]);

    return {
        remnawave,
        step,
        setStep,
        loading,
        url,
        setUrl,
        apiToken,
        setApiToken,
        profiles,
        handleRefreshProfiles,
        handleConnect,
        handleSelectProfile,
        disconnectRemnawave,
        accounts: remnawave.accounts,
        activeAccountId: remnawave.activeAccountId,
        handleSwitchAccount,
        handleForgetAccount,
        renameRemnawaveAccount,
    };
};
