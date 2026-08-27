import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
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

// i18next itself is shared as a federation singleton (see vite.config.ts) so the
// shell and every MFE remote read/write the exact same runtime instance — a
// language change made anywhere is instantly reflected everywhere. Standalone
// dev mode (no shell present) still needs its own init, hence the guard below.
if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    lng: readStoredLocale(),
    fallbackLng: 'en',
    ns: ['tickets'],
    defaultNS: 'tickets',
    resources: {},
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

const BUNDLES: Record<string, object> = { en, hi, ta, te, kn, ml };
for (const [lng, data] of Object.entries(BUNDLES)) {
  i18n.addResourceBundle(lng, 'tickets', data, true, true);
}

export default i18n;
