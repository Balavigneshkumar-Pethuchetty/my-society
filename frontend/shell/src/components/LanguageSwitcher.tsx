import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton, ListItemText, Menu, MenuItem, Tooltip } from '@mui/material';
import TranslateIcon from '@mui/icons-material/Translate';
import CheckIcon from '@mui/icons-material/Check';
import { LANGUAGE_OPTIONS } from '../i18n';

// Icon-button + menu, mirroring ThemeToggle's pattern so the two utilities
// sit consistently in the navbar (and look at home standing alone on pages
// that have no navbar, like ForgotPassword). Changing the selection updates
// the shared i18next singleton immediately; LocaleSyncBridge persists it.
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation('shell');
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const open = Boolean(anchor);

  const handleSelect = (code: string) => {
    i18n.changeLanguage(code);
    setAnchor(null);
  };

  return (
    <>
      <Tooltip title={t('settings.language.label')}>
        <IconButton
          aria-label={t('settings.language.label')}
          aria-haspopup="true"
          aria-expanded={open}
          onClick={(e) => setAnchor(e.currentTarget)}
          sx={{
            color: 'rgba(203,213,225,0.9)',
            '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.08)' },
          }}
        >
          <TranslateIcon fontSize="small" />
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
        {LANGUAGE_OPTIONS.map((l) => (
          <MenuItem
            key={l.code}
            dense
            selected={i18n.language === l.code}
            onClick={() => handleSelect(l.code)}
            sx={{ gap: 1.25, py: 1 }}
          >
            <ListItemText primary={l.label} />
            {i18n.language === l.code && <CheckIcon fontSize="small" sx={{ ml: 1, color: 'primary.main' }} />}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
