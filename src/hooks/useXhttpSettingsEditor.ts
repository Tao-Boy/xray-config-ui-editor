/**
 * Business logic for XhttpSettingsEditor: the generic path-based deep-clone
 * updater plus the derived `extra`/`xmux` sub-objects it reads from.
 * Extracted out of XhttpSettingsEditor.tsx (RuleEditor-style) —
 * `xhttpSettings` is a whole-object value and `onChange` replaces it
 * wholesale (no store path), so this does not fit the path-based
 * useField/useArrayField model. UI-only view-state (which collapsible
 * sections are open) stays local to the component, same as RuleEditor
 * keeps its own local view state alongside useRuleEditor.
 */
export function useXhttpSettingsEditor(xhttpSettings: any, onChange: (v: any) => void) {
    const update = (path: string[], value: any) => {
        const newObj = JSON.parse(JSON.stringify(xhttpSettings ?? {}));
        let curr = newObj;
        for (let i = 0; i < path.length - 1; i++) {
            const key = path[i]!;
            if (!curr[key]) curr[key] = {};
            curr = curr[key];
        }

        const lastKey = path[path.length - 1]!;
        if (value === "" || value === undefined || value === null) {
            delete curr[lastKey];
        } else {
            curr[lastKey] = value;
        }

        // downloadSettings is a whole stream of its own, and the dialer
        // asserts it is XHTTP without checking — `memory2.ProtocolSettings.(*Config)`
        // (v26.7.28:transport/internet/splithttp/dialer.go:405) — so one written
        // without a network is a panic on the first dial, not a fallback.
        const download = newObj.extra?.downloadSettings;
        if (path[0] === 'extra' && path[1] === 'downloadSettings' && download && typeof download === 'object' && !download.network) {
            download.network = 'xhttp';
        }
        onChange(newObj);
    };

    const extra = xhttpSettings?.extra || {};
    const xmux = extra.xmux || {};

    return { update, extra, xmux };
}
