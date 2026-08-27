import * as i18nextNS from 'i18next';
import type { i18n as I18nInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

// Federation's shared-singleton runtime can hand back the ES module namespace
// object instead of unwrapping `.default` — i18next only re-exports
// init/use/changeLanguage/etc. as named exports, not its EventEmitter methods
// (on/off), so code calling `i18n.on(...)` throws "i18n.on is not a function"
// against the raw namespace. Prefer `.default` when present.
const i18n = ((i18nextNS as unknown as { default?: I18nInstance }).default ?? i18nextNS) as I18nInstance;
import en from './locales/en.json';
import hi from './locales/hi.json';
import ta from './locales/ta.json';
import te from './locales/te.json';
import kn from './locales/kn.json';
import ml from './locales/ml.json';

export const SUPPORTED_LOCALES = ['en', 'hi', 'ta', 'te', 'kn', 'ml'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

// Native endonyms (not translated per-locale) so a language is always
// recognizable in its own script, regardless of the currently active UI language.
export const LANGUAGE_OPTIONS: { code: SupportedLocale; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'ta', label: 'தமிழ்' },
  { code: 'te', label: 'తెలుగు' },
  { code: 'kn', label: 'ಕನ್ನಡ' },
  { code: 'ml', label: 'മലയാളം' },
];

export const STORAGE_KEY = 'gmgt-locale';

export function isSupportedLocale(value: string | null | undefined): value is SupportedLocale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function readStoredLocale(): SupportedLocale {
  const stored = localStorage.getItem(STORAGE_KEY);
  return isSupportedLocale(stored) ? stored : 'en';
}

// i18next itself is shared as a federation singleton (see vite.config.ts) so the
// shell and every MFE remote read/write the exact same runtime instance — a
// language change made anywhere is instantly reflected everywhere, no extra
// cross-remote sync code needed. Each remote still guards its own init call
// for standalone dev mode (see each MFE's own i18n bootstrap).
if (!i18n.isInitialized) {
  i18n
    .use(initReactI18next)
    .init({
      lng: readStoredLocale(),
      fallbackLng: 'en',
      supportedLngs: SUPPORTED_LOCALES as unknown as string[],
      ns: ['shell'],
      defaultNS: 'shell',
      resources: {
        en: { shell: en },
        hi: { shell: hi },
        ta: { shell: ta },
        te: { shell: te },
        kn: { shell: kn },
        ml: { shell: ml },
      },
      interpolation: { escapeValue: false },
      returnNull: false,
    });
}

export default i18n;
