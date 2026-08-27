import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog,
  DialogActions, DialogContent, DialogTitle, Divider,
  Grid, IconButton, InputAdornment, MenuItem, Paper, Stack,
  Table, TableBody, TableCell, TableHead, TablePagination,
  TableRow, TableSortLabel, TextField, Typography,
} from '@mui/material';
import AddIcon    from '@mui/icons-material/Add';
import EditIcon   from '@mui/icons-material/Edit';
import LinkIcon   from '@mui/icons-material/Link';
import MenuIcon   from '@mui/icons-material/Menu';
import SearchIcon from '@mui/icons-material/Search';
import { AdminSidebar } from '../components/AdminSidebar';

// ── API helpers (payments service owns sponsors; events service owns the event list) ──

function apiBase(service: string): string {
  const { hostname, port, origin } = window.location;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  if (isLocal && ['4004', '4005'].includes(port)) return `${origin}/api/${service}`;
  return `/api/${service}`;
}

async function apiFetch<T>(service: string, path: string, token: string): Promise<T> {
  const res = await fetch(`${apiBase(service)}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { detail?: string }).detail ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function apiMutate<T>(
  service: string, path: string, token: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown,
): Promise<T | null> {
  const res = await fetch(`${apiBase(service)}${path}`, {
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

interface Sponsor {
  id: string; organization_name: string; organization_type: string;
  contact_name: string | null; contact_email: string | null;
  platform_user_name: string | null;
  event_count: number; total_pledged: number | string; is_active: boolean;
}

interface EventOption { id: string; title: string }

const ORG_TYPES = ['private', 'public', 'ngo', 'individual'];

type SortDir = 'asc' | 'desc';
type SortKey = 'organization_name' | 'organization_type' | 'event_count' | 'total_pledged';

export function SponsorManagement({ token = null }: { token?: string | null }) {
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [events,   setEvents]   = useState<EventOption[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [saving,   setSaving]   = useState(false);
  const [addOpen,  setAddOpen]  = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [search,     setSearch]     = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sortKey,    setSortKey]    = useState<SortKey>('organization_name');
  const [sortDir,    setSortDir]    = useState<SortDir>('asc');
  const [page,       setPage]       = useState(0);
  const [rpp,        setRpp]        = useState(10);

  const [newOrg, setNewOrg] = useState(''); const [newType, setNewType] = useState('private');
  const [newContact, setNewContact] = useState(''); const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');

  const [linkSponsorId, setLinkSponsorId] = useState(''); const [linkEventId, setLinkEventId] = useState('');
  const [linkAmount, setLinkAmount] = useState(''); const [linkStatus, setLinkStatus] = useState('pledged');
  const [linkNotes, setLinkNotes] = useState('');

  const load = useCallback(() => {
    if (!token) { setLoading(false); return; }
    setLoading(true); setError(null);
    Promise.all([
      apiFetch<Sponsor[]>('payments', '/sponsors', token),
      apiFetch<{ events: { id: string; title: string }[] }>('events', '/events?status=&limit=100', token),
    ])
      .then(([s, ev]) => { setSponsors(s); setEvents(ev.events.map(e => ({ id: e.id, title: e.title }))); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const totalPledged = sponsors.reduce((a, s) => a + Number(s.total_pledged), 0);
  const statsCards = [
    { label: 'Total Sponsors',  value: sponsors.length },
    { label: 'Total Pledged',   value: `₹${totalPledged.toLocaleString()}` },
  ];

  const handleSaveSponsor = async () => {
    if (!newOrg || !token) return;
    setSaving(true);
    try {
      await apiMutate('payments', '/sponsors', token, 'POST', {
        organization_name: newOrg, organization_type: newType,
        contact_name: newContact || null, contact_email: newEmail || null, contact_phone: newPhone || null,
      });
      setAddOpen(false);
      setNewOrg(''); setNewType('private'); setNewContact(''); setNewEmail(''); setNewPhone('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add sponsor');
    } finally {
      setSaving(false);
    }
  };

  const handleLinkSponsor = async () => {
    if (!token || !linkSponsorId || !linkEventId || !linkAmount) return;
    setSaving(true);
    try {
      await apiMutate('payments', `/sponsors/${linkSponsorId}/sponsorships`, token, 'POST', {
        event_id: linkEventId, amount: Number(linkAmount), status: linkStatus, notes: linkNotes || null,
      });
      setLinkOpen(false);
      setLinkEventId(''); setLinkAmount(''); setLinkStatus('pledged'); setLinkNotes('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to link sponsor to event');
    } finally {
      setSaving(false);
    }
  };

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
    setPage(0);
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const list = sponsors.filter(s =>
      (s.organization_name.toLowerCase().includes(q) ||
        (s.contact_name ?? '').toLowerCase().includes(q) ||
        (s.contact_email ?? '').toLowerCase().includes(q)) &&
      (typeFilter === '' || s.organization_type === typeFilter)
    );
    return [...list].sort((a, b) => {
      const va = String(a[sortKey] ?? ''); const vb = String(b[sortKey] ?? '');
      return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });
  }, [sponsors, search, typeFilter, sortKey, sortDir]);

  const paginated = filtered.slice(page * rpp, (page + 1) * rpp);

  if (!token) {
    return <Box sx={{ p: 4 }}><Alert severity="warning">You must be logged in.</Alert></Box>;
  }

  return (
    <Box component="main" sx={{ display: 'flex', minHeight: 'calc(100vh - 60px)' }}>
      <AdminSidebar active="Sponsors" mobileOpen={sidebarOpen} onMobileClose={() => setSidebarOpen(false)} />

      <Box sx={{ flex: 1, p: { xs: 2, md: 4 }, minWidth: 0 }}>

        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 3, gap: 1.5, flexWrap: 'wrap' }}>
          <IconButton onClick={() => setSidebarOpen(true)}
            sx={{ display: { md: 'none' }, color: 'text.secondary' }} aria-label="Open admin menu">
            <MenuIcon />
          </IconButton>
          <Typography variant="h5" fontWeight={800} sx={{ flex: 1, fontSize: { xs: 20, md: 24 } }}>Sponsors</Typography>
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            <Button variant="outlined" startIcon={<LinkIcon />} onClick={() => setLinkOpen(true)}>Link to Event</Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>Add Sponsor</Button>
          </Stack>
        </Box>

        {error && <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>{error}</Alert>}
        {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>}

        {!loading && (
        <>
        {/* Stats */}
        <Grid container spacing={2} sx={{ mb: 4 }}>
          {statsCards.map(s => (
            <Grid item xs={6} md={3} key={s.label}>
              <Card variant="outlined" sx={{ borderRadius: 2 }}>
                <CardContent sx={{ textAlign: 'center', py: 2 }}>
                  <Typography fontSize={{ xs: 22, md: 28 }} fontWeight={800}>{s.value}</Typography>
                  <Typography fontSize={11} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, mt: 0.5 }}>
                    {s.label}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          {/* Search + filter bar */}
          <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              size="small" placeholder="Search org, contact, email…" value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 16, color: 'text.secondary' }} /></InputAdornment> }}
              sx={{ minWidth: 200, flex: 1, maxWidth: 360, bgcolor: 'background.paper' }}
            />
            <TextField size="small" select label="Type" value={typeFilter}
              onChange={e => { setTypeFilter(e.target.value); setPage(0); }}
              sx={{ minWidth: 140, bgcolor: 'background.paper' }}>
              <MenuItem value=""><em>All types</em></MenuItem>
              {ORG_TYPES.map(t => <MenuItem key={t} value={t} sx={{ textTransform: 'capitalize' }}>{t}</MenuItem>)}
            </TextField>
            {(search || typeFilter) && (
              <Typography fontSize={13} color="text.secondary">{filtered.length} of {sponsors.length}</Typography>
            )}
          </Box>

          {paginated.length === 0 ? (
            <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>No sponsors match your filter.</Box>
          ) : (
            <>
              {/* ── Mobile: card list ── */}
              <Stack spacing={1.5} sx={{ display: { xs: 'flex', md: 'none' }, p: 2 }}>
                {paginated.map(s => (
                  <Paper key={s.id} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1, gap: 1 }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography fontWeight={700} fontSize={15}>{s.organization_name}</Typography>
                        <Box sx={{ display: 'flex', gap: 1, mt: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
                          <Chip label={s.organization_type} size="small" variant="outlined" sx={{ textTransform: 'capitalize', fontSize: 11, fontWeight: 600 }} />
                          <Chip label={s.is_active ? 'Active' : 'Inactive'} color={s.is_active ? 'success' : 'default'} size="small" sx={{ fontWeight: 700 }} />
                        </Box>
                      </Box>
                      <Typography fontWeight={800} fontSize={15} color="primary.main" sx={{ flexShrink: 0 }}>
                        ₹{Number(s.total_pledged).toLocaleString()}
                      </Typography>
                    </Box>
                    <Divider sx={{ my: 1 }} />
                    <Box sx={{ display: 'flex', gap: 2, mb: 1, flexWrap: 'wrap' }}>
                      <Box>
                        <Typography fontSize={11} color="text.secondary">Contact</Typography>
                        <Typography fontSize={13} fontWeight={600}>{s.contact_name ?? '—'}</Typography>
                        <Typography fontSize={11} color="text.secondary">{s.contact_email ?? '—'}</Typography>
                      </Box>
                      <Box>
                        <Typography fontSize={11} color="text.secondary">Platform user</Typography>
                        <Typography fontSize={13} fontWeight={s.platform_user_name ? 600 : 400} color={s.platform_user_name ? 'text.primary' : 'text.secondary'} sx={{ fontStyle: s.platform_user_name ? 'normal' : 'italic' }}>
                          {s.platform_user_name ?? '— external —'}
                        </Typography>
                      </Box>
                      <Box>
                        <Typography fontSize={11} color="text.secondary">Events</Typography>
                        <Typography fontSize={15} fontWeight={700}>{s.event_count}</Typography>
                      </Box>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Button fullWidth size="small" variant="outlined" startIcon={<EditIcon />}>Edit</Button>
                      <Button fullWidth size="small" variant="outlined" startIcon={<LinkIcon />}
                        onClick={() => { setLinkSponsorId(s.id); setLinkOpen(true); }}>Link</Button>
                    </Box>
                  </Paper>
                ))}
              </Stack>

              {/* ── Desktop: table ── */}
              <Box sx={{ display: { xs: 'none', md: 'block' }, overflowX: 'auto' }}>
                <Table sx={{ minWidth: 700 }}>
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'action.hover' }}>
                      {([['organization_name', 'Organization'], ['organization_type', 'Type']] as [SortKey, string][]).map(([k, l]) => (
                        <TableCell key={k} sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'text.secondary', letterSpacing: 0.4 }}>
                          <TableSortLabel active={sortKey === k} direction={sortKey === k ? sortDir : 'asc'} onClick={() => toggleSort(k)}>{l}</TableSortLabel>
                        </TableCell>
                      ))}
                      {['Contact', 'Platform User'].map(h => (
                        <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'text.secondary', letterSpacing: 0.4 }}>{h}</TableCell>
                      ))}
                      {([['event_count', 'Events'], ['total_pledged', 'Total Pledged']] as [SortKey, string][]).map(([k, l]) => (
                        <TableCell key={k} sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'text.secondary', letterSpacing: 0.4 }}>
                          <TableSortLabel active={sortKey === k} direction={sortKey === k ? sortDir : 'asc'} onClick={() => toggleSort(k)}>{l}</TableSortLabel>
                        </TableCell>
                      ))}
                      {['Status', 'Actions'].map(h => (
                        <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'text.secondary', letterSpacing: 0.4 }}>{h}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {paginated.map(s => (
                      <TableRow key={s.id} hover>
                        <TableCell><Typography fontWeight={700} fontSize={14}>{s.organization_name}</Typography></TableCell>
                        <TableCell><Chip label={s.organization_type} size="small" variant="outlined" sx={{ textTransform: 'capitalize', fontSize: 11, fontWeight: 600 }} /></TableCell>
                        <TableCell>
                          <Typography fontSize={13}>{s.contact_name ?? '—'}</Typography>
                          <Typography fontSize={11} color="text.secondary">{s.contact_email ?? '—'}</Typography>
                        </TableCell>
                        <TableCell>
                          {s.platform_user_name
                            ? <Typography fontSize={13}>{s.platform_user_name}</Typography>
                            : <Typography fontSize={12} color="text.secondary" sx={{ fontStyle: 'italic' }}>— external —</Typography>}
                        </TableCell>
                        <TableCell><Typography fontWeight={700}>{s.event_count}</Typography></TableCell>
                        <TableCell><Typography fontWeight={700}>₹{Number(s.total_pledged).toLocaleString()}</Typography></TableCell>
                        <TableCell><Chip label={s.is_active ? 'Active' : 'Inactive'} color={s.is_active ? 'success' : 'default'} size="small" sx={{ fontWeight: 700 }} /></TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={1}>
                            <Button size="small" variant="outlined" startIcon={<EditIcon />}>Edit</Button>
                            <Button size="small" variant="outlined" startIcon={<LinkIcon />}
                              onClick={() => { setLinkSponsorId(s.id); setLinkOpen(true); }}>Link</Button>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </>
          )}

          <TablePagination
            component="div" count={filtered.length} page={page}
            onPageChange={(_, p) => setPage(p)} rowsPerPage={rpp}
            onRowsPerPageChange={e => { setRpp(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[5, 10, 25]}
            sx={{ borderTop: '1px solid', borderColor: 'divider' }}
          />
        </Paper>
        </>
        )}
      </Box>

      {/* Add Sponsor dialog */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle fontWeight={700}>Add New Sponsor</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <Grid container spacing={2}>
              <Grid item xs={8}><TextField label="Organization Name *" fullWidth size="small" value={newOrg} onChange={e => setNewOrg(e.target.value)} /></Grid>
              <Grid item xs={4}>
                <TextField label="Type *" fullWidth size="small" select value={newType} onChange={e => setNewType(e.target.value)}>
                  {ORG_TYPES.map(t => <MenuItem key={t} value={t} sx={{ textTransform: 'capitalize' }}>{t}</MenuItem>)}
                </TextField>
              </Grid>
            </Grid>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}><TextField label="Contact Name" fullWidth size="small" value={newContact} onChange={e => setNewContact(e.target.value)} /></Grid>
              <Grid item xs={12} sm={6}><TextField label="Contact Email" type="email" fullWidth size="small" value={newEmail} onChange={e => setNewEmail(e.target.value)} /></Grid>
            </Grid>
            <Grid container spacing={2}>
              <Grid item xs={12}><TextField label="Contact Phone" fullWidth size="small" value={newPhone} onChange={e => setNewPhone(e.target.value)} /></Grid>
            </Grid>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveSponsor} disabled={!newOrg || saving}>Save Sponsor</Button>
        </DialogActions>
      </Dialog>

      {/* Link to Event dialog */}
      <Dialog open={linkOpen} onClose={() => setLinkOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle fontWeight={700}>Link Sponsor to Event</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <TextField label="Sponsor" fullWidth size="small" select value={linkSponsorId} onChange={e => setLinkSponsorId(e.target.value)}>
              <MenuItem value="">— select sponsor —</MenuItem>
              {sponsors.map(s => <MenuItem key={s.id} value={s.id}>{s.organization_name}</MenuItem>)}
            </TextField>
            <TextField label="Event" fullWidth size="small" select value={linkEventId} onChange={e => setLinkEventId(e.target.value)}>
              <MenuItem value="">— select event —</MenuItem>
              {events.map(e => <MenuItem key={e.id} value={e.id}>{e.title}</MenuItem>)}
            </TextField>
            <Grid container spacing={2}>
              <Grid item xs={7}><TextField label="Amount (₹) *" type="number" fullWidth size="small" value={linkAmount} onChange={e => setLinkAmount(e.target.value)} /></Grid>
              <Grid item xs={5}>
                <TextField label="Status" fullWidth size="small" select value={linkStatus} onChange={e => setLinkStatus(e.target.value)}>
                  <MenuItem value="pledged">Pledged</MenuItem>
                  <MenuItem value="received">Received</MenuItem>
                </TextField>
              </Grid>
            </Grid>
            <TextField label="Notes" multiline rows={2} fullWidth size="small" value={linkNotes} onChange={e => setLinkNotes(e.target.value)} placeholder="What is this sponsorship covering?" />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setLinkOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!linkSponsorId || !linkEventId || !linkAmount || saving} onClick={handleLinkSponsor}>Link Sponsor</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
