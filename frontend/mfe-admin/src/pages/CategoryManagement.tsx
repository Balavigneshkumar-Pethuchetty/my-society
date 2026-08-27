import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Container,
  Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, MenuItem, Paper, Popover, Stack, TextField, ToggleButton,
  ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import AddIcon         from '@mui/icons-material/Add';
import CloseIcon       from '@mui/icons-material/Close';
import DeleteIcon      from '@mui/icons-material/DeleteOutline';
import EditIcon        from '@mui/icons-material/Edit';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import FavoriteIcon    from '@mui/icons-material/Favorite';
import BusinessIcon    from '@mui/icons-material/Business';
import StarIcon        from '@mui/icons-material/Star';
import CelebrationIcon from '@mui/icons-material/Celebration';
import MusicNoteIcon   from '@mui/icons-material/MusicNote';
import SchoolIcon      from '@mui/icons-material/School';
import GroupsIcon      from '@mui/icons-material/Groups';
import RestaurantIcon  from '@mui/icons-material/Restaurant';
import VolunteerActivismIcon from '@mui/icons-material/VolunteerActivism';
import LabelOutlinedIcon from '@mui/icons-material/LabelOutlined';

// ── Icon mapping ──────────────────────────────────────────────────────────────
// `icon` is stored as either a known keyword (e.g. "sparkles", "trophy") mapped
// to a MUI icon, or a raw emoji the user typed/pasted directly — rendered as-is.

const ICON_OPTIONS: { value: string; label: string; Icon: typeof StarIcon }[] = [
  { value: 'sparkles', label: 'Sparkles (Festival)', Icon: AutoAwesomeIcon },
  { value: 'trophy',   label: 'Trophy (Sports)',      Icon: EmojiEventsIcon },
  { value: 'heart',    label: 'Heart (Wellness)',      Icon: FavoriteIcon },
  { value: 'building', label: 'Building (Governance)', Icon: BusinessIcon },
  { value: 'star',     label: 'Star (Kids)',           Icon: StarIcon },
  { value: 'celebration', label: 'Celebration',        Icon: CelebrationIcon },
  { value: 'music',    label: 'Music',                 Icon: MusicNoteIcon },
  { value: 'school',   label: 'Education',             Icon: SchoolIcon },
  { value: 'groups',   label: 'Community',             Icon: GroupsIcon },
  { value: 'food',     label: 'Food',                  Icon: RestaurantIcon },
  { value: 'charity',  label: 'Charity',                Icon: VolunteerActivismIcon },
];

const ICON_MAP: Record<string, typeof StarIcon> = Object.fromEntries(
  ICON_OPTIONS.map(({ value, Icon }) => [value, Icon]),
);

function isPresetIconKeyword(icon: string | null) {
  return Boolean(icon && ICON_MAP[icon.trim().toLowerCase()]);
}

function CategoryIcon({ icon, sx }: { icon: string | null; sx?: object }) {
  const trimmed = icon?.trim();
  const PresetIcon = trimmed ? ICON_MAP[trimmed.toLowerCase()] : undefined;
  if (PresetIcon) return <PresetIcon sx={{ color: '#fff', fontSize: 18, ...sx }} />;
  if (trimmed) return <Box component="span" sx={{ fontSize: 16, lineHeight: 1, ...sx }}>{trimmed}</Box>;
  return <LabelOutlinedIcon sx={{ color: '#fff', fontSize: 18, ...sx }} />;
}

// ── API ───────────────────────────────────────────────────────────────────────

function eventsApiBase(): string {
  const { hostname, port, origin } = window.location;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  if (isLocal && ['4004', '4005'].includes(port)) return `${origin}/api/events`;
  return '/api/events';
}

async function eventsApiFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${eventsApiBase()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  const ct = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    if (ct.includes('application/json')) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { detail?: string }).detail ?? `HTTP ${res.status}`);
    }
    throw new Error(`HTTP ${res.status} — event service may not be running`);
  }
  if (res.status === 204) return undefined as T;
  if (!ct.includes('application/json')) {
    throw new Error('Event service is not reachable — nginx is returning HTML instead of JSON.\nRun: docker compose up -d event-service && docker compose up -d --build nginx');
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Category {
  id: string;
  name: string;
  icon: string | null;
  color_hex: string | null;
}

const DEFAULT_COLOR = '#6366f1';

const PRESET_COLORS = [
  '#EF4444', '#F97316', '#F59E0B', '#EAB308', '#84CC16', '#22C55E',
  '#10B981', '#14B8A6', '#06B6D4', '#0EA5E9', '#3B82F6', '#6366F1',
  '#8B5CF6', '#A855F7', '#D946EF', '#EC4899', '#F43F5E', '#78716C',
  '#71717A', '#6B7280', '#64748B', '#111827',
];

// ── Color picker ──────────────────────────────────────────────────────────────

function ColorPickerField({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const valid = /^#[0-9A-Fa-f]{6}$/.test(value);

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
        Color
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box
          onClick={e => setAnchorEl(e.currentTarget)}
          sx={{
            width: 40, height: 40, borderRadius: 1, cursor: 'pointer', flexShrink: 0,
            bgcolor: valid ? value : 'action.disabledBackground',
            border: '2px solid', borderColor: 'divider',
            '&:hover': { borderColor: 'primary.main' },
          }}
        />
        <TextField
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="#6366f1"
          size="small"
          fullWidth
        />
      </Box>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box sx={{ p: 2, width: 268 }}>
          <Box
            component="input"
            type="color"
            value={valid ? value : DEFAULT_COLOR}
            onChange={e => onChange(e.target.value)}
            sx={{
              width: '100%', height: 44, p: 0, border: 'none', borderRadius: 1,
              cursor: 'pointer', background: 'none',
              '&::-webkit-color-swatch-wrapper': { p: 0 },
              '&::-webkit-color-swatch': { border: 'none', borderRadius: 1 },
              '&::-moz-color-swatch': { border: 'none', borderRadius: 1 },
            }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5, mb: 1 }}>
            Presets
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {PRESET_COLORS.map(c => (
              <Box
                key={c}
                onClick={() => onChange(c)}
                sx={{
                  width: 26, height: 26, borderRadius: '50%', cursor: 'pointer',
                  bgcolor: c, boxShadow: '0 0 0 1px rgba(0,0,0,0.15)',
                  outline: c.toLowerCase() === value.toLowerCase() ? '2px solid' : 'none',
                  outlineColor: 'text.primary', outlineOffset: '2px',
                }}
              />
            ))}
          </Box>
        </Box>
      </Popover>
    </Box>
  );
}

// ── Edit / Create dialog ─────────────────────────────────────────────────────

function CategoryDialog({
  token, category, onClose, onDone,
}: {
  token: string;
  category: Category | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName]           = useState(category?.name ?? '');
  const [icon, setIcon]           = useState(category?.icon ?? '');
  const [iconMode, setIconMode]   = useState<'preset' | 'emoji'>(
    isPresetIconKeyword(category?.icon ?? null) || !category?.icon ? 'preset' : 'emoji',
  );
  const [colorHex, setColorHex]   = useState(category?.color_hex ?? DEFAULT_COLOR);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const isEdit = Boolean(category);

  async function save() {
    if (!name.trim()) {
      setError('Name is required.'); return;
    }
    if (colorHex && !/^#[0-9A-Fa-f]{6}$/.test(colorHex)) {
      setError('Color must be a hex code like #6366f1.'); return;
    }
    setLoading(true); setError(null);
    try {
      const body = { name: name.trim(), icon: icon.trim() || null, color_hex: colorHex || null };
      if (isEdit) {
        await eventsApiFetch(`/categories/${category!.id}`, token, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await eventsApiFetch('/categories', token, { method: 'POST', body: JSON.stringify(body) });
      }
      onDone();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {isEdit ? 'Edit Category' : 'New Category'}
        <IconButton size="small" onClick={onClose}><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2.5}>
          <TextField
            label="Name"
            value={name} onChange={e => setName(e.target.value)}
            fullWidth autoFocus placeholder="e.g. Festival, Sports, Cultural"
          />
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
              <Typography variant="caption" color="text.secondary">Icon</Typography>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={iconMode}
                onChange={(_, v: 'preset' | 'emoji' | null) => {
                  if (!v || v === iconMode) return;
                  setIconMode(v);
                  setIcon('');
                }}
              >
                <ToggleButton value="preset" sx={{ px: 1.5, py: 0.25, fontSize: 12, textTransform: 'none' }}>
                  Icon set
                </ToggleButton>
                <ToggleButton value="emoji" sx={{ px: 1.5, py: 0.25, fontSize: 12, textTransform: 'none' }}>
                  Emoji
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              {iconMode === 'preset' ? (
                <TextField
                  select
                  value={icon} onChange={e => setIcon(e.target.value)}
                  fullWidth
                >
                  <MenuItem value=""><em>None</em></MenuItem>
                  {ICON_OPTIONS.map(({ value, label, Icon }) => (
                    <MenuItem key={value} value={value}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Icon fontSize="small" /> {label}
                      </Box>
                    </MenuItem>
                  ))}
                </TextField>
              ) : (
                <TextField
                  value={icon} onChange={e => setIcon(e.target.value)}
                  fullWidth placeholder="Paste an emoji, e.g. 🎉"
                  inputProps={{ maxLength: 8 }}
                />
              )}
              <Box
                sx={{
                  width: 40, height: 40, borderRadius: 1, flexShrink: 0,
                  bgcolor: /^#[0-9A-Fa-f]{6}$/.test(colorHex) ? colorHex : 'action.disabledBackground',
                  border: '1px solid', borderColor: 'divider',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <CategoryIcon icon={icon} />
              </Box>
            </Box>
          </Box>
          <ColorPickerField value={colorHex} onChange={setColorHex} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} disabled={loading}>Cancel</Button>
        <Button variant="contained" disabled={loading} onClick={save}>
          {loading ? <CircularProgress size={18} color="inherit" /> : isEdit ? 'Save' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function CategoryManagement({ token }: { token?: string | null }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [dialog, setDialog]         = useState<Category | null | 'new' | undefined>(undefined);
  const [deleting, setDeleting]     = useState<Category | null>(null);
  const [busy, setBusy]             = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      setCategories(await eventsApiFetch<Category[]>('/categories', token));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function confirmDelete() {
    if (!deleting || !token) return;
    setBusy(true);
    try {
      await eventsApiFetch(`/categories/${deleting.id}`, token, { method: 'DELETE' });
      setDeleting(null);
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed');
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  if (!token) return <Box sx={{ p: 4, textAlign: 'center' }}><Typography color="text.secondary">Not authenticated.</Typography></Box>;

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight={800}>Event Categories</Typography>
          <Typography variant="body2" color="text.secondary">
            Create and manage the categories used to tag and filter events.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog('new')}>
          New Category
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {loading
        ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
        : (
          <Stack spacing={1.5}>
            {categories.length === 0 && (
              <Typography color="text.secondary" textAlign="center" py={6}>
                No categories yet. Click "New Category" to get started.
              </Typography>
            )}
            {categories.map(cat => (
              <Paper key={cat.id} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Box
                    sx={{
                      width: 32, height: 32, borderRadius: 1, flexShrink: 0,
                      bgcolor: cat.color_hex ?? DEFAULT_COLOR,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <CategoryIcon icon={cat.icon} />
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography fontWeight={700}>{cat.name}</Typography>
                    <Typography variant="caption" color="text.secondary" fontFamily="monospace">
                      {cat.color_hex ?? 'no color'}
                    </Typography>
                  </Box>
                  <Tooltip title="Edit">
                    <IconButton size="small" onClick={() => setDialog(cat)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete">
                    <IconButton size="small" color="error" onClick={() => setDeleting(cat)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Paper>
            ))}
          </Stack>
        )}

      {dialog !== undefined && token && (
        <CategoryDialog
          token={token}
          category={dialog === 'new' ? null : dialog}
          onClose={() => setDialog(undefined)}
          onDone={() => { setDialog(undefined); load(); }}
        />
      )}

      <Dialog open={Boolean(deleting)} onClose={() => setDeleting(null)}>
        <DialogTitle>Delete category?</DialogTitle>
        <DialogContent>
          <Typography>
            This will remove <strong>{deleting?.name}</strong>. Events already tagged with it will keep
            their existing tag reference but it will no longer appear in filters or new event forms.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setDeleting(null)} disabled={busy}>Cancel</Button>
          <Button variant="contained" color="error" onClick={confirmDelete} disabled={busy}>
            {busy ? <CircularProgress size={18} color="inherit" /> : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
