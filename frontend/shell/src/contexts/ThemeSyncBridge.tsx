import { useEffect, useRef } from 'react';
import { useThemeMode } from './ThemeModeContext';
import { useUserService } from './UserServiceContext';

// Reconciles the client-only ThemeModeContext (localStorage) with the
// server-side dbUser.theme so it follows a user across devices. Lives here
// rather than inside ThemeModeContext itself because ThemeModeProvider sits
// above UserServiceProvider in the tree and can't consume it directly.
export function ThemeSyncBridge() {
  const { mode, setMode } = useThemeMode();
  const { dbUser, updateSettings } = useUserService();
  const hydrated = useRef(false);

  // Login-time hydration: the server value overrides whatever localStorage
  // had, once per login.
  useEffect(() => {
    if (dbUser && !hydrated.current) {
      hydrated.current = true;
      if (dbUser.theme && dbUser.theme !== mode) setMode(dbUser.theme);
    }
    if (!dbUser) hydrated.current = false; // logout — re-hydrate on next login
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbUser]);

  // Write-through: local mode changes after hydration sync back to the server.
  useEffect(() => {
    if (!dbUser || !hydrated.current || mode === dbUser.theme) return;
    updateSettings({ theme: mode }).catch(() => {/* non-fatal */});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  return null;
}
