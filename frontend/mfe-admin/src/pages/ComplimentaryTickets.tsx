import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, CircularProgress, Container, Dialog, DialogContent,
  DialogTitle, FormControl, Grid, IconButton, InputLabel, MenuItem, Paper, Select,
  Snackbar, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography, Chip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EmailIcon from '@mui/icons-material/Email';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import QrCode2Icon from '@mui/icons-material/QrCode2';

// ── API helpers ───────────────────────────────────────────────────────────────

function apiBase(service: string): string {
  const { hostname, port, origin } = window.location;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  if (isLocal && ['4004', '4005'].includes(port)) return `${origin}/api/${service}`;
  return `/api/${service}`;
}

async function apiFetch<T>(service: string, path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase(service)}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { detail?: string }).detail ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type InviterType = 'organizer' | 'committee_member' | 'sponsor' | 'walk_in';

interface EventDetail { id: string; title: string; status: string }

interface UserSummary { id: string; name: string; role: string }

interface Entry {
  id: string;
  event_id: string;
  inviter_type: InviterType;
  invited_by_user_id: string | null;
  invited_by_name: string | null;
  guest_name: string | null;
  guest_email: string | null;
  ticket_id: string | null;
  ticket_status: string | null;
  qr_token: string | null;
  ticket_count: number;
  notes: string | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  cancelled_at: string | null;
  emailed_at: string | null;
}

const TYPE_CONFIG: Record<InviterType, { label: string; color: 'primary' | 'info' | 'success' | 'warning' }> = {
  organizer:        { label: 'Organizer',    color: 'primary' },
  committee_member: { label: 'Committee',    color: 'info' },
  sponsor:          { label: 'Sponsor',      color: 'success' },
  walk_in:          { label: 'Walk-in',      color: 'warning' },
};

const ELIGIBLE_ROLES: Record<Exclude<InviterType, 'walk_in'>, string> = {
  organizer:        'admin',
  committee_member: 'committee_member',
  sponsor:          'sponsor',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function entryStatus(e: Entry): { label: string; color: 'success' | 'error' | 'default' } {
  if (e.cancelled_at) return { label: 'Cancelled', color: 'error' };
  if (e.ticket_status === 'used') return { label: 'Used', color: 'default' };
  if (e.ticket_id) return { label: 'Issued', color: 'success' };
  return { label: 'Logged', color: 'default' };
}

// ── QR dialog ─────────────────────────────────────────────────────────────────

function QrDialog({ ticketId, guestName, onClose }: { ticketId: string; guestName: string | null; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {guestName ?? 'Guest Ticket'}
        <IconButton size="small" onClick={onClose}><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent sx={{ textAlign: 'center', pb: 3 }}>
        <Box
          component="img"
          src={`${apiBase('tickets')}/tickets/${ticketId}/qr`}
          alt="Ticket QR"
          sx={{ width: 220, height: 220, mx: 'auto', display: 'block' }}
        />
        <Typography variant="caption" color="text.secondary" display="block" mt={1}>
          Ticket ID: {ticketId.slice(0, 8).toUpperCase()}
        </Typography>
      </DialogContent>
    </Dialog>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ComplimentaryTickets({ token, id: eventId }: { token?: string | null; id?: string }) {
  const [event, setEvent]     = useState<EventDetail | null>(null);
  const [users, setUsers]     = useState<UserSummary[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [qrTicket, setQrTicket] = useState<{ id: string; name: string | null } | null>(null);
  const [toast, setToast]     = useState<string | null>(null);

  const [inviterType, setInviterType]     = useState<InviterType>('walk_in');
  const [inviterUserId, setInviterUserId] = useState('');
  const [guestName, setGuestName]         = useState('');
  const [guestEmail, setGuestEmail]       = useState('');
  const [ticketCount, setTicketCount]     = useState('1');
  const [notes, setNotes]                 = useState('');
  const [submitting, setSubmitting]       = useState(false);
  const [emailingId, setEmailingId]       = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token || !eventId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    Promise.all([
      apiFetch<EventDetail>('events', `/events/${eventId}`, token),
      apiFetch<{ items: UserSummary[] }>('users', '/users?limit=200', token),
      apiFetch<Entry[]>('registrations', `/complimentary/tickets?event_id=${eventId}`, token),
    ])
      .then(([ev, userList, comp]) => {
        setEvent(ev);
        setUsers(userList.items);
        setEntries(comp);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, eventId]);

  useEffect(() => { load(); }, [load]);

  if (!token) {
    return <Container maxWidth="md" sx={{ pt: 6 }}><Alert severity="warning">You must be logged in.</Alert></Container>;
  }

  if (!eventId) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="info" sx={{ mb: 2 }}>
          Navigate to this page from an event's row in Manage Events (🎟 icon) to manage its complimentary tickets.
        </Alert>
        <Button startIcon={<ArrowBackIcon />} onClick={() => { window.location.href = '/manage'; }}>
          Back to Manage Events
        </Button>
      </Box>
    );
  }

  const eventClosed = event?.status === 'completed' || event?.status === 'cancelled';

  const eligibleUsers = inviterType === 'walk_in'
    ? []
    : users.filter(u => u.role === ELIGIBLE_ROLES[inviterType]);

  const live = entries.filter(e => !e.cancelled_at);
  const grandTotal = live.reduce((s, e) => s + e.ticket_count, 0);
  const byType = live.reduce((acc, e) => ({ ...acc, [e.inviter_type]: (acc[e.inviter_type] ?? 0) + e.ticket_count }), {} as Record<string, number>);

  async function handleAdd() {
    const count = Number(ticketCount);
    if (!count || count < 1) return;
    setSubmitting(true);
    setError(null);
    try {
      if (inviterType === 'walk_in' && !guestName.trim()) {
        // Anonymous walk-in: headcount only, no ticket/QR.
        await apiFetch('registrations', '/complimentary/walk-ins', token!, {
          method: 'POST',
          body: JSON.stringify({ event_id: eventId, ticket_count: count, notes: notes || null }),
        });
      } else {
        if (inviterType !== 'walk_in' && !inviterUserId) {
          setError('Please select who invited the guest.');
          setSubmitting(false);
          return;
        }
        if (!guestName.trim()) {
          setError('Please enter the guest name.');
          setSubmitting(false);
          return;
        }
        await apiFetch('registrations', '/complimentary/tickets', token!, {
          method: 'POST',
          body: JSON.stringify({
            event_id: eventId, inviter_type: inviterType,
            invited_by_user_id: inviterType === 'walk_in' ? null : inviterUserId,
            guest_name: guestName.trim(), guest_email: guestEmail.trim() || null,
            ticket_count: count, notes: notes || null,
          }),
        });
      }
      setGuestName(''); setGuestEmail(''); setTicketCount('1'); setNotes(''); setInviterUserId('');
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add entry');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(e: Entry) {
    if (!window.confirm(`Revoke this ${TYPE_CONFIG[e.inviter_type].label.toLowerCase()} entry${e.guest_name ? ` for ${e.guest_name}` : ''}?`)) return;
    try {
      await apiFetch('registrations', `/complimentary/tickets/${e.id}`, token!, { method: 'DELETE' });
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to revoke');
    }
  }

  async function handleEmail(e: Entry) {
    setEmailingId(e.id);
    setError(null);
    try {
      await apiFetch('registrations', `/complimentary/tickets/${e.id}/email`, token!, { method: 'POST' });
      setToast(`QR ticket emailed to ${e.guest_email}`);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send email');
    } finally {
      setEmailingId(null);
    }
  }

  return (
    <Box component="main">
      <Box sx={{ bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider', px: 3, py: 3 }}>
        <Container maxWidth="lg">
          <Button size="small" startIcon={<ArrowBackIcon />} sx={{ mb: 1 }}
            onClick={() => { window.location.href = '/manage'; }}>
            Manage Events
          </Button>
          <Typography fontSize={13} color="text.secondary" sx={{ mb: 0.5 }}>
            Manage Events ›{' '}
            <Box component="span" fontWeight={700} color="text.primary">{event?.title ?? '…'}</Box>
            {' '}› Complimentary Tickets
          </Typography>
          <Typography variant="h5" fontWeight={800} sx={{ mt: 0.5 }}>Complimentary Tickets</Typography>
          <Typography fontSize={14} color="text.secondary" sx={{ mt: 0.5 }}>
            Free-entry allocations for organizer guests, committee acquaintances, sponsor guests, and walk-ins.
          </Typography>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: 4 }}>
        {error && <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>{error}</Alert>}
        {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>}

        {!loading && (
          <>
            <Grid container spacing={2} sx={{ mb: 4 }}>
              <Grid item>
                <Card variant="outlined" sx={{ borderRadius: 2, textAlign: 'center', px: 3, py: 2, minWidth: 120 }}>
                  <Typography fontSize={28} fontWeight={800} color="primary">{grandTotal}</Typography>
                  <Typography fontSize={12} color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>Total Free</Typography>
                </Card>
              </Grid>
              {(Object.entries(byType) as [InviterType, number][]).map(([type, count]) => (
                <Grid item key={type}>
                  <Card variant="outlined" sx={{ borderRadius: 2, textAlign: 'center', px: 3, py: 2, minWidth: 110 }}>
                    <Typography fontSize={28} fontWeight={800}>{count}</Typography>
                    <Typography fontSize={12} color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {TYPE_CONFIG[type]?.label ?? type}
                    </Typography>
                  </Card>
                </Grid>
              ))}
            </Grid>

            <Grid container spacing={4}>
              <Grid item xs={12} md={7}>
                <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>Current Allocations</Typography>
                <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
                  <Table>
                    <TableHead>
                      <TableRow sx={{ bgcolor: 'action.hover' }}>
                        {['Guest / Invited By', 'Type', 'Tickets', 'Status', 'Issued By', ''].map((h) => (
                          <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'text.secondary', letterSpacing: 0.4 }}>{h}</TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {entries.length === 0 && (
                        <TableRow><TableCell colSpan={6}>
                          <Typography fontSize={13} color="text.secondary" textAlign="center" py={2}>No entries yet.</Typography>
                        </TableCell></TableRow>
                      )}
                      {entries.map((e) => {
                        const status = entryStatus(e);
                        return (
                          <TableRow key={e.id} hover sx={{ opacity: e.cancelled_at ? 0.55 : 1 }}>
                            <TableCell>
                              {e.inviter_type === 'walk_in'
                                ? <Typography fontSize={13} color="text.secondary" sx={{ fontStyle: 'italic' }}>Walk-in counter</Typography>
                                : (
                                  <>
                                    <Typography fontWeight={600} fontSize={13}>{e.guest_name}</Typography>
                                    <Typography variant="caption" color="text.secondary" display="block">
                                      Invited by {e.invited_by_name ?? '—'}
                                    </Typography>
                                    {e.guest_email && (
                                      <Typography variant="caption" color="text.secondary" display="block">
                                        {e.guest_email}{e.emailed_at ? ` · emailed ${fmtDate(e.emailed_at)}` : ''}
                                      </Typography>
                                    )}
                                  </>
                                )}
                            </TableCell>
                            <TableCell>
                              <Chip label={TYPE_CONFIG[e.inviter_type].label} color={TYPE_CONFIG[e.inviter_type].color} size="small" sx={{ fontWeight: 700 }} />
                            </TableCell>
                            <TableCell><Typography fontWeight={700} fontSize={14}>{e.ticket_count}</Typography></TableCell>
                            <TableCell><Chip label={status.label} color={status.color} size="small" /></TableCell>
                            <TableCell>
                              <Typography fontSize={12}>{e.created_by_name ?? '—'}</Typography>
                              <Typography variant="caption" color="text.secondary">{fmtDate(e.created_at)}</Typography>
                            </TableCell>
                            <TableCell padding="none">
                              <Stack direction="row" spacing={0.5}>
                                {e.ticket_id && !e.cancelled_at && (
                                  <IconButton size="small" onClick={() => setQrTicket({ id: e.ticket_id!, name: e.guest_name })}>
                                    <QrCode2Icon fontSize="small" />
                                  </IconButton>
                                )}
                                {e.ticket_id && e.guest_email && !e.cancelled_at && (
                                  <IconButton size="small" color="primary" disabled={emailingId === e.id}
                                    onClick={() => handleEmail(e)} title="Email QR ticket to guest">
                                    {emailingId === e.id ? <CircularProgress size={16} /> : <EmailIcon fontSize="small" />}
                                  </IconButton>
                                )}
                                {!e.cancelled_at && (
                                  <IconButton size="small" color="error" onClick={() => handleRevoke(e)}>
                                    <DeleteOutlineIcon fontSize="small" />
                                  </IconButton>
                                )}
                              </Stack>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Paper>
              </Grid>

              <Grid item xs={12} md={5}>
                <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>Add New Entry</Typography>
                {eventClosed ? (
                  <Alert severity="warning" sx={{ borderRadius: 2 }}>
                    This event is {event?.status} — complimentary tickets can no longer be issued.
                  </Alert>
                ) : (
                <>
                <Paper variant="outlined" sx={{ p: 3, borderRadius: 2, bgcolor: 'action.hover' }}>
                  <Stack spacing={2.5}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Entry Type</InputLabel>
                      <Select label="Entry Type" value={inviterType} onChange={(e) => { setInviterType(e.target.value as InviterType); setInviterUserId(''); }}>
                        <MenuItem value="organizer">Organizer's Guest</MenuItem>
                        <MenuItem value="committee_member">Committee Member's Acquaintance</MenuItem>
                        <MenuItem value="sponsor">Sponsor's Acquaintance</MenuItem>
                        <MenuItem value="walk_in">Walk-in</MenuItem>
                      </Select>
                    </FormControl>

                    {inviterType !== 'walk_in' && (
                      <FormControl fullWidth size="small">
                        <InputLabel>Invited By</InputLabel>
                        <Select label="Invited By" value={inviterUserId} onChange={(e) => setInviterUserId(e.target.value)}>
                          {eligibleUsers.map((u) => (
                            <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    )}

                    <TextField
                      label={inviterType === 'walk_in' ? 'Guest Name (optional)' : 'Guest Name *'}
                      size="small" fullWidth
                      value={guestName} onChange={(e) => setGuestName(e.target.value)}
                      placeholder={inviterType === 'walk_in' ? 'Leave blank for an anonymous headcount' : undefined}
                    />
                    <TextField
                      label="Guest Email (optional, to send the QR ticket)" type="email" size="small" fullWidth
                      value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)}
                      placeholder="guest@example.com"
                      disabled={inviterType === 'walk_in' && !guestName.trim()}
                    />

                    <TextField
                      label="Number of Tickets" type="number" size="small" fullWidth
                      value={ticketCount} onChange={(e) => setTicketCount(e.target.value)}
                      inputProps={{ min: 1 }}
                    />

                    <TextField
                      label="Notes (optional)" multiline rows={2} size="small" fullWidth
                      value={notes} onChange={(e) => setNotes(e.target.value)}
                      placeholder="e.g. Gate batch 2"
                    />

                    <Button
                      variant="contained" startIcon={<AddIcon />} onClick={handleAdd}
                      disabled={submitting || (inviterType !== 'walk_in' && !inviterUserId)}
                    >
                      {submitting ? <CircularProgress size={18} color="inherit" /> : 'Add Entry'}
                    </Button>
                  </Stack>
                </Paper>

                {inviterType === 'walk_in' && !guestName.trim() && (
                  <Alert icon={<InfoOutlinedIcon />} severity="info" sx={{ mt: 2, borderRadius: 2 }}>
                    Leaving the name blank logs this walk-in as a headcount only — no ticket or QR code. Add a name (and email) to issue this walk-in a real, scannable ticket instead.
                  </Alert>
                )}
                {(inviterType !== 'walk_in' || guestName.trim()) && (
                  <Alert icon={<InfoOutlinedIcon />} severity="info" sx={{ mt: 2, borderRadius: 2 }}>
                    Creates a real, scannable gate ticket for this guest{inviterType !== 'walk_in' ? ' under the selected inviter' : ''}.
                  </Alert>
                )}
                </>
                )}
              </Grid>
            </Grid>
          </>
        )}
      </Container>

      {qrTicket && <QrDialog ticketId={qrTicket.id} guestName={qrTicket.name} onClose={() => setQrTicket(null)} />}

      <Snackbar
        open={!!toast} autoHideDuration={4000} onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" variant="filled" onClose={() => setToast(null)} sx={{ borderRadius: 2 }}>
          {toast}
        </Alert>
      </Snackbar>
    </Box>
  );
}
