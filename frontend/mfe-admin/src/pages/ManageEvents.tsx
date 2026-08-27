import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';

// Lazy-load so Leaflet CSS is only injected when the Location tab is opened
const InteractiveMap = lazy(() =>
  import('../components/InteractiveMap').then(m => ({ default: m.InteractiveMap }))
);
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress,
  Container, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, FormControlLabel, Grid, IconButton, InputAdornment,
  List, ListItem, ListItemButton, ListItemText,
  MenuItem, Paper, Stack, Switch, Tab, Table, TableBody,
  TableCell, TableHead, TableRow, Tabs, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon           from '@mui/icons-material/Add';
import EditIcon          from '@mui/icons-material/Edit';
import PublishIcon       from '@mui/icons-material/PublishOutlined';
import CancelIcon        from '@mui/icons-material/DoNotDisturbOutlined';
import CheckCircleIcon   from '@mui/icons-material/CheckCircleOutline';
import DeleteIcon        from '@mui/icons-material/DeleteOutline';
import OpenInNewIcon     from '@mui/icons-material/OpenInNew';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import LocationOnIcon    from '@mui/icons-material/LocationOn';
import GroupIcon         from '@mui/icons-material/Group';
import SearchIcon        from '@mui/icons-material/Search';
import DirectionsIcon    from '@mui/icons-material/Directions';
import LocalActivityIcon from '@mui/icons-material/LocalActivity';
import SaveIcon          from '@mui/icons-material/Save';
import GroupAddIcon      from '@mui/icons-material/GroupAddOutlined';
import MyLocationIcon    from '@mui/icons-material/MyLocation';

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

function paymentsApiBase(): string {
  const { hostname, port, protocol, origin } = window.location;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  if (isLocal && ['4004', '4005'].includes(port)) return `${origin}/api/payments`;
  if (isLocal && port !== '8080' && port !== '80')
    return `${protocol}//${hostname}:8080/api/payments`;
  return `${origin}/api/payments`;
}

async function paymentsApiFetch<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${paymentsApiBase()}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { detail?: string }).detail ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function paymentsApiMutate<T>(
  path: string, token: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown,
): Promise<T | null> {
  const res = await fetch(`${paymentsApiBase()}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error((errBody as { detail?: string }).detail ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Category { id: string; name: string; color_hex: string | null }

interface EventItem {
  id: string; title: string; description: string | null;
  start_time: string; end_time: string; venue: string;
  venue_lat: number | null; venue_lng: number | null;
  venue_place_id: string | null; venue_address: string | null;
  capacity: number | null; status: string;
  ticket_price: number; price_currency: string; is_free: boolean;
  cancel_freeze_at: string | null;
  category_id: string | null; category_name: string | null; category_color: string | null;
  organizer_name: string;
  approved_members: string[];
  registration_count: number; confirmed_tickets: number;
  spots_remaining: number | null; is_sold_out: boolean;
}

interface TicketType {
  id: string; name: string; description: string | null;
  price: number; is_free: boolean; capacity: number | null;
  sort_order: number; is_active: boolean;
}

interface EventListResponse { events: EventItem[]; total: number; total_pages: number }

interface NominatimResult { place_id: string; display_name: string; lat: string; lon: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { label: string; color: 'default'|'warning'|'success'|'error'|'info' }> = {
  draft:     { label: 'Draft',     color: 'default'  },
  published: { label: 'Published', color: 'success'  },
  cancelled: { label: 'Cancelled', color: 'error'    },
  completed: { label: 'Completed', color: 'info'     },
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

// Same-day events collapse the end to just its time (one line); multi-day events
// return an explicit second line instead of relying on wrap, so the cell never
// grows past two lines regardless of column width.
function fmtDateRange(startIso: string, endIso: string): [string, string | null] {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (start.toDateString() === end.toDateString()) {
    const endTime = end.toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    return [`${fmtDate(startIso)} – ${endTime}`, null];
  }
  return [fmtDate(startIso), `– ${fmtDate(endIso)}`];
}

function toLocalDT(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function mapsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

// ── Location search (Nominatim / OpenStreetMap) ───────────────────────────────

async function nominatimSearch(q: string): Promise<NominatimResult[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=6&addressdetails=1`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  if (!res.ok) return [];
  return res.json();
}

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  if (!res.ok) return null;
  const data = await res.json();
  return data.display_name ?? null;
}

function getCurrentPosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(null); return; }
    // enableHighAccuracy asks the OS to use GPS/Wi-Fi positioning over coarse IP-based
    // lookup where available — helps on phones/laptops with Wi-Fi scanning, does nothing
    // on a desktop with no such hardware (there the OS has no better signal to give us,
    // so it'll still resolve to an ISP-level approximation; drag the pin to correct it).
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 8000, enableHighAccuracy: true },
    );
  });
}

function LocationTab({
  venue, venueAddress, venueLat, venueLng,
  onChange,
}: {
  venue: string;
  venueAddress: string;
  venueLat: string;
  venueLng: string;
  onChange: (patch: { venue?: string; venueAddress?: string; venueLat?: string; venueLng?: string }) => void;
}) {
  const [query,       setQuery]       = useState(venue || venueAddress);
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [searching,   setSearching]   = useState(false);
  const [locating,    setLocating]    = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [locatingMe,  setLocatingMe]  = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lat = parseFloat(venueLat);
  const lng = parseFloat(venueLng);
  const hasCoords    = !isNaN(lat) && !isNaN(lng);
  const hasAddress   = venueAddress.trim().length > 0;
  const needsGeocode = hasAddress && !hasCoords;

  const handleMapPositionChange = async (newLat: number, newLng: number) => {
    onChange({ venueLat: String(newLat), venueLng: String(newLng) });
    // Fill in the address from the dropped pin too, but never clobber something the
    // organizer already typed themselves.
    if (!venueAddress.trim()) {
      const display = await reverseGeocode(newLat, newLng);
      if (display) onChange({ venueAddress: display });
    }
  };

  const useCurrentLocation = useCallback(async () => {
    setLocatingMe(true);
    setLocateError(null);
    const pos = await getCurrentPosition();
    if (pos) {
      await handleMapPositionChange(pos.lat, pos.lng);
    } else {
      setLocateError('Couldn\'t detect your location — search for an address above, or open the map and drag the pin to the right spot.');
    }
    setLocatingMe(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueAddress]);

  // ── Auto-geocode on first render when address exists but no coords ──────────
  // If there's neither an address nor coords yet (a brand-new event), try defaulting the
  // map to the organizer's current location so it opens immediately instead of requiring a
  // search first. If location access is denied/unavailable, useCurrentLocation surfaces a
  // warning and leaves hasCoords false — the "enter an address" prompt covers that case
  // instead of silently pinning a wrong default location.
  useEffect(() => {
    if (needsGeocode) {
      void geocodeAddress(venueAddress);
    } else if (!hasCoords && !hasAddress) {
      void useCurrentLocation();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // run once on mount only

  // ── Geocode any text string → fill lat/lng ────────────────────────────────
  const geocodeAddress = async (text: string) => {
    if (!text.trim()) return;
    setLocating(true);
    setLocateError(null);
    try {
      const results = await nominatimSearch(text);
      if (results.length === 0) {
        setLocateError(`No location found for "${text}". Try a more specific address or city name.`);
        return;
      }
      const r = results[0];
      onChange({ venueLat: r.lat, venueLng: r.lon });
      if (!venueAddress) onChange({ venueAddress: r.display_name });
    } catch {
      setLocateError('Could not reach the geocoding service. Check your internet connection.');
    } finally {
      setLocating(false);
    }
  };

  // ── Suggestion search (debounced as user types in search box) ─────────────
  const searchSuggestions = useCallback(async (q: string) => {
    if (q.length < 3) { setSuggestions([]); return; }
    setSearching(true);
    try {
      const data = await nominatimSearch(q);
      setSuggestions(data);
    } catch { /* ignore */ }
    finally { setSearching(false); }
  }, []);

  const handleSearchInput = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void searchSuggestions(val), 500);
  };

  const selectSuggestion = (r: NominatimResult) => {
    const shortName = r.display_name.split(',')[0];
    setQuery(shortName);
    setSuggestions([]);
    setLocateError(null);
    onChange({
      venue:        shortName,
      venueAddress: r.display_name,
      venueLat:     r.lat,
      venueLng:     r.lon,
    });
  };

  const handleLatChange = (val: string) => onChange({ venueLat: val });
  const handleLngChange = (val: string) => onChange({ venueLng: val });

  return (
    <Stack spacing={2} sx={{ pt: 1 }}>

      {/* ── Search box ──────────────────────────────────────────────────── */}
      <Box>
        <TextField
          label="Search venue / address"
          size="small" fullWidth
          value={query}
          onChange={e => handleSearchInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              setSuggestions([]);
              void geocodeAddress(query);
            }
          }}
          placeholder="e.g. Whitefield Bengaluru, Society Clubhouse…"
          helperText="Type and pick a suggestion, or press Enter to locate"
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
              </InputAdornment>
            ),
            endAdornment: searching
              ? <InputAdornment position="end"><CircularProgress size={16} /></InputAdornment>
              : null,
          }}
        />

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <Paper variant="outlined" sx={{ borderRadius: 1.5, mt: 0.5, maxHeight: 200, overflow: 'auto', zIndex: 10, position: 'relative' }}>
            <List dense disablePadding>
              {suggestions.map(r => (
                <ListItem key={r.place_id} disablePadding divider>
                  <ListItemButton onClick={() => selectSuggestion(r)}>
                    <LocationOnIcon sx={{ fontSize: 15, color: '#6366f1', mr: 1, flexShrink: 0 }} />
                    <ListItemText
                      primary={r.display_name.split(',')[0]}
                      secondary={r.display_name.split(',').slice(1, 3).join(',').trim()}
                      primaryTypographyProps={{ fontSize: 13, fontWeight: 600 }}
                      secondaryTypographyProps={{ fontSize: 11 }}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </Paper>
        )}
      </Box>

      {/* ── Full address + "Find on Map" button ─────────────────────────── */}
      <Box>
        <TextField
          label="Full address"
          size="small" fullWidth multiline rows={2}
          value={venueAddress}
          onChange={e => onChange({ venueAddress: e.target.value })}
          placeholder="Street, area, city, state — shown to attendees"
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
          <Button
            size="small"
            variant={needsGeocode ? 'contained' : 'outlined'}
            color={needsGeocode ? 'primary' : 'inherit'}
            startIcon={locating ? <CircularProgress size={14} color="inherit" /> : <LocationOnIcon sx={{ fontSize: 16 }} />}
            disabled={locating || !hasAddress}
            onClick={() => void geocodeAddress(venueAddress || query)}
            sx={{ fontSize: 12, textTransform: 'none', fontWeight: 600 }}
          >
            {locating ? 'Locating…' : 'Find on Map'}
          </Button>
          {needsGeocode && !locating && (
            <Typography fontSize={11} color="warning.main" fontWeight={600}>
              ⚠ Address entered but no coordinates yet — click "Find on Map"
            </Typography>
          )}
          {hasCoords && !locating && (
            <Typography fontSize={11} color="success.main" fontWeight={600}>
              ✓ Coordinates set
            </Typography>
          )}
        </Box>
        {locateError && (
          <Alert severity="warning" onClose={() => setLocateError(null)} sx={{ mt: 1, py: 0.5, fontSize: 12 }}>
            {locateError}
          </Alert>
        )}
      </Box>

      {/* ── Coordinates ─────────────────────────────────────────────────── */}
      <Box>
        <Typography fontSize={12} fontWeight={700} color="text.secondary"
          textTransform="uppercase" letterSpacing={0.5} mb={1}>
          GPS Coordinates
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={6}>
            <TextField
              label="Latitude"
              size="small" fullWidth
              value={venueLat}
              onChange={e => handleLatChange(e.target.value)}
              placeholder="e.g. 12.9716"
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Typography fontSize={11} color="text.secondary" fontFamily="monospace">lat</Typography>
                  </InputAdornment>
                ),
              }}
            />
          </Grid>
          <Grid item xs={6}>
            <TextField
              label="Longitude"
              size="small" fullWidth
              value={venueLng}
              onChange={e => handleLngChange(e.target.value)}
              placeholder="e.g. 77.5946"
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Typography fontSize={11} color="text.secondary" fontFamily="monospace">lng</Typography>
                  </InputAdornment>
                ),
              }}
            />
          </Grid>
        </Grid>

        {hasCoords && (
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, mt: 1,
            px: 1.5, py: 0.5, bgcolor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 1.5 }}>
            <LocationOnIcon sx={{ fontSize: 14, color: '#16a34a' }} />
            <Typography fontSize={12} fontWeight={700} color="#166534" fontFamily="monospace">
              {lat.toFixed(6)},&nbsp;{lng.toFixed(6)}
            </Typography>
          </Box>
        )}
      </Box>

      {/* ── Interactive map (drag pin or click to set location) ─────────── */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, flexWrap: 'wrap', gap: 1 }}>
          <Box>
            <Typography fontSize={12} fontWeight={700} color="text.secondary"
              textTransform="uppercase" letterSpacing={0.5}>
              Map — drag the pin or click to set location
            </Typography>
            <Typography fontSize={11} color="text.secondary">
              "Use current location" is often approximate on desktops (no GPS) — always drag the pin to the exact spot.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Button size="small" variant="text"
              startIcon={locatingMe ? <CircularProgress size={12} /> : <MyLocationIcon sx={{ fontSize: 14 }} />}
              onClick={() => void useCurrentLocation()} disabled={locatingMe}
              sx={{ fontSize: 11, textTransform: 'none', fontWeight: 600 }}>
              Use current location
            </Button>
            {hasCoords && (
              <Typography fontSize={11} color="text.secondary" fontFamily="monospace">
                {lat.toFixed(5)}, {lng.toFixed(5)}
              </Typography>
            )}
          </Stack>
        </Box>

        {locatingMe ? (
          <Box sx={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'action.hover', borderRadius: 2 }}>
            <CircularProgress size={28} />
          </Box>
        ) : hasCoords ? (
          <Box sx={{ borderRadius: 2, overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}>
            <Suspense fallback={
              <Box sx={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'action.hover' }}>
                <CircularProgress size={28} />
              </Box>
            }>
              <InteractiveMap
                key={`${lat.toFixed(4)}-${lng.toFixed(4)}`}
                lat={lat}
                lng={lng}
                onPositionChange={(la, ln) => void handleMapPositionChange(la, ln)}
                height={320}
              />
            </Suspense>
          </Box>
        ) : (
          <Alert severity="info" icon={<LocationOnIcon fontSize="inherit" />} sx={{ borderRadius: 1.5 }}>
            {hasAddress
              ? 'Click "Find on Map" above to geocode the address — then drag the pin to fine-tune.'
              : 'Enter an address and click "Find on Map", or "Use current location" above, to open the map.'}
          </Alert>
        )}
      </Box>

      {/* ── Navigation links ─────────────────────────────────────────────── */}
      {hasCoords && (
        <Box>
          <Typography fontSize={12} fontWeight={700} color="text.secondary"
            textTransform="uppercase" letterSpacing={0.5} mb={1}>
            Open in Navigation App
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {[
              { label: 'Google Maps',    href: `https://www.google.com/maps?q=${lat},${lng}` },
              { label: 'Apple Maps',     href: `https://maps.apple.com/?q=${lat},${lng}` },
              { label: 'Bing Maps',      href: `https://www.bing.com/maps?cp=${lat}~${lng}&lvl=16` },
              { label: 'OpenStreetMap',  href: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}&zoom=16` },
            ].map(m => (
              <Button key={m.label} size="small" variant="outlined"
                startIcon={<DirectionsIcon sx={{ fontSize: 14 }} />}
                endIcon={<OpenInNewIcon sx={{ fontSize: 11 }} />}
                href={m.href} target="_blank" rel="noopener noreferrer"
                sx={{ fontSize: 12, textTransform: 'none', borderColor: 'divider', color: 'text.secondary',
                  '&:hover': { borderColor: '#6366f1', color: '#6366f1', bgcolor: 'action.hover' } }}>
                {m.label}
              </Button>
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}

// ── Ticket Types tab (inside the form dialog) ─────────────────────────────────

const EMPTY_TT = { name: '', description: '', price: '', is_free: false, capacity: '', sort_order: '' };

function TicketTypesTab({
  eventId, token,
}: {
  eventId: string | undefined;
  token: string;
}) {
  const [types,    setTypes]    = useState<TicketType[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [form,     setForm]     = useState(EMPTY_TT);
  const [editId,   setEditId]   = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving,   setSaving]   = useState(false);

  const loadTypes = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    try {
      const data = await eventsApiFetch<TicketType[]>(`/events/${eventId}/ticket-types`, token);
      setTypes(data);
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [eventId, token]);

  useEffect(() => { void loadTypes(); }, [loadTypes]);

  const openAdd = () => { setForm(EMPTY_TT); setEditId(null); setShowForm(true); };
  const openEdit = (t: TicketType) => {
    setForm({ name: t.name, description: t.description ?? '', price: String(t.price),
              is_free: t.is_free, capacity: t.capacity != null ? String(t.capacity) : '',
              sort_order: String(t.sort_order) });
    setEditId(t.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name || !eventId) return;
    setSaving(true);
    setError(null);
    try {
      const body = {
        name:        form.name,
        description: form.description || null,
        price:       form.is_free ? 0 : Number(form.price || 0),
        is_free:     form.is_free,
        capacity:    form.capacity ? Number(form.capacity) : null,
        sort_order:  Number(form.sort_order || 0),
        is_active:   true,
      };
      if (editId) {
        await eventsApiFetch(`/events/${eventId}/ticket-types/${editId}`, token,
          { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await eventsApiFetch(`/events/${eventId}/ticket-types`, token,
          { method: 'POST', body: JSON.stringify(body) });
      }
      setShowForm(false);
      setEditId(null);
      void loadTypes();
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    try {
      await eventsApiFetch(`/events/${eventId}/ticket-types/${id}`, token, { method: 'DELETE' });
      void loadTypes();
    } catch (e: unknown) { setError((e as Error).message); }
  };

  const toggleActive = async (t: TicketType) => {
    try {
      await eventsApiFetch(`/events/${eventId}/ticket-types/${t.id}`, token,
        { method: 'PUT', body: JSON.stringify({ is_active: !t.is_active }) });
      void loadTypes();
    } catch (e: unknown) { setError((e as Error).message); }
  };

  if (!eventId) {
    return (
      <Alert severity="info" sx={{ mt: 1, borderRadius: 1.5 }}>
        Save the event as a draft first, then come back here to add ticket types.
      </Alert>
    );
  }

  return (
    <Box>
      {error && <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>{error}</Alert>}

      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography fontWeight={700} fontSize={14} sx={{ flex: 1 }}>
          Ticket Types ({types.filter(t => t.is_active).length} active)
        </Typography>
        <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={openAdd}>
          Add Type
        </Button>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={24} /></Box>
      ) : types.length === 0 ? (
        <Alert severity="info" sx={{ borderRadius: 1.5 }}>
          No ticket types yet. Single-price from the event details will be used. Add types for sub-events like "Play Area", "Lunch Coupon", "Music Pass", etc.
        </Alert>
      ) : (
        <Stack spacing={1}>
          {[...types].sort((a, b) => a.sort_order - b.sort_order).map(t => (
            <Box key={t.id} sx={{
              display: 'flex', alignItems: 'center', gap: 1.5,
              p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1.5,
              opacity: t.is_active ? 1 : 0.55, bgcolor: 'action.hover',
            }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography fontWeight={700} fontSize={13}>{t.name}</Typography>
                  {!t.is_active && <Chip label="Inactive" size="small" sx={{ height: 16, fontSize: 10 }} />}
                </Box>
                {t.description && (
                  <Typography fontSize={11} color="text.secondary" noWrap>{t.description}</Typography>
                )}
                <Box sx={{ display: 'flex', gap: 1.5, mt: 0.5 }}>
                  <Typography fontSize={12} fontWeight={700} color={t.is_free ? 'success.main' : '#6366f1'}>
                    {t.is_free ? 'Free' : `₹${Number(t.price).toLocaleString('en-IN')}`}
                  </Typography>
                  {t.capacity && (
                    <Typography fontSize={12} color="text.secondary">
                      Capacity: {t.capacity}
                    </Typography>
                  )}
                  <Typography fontSize={12} color="text.secondary">Order: {t.sort_order}</Typography>
                </Box>
              </Box>
              <Stack direction="row" spacing={0.5}>
                <Tooltip title={t.is_active ? 'Deactivate' : 'Activate'}>
                  <Switch size="small" checked={t.is_active} onChange={() => void toggleActive(t)} />
                </Tooltip>
                <Tooltip title="Edit">
                  <IconButton size="small" onClick={() => openEdit(t)}>
                    <EditIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Delete">
                  <IconButton size="small" color="error" onClick={() => void handleDelete(t.id)}>
                    <DeleteIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Box>
          ))}
        </Stack>
      )}

      {/* Inline add/edit form */}
      {showForm && (
        <Box sx={{ mt: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, bgcolor: 'action.hover' }}>
          <Typography fontWeight={700} fontSize={13} mb={1.5}>
            {editId ? 'Edit Ticket Type' : 'New Ticket Type'}
          </Typography>
          {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}
          <Stack spacing={1.5}>
            <Grid container spacing={1.5}>
              <Grid item xs={8}>
                <TextField label="Name *" size="small" fullWidth value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Play Area, Lunch Coupon, Water Games…" />
              </Grid>
              <Grid item xs={4}>
                <TextField label="Sort Order" type="number" size="small" fullWidth
                  value={form.sort_order}
                  onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} />
              </Grid>
            </Grid>
            <TextField label="Description" size="small" fullWidth multiline rows={2}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="What does this ticket include?" />
            <Grid container spacing={1.5} alignItems="center">
              <Grid item xs={4}>
                <FormControlLabel
                  control={<Switch size="small" checked={form.is_free}
                    onChange={e => setForm(f => ({ ...f, is_free: e.target.checked, price: e.target.checked ? '0' : f.price }))} />}
                  label={<Typography fontSize={12} fontWeight={600}>Free</Typography>}
                />
              </Grid>
              <Grid item xs={4}>
                <TextField label="Price (₹)" type="number" size="small" fullWidth
                  value={form.price} disabled={form.is_free}
                  onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
              </Grid>
              <Grid item xs={4}>
                <TextField label="Capacity (∞ if blank)" type="number" size="small" fullWidth
                  value={form.capacity}
                  onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))} />
              </Grid>
            </Grid>
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button size="small" onClick={() => { setShowForm(false); setEditId(null); }}>Cancel</Button>
              <Button size="small" variant="contained" disabled={!form.name || saving}
                startIcon={saving ? <CircularProgress size={12} /> : <SaveIcon />}
                onClick={() => void handleSave()}>
                {editId ? 'Save' : 'Add'}
              </Button>
            </Stack>
          </Stack>
        </Box>
      )}
    </Box>
  );
}

// ── Event Payment Settings tab (organizer self-service UPI collector) ────────

interface CollectorSettings {
  event_id: string;
  member_id: string | null;
  member_name: string | null;
  upi_id: string | null;
  imap_host: string;
  imap_port: number;
  imap_user: string;
  imap_password_set: boolean;
  imap_mailbox: string;
  assigned_at: string | null;
  reconciliation_channel_configured: boolean;
}

function PaymentSettingsTab({ eventId, token }: { eventId: string | undefined; token: string }) {
  const [cfg,     setCfg]     = useState<CollectorSettings | null>(null);
  const [upiId,   setUpiId]   = useState('');
  const [loading, setLoading] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [saved,   setSaved]   = useState(false);

  const load = useCallback(() => {
    if (!eventId) return;
    setLoading(true); setError(null);
    paymentsApiFetch<CollectorSettings>(`/registry/${eventId}/settings`, token)
      .then(d => { setCfg(d); setUpiId(d.upi_id ?? ''); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [eventId, token]);

  useEffect(() => { load(); }, [load]);

  if (!eventId) {
    return <Alert severity="info">Save step 1 first, then come back here to set this event's payment collection UPI ID.</Alert>;
  }

  const save = async () => {
    setSaving(true); setError(null); setSaved(false);
    try {
      // Carry forward any existing IMAP/email config untouched — this tab only edits UPI.
      await paymentsApiMutate(`/registry/${eventId}/settings`, token, 'PUT', {
        upi_id: upiId,
        imap_host: cfg?.imap_host ?? '',
        imap_port: cfg?.imap_port ?? 993,
        imap_user: cfg?.imap_user ?? '',
        imap_mailbox: cfg?.imap_mailbox ?? 'INBOX',
      });
      setSaved(true);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>;

  return (
    <Stack spacing={2.5} sx={{ pt: 1, maxWidth: 480 }}>
      <Box>
        <Typography fontWeight={700} mb={0.5}>Event Payment Settings</Typography>
        <Typography variant="body2" color="text.secondary">
          Assign a UPI ID to each event to manage registration fees and collections.
        </Typography>
      </Box>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {saved && <Alert severity="success" onClose={() => setSaved(false)}>Payment settings saved.</Alert>}

      <TextField
        label="UPI ID" size="small" fullWidth value={upiId}
        onChange={e => setUpiId(e.target.value)}
        placeholder="name@bankname"
        helperText="The UPI ID residents pay into for this event's registration fees."
      />
      {cfg?.member_name && (
        <Typography variant="caption" color="text.secondary">
          Collector on record: {cfg.member_name}
        </Typography>
      )}

      <Box>
        <Button
          variant="contained" size="small" onClick={() => void save()}
          disabled={saving || upiId.trim().length < 5}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : <SaveIcon />}
        >
          {saving ? 'Saving…' : 'Save Payment Settings'}
        </Button>
      </Box>
    </Stack>
  );
}

// ── Event form dialog (3-step save flow) ─────────────────────────────────────

interface FormState {
  title: string; description: string; venue: string;
  venueAddress: string; venueLat: string; venueLng: string;
  start_time: string; end_time: string; capacity: string;
  ticket_price: string; price_currency: string; is_free: boolean;
  category_id: string; cancel_freeze_at: string;
}

function EventForm({
  open, token, categories, initial, onClose, onSaved, onPublish, onCancel,
}: {
  open: boolean; token: string; categories: Category[];
  initial?: EventItem; onClose: () => void; onSaved: (id?: string) => void;
  onPublish?: () => void; onCancel?: () => void;
}) {
  const [tab,     setTab]     = useState(0);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | undefined>(initial?.id);

  const [form, setForm] = useState<FormState>({
    title:          initial?.title          ?? '',
    description:    initial?.description    ?? '',
    venue:          initial?.venue          ?? '',
    venueAddress:   initial?.venue_address  ?? '',
    venueLat:       initial?.venue_lat      != null ? String(initial.venue_lat) : '',
    venueLng:       initial?.venue_lng      != null ? String(initial.venue_lng) : '',
    start_time:     initial?.start_time     ? toLocalDT(initial.start_time) : '',
    end_time:       initial?.end_time       ? toLocalDT(initial.end_time)   : '',
    capacity:       initial?.capacity       != null ? String(initial.capacity) : '',
    ticket_price:   initial?.ticket_price   != null ? String(initial.ticket_price) : '0',
    price_currency: initial?.price_currency ?? 'INR',
    is_free:        initial?.is_free        ?? true,
    category_id:    initial?.category_id    ?? '',
    cancel_freeze_at: initial?.cancel_freeze_at ? toLocalDT(initial.cancel_freeze_at) : '',
  });

  const patch = (p: Partial<FormState>) => setForm(f => ({ ...f, ...p }));

  // For a brand-new event, suggest a freeze time 1 day before the start —
  // but stop once the organizer has touched the field, so "leave it blank" sticks.
  const freezeTouchedRef = useRef(!!initial);
  useEffect(() => {
    if (freezeTouchedRef.current || !form.start_time) return;
    const start = new Date(form.start_time);
    if (Number.isNaN(start.getTime())) return;
    const suggested = new Date(start.getTime() - 24 * 60 * 60 * 1000);
    patch({ cancel_freeze_at: toLocalDT(suggested.toISOString()) });
  }, [form.start_time]);

  // Save all current form state to the backend; optionally advance to nextTab.
  const handleSave = async (nextTab?: number) => {
    setError(null);
    if (!form.title.trim() || !form.venue.trim() || !form.start_time || !form.end_time) {
      setError('Title, venue, and start / end dates are required.');
      setTab(0);
      return;
    }
    if (form.cancel_freeze_at && new Date(form.cancel_freeze_at) >= new Date(form.start_time)) {
      setError('Ticket cancellation freeze time must be before the event start time.');
      setTab(0);
      return;
    }
    setSaving(true);
    try {
      const body = {
        title:          form.title,
        description:    form.description || null,
        venue:          form.venue,
        venue_address:  form.venueAddress || null,
        venue_lat:      form.venueLat ? Number(form.venueLat) : null,
        venue_lng:      form.venueLng ? Number(form.venueLng) : null,
        start_time:     new Date(form.start_time).toISOString(),
        end_time:       new Date(form.end_time).toISOString(),
        capacity:       form.capacity ? Number(form.capacity) : null,
        ticket_price:   Number(form.ticket_price || 0),
        price_currency: form.price_currency,
        is_free:        form.is_free,
        category_id:    form.category_id || null,
        cancel_freeze_at: form.cancel_freeze_at ? new Date(form.cancel_freeze_at).toISOString() : null,
      };
      let id = savedId;
      if (id) {
        await eventsApiFetch(`/events/${id}`, token, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        const res = await eventsApiFetch<{ id: string }>('/events', token, { method: 'POST', body: JSON.stringify(body) });
        id = res.id;
        setSavedId(id);
      }
      onSaved(id);
      if (nextTab !== undefined) {
        setTab(nextTab);
      } else {
        onClose();
      }
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const hasId       = !!savedId;
  const isDraft     = initial ? initial.status === 'draft'     : hasId;
  const isPublished = initial ? initial.status === 'published' : false;

  const STEP_LABELS = ['1. Event Details', '2. Location', '3. Ticket Types', '4. Payment Settings'];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, pb: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {initial ? `Edit — ${initial.title}` : 'Create New Event'}
          {initial && (
            <Chip
              label={STATUS_STYLE[initial.status]?.label ?? initial.status}
              color={STATUS_STYLE[initial.status]?.color ?? 'default'}
              size="small" sx={{ fontWeight: 700, fontSize: 11 }}
            />
          )}
          {!initial && hasId && (
            <Chip label="Draft saved" size="small" color="default" sx={{ fontSize: 11 }} />
          )}
        </Box>
      </DialogTitle>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          {STEP_LABELS.map((label, i) => (
            <Tab key={label} label={label}
              disabled={i > 0 && !hasId}
              icon={i > 0 && !hasId
                ? <Typography fontSize={10} color="text.disabled">Save step 1 first</Typography>
                : undefined}
              iconPosition="end"
              sx={{ fontSize: 13 }}
            />
          ))}
        </Tabs>
      </Box>

      <DialogContent dividers sx={{ minHeight: 420 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {/* ── Step 1: Event Details (no ticket fields here) ─────────────────── */}
        {tab === 0 && (
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <TextField label="Title *" size="small" fullWidth value={form.title}
              onChange={e => patch({ title: e.target.value })} />
            <TextField label="Description" size="small" fullWidth multiline rows={3}
              value={form.description} onChange={e => patch({ description: e.target.value })} />
            <TextField label="Venue / Location Name *" size="small" fullWidth value={form.venue}
              onChange={e => patch({ venue: e.target.value })}
              placeholder="e.g. Society Clubhouse, Rooftop Garden Block A" />
            <Stack direction="row" spacing={2}>
              <TextField label="Start Date & Time *" type="datetime-local" size="small" fullWidth sx={{ flex: 1 }}
                InputLabelProps={{ shrink: true }} value={form.start_time}
                onChange={e => patch({ start_time: e.target.value })} />
              <TextField label="End Date & Time *" type="datetime-local" size="small" fullWidth sx={{ flex: 1 }}
                InputLabelProps={{ shrink: true }} value={form.end_time}
                onChange={e => patch({ end_time: e.target.value })} />
            </Stack>
            <TextField
              label="Ticket Cancellation Freeze Time (optional)"
              type="datetime-local" size="small" fullWidth
              InputLabelProps={{ shrink: true }} value={form.cancel_freeze_at}
              onChange={e => { freezeTouchedRef.current = true; patch({ cancel_freeze_at: e.target.value }); }}
              helperText="Defaults to 1 day before the start time; clear it to let residents cancel a confirmed ticket any time before the event starts. Must be before the start time."
            />
            <Stack direction="row" spacing={2}>
              <TextField label="Capacity (blank = unlimited)" type="number" size="small" fullWidth sx={{ flex: 1 }}
                value={form.capacity} onChange={e => patch({ capacity: e.target.value })} />
              <TextField label="Category" select size="small" fullWidth sx={{ flex: 2 }} value={form.category_id}
                onChange={e => patch({ category_id: e.target.value })}>
                <MenuItem value=""><em>None</em></MenuItem>
                {categories.map(c => (
                  <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                ))}
              </TextField>
            </Stack>
          </Stack>
        )}

        {/* ── Step 2: Location ─────────────────────────────────────────────── */}
        {tab === 1 && (
          <LocationTab
            venue={form.venue}
            venueAddress={form.venueAddress}
            venueLat={form.venueLat}
            venueLng={form.venueLng}
            onChange={p => patch({
              ...(p.venue        !== undefined ? { venue:        p.venue        } : {}),
              ...(p.venueAddress !== undefined ? { venueAddress: p.venueAddress } : {}),
              ...(p.venueLat     !== undefined ? { venueLat:     p.venueLat     } : {}),
              ...(p.venueLng     !== undefined ? { venueLng:     p.venueLng     } : {}),
            })}
          />
        )}

        {/* ── Step 3: Pricing + Ticket Types ───────────────────────────────── */}
        {tab === 2 && (
          <Stack spacing={3} sx={{ pt: 1 }}>
            {/* Pricing section */}
            <Box>
              <Typography fontSize={12} fontWeight={700} color="text.secondary"
                textTransform="uppercase" letterSpacing={0.5} mb={1.5}>
                Event Pricing
              </Typography>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={4}>
                  <TextField label="Ticket pricing" select size="small" fullWidth
                    value={form.is_free ? 'true' : 'false'}
                    onChange={e => {
                      const f = e.target.value === 'true';
                      patch({ is_free: f });
                      if (f) patch({ ticket_price: '0' });
                    }}>
                    <MenuItem value="true">Free event</MenuItem>
                    <MenuItem value="false">Paid event</MenuItem>
                  </TextField>
                </Grid>
                {!form.is_free && (
                  <>
                    <Grid item xs={4}>
                      <TextField label="Default ticket price" type="number" size="small" fullWidth
                        value={form.ticket_price} onChange={e => patch({ ticket_price: e.target.value })} />
                    </Grid>
                    <Grid item xs={4}>
                      <TextField label="Currency" select size="small" fullWidth
                        value={form.price_currency} onChange={e => patch({ price_currency: e.target.value })}>
                        {['INR','USD','GBP','EUR','SGD','AED'].map(c => (
                          <MenuItem key={c} value={c}>{c}</MenuItem>
                        ))}
                      </TextField>
                    </Grid>
                  </>
                )}
              </Grid>
            </Box>

            <Divider />

            {/* Ticket types */}
            <Box>
              <Typography fontSize={12} fontWeight={700} color="text.secondary"
                textTransform="uppercase" letterSpacing={0.5} mb={1.5}>
                Ticket Types
              </Typography>
              <TicketTypesTab eventId={savedId} token={token} />
            </Box>
          </Stack>
        )}

        {/* ── Step 4: Payment Settings ──────────────────────────────────────── */}
        {tab === 3 && <PaymentSettingsTab eventId={savedId} token={token} />}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between' }}>
        {/* Left side: publish / cancel event actions */}
        <Stack direction="row" spacing={1}>
          {isDraft && onPublish && (
            <Button variant="contained" color="success" size="small"
              startIcon={<PublishIcon />} onClick={onPublish}>
              Publish Event
            </Button>
          )}
          {isPublished && onCancel && (
            <Button variant="outlined" color="error" size="small"
              startIcon={<CancelIcon />} onClick={onCancel}>
              Cancel Event
            </Button>
          )}
        </Stack>

        {/* Right side: step navigation */}
        <Stack direction="row" spacing={1}>
          <Button onClick={onClose}>Close</Button>
          {tab > 0 && (
            <Button variant="outlined" onClick={() => setTab(tab - 1)}>
              ← Back
            </Button>
          )}
          {tab < 3 ? (
            <Button variant="contained" onClick={() => void handleSave(tab + 1)} disabled={saving}
              startIcon={saving ? <CircularProgress size={14} color="inherit" /> : <SaveIcon />}>
              {saving ? 'Saving…' : 'Save & Next →'}
            </Button>
          ) : (
            <Button variant="contained" onClick={() => void handleSave()} disabled={saving}
              startIcon={saving ? <CircularProgress size={14} color="inherit" /> : <SaveIcon />}>
              {saving ? 'Saving…' : (initial ? 'Save Changes' : 'Save Draft')}
            </Button>
          )}
        </Stack>
      </DialogActions>
    </Dialog>
  );
}

// ── Manage Access dialog (approved-member delegation, organizer-only) ────────

interface ApprovedMember {
  id: string; user_id: string; user_name: string; user_email: string | null;
  granted_by_name: string; granted_at: string;
}

function ManageAccessDialog({
  open, onClose, eventId, token,
}: { open: boolean; onClose: () => void; eventId: string; token: string }) {
  const [members, setMembers] = useState<ApprovedMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [email,   setEmail]   = useState('');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    eventsApiFetch<ApprovedMember[]>(`/events/${eventId}/permissions`, token)
      .then(setMembers)
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [eventId, token]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  const grant = async () => {
    if (!email.trim()) return;
    setSaving(true); setError(null);
    try {
      await eventsApiFetch(`/events/${eventId}/permissions`, token, { method: 'POST', body: JSON.stringify({ email }) });
      setEmail('');
      void load();
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setSaving(false); }
  };

  const revoke = async (userId: string) => {
    try {
      await eventsApiFetch(`/events/${eventId}/permissions/${userId}`, token, { method: 'DELETE' });
      void load();
    } catch (e: unknown) { setError((e as Error).message); }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Manage Access</DialogTitle>
      <DialogContent dividers>
        <Typography fontSize={13} color="text.secondary" mb={2}>
          Approved members can manage this event — edit, publish, ticket types — the same as
          you, but only this one event.
        </Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={22} /></Box>
        ) : (
          <Stack spacing={1} sx={{ mb: 2 }}>
            {members.length === 0 && (
              <Typography fontSize={13} color="text.secondary">No approved members yet.</Typography>
            )}
            {members.map(m => (
              <Box key={m.id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}>
                <Box>
                  <Typography fontWeight={600} fontSize={13}>{m.user_name}</Typography>
                  <Typography fontSize={11} color="text.secondary">{m.user_email}</Typography>
                </Box>
                <Tooltip title="Revoke access">
                  <IconButton size="small" color="error" onClick={() => void revoke(m.user_id)}>
                    <DeleteIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            ))}
          </Stack>
        )}
        <Stack direction="row" spacing={1}>
          <TextField size="small" fullWidth label="Email address" value={email} onChange={e => setEmail(e.target.value)} />
          <Button variant="contained" disabled={saving || !email.trim()} onClick={() => void grant()}>Grant</Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props { token: string | null; id?: string }

export function ManageEvents({ token, id }: Props) {
  const [events,     setEvents]     = useState<EventItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [formOpen,   setFormOpen]   = useState(id === 'new');
  const [editTarget, setEditTarget] = useState<EventItem | undefined>(undefined);
  const [actionMsg,  setActionMsg]  = useState<string | null>(null);
  const [confirm,    setConfirm]    = useState<{ label: string; action: () => Promise<void> } | null>(null);
  const [accessTarget, setAccessTarget] = useState<EventItem | undefined>(undefined);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const base = eventsApiBase();
      const [evRes, catRes] = await Promise.all([
        fetch(`${base}/events?status=&limit=50&sort=date_desc`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${base}/categories`,                             { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const evCT = evRes.headers.get('content-type') ?? '';
      if (!evCT.includes('application/json')) {
        throw new Error('Event service is not reachable — nginx is returning HTML instead of JSON.\nRun: docker compose up -d event-service && docker compose up -d --build nginx');
      }
      if (!evRes.ok) {
        const body = await evRes.json().catch(() => ({}));
        throw new Error((body as { detail?: string }).detail ?? `HTTP ${evRes.status}`);
      }
      const evData: EventListResponse = await evRes.json();
      setEvents(evData.events);
      const catCT = catRes.headers.get('content-type') ?? '';
      if (catRes.ok && catCT.includes('application/json')) setCategories(await catRes.json());
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const action = (label: string, fn: () => Promise<void>) => setConfirm({ label, action: fn });
  const publish  = (e: EventItem) => action(`Publish "${e.title}"? It will become visible to all members.`, async () => { await eventsApiFetch(`/events/${e.id}/publish`, token!, { method: 'PATCH' }); setActionMsg(`"${e.title}" published.`); void load(); });
  const cancel   = (e: EventItem) => action(`Cancel "${e.title}"? This will close registrations and notify members.`, async () => { await eventsApiFetch(`/events/${e.id}/cancel`, token!, { method: 'PATCH' }); setActionMsg(`"${e.title}" cancelled.`); void load(); });
  const complete = (e: EventItem) => action(`Mark "${e.title}" as completed?`, async () => { await eventsApiFetch(`/events/${e.id}/complete`, token!, { method: 'PATCH' }); setActionMsg(`"${e.title}" completed.`); void load(); });
  const remove   = (e: EventItem) => action(
    e.status === 'completed'
      ? `Delete "${e.title}"? This removes the event and its announcements/ticket-types/complimentary-ticket log, plus all registrations, tickets, and payment records for it. This cannot be undone.`
      : `Delete draft "${e.title}"? This cannot be undone.`,
    async () => { await eventsApiFetch(`/events/${e.id}`, token!, { method: 'DELETE' }); setActionMsg(`"${e.title}" deleted.`); void load(); });
  const openEdit = (e: EventItem) => { setEditTarget(e); setFormOpen(true); };
  const handleFormClose = () => { setFormOpen(false); setEditTarget(undefined); };
  const handleFormSaved = () => { void load(); };
  const handleFormPublish = () => { if (editTarget) { handleFormClose(); publish(editTarget); } };
  const handleFormCancel  = () => { if (editTarget) { handleFormClose(); cancel(editTarget);  } };

  if (!token) {
    return <Container maxWidth="md" sx={{ pt: 6 }}><Alert severity="warning">You must be logged in to manage events.</Alert></Container>;
  }

  return (
    <Box component="main" sx={{ bgcolor: 'background.default', minHeight: 'calc(100vh - 64px)' }}>
      <Box sx={{ bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider', px: 3, py: 2.5 }}>
        <Container maxWidth="lg">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="h5" fontWeight={800}>Manage Events</Typography>
              <Typography fontSize={13} color="text.secondary" mt={0.25}>Create, publish, and manage all society events</Typography>
            </Box>
            <Button variant="contained" startIcon={<AddIcon />}
              onClick={() => { setEditTarget(undefined); setFormOpen(true); }}>
              New Event
            </Button>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: 4 }}>
        {actionMsg && <Alert severity="success" onClose={() => setActionMsg(null)} sx={{ mb: 2 }}>{actionMsg}</Alert>}
        {error && <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }} action={<Button size="small" onClick={() => void load()}>Retry</Button>}>{error}</Alert>}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
        ) : events.length === 0 ? (
          <Paper variant="outlined" sx={{ borderRadius: 2, p: 6, textAlign: 'center' }}>
            <Typography fontSize={40}>📅</Typography>
            <Typography variant="h6" mt={1}>No events yet</Typography>
            <Typography color="text.secondary" fontSize={14} mb={2}>Create your first event to get started.</Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setEditTarget(undefined); setFormOpen(true); }}>Create Event</Button>
          </Paper>
        ) : (
          <>
          {/* Mobile card layout – xs only */}
          <Box sx={{ display: { xs: 'flex', sm: 'none' }, flexDirection: 'column', gap: 1.5 }}>
            {events.map(ev => {
              const ss = STATUS_STYLE[ev.status] ?? { label: ev.status, color: 'default' as const };
              const hasLocation = ev.venue_lat != null && ev.venue_lng != null;
              return (
                <Paper key={ev.id} variant="outlined" sx={{ borderRadius: 2, p: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                    <Box sx={{ flex: 1, mr: 1, minWidth: 0 }}>
                      <Typography fontWeight={700} fontSize={15} sx={{ wordBreak: 'break-word' }}>{ev.title}</Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                        <GroupIcon sx={{ fontSize: 11, color: 'text.secondary' }} />
                        <Typography fontSize={12} color="text.secondary">By {ev.organizer_name}</Typography>
                      </Box>
                      {ev.approved_members.length > 0 && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                          <GroupAddIcon sx={{ fontSize: 11, color: 'text.secondary' }} />
                          <Typography fontSize={12} color="text.secondary">
                            In charge: {ev.approved_members.join(', ')}
                          </Typography>
                        </Box>
                      )}
                    </Box>
                    <Chip label={ss.label} color={ss.color} size="small" sx={{ fontWeight: 700, fontSize: 11, flexShrink: 0 }} />
                  </Box>

                  {ev.category_name && (
                    <Box sx={{ mb: 1 }}>
                      <Chip label={ev.category_name} size="small"
                        sx={{ bgcolor: ev.category_color ? `${ev.category_color}22` : 'action.hover', color: ev.category_color ?? 'text.secondary', fontWeight: 600, fontSize: 11 }} />
                    </Box>
                  )}

                  <Stack spacing={0.75} sx={{ mb: 1.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
                      <CalendarTodayIcon sx={{ fontSize: 13, color: 'text.secondary', flexShrink: 0, mt: 0.25 }} />
                      <Box>
                        {fmtDateRange(ev.start_time, ev.end_time).map((line, i) => line && (
                          <Typography key={i} fontSize={13}>{line}</Typography>
                        ))}
                      </Box>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
                      <LocationOnIcon sx={{ fontSize: 14, color: hasLocation ? '#6366f1' : 'text.disabled', mt: 0.1, flexShrink: 0 }} />
                      <Box sx={{ minWidth: 0 }}>
                        <Typography fontSize={13} sx={{ wordBreak: 'break-word' }}>{ev.venue}</Typography>
                        {hasLocation && (
                          <Box component="a" href={mapsUrl(ev.venue_lat!, ev.venue_lng!)}
                            target="_blank" rel="noopener noreferrer"
                            sx={{ fontSize: 11, color: '#6366f1', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 0.25, '&:hover': { textDecoration: 'underline' } }}>
                            <DirectionsIcon sx={{ fontSize: 11 }} /> Get Directions
                          </Box>
                        )}
                      </Box>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <GroupIcon sx={{ fontSize: 13, color: 'text.secondary', flexShrink: 0 }} />
                      <Typography fontSize={13} fontWeight={700}>{ev.confirmed_tickets}</Typography>
                      <Typography fontSize={12} color="text.secondary">
                        {ev.capacity ? `/ ${ev.capacity} registrations` : '∞ registrations'}
                      </Typography>
                    </Box>
                  </Stack>

                  <Divider sx={{ mb: 1.5 }} />

                  <Stack direction="row" spacing={0.5} flexWrap="wrap" alignItems="center">
                    {ev.status === 'draft' && (
                      <>
                        <Tooltip title="Edit draft">
                          <IconButton size="small" color="primary" onClick={() => openEdit(ev)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Button size="small" variant="contained" color="success"
                          startIcon={<PublishIcon sx={{ fontSize: 14 }} />}
                          onClick={() => publish(ev)}
                          sx={{ fontSize: 11, textTransform: 'none', px: 1.25, py: 0.25 }}>
                          Publish
                        </Button>
                        <Tooltip title="Delete draft">
                          <IconButton size="small" color="error" onClick={() => remove(ev)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}
                    {ev.status === 'published' && (
                      <>
                        <Tooltip title="Edit event">
                          <IconButton size="small" color="primary" onClick={() => openEdit(ev)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Mark as completed">
                          <IconButton size="small" color="info" onClick={() => complete(ev)}>
                            <CheckCircleIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Button size="small" variant="outlined" color="error"
                          startIcon={<CancelIcon sx={{ fontSize: 14 }} />}
                          onClick={() => cancel(ev)}
                          sx={{ fontSize: 11, textTransform: 'none', px: 1.25, py: 0.25 }}>
                          Cancel Event
                        </Button>
                      </>
                    )}
                    {ev.status === 'cancelled' && (
                      <Typography fontSize={11} color="text.disabled" sx={{ px: 0.5 }}>No actions</Typography>
                    )}
                    {ev.status === 'completed' && (
                      <Tooltip title="Delete event (removes registrations, tickets & payments)">
                        <IconButton size="small" color="error" onClick={() => remove(ev)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {ev.status !== 'completed' && ev.status !== 'cancelled' && (
                      <Tooltip title="Complimentary tickets">
                        <IconButton size="small" onClick={() => { window.location.href = `/manage/complimentary/${ev.id}`; }}>
                          <LocalActivityIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title="Manage access">
                      <IconButton size="small" onClick={() => setAccessTarget(ev)}>
                        <GroupAddIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="View details">
                      <IconButton size="small" onClick={() => { window.location.href = `/manage/details/${ev.id}`; }}>
                        <OpenInNewIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Paper>
              );
            })}
          </Box>

          {/* Table layout – sm and above */}
          <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', display: { xs: 'none', sm: 'block' } }}>
            <Table>
              <TableHead>
                <TableRow sx={{ bgcolor: 'action.hover' }}>
                  {['Event', 'Category', 'Date', 'Location', 'Registrations', 'Status', 'Actions'].map(h => (
                    <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'text.secondary', py: 1.5 }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {events.map(ev => {
                  const ss = STATUS_STYLE[ev.status] ?? { label: ev.status, color: 'default' as const };
                  const hasLocation = ev.venue_lat != null && ev.venue_lng != null;
                  return (
                    <TableRow key={ev.id} hover sx={{ '&:last-child td': { borderBottom: 0 } }}>
                      <TableCell sx={{ maxWidth: 220, overflow: 'hidden' }}>
                        <Tooltip title={ev.title}>
                          <Typography fontWeight={700} fontSize={14} noWrap>{ev.title}</Typography>
                        </Tooltip>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25, minWidth: 0 }}>
                          <GroupIcon sx={{ fontSize: 11, color: 'text.secondary', flexShrink: 0 }} />
                          <Tooltip title={ev.organizer_name}>
                            <Typography fontSize={12} color="text.secondary" noWrap sx={{ minWidth: 0 }}>By {ev.organizer_name}</Typography>
                          </Tooltip>
                        </Box>
                        {ev.approved_members.length > 0 && (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25, minWidth: 0 }}>
                            <GroupAddIcon sx={{ fontSize: 11, color: 'text.secondary', flexShrink: 0 }} />
                            <Tooltip title={ev.approved_members.join(', ')}>
                              <Typography fontSize={12} color="text.secondary" noWrap sx={{ minWidth: 0 }}>
                                In charge: {ev.approved_members.join(', ')}
                              </Typography>
                            </Tooltip>
                          </Box>
                        )}
                      </TableCell>
                      <TableCell>
                        {ev.category_name ? (
                          <Chip label={ev.category_name} size="small"
                            sx={{ bgcolor: ev.category_color ? `${ev.category_color}22` : 'action.hover', color: ev.category_color ?? 'text.secondary', fontWeight: 600, fontSize: 11 }} />
                        ) : <Typography fontSize={12} color="text.secondary">—</Typography>}
                      </TableCell>
                      <TableCell sx={{ minWidth: 150 }}>
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                          <CalendarTodayIcon sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }} />
                          <Box>
                            {fmtDateRange(ev.start_time, ev.end_time).map((line, i) => line && (
                              <Typography key={i} fontSize={12}>{line}</Typography>
                            ))}
                          </Box>
                        </Box>
                      </TableCell>
                      <TableCell sx={{ maxWidth: 160, overflow: 'hidden' }}>
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, minWidth: 0 }}>
                          <LocationOnIcon sx={{ fontSize: 13, color: hasLocation ? '#6366f1' : 'text.disabled', mt: 0.2, flexShrink: 0 }} />
                          <Box sx={{ minWidth: 0 }}>
                            <Tooltip title={ev.venue}>
                              <Typography fontSize={12} noWrap sx={{ textOverflow: 'ellipsis', overflow: 'hidden' }}>{ev.venue}</Typography>
                            </Tooltip>
                            {hasLocation && (
                              <Box component="a"
                                href={mapsUrl(ev.venue_lat!, ev.venue_lng!)}
                                target="_blank" rel="noopener noreferrer"
                                sx={{ fontSize: 11, color: '#6366f1', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 0.25, '&:hover': { textDecoration: 'underline' } }}>
                                <DirectionsIcon sx={{ fontSize: 11 }} /> Get Directions
                              </Box>
                            )}
                          </Box>
                        </Box>
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <Stack direction="row" spacing={0.5} alignItems="baseline">
                          <Typography fontWeight={700} fontSize={14}>{ev.confirmed_tickets}</Typography>
                          <Typography fontSize={11} color="text.secondary">{ev.capacity ? `/ ${ev.capacity}` : '∞'}</Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Chip label={ss.label} color={ss.color} size="small" sx={{ fontWeight: 700, fontSize: 11 }} />
                      </TableCell>
                      <TableCell sx={{ maxWidth: 140 }}>
                        <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                          {ev.status === 'draft' && (
                            <>
                              <Tooltip title="Edit draft">
                                <IconButton size="small" color="primary" onClick={() => openEdit(ev)}>
                                  <EditIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              <Button size="small" variant="contained" color="success"
                                startIcon={<PublishIcon sx={{ fontSize: 14 }} />}
                                onClick={() => publish(ev)}
                                sx={{ fontSize: 11, textTransform: 'none', px: 1.25, py: 0.25 }}>
                                Publish
                              </Button>
                              <Tooltip title="Delete draft">
                                <IconButton size="small" color="error" onClick={() => remove(ev)}>
                                  <DeleteIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </>
                          )}
                          {ev.status === 'published' && (
                            <>
                              <Tooltip title="Edit event">
                                <IconButton size="small" color="primary" onClick={() => openEdit(ev)}>
                                  <EditIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Mark as completed">
                                <IconButton size="small" color="info" onClick={() => complete(ev)}>
                                  <CheckCircleIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              <Button size="small" variant="outlined" color="error"
                                startIcon={<CancelIcon sx={{ fontSize: 14 }} />}
                                onClick={() => cancel(ev)}
                                sx={{ fontSize: 11, textTransform: 'none', px: 1.25, py: 0.25 }}>
                                Cancel Event
                              </Button>
                            </>
                          )}
                          {ev.status === 'cancelled' && (
                            <Typography fontSize={11} color="text.disabled" sx={{ px: 0.5 }}>No actions</Typography>
                          )}
                          {ev.status === 'completed' && (
                            <Tooltip title="Delete event (removes registrations, tickets & payments)">
                              <IconButton size="small" color="error" onClick={() => remove(ev)}>
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                          {ev.status !== 'completed' && ev.status !== 'cancelled' && (
                            <Tooltip title="Complimentary tickets">
                              <IconButton size="small" onClick={() => { window.location.href = `/manage/complimentary/${ev.id}`; }}>
                                <LocalActivityIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                          <Tooltip title="Manage access">
                            <IconButton size="small" onClick={() => setAccessTarget(ev)}>
                              <GroupAddIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="View details">
                            <IconButton size="small" onClick={() => { window.location.href = `/manage/details/${ev.id}`; }}>
                              <OpenInNewIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Paper>
          </>
        )}
      </Container>

      {formOpen && (
        <EventForm
          open={formOpen} token={token} categories={categories}
          initial={editTarget} onClose={handleFormClose} onSaved={handleFormSaved}
          onPublish={editTarget?.status === 'draft'     ? handleFormPublish : undefined}
          onCancel ={editTarget?.status === 'published' ? handleFormCancel  : undefined}
        />
      )}

      {confirm && (
        <ConfirmDialog message={confirm.label}
          onConfirm={async () => { try { await confirm.action(); } catch (e: unknown) { setError((e as Error).message); } finally { setConfirm(null); } }}
          onCancel={() => setConfirm(null)} />
      )}

      {accessTarget && token && (
        <ManageAccessDialog
          open={!!accessTarget} eventId={accessTarget.id} token={token}
          onClose={() => setAccessTarget(undefined)}
        />
      )}
    </Box>
  );
}

function ConfirmDialog({ message, onConfirm, onCancel }: { message: string; onConfirm: () => Promise<void>; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Confirm</DialogTitle>
      <DialogContent><Typography sx={{ whiteSpace: 'pre-line' }}>{message}</Typography></DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="contained" color="error" disabled={busy}
          startIcon={busy ? <CircularProgress size={14} /> : null}
          onClick={async () => { setBusy(true); await onConfirm(); }}>
          Confirm
        </Button>
      </DialogActions>
    </Dialog>
  );
}
