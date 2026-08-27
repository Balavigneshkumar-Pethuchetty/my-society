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

// i18next is a federation singleton (see vite.config.ts) so in production this
// remote shares the shell's already-initialized instance — this guard only
// fires for standalone dev mode (npm run dev, no shell present).
if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    lng: readStoredLocale(),
    fallbackLng: 'en',
    ns: ['booking'],
    defaultNS: 'booking',
    resources: {},
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

const BUNDLES: Record<string, object> = { en, hi, ta, te, kn, ml };
for (const [lng, data] of Object.entries(BUNDLES)) {
  i18n.addResourceBundle(lng, 'booking', data, true, true);
}

export default i18n;
