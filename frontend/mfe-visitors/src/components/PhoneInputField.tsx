/**
 * PhoneInputField
 *
 * Displays a country-code selector + formatted number input.
 * Internally stores and emits E.164 format (+919876543210),
 * which is compatible with Twilio, Fast2SMS, AWS SNS, MSG91, etc.
 *
 * Display format examples:
 *   India  (+91)  →  +91-98450-11111
 *   USA    (+1)   →  +1-650-555-1234
 *   UK     (+44)  →  +44-7911-123456
 *   UAE    (+971) →  +971-50-123-4567
 */
import '../i18n';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, InputAdornment, List, ListItemButton, Popover, TextField, Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import SearchIcon from '@mui/icons-material/Search';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import type { SxProps, Theme } from '@mui/material/styles';

// ── Country registry ──────────────────────────────────────────────────────────

interface Country {
  code: string;   // ISO-3166 alpha-2
  dial: string;   // E.164 prefix, e.g. "+91"
  flag: string;   // emoji flag
  name: string;
  digits: number; // expected local-part digit count
  mask: string;   // "X" chars + separators, e.g. "XXXXX-XXXXX"
}

const COUNTRIES: Country[] = [
  { code: 'IN', dial: '+91',  flag: '🇮🇳', name: 'India',        digits: 10, mask: 'XXXXX-XXXXX'    },
  { code: 'US', dial: '+1',   flag: '🇺🇸', name: 'USA',          digits: 10, mask: 'XXX-XXX-XXXX'   },
  { code: 'CA', dial: '+1',   flag: '🇨🇦', name: 'Canada',       digits: 10, mask: 'XXX-XXX-XXXX'   },
  { code: 'GB', dial: '+44',  flag: '🇬🇧', name: 'UK',           digits: 10, mask: 'XXXX-XXXXXX'    },
  { code: 'AU', dial: '+61',  flag: '🇦🇺', name: 'Australia',    digits: 9,  mask: 'XXX-XXX-XXX'    },
  { code: 'SG', dial: '+65',  flag: '🇸🇬', name: 'Singapore',    digits: 8,  mask: 'XXXX-XXXX'      },
  { code: 'AE', dial: '+971', flag: '🇦🇪', name: 'UAE',          digits: 9,  mask: 'XX-XXX-XXXX'    },
  { code: 'SA', dial: '+966', flag: '🇸🇦', name: 'Saudi Arabia', digits: 9,  mask: 'XX-XXX-XXXX'    },
  { code: 'DE', dial: '+49',  flag: '🇩🇪', name: 'Germany',      digits: 10, mask: 'XXXX-XXXXXX'    },
  { code: 'FR', dial: '+33',  flag: '🇫🇷', name: 'France',       digits: 9,  mask: 'X-XX-XX-XX-XX'  },
  { code: 'JP', dial: '+81',  flag: '🇯🇵', name: 'Japan',        digits: 10, mask: 'XX-XXXX-XXXX'   },
  { code: 'NZ', dial: '+64',  flag: '🇳🇿', name: 'New Zealand',  digits: 9,  mask: 'XXX-XXX-XXX'    },
  { code: 'MY', dial: '+60',  flag: '🇲🇾', name: 'Malaysia',     digits: 9,  mask: 'XX-XXXX-XXXX'   },
  { code: 'LK', dial: '+94',  flag: '🇱🇰', name: 'Sri Lanka',    digits: 9,  mask: 'XX-XXX-XXXX'    },
  { code: 'NP', dial: '+977', flag: '🇳🇵', name: 'Nepal',        digits: 10, mask: 'XX-XXXX-XXXX'   },
  { code: 'BD', dial: '+880', flag: '🇧🇩', name: 'Bangladesh',   digits: 10, mask: 'XXXXX-XXXXX'    },
  { code: 'PK', dial: '+92',  flag: '🇵🇰', name: 'Pakistan',     digits: 10, mask: 'XXX-XXXXXXX'    },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Apply a mask ("XXXXX-XXXXX") to raw digits. */
function applyMask(digits: string, mask: string): string {
  let out = '';
  let di = 0;
  for (let i = 0; i < mask.length && di < digits.length; i++) {
    if (mask[i] === 'X') {
      out += digits[di++];
    } else {
      // Only add separator if there are more digits coming
      if (di < digits.length) out += mask[i];
    }
  }
  return out;
}

/** Parse an E.164 string into (country, localDigits). */
function parseE164(e164: string, countries: Country[]): [Country, string] | null {
  if (!e164.startsWith('+')) return null;
  // Try longest dial code first to avoid +1 matching +1XX countries
  const sorted = [...countries].sort((a, b) => b.dial.length - a.dial.length);
  for (const c of sorted) {
    if (e164.startsWith(c.dial)) {
      const local = e164.slice(c.dial.length).replace(/\D/g, '');
      return [c, local];
    }
  }
  return null;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  value: string;            // E.164 string, e.g. "+919876543210" or ""
  onChange: (e164: string) => void;
  label?: string;
  size?: 'small' | 'medium';
  required?: boolean;
  helperText?: string;
  error?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Cascades to the country Select and the number TextField, e.g. for a dark-card auth page. */
  sx?: SxProps<Theme>;
  /** Rendered inside the number field's end adornment, e.g. a "Verified" chip. */
  endAdornment?: React.ReactNode;
}

export function PhoneInputField({
  value,
  onChange,
  label,
  size = 'small',
  required,
  helperText,
  error,
  disabled,
  autoFocus,
  sx,
  endAdornment,
}: Props) {
  const { t } = useTranslation('visitors');
  const resolvedLabel = label ?? t('phoneInput.defaultLabel');
  const defaultCountry = COUNTRIES[0]; // India

  const [country,    setCountry]    = useState<Country>(defaultCountry);
  const [localInput, setLocalInput] = useState('');  // formatted display string

  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [search,   setSearch]   = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const open = Boolean(anchorEl);

  const filteredCountries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter((c) =>
      c.name.toLowerCase().includes(q)
      || c.code.toLowerCase().includes(q)
      || c.dial.replace('+', '').includes(q.replace('+', ''))
    );
  }, [search]);

  const openPicker = (e: React.MouseEvent<HTMLElement>) => {
    if (disabled) return;
    setAnchorEl(e.currentTarget);
    setSearch('');
  };
  const closePicker = () => setAnchorEl(null);

  // Sync from external E.164 value (e.g. loaded from DB)
  useEffect(() => {
    if (!value) { setLocalInput(''); return; }
    const parsed = parseE164(value, COUNTRIES);
    if (parsed) {
      const [c, digits] = parsed;
      setCountry(c);
      setLocalInput(applyMask(digits, c.mask));
    } else {
      // Unrecognised prefix — show as-is stripped of dial
      setLocalInput(value.replace(/\D/g, ''));
    }
  }, [value]);

  const handleCountryChange = (code: string) => {
    const c = COUNTRIES.find((x) => x.code === code) ?? defaultCountry;
    setCountry(c);
    // Re-format existing digits with new country mask
    const digits = localInput.replace(/\D/g, '').slice(0, c.digits);
    const formatted = applyMask(digits, c.mask);
    setLocalInput(formatted);
    // Emit E.164
    if (digits) onChange(`${c.dial}${digits}`);
    else onChange('');
    closePicker();
  };

  const handleNumberChange = (raw: string) => {
    // Strip everything except digits
    const digits = raw.replace(/\D/g, '').slice(0, country.digits);
    const formatted = applyMask(digits, country.mask);
    setLocalInput(formatted);
    // Emit E.164 only when complete, or clear if empty
    if (digits.length === country.digits) {
      onChange(`${country.dial}${digits}`);
    } else if (digits.length === 0) {
      onChange('');
    } else {
      // Partial — emit what we have (caller decides whether to validate)
      onChange(`${country.dial}${digits}`);
    }
  };

  const placeholder = applyMask('X'.repeat(country.digits).replace(/X/g, '0'), country.mask);

  return (
    <Box sx={{ display: 'flex', gap: 1, ...sx }}>
      {/* Country selector — a real TextField (not a plain styled Box) so that
          callers overriding `sx` with dark-theme selectors targeting
          `.MuiOutlinedInput-root` / `.MuiInputLabel-root` (e.g. PhoneLogin's
          darkFieldSx) still theme it consistently with the number field. */}
      <TextField
        label=" "
        size={size}
        disabled={disabled}
        value={country.dial}
        onClick={openPicker}
        sx={{ minWidth: 108, '& .MuiInputBase-input': { cursor: disabled ? 'default' : 'pointer', fontWeight: 600 } }}
        InputProps={{
          readOnly: true,
          startAdornment: (
            <InputAdornment position="start">
              <Typography fontSize={18} lineHeight={1}>{country.flag}</Typography>
            </InputAdornment>
          ),
          endAdornment: <ArrowDropDownIcon fontSize="small" sx={{ color: 'text.secondary' }} />,
        }}
        inputProps={{ 'aria-label': t('phoneInput.countryCodeAria'), readOnly: true }}
      />

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={closePicker}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        TransitionProps={{ onEntered: () => searchRef.current?.focus() }}
      >
        <Box sx={{ p: 1, width: 260 }}>
          <TextField
            inputRef={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('phoneInput.searchPlaceholder')}
            size="small"
            fullWidth
            autoFocus
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
        </Box>
        <List sx={{ maxHeight: 320, overflowY: 'auto', pt: 0 }}>
          {filteredCountries.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1 }}>
              {t('phoneInput.noCountriesMatch', { search })}
            </Typography>
          )}
          {filteredCountries.map((c) => (
            <ListItemButton
              key={c.code}
              selected={c.code === country.code}
              onClick={() => handleCountryChange(c.code)}
              sx={{ gap: 1.5 }}
            >
              <Typography fontSize={18} lineHeight={1}>{c.flag}</Typography>
              <Typography fontSize={13} fontWeight={600} sx={{ flexGrow: 1 }}>{c.name}</Typography>
              <Typography fontSize={12} color="text.secondary">{c.dial}</Typography>
            </ListItemButton>
          ))}
        </List>
      </Popover>

      {/* Number input — minWidth: 0 overrides the flex-item default of
          min-width: auto, which otherwise refuses to shrink below the
          browser's native <input> min-content width and pushes this row
          (and the whole dialog) wider than its container on narrow
          viewports, producing a page-wide horizontal scrollbar. */}
      <TextField
        label={resolvedLabel}
        value={localInput}
        onChange={(e) => handleNumberChange(e.target.value)}
        placeholder={placeholder}
        fullWidth
        sx={{ minWidth: 0 }}
        size={size}
        required={required}
        autoFocus={autoFocus}
        helperText={helperText ?? t('phoneInput.storedAs', { number: `${country.dial}${localInput.replace(/\D/g, '') || 'XXXXXXXXXX'}` })}
        error={error}
        disabled={disabled}
        inputProps={{ inputMode: 'tel' }}
        InputProps={endAdornment ? {
          endAdornment: <InputAdornment position="end">{endAdornment}</InputAdornment>,
        } : undefined}
      />
    </Box>
  );
}
