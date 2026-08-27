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

const STORAGE_KEY = 'gmgt-locale';
const SUPPORTED = ['en', 'hi', 'ta', 'te', 'kn', 'ml'];

function readStoredLocale(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored && SUPPORTED.includes(stored) ? stored : 'en';
}

// i18next itself is shared as a federation singleton (see vite.config.ts), so this
// MFE reads/writes the exact same runtime instance as the shell and every other
// remote — a language change made anywhere is instantly reflected here too. This
// bootstrap only needs to guard its own init call for standalone dev mode (no shell
// present to have already called i18next.init()), and always register its own
// namespace bundle regardless of which remote/host loads first.
if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    lng: readStoredLocale(),
    fallbackLng: 'en',
    ns: ['admin'],
    defaultNS: 'admin',
    resources: {},
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

const BUNDLES: Record<string, object> = { en, hi, ta, te, kn, ml };
for (const [lng, data] of Object.entries(BUNDLES)) {
  i18n.addResourceBundle(lng, 'admin', data, true, true);
}

export default i18n;
