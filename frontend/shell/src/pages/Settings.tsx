import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert, Box, Button, Card, CardContent, Container,
  Divider, FormControl, FormControlLabel, Grid, InputLabel,
  MenuItem, Select, Skeleton, Switch, Typography,
} from '@mui/material';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import SettingsBrightnessIcon from '@mui/icons-material/SettingsBrightness';
import { useThemeMode, ThemeMode } from '../contexts/ThemeModeContext';
import { useUserService } from '../contexts/UserServiceContext';
import { LANGUAGE_OPTIONS } from '../i18n';

// ── Appearance card ──────────────────────────────────────────────────────────
function AppearanceCard() {
  const { t } = useTranslation('shell');
  const { mode, setMode } = useThemeMode();

  const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: React.ReactNode }[] = [
    { mode: 'light',  label: t('theme.light'),  icon: <LightModeIcon fontSize="small" /> },
    { mode: 'dark',   label: t('theme.dark'),   icon: <DarkModeIcon fontSize="small" /> },
    { mode: 'system', label: t('theme.system'), icon: <SettingsBrightnessIcon fontSize="small" /> },
  ];

  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardContent sx={{ p: 3 }}>
        <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>{t('settings.appearance.title')}</Typography>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          {THEME_OPTIONS.map((o) => (
            <Button
              key={o.mode}
              variant={mode === o.mode ? 'contained' : 'outlined'}
              startIcon={o.icon}
              onClick={() => setMode(o.mode)}
              sx={{ textTransform: 'none', borderRadius: 1.5 }}
            >
              {o.label}
            </Button>
          ))}
        </Box>
        <Typography fontSize={12} color="text.secondary" sx={{ mt: 1.5 }}>
          {t('settings.appearance.hint')}
        </Typography>
      </CardContent>
    </Card>
  );
}

// ── Language card ────────────────────────────────────────────────────────────
function LanguageCard() {
  const { t, i18n } = useTranslation('shell');

  // Bind directly to i18n.language rather than local state: i18next is a
  // federation singleton, and useTranslation() already re-renders this
  // component on its 'languageChanged' event, so the dropdown reflects a
  // change made anywhere (header switcher, another tab/MFE) immediately,
  // with no refresh needed. LocaleSyncBridge persists the choice to
  // localStorage + the account as soon as that same event fires.
  const handleChange = (value: string) => {
    i18n.changeLanguage(value);
  };

  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardContent sx={{ p: 3 }}>
        <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>{t('settings.language.title')}</Typography>
        <FormControl sx={{ minWidth: 220 }}>
          <InputLabel id="settings-locale-label">{t('settings.language.label')}</InputLabel>
          <Select
            labelId="settings-locale-label"
            label={t('settings.language.label')}
            value={i18n.language}
            onChange={(e) => handleChange(e.target.value)}
          >
            {LANGUAGE_OPTIONS.map((l) => (
              <MenuItem key={l.code} value={l.code}>{l.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography fontSize={12} color="text.secondary" sx={{ mt: 1.5 }}>
          {t('settings.language.hint')}
        </Typography>
      </CardContent>
    </Card>
  );
}

// ── Notifications card ───────────────────────────────────────────────────────
function NotificationsCard() {
  const { t } = useTranslation('shell');
  const { dbUser, updateSettings } = useUserService();
  const [busy,  setBusy]  = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!dbUser) return null;

  const toggle = async (key: 'notify_sms' | 'notify_email' | 'notify_telegram', checked: boolean) => {
    setError(null);
    setBusy(key);
    try {
      await updateSettings({ [key]: checked });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('settings.notifications.error'));
    } finally {
      setBusy(null);
    }
  };

  const rows: { key: 'notify_sms' | 'notify_email' | 'notify_telegram'; label: string }[] = [
    { key: 'notify_sms', label: t('settings.notifications.sms') },
    { key: 'notify_email', label: t('settings.notifications.email') },
    { key: 'notify_telegram', label: t('settings.notifications.telegram') },
  ];

  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardContent sx={{ p: 3 }}>
        <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>{t('settings.notifications.title')}</Typography>
        {rows.map((r) => (
          <FormControlLabel
            key={r.key}
            sx={{ display: 'flex', ml: 0, justifyContent: 'space-between' }}
            labelPlacement="start"
            control={
              <Switch
                checked={dbUser[r.key]}
                disabled={busy === r.key}
                onChange={(e) => toggle(r.key, e.target.checked)}
              />
            }
            label={r.label}
          />
        ))}
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function Settings() {
  const { t } = useTranslation('shell');
  const { dbUser, isSyncing, syncError } = useUserService();

  return (
    <Box component="main">
      <Box
        sx={{
          background: 'linear-gradient(135deg, #1e293b 0%, #312e81 100%)',
          color: '#fff',
          py: { xs: 5, md: 7 },
          px: 3,
        }}
      >
        <Container maxWidth="lg">
          <Typography variant="h5" fontWeight={800}>{t('settings.title')}</Typography>
          <Typography sx={{ color: '#a5b4fc', fontSize: 14, mt: 0.5 }}>
            {t('settings.subtitle')}
          </Typography>
        </Container>
      </Box>

      <Box sx={{ py: 5, px: 3 }}>
        <Container maxWidth="md">
          {syncError && (
            <Alert severity="warning" sx={{ mb: 3 }}>
              {t('settings.syncErrorPrefix')} {syncError}. {t('settings.syncErrorSuffix')}
            </Alert>
          )}

          <Grid container spacing={3}>
            <Grid item xs={12}>
              {isSyncing || !dbUser ? (
                <Card variant="outlined" sx={{ borderRadius: 2 }}>
                  <CardContent sx={{ p: 3 }}>
                    <Skeleton width={160} height={28} sx={{ mb: 2 }} />
                    <Skeleton height={40} />
                  </CardContent>
                </Card>
              ) : (
                <AppearanceCard />
              )}
            </Grid>

            <Grid item xs={12}><Divider /></Grid>

            <Grid item xs={12}>
              {isSyncing || !dbUser ? (
                <Card variant="outlined" sx={{ borderRadius: 2 }}>
                  <CardContent sx={{ p: 3 }}>
                    <Skeleton width={160} height={28} sx={{ mb: 2 }} />
                    <Skeleton height={56} sx={{ borderRadius: 1.5 }} />
                  </CardContent>
                </Card>
              ) : (
                <LanguageCard />
              )}
            </Grid>

            <Grid item xs={12}><Divider /></Grid>

            <Grid item xs={12}>
              {isSyncing || !dbUser ? (
                <Card variant="outlined" sx={{ borderRadius: 2 }}>
                  <CardContent sx={{ p: 3 }}>
                    <Skeleton width={160} height={28} sx={{ mb: 2 }} />
                    <Skeleton height={40} />
                    <Skeleton height={40} sx={{ mt: 1 }} />
                    <Skeleton height={40} sx={{ mt: 1 }} />
                  </CardContent>
                </Card>
              ) : (
                <NotificationsCard />
              )}
            </Grid>
          </Grid>
        </Container>
      </Box>
    </Box>
  );
}
