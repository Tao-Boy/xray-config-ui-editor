import { useSyncExternalStore } from 'react';
import { ru } from './ru';
import { zhCN } from './zh-CN';
import { z } from 'zod';
import chineseLocale from 'zod/v4/locales/zh-CN.js';
import englishLocale from 'zod/v4/locales/en.js';
import russianLocale from 'zod/v4/locales/ru.js';

export type Lang = 'zh-CN' | 'en' | 'ru';

export const LANGUAGES: { code: Lang; label: string; short: string }[] = [
    { code: 'zh-CN', label: '简体中文', short: '中文' },
    { code: 'en', label: 'English', short: 'EN' },
    { code: 'ru', label: 'Русский', short: 'RU' },
];

/**
 * English source text doubles as the lookup key — gettext style.
 *
 * The alternative, invented keys like `builder.template.saveButton`, buys
 * nothing here and costs a lot: every string would need a name, the JSX would
 * stop being readable on its own, and a typo would silently render the key.
 * With the source text as the key, a missing translation falls back to perfectly
 * good English, so the app is never broken by an incomplete dictionary, and
 * `bun test` can diff the two sides to report what is still untranslated.
 */
const DICTIONARIES: Record<Lang, Record<string, string>> = { 'zh-CN': zhCN, en: {}, ru };

const STORAGE_KEY = 'xray-ui-lang';

const isLang = (v: unknown): v is Lang => v === 'zh-CN' || v === 'en' || v === 'ru';

/** This fork defaults to Chinese; an explicit saved choice always wins. */
export const detectLang = (): Lang => {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (isLang(saved)) return saved;
    } catch {
        // Storage blocked or absent: the Chinese default still works.
    }
    return 'zh-CN';
};

let current: Lang = detectLang();
const listeners = new Set<() => void>();

// Stamped on load as well as on every switch: index.html can only carry one
// language, and a wrong `lang` sends screen readers and spellcheckers down the
// wrong dictionary before anyone has touched the switch.
const syncDocument = () => {
    z.config(current === 'zh-CN' ? chineseLocale() : current === 'ru' ? russianLocale() : englishLocale());
    if (typeof document === 'undefined') return;
    document.documentElement.lang = current;
    document.title = DICTIONARIES[current]['Xray Config Editor'] ?? 'Xray Config Editor';
};
syncDocument();

export const getLang = (): Lang => current;

export const setLang = (lang: Lang) => {
    if (lang === current) return;
    current = lang;
    try {
        localStorage.setItem(STORAGE_KEY, lang);
    } catch {
        // Not persisting is survivable; switching within the session still works.
    }
    syncDocument();
    listeners.forEach(fn => fn());
};

const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => {
        listeners.delete(fn);
    };
};

/** Subscribes a component to the active language. */
export const useLang = (): Lang => useSyncExternalStore(subscribe, getLang, getLang);

export type TVars = Record<string, string | number | undefined | null>;

const interpolate = (text: string, vars?: TVars) =>
    vars
        ? text.replace(/\{(\w+)\}/g, (whole, name: string) =>
              name in vars && vars[name] != null ? String(vars[name]) : whole,
          )
        : text;

/**
 * Translates `key` into the active language, falling back to the key itself.
 *
 * Deliberately a plain function rather than a hook, so the same call works in
 * store actions, validators and toasts as in JSX. Components stay in sync
 * because switching the language remounts the tree (see `I18nRoot`), which also
 * means no component can hold a stale translation in memoised state.
 */
export const t = (key: string, vars?: TVars): string =>
    interpolate(DICTIONARIES[current][key] ?? key, vars);

/**
 * Picks a plural form. English needs two, Russian needs three, so the caller
 * passes all three and each language takes what it uses:
 *
 *   tn(n, '{n} node', '{n} nodes')                      → en
 *   '{n} узел|{n} узла|{n} узлов' as the ru translation  → ru
 */
export const tn = (n: number, one: string, many: string, vars?: TVars): string => {
    const key = `${one}|${many}`;
    const forms = (DICTIONARIES[current][key] ?? key).split('|');
    const index = current === 'zh-CN' ? 0 : current === 'ru' ? russianPluralIndex(n) : n === 1 ? 0 : 1;
    const form = forms[Math.min(index, forms.length - 1)] ?? key;
    return interpolate(form, { n, ...vars });
};

const russianPluralIndex = (n: number): 0 | 1 | 2 => {
    const abs = Math.abs(n);
    const mod10 = abs % 10;
    const mod100 = abs % 100;
    if (mod10 === 1 && mod100 !== 11) return 0; // 1 узел
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 1; // 2 узла
    return 2; // 5 узлов
};

/**
 * Memoises a value built from translated strings, rebuilding it when the
 * language changes.
 *
 * A module-level `const LABELS = { ok: t('OK') }` is evaluated once, at import,
 * so it would keep the language that was active then — the one case where
 * remounting the tree is not enough. Tables of labels declared outside a
 * component go through this instead:
 *
 *   const labels = perLanguage(() => ({ ok: t('OK') }));
 *   labels().ok
 */
export const perLanguage = <T>(build: () => T): (() => T) => {
    let cached: T;
    let builtFor: Lang | null = null;
    return () => {
        if (builtFor !== current) {
            cached = build();
            builtFor = current;
        }
        return cached;
    };
};

/** Exposed for the coverage test in `i18n.test.ts`. */
export const dictionaryFor = (lang: Lang) => DICTIONARIES[lang];
