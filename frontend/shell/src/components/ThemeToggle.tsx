import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip } from '@mui/material';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import SettingsBrightnessIcon from '@mui/icons-material/SettingsBrightness';
import CheckIcon from '@mui/icons-material/Check';
import { ThemeMode, useThemeMode } from '../contexts/ThemeModeContext';

export function ThemeToggle() {
  const { t } = useTranslation('shell');
  const { mode, resolvedMode, setMode } = useThemeMode();
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const open = Boolean(anchor);

  const OPTIONS: { mode: ThemeMode; label: string; icon: React.ReactNode }[] = [
    { mode: 'light',  label: t('theme.light'),  icon: <LightModeIcon fontSize="small" /> },
    { mode: 'dark',   label: t('theme.dark'),   icon: <DarkModeIcon fontSize="small" /> },
    { mode: 'system', label: t('theme.system'), icon: <SettingsBrightnessIcon fontSize="small" /> },
  ];

  const CurrentIcon = resolvedMode === 'dark' ? DarkModeIcon : LightModeIcon;

  return (
    <>
      <Tooltip title={t('theme.tooltip')}>
        <IconButton
          aria-label={t('theme.changeThemeAria')}
          aria-haspopup="true"
          aria-expanded={open}
          onClick={(e) => setAnchor(e.currentTarget)}
          sx={{
            color: 'rgba(203,213,225,0.9)',
            '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.08)' },
          }}
        >
          <CurrentIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={anchor}
        open={open}
        onClose={() => setAnchor(null)}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        PaperProps={{ elevation: 4, sx: { width: 190, borderRadius: 1.5, mt: 1 } }}
      >
        {OPTIONS.map((o) => (
          <MenuItem
            key={o.mode}
            dense
            selected={mode === o.mode}
            onClick={() => { setMode(o.mode); setAnchor(null); }}
            sx={{ gap: 1.25, py: 1 }}
          >
            <ListItemIcon sx={{ minWidth: 0 }}>{o.icon}</ListItemIcon>
            <ListItemText primary={o.label} />
            {mode === o.mode && <CheckIcon fontSize="small" sx={{ ml: 1, color: 'primary.main' }} />}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
