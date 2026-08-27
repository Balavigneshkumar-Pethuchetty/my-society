import { useEffect, useRef } from 'react';
import i18n, { isSupportedLocale, STORAGE_KEY } from '../i18n';
import { useUserService } from './UserServiceContext';

// Mirrors ThemeSyncBridge's pattern: reconciles the client-only i18next
// language (localStorage, works for guests too) with the server-side
// dbUser.locale so it follows a user across devices. i18next is shared as a
// federation singleton, so calling i18n.changeLanguage() here also updates
// every mounted MFE remote's useTranslation() output — no extra plumbing.
export function LocaleSyncBridge() {
  const { dbUser, updateSettings } = useUserService();
  const hydrated = useRef(false);

  // Login-time hydration: the server value overrides whatever localStorage
  // had, once per login.
  useEffect(() => {
    if (dbUser && !hydrated.current) {
      hydrated.current = true;
      if (isSupportedLocale(dbUser.locale) && dbUser.locale !== i18n.language) {
        i18n.changeLanguage(dbUser.locale);
      }
    }
    if (!dbUser) hydrated.current = false; // logout — re-hydrate on next login
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbUser]);

  // Always mirror the active language into localStorage, so it persists
  // across reloads even for guests (no dbUser yet).
  useEffect(() => {
    const onChange = (lng: string) => {
      localStorage.setItem(STORAGE_KEY, lng);
      if (dbUser && hydrated.current && lng !== dbUser.locale && isSupportedLocale(lng)) {
        updateSettings({ locale: lng }).catch(() => {/* non-fatal */});
      }
    };
    i18n.on('languageChanged', onChange);
    return () => { i18n.off('languageChanged', onChange); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbUser]);

  return null;
}
