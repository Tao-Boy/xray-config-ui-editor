import { useState, useEffect, useCallback } from 'react';
import { panelKey, useConfigStore } from '../store/configStore';
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
        setRemnawaveAccountRemember,
    } = useConfigStore();

    const [step, setStep] = useState<'login' | 'select'>('login');
    const [loading, setLoading] = useState(false);

    // Form State
    const [url, setUrl] = useState(remnawave.url || "");
    const [apiToken, setApiToken] = useState(remnawave.token || "");
    /**
     * Whether the token may be written to this browser's storage.
     *
     * Follows the panel already selected, so one that was set not to be
     * remembered does not quietly start being remembered again. A panel nobody
     * has chosen yet starts at "yes", matching the store's own default.
     */
    const [remember, setRemember] = useState(() => {
        const active = remnawave.accounts.find(account => account.id === remnawave.activeAccountId);
        return active?.remember ?? true;
    });

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
            connectRemnawaveToken(url, apiToken, { remember });
            setProfiles(loadedProfiles);
            setStep('select');
        } catch (e: any) {
            console.error(e);
            toast.error(t("Connection failed"), { description: t("Invalid token or panel URL") });
        } finally {
            setLoading(false);
        }
    }, [url, apiToken, remember, connectRemnawaveToken]);

    /**
     * Move to another saved panel.
     *
     * The effect above refreshes when the connection comes up, which a switch
     * never does — it was up already — so the profile list is asked for here.
     *
     * A panel whose token was not kept has its URL filled in and stays on the
     * login step: everything is ready except the one thing we deliberately did
     * not store.
     */
    const handleSwitchAccount = useCallback((id: string) => {
        const account = remnawave.accounts.find(entry => entry.id === id);
        if (!account) return;
        switchRemnawaveAccount(id);
        setUrl(account.url);
        setApiToken(account.token);
        setRemember(account.remember);
        if (!account.token) {
            setStep('login');
            return;
        }
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
        remember,
        /**
         * Flipped on the form before connecting, and on a panel already
         * connected — where it also has to reach the saved entry, or the token
         * would go on being stored under a switch that says it is not.
         */
        setRemember: useCallback((next: boolean) => {
            setRemember(next);
            const active = remnawave.accounts.find(
                account => account.id === remnawave.activeAccountId,
            );
            // Only the panel the form is still pointing at: with a URL typed
            // over, the flag belongs to the panel being connected to, and gets
            // there through connectRemnawaveToken.
            if (active && panelKey(active.url) === panelKey(url)) {
                setRemnawaveAccountRemember(active.id, next);
            }
        }, [remnawave.accounts, remnawave.activeAccountId, url, setRemnawaveAccountRemember]),
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
