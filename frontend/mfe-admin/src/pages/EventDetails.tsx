import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Container,
  Grid, IconButton, InputAdornment, Link, MenuItem, Paper, Stack, Tab, Tabs, Table, TableBody, TableCell, TableHead,
  TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import ArrowBackIcon      from '@mui/icons-material/ArrowBack';
import CalendarTodayIcon  from '@mui/icons-material/CalendarToday';
import LocationOnIcon     from '@mui/icons-material/LocationOn';
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber';
import HowToRegIcon       from '@mui/icons-material/HowToReg';
import CardGiftcardIcon   from '@mui/icons-material/CardGiftcard';
import ReceiptIcon        from '@mui/icons-material/Receipt';
import StorefrontIcon     from '@mui/icons-material/Storefront';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import EmailIcon          from '@mui/icons-material/Email';
import CheckCircleIcon    from '@mui/icons-material/CheckCircle';
import SyncIcon           from '@mui/icons-material/Sync';
import VisibilityIcon     from '@mui/icons-material/Visibility';
import VisibilityOffIcon  from '@mui/icons-material/VisibilityOff';
import OpenInNewIcon      from '@mui/icons-material/OpenInNew';
import DeleteIcon         from '@mui/icons-material/DeleteOutline';

// ── API helpers ───────────────────────────────────────────────────────────────

function apiBase(service: string): string {
  const { hostname, port, origin } = window.location;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  if (isLocal && ['4004', '4005'].includes(port)) return `${origin}/api/${service}`;
  return `/api/${service}`;
}

async function apiFetch<T>(service: string, path: string, token: string): Promise<T> {
  const res = await fetch(`${apiBase(service)}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
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

interface EventInfo {
  id: string; title: string; status: string; start_time: string; venue: string;
  category_name: string | null;
}

interface Registration {
  id: string; ticket_count: number; total_amount: number | string; display_currency: string;
  status: string; registered_at: string; user_name: string | null; user_email: string | null;
  payment: { status: string; payment_method: string | null } | null;
}

interface RosterTicket {
  ticket_id: string; user_name: string | null; user_email: string | null;
  user_phone: string | null; ticket_count: number; status: string;
  scanned_at: string | null; unit_label: string | null;
}

interface ComplimentaryEntry {
  id: string; inviter_type: string; invited_by_name: string | null;
  guest_name: string | null; guest_email: string | null; ticket_status: string | null;
  ticket_count: number; created_by_name: string | null; created_at: string;
  cancelled_at: string | null;
}

const STATUS_STYLE: Record<string, { label: string; color: 'default' | 'warning' | 'success' | 'error' | 'info' }> = {
  draft:      { label: 'Draft',     color: 'default' },
  published:  { label: 'Published', color: 'success' },
  cancelled:  { label: 'Cancelled', color: 'error' },
  completed:  { label: 'Completed', color: 'info' },
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function fmtMoney(n: number | string, currency: string) {
  return `${currency === 'INR' ? '₹' : currency + ' '}${Number(n).toLocaleString('en-IN')}`;
}

// Money is only "collected" once a registration is confirmed (payment approved, or free)
// or attended (scanned at the gate). pending_payment hasn't been paid yet; cancelled was refunded.
const PAID_STATUSES = new Set(['confirmed', 'attended']);

// ── Purchases tab ────────────────────────────────────────────────────────────

function PurchasesTab({ registrations }: { registrations: Registration[] }) {
  const countByEmail = registrations.reduce<Record<string, number>>((acc, r) => {
    const key = r.user_email ?? r.user_name ?? '';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const paid = registrations.filter(r => PAID_STATUSES.has(r.status));
  const totalTickets = paid.reduce((s, r) => s + r.ticket_count, 0);
  const totalRevenue  = paid.reduce((s, r) => s + Number(r.total_amount), 0);

  // Deep link from a notification (?registration_id=...) — scroll to and
  // highlight the specific purchase the organizer was pointed at.
  const [highlightId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('registration_id'),
  );
  const highlightRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    if (highlightId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightId, registrations]);

  return (
    <>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <StatCard label="Registrations" value={registrations.length} color="#6366f1" />
        <StatCard label="Tickets Purchased" value={totalTickets} color="#10b981" />
        <StatCard label="Revenue" value={fmtMoney(totalRevenue, registrations[0]?.display_currency ?? 'INR')} color="#0ea5e9" />
      </Grid>
      <Typography fontSize={12} color="text.secondary" sx={{ mb: 2 }}>
        Tickets Purchased and Revenue count only <strong>confirmed</strong> or <strong>attended</strong> registrations — money actually collected. Cancelled and still-unpaid (pending payment) registrations are excluded.
      </Typography>
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <Table>
          <TableHead>
            <TableRow sx={{ bgcolor: 'action.hover' }}>
              {['Resident', 'Tickets', 'Amount', 'Payment', 'Status', 'Registered At'].map(h => (
                <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'text.secondary' }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {registrations.length === 0 && (
              <TableRow><TableCell colSpan={6}>
                <Typography fontSize={13} color="text.secondary" textAlign="center" py={2}>No purchases yet.</Typography>
              </TableCell></TableRow>
            )}
            {registrations.map(r => {
              const key = r.user_email ?? r.user_name ?? '';
              const multi = countByEmail[key] > 1;
              return (
                <TableRow key={r.id} hover
                  ref={r.id === highlightId ? highlightRef : undefined}
                  sx={r.id === highlightId ? { bgcolor: 'action.selected' } : undefined}>
                  <TableCell>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <Box>
                        <Typography fontWeight={600} fontSize={13}>{r.user_name ?? '—'}</Typography>
                        <Typography fontSize={11} color="text.secondary">{r.user_email ?? '—'}</Typography>
                      </Box>
                      {multi && <Chip label={`×${countByEmail[key]} purchases`} size="small" color="warning" sx={{ fontWeight: 700, fontSize: 10 }} />}
                    </Stack>
                  </TableCell>
                  <TableCell><Typography fontWeight={700} fontSize={14}>{r.ticket_count}</Typography></TableCell>
                  <TableCell><Typography fontSize={13}>{fmtMoney(r.total_amount, r.display_currency)}</Typography></TableCell>
                  <TableCell>
                    {r.payment ? <Chip label={r.payment.status} size="small" /> : <Typography fontSize={12} color="text.secondary">Free</Typography>}
                  </TableCell>
                  <TableCell><Chip label={r.status} size="small" color={r.status === 'confirmed' || r.status === 'attended' ? 'success' : 'default'} /></TableCell>
                  <TableCell><Typography fontSize={12}>{fmtDate(r.registered_at)}</Typography></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Paper>
    </>
  );
}

// ── Attendance / roster tab ──────────────────────────────────────────────────

function AttendanceTab({ tickets }: { tickets: RosterTicket[] }) {
  const totalIssued = tickets.reduce((s, t) => s + t.ticket_count, 0);
  const used = tickets.filter(t => t.status === 'used').length;

  return (
    <>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <StatCard label="Tickets Issued" value={totalIssued} color="#6366f1" />
        <StatCard label="Checked In" value={used} color="#10b981" />
        <StatCard label="Not Yet Checked In" value={tickets.length - used} color="#f59e0b" />
      </Grid>
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <Table>
          <TableHead>
            <TableRow sx={{ bgcolor: 'action.hover' }}>
              {['Resident', 'Unit', 'Tickets', 'Status', 'Scanned At'].map(h => (
                <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'text.secondary' }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {tickets.length === 0 && (
              <TableRow><TableCell colSpan={5}>
                <Typography fontSize={13} color="text.secondary" textAlign="center" py={2}>No tickets issued yet.</Typography>
              </TableCell></TableRow>
            )}
            {tickets.map(t => (
              <TableRow key={t.ticket_id} hover>
                <TableCell>
                  <Typography fontWeight={600} fontSize={13}>{t.user_name ?? '—'}</Typography>
                  <Typography fontSize={11} color="text.secondary">{t.user_email ?? '—'}</Typography>
                </TableCell>
                <TableCell><Typography fontSize={12}>{t.unit_label ?? '—'}</Typography></TableCell>
                <TableCell><Typography fontWeight={700} fontSize={14}>{t.ticket_count}</Typography></TableCell>
                <TableCell><Chip label={t.status === 'used' ? 'Checked in' : 'Issued'} size="small" color={t.status === 'used' ? 'success' : 'default'} /></TableCell>
                <TableCell><Typography fontSize={12}>{t.scanned_at ? fmtDate(t.scanned_at) : '—'}</Typography></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </>
  );
}

// ── Complimentary tab (read-only summary; full CRUD lives on its own page) ───

function ComplimentaryTab({ entries, eventId }: { entries: ComplimentaryEntry[]; eventId: string }) {
  const live = entries.filter(e => !e.cancelled_at);
  const total = live.reduce((s, e) => s + e.ticket_count, 0);

  return (
    <>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography fontSize={13} color="text.secondary">{total} complimentary ticket{total === 1 ? '' : 's'} issued for this event.</Typography>
        <Button size="small" variant="outlined" endIcon={<OpenInNewIcon fontSize="small" />}
          onClick={() => { window.location.href = `/manage/complimentary/${eventId}`; }}>
          Manage Complimentary Tickets
        </Button>
      </Stack>
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <Table>
          <TableHead>
            <TableRow sx={{ bgcolor: 'action.hover' }}>
              {['Guest / Invited By', 'Type', 'Tickets', 'Status', 'Issued By'].map(h => (
                <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'text.secondary' }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {entries.length === 0 && (
              <TableRow><TableCell colSpan={5}>
                <Typography fontSize={13} color="text.secondary" textAlign="center" py={2}>No complimentary tickets issued yet.</Typography>
              </TableCell></TableRow>
            )}
            {entries.map(e => (
              <TableRow key={e.id} hover sx={{ opacity: e.cancelled_at ? 0.5 : 1 }}>
                <TableCell>
                  {e.inviter_type === 'walk_in' && !e.guest_name
                    ? <Typography fontSize={13} color="text.secondary" sx={{ fontStyle: 'italic' }}>Walk-in counter</Typography>
                    : (
                      <>
                        <Typography fontWeight={600} fontSize={13}>{e.guest_name ?? '—'}</Typography>
                        <Typography fontSize={11} color="text.secondary">Invited by {e.invited_by_name ?? '—'}</Typography>
                      </>
                    )}
                </TableCell>
                <TableCell><Chip label={e.inviter_type.replace('_', ' ')} size="small" /></TableCell>
                <TableCell><Typography fontWeight={700} fontSize={14}>{e.ticket_count}</Typography></TableCell>
                <TableCell>
                  <Chip size="small"
                    label={e.cancelled_at ? 'Cancelled' : e.ticket_status === 'used' ? 'Used' : 'Issued'}
                    color={e.cancelled_at ? 'error' : e.ticket_status === 'used' ? 'default' : 'success'} />
                </TableCell>
                <TableCell><Typography fontSize={12}>{e.created_by_name ?? '—'}</Typography></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </>
  );
}

// ── Finance & Expenses tab ───────────────────────────────────────────────────

interface FinanceSummary {
  ticket_revenue: number | string; sponsorship_income: number | string;
  total_expenses: number | string; vendor_pool: number | string;
  net_balance: number | string; sponsor_count: number; complimentary_tickets: number;
}

interface Expense {
  id: string; description: string; amount: number | string; currency_code: string;
  category: string; created_by_name: string; created_at: string;
}

const EXPENSE_CATEGORIES = ['venue', 'catering', 'equipment', 'marketing', 'staff', 'other'];

function FinanceTab({ eventId, token }: { eventId: string; token: string }) {
  const [summary,  setSummary]  = useState<FinanceSummary | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [desc,     setDesc]     = useState('');
  const [amount,   setAmount]   = useState('');
  const [category, setCategory] = useState('other');
  const [saving,   setSaving]   = useState(false);
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    Promise.all([
      apiFetch<FinanceSummary>('payments', `/funds/${eventId}/summary`, token),
      apiFetch<Expense[]>('payments', `/funds/${eventId}/expenses`, token),
    ]).then(([s, ex]) => { setSummary(s); setExpenses(ex); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [eventId, token]);

  useEffect(() => { load(); }, [load]);

  const addExpense = async () => {
    setSaving(true);
    try {
      await apiMutate('payments', `/funds/${eventId}/expenses`, token, 'POST', {
        description: desc, amount: Number(amount), category,
      });
      setDesc(''); setAmount(''); setCategory('other');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add expense');
    } finally {
      setSaving(false);
    }
  };

  const removeExpense = async (id: string) => {
    await apiMutate('payments', `/funds/expenses/${id}`, token, 'DELETE');
    load();
  };

  const downloadExport = async (format: 'xlsx' | 'pdf') => {
    const res = await fetch(`${apiBase('payments')}/funds/${eventId}/export.${format}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) { setError(`Failed to generate ${format} export`); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `fund-report-${eventId}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyShareLink = async () => {
    try {
      const link = await apiMutate<{ path: string; expires_at: string }>(
        'payments', `/funds/${eventId}/share-link`, token, 'POST',
      );
      if (!link) return;
      const fullUrl = `${window.location.origin}${link.path}`;
      await navigator.clipboard.writeText(fullUrl);
      setShareMsg(`Link copied — valid until ${new Date(link.expires_at).toLocaleDateString('en-IN')}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create share link');
    }
  };

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>;

  return (
    <>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {shareMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setShareMsg(null)}>{shareMsg}</Alert>}
      <Stack direction="row" spacing={1.5} justifyContent="flex-end" sx={{ mb: 2 }}>
        <Button size="small" variant="outlined" onClick={() => downloadExport('xlsx')}>Download Excel</Button>
        <Button size="small" variant="outlined" onClick={() => downloadExport('pdf')}>Download PDF</Button>
        <Button size="small" variant="outlined" onClick={copyShareLink}>Copy Share Link</Button>
      </Stack>
      {summary && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <StatCard label="Ticket Revenue" value={fmtMoney(summary.ticket_revenue, 'INR')} color="#0ea5e9" />
          <StatCard label="Sponsorship Income" value={fmtMoney(summary.sponsorship_income, 'INR')} color="#8b5cf6" />
          <StatCard label="Total Expenses" value={fmtMoney(summary.total_expenses, 'INR')} color="#ef4444" />
          <StatCard label="Net Balance" value={fmtMoney(summary.net_balance, 'INR')}
            color={Number(summary.net_balance) >= 0 ? '#10b981' : '#ef4444'} />
        </Grid>
      )}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', mb: 3 }}>
        <Table>
          <TableHead>
            <TableRow sx={{ bgcolor: 'action.hover' }}>
              {['Description', 'Category', 'Amount', 'Logged By', ''].map(h => (
                <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'text.secondary' }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {expenses.length === 0 && (
              <TableRow><TableCell colSpan={5}>
                <Typography fontSize={13} color="text.secondary" textAlign="center" py={2}>No expenses logged yet.</Typography>
              </TableCell></TableRow>
            )}
            {expenses.map(e => (
              <TableRow key={e.id} hover>
                <TableCell><Typography fontSize={13}>{e.description}</Typography></TableCell>
                <TableCell><Chip label={e.category} size="small" sx={{ textTransform: 'capitalize' }} /></TableCell>
                <TableCell><Typography fontWeight={700} fontSize={13}>{fmtMoney(e.amount, e.currency_code)}</Typography></TableCell>
                <TableCell><Typography fontSize={12} color="text.secondary">{e.created_by_name}</Typography></TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => removeExpense(e.id)}><DeleteIcon sx={{ fontSize: 16 }} /></IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
        <TextField size="small" label="Description" value={desc} onChange={e => setDesc(e.target.value)} sx={{ flex: 1, minWidth: 180 }} />
        <TextField size="small" label="Amount (₹)" type="number" value={amount} onChange={e => setAmount(e.target.value)} sx={{ width: 130 }} />
        <TextField size="small" select label="Category" value={category} onChange={e => setCategory(e.target.value)} sx={{ width: 140 }}>
          {EXPENSE_CATEGORIES.map(c => <MenuItem key={c} value={c} sx={{ textTransform: 'capitalize' }}>{c}</MenuItem>)}
        </TextField>
        <Button variant="contained" size="small" disabled={saving || !desc.trim() || !amount} onClick={addExpense}>
          Add Expense
        </Button>
      </Stack>
    </>
  );
}

// ── Vendors tab ──────────────────────────────────────────────────────────────

interface VendorDirectoryEntry { id: string; name: string; category: string }
interface EventVendor {
  id: string; vendor_id: string; vendor_name: string; vendor_category: string;
  stall_number: string | null; fee_type: string; fixed_fee: number | string;
  revenue_share_pct: number | string; status: string;
}

const VENDOR_CATEGORIES = ['food', 'beverages', 'merchandise', 'games', 'services', 'other'];
const VENDOR_STATUSES = ['invited', 'confirmed', 'cancelled'];

function VendorsTab({ eventId, token }: { eventId: string; token: string }) {
  const [directory, setDirectory] = useState<VendorDirectoryEntry[]>([]);
  const [vendors,   setVendors]   = useState<EventVendor[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [newVendorName, setNewVendorName] = useState('');
  const [newVendorCat,  setNewVendorCat]  = useState('other');
  const [pickVendorId,  setPickVendorId]  = useState('');
  const [stall,         setStall]         = useState('');
  const [saving,        setSaving]        = useState(false);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    Promise.all([
      apiFetch<VendorDirectoryEntry[]>('payments', '/funds/vendor-directory', token),
      apiFetch<EventVendor[]>('payments', `/funds/${eventId}/vendors`, token),
    ]).then(([d, v]) => { setDirectory(d); setVendors(v); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [eventId, token]);

  useEffect(() => { load(); }, [load]);

  const createVendor = async () => {
    setSaving(true);
    try {
      await apiMutate('payments', '/funds/vendor-directory', token, 'POST', {
        name: newVendorName, category: newVendorCat,
      });
      setNewVendorName(''); setNewVendorCat('other');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add vendor');
    } finally {
      setSaving(false);
    }
  };

  const inviteVendor = async () => {
    setSaving(true);
    try {
      await apiMutate('payments', `/funds/${eventId}/vendors`, token, 'POST', {
        vendor_id: pickVendorId, stall_number: stall || null,
      });
      setPickVendorId(''); setStall('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to invite vendor');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (id: string, status: string) => {
    await apiMutate('payments', `/funds/vendors/${id}`, token, 'PUT', { status });
    load();
  };

  const remove = async (id: string) => {
    await apiMutate('payments', `/funds/vendors/${id}`, token, 'DELETE');
    load();
  };

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>;

  return (
    <>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', mb: 3 }}>
        <Table>
          <TableHead>
            <TableRow sx={{ bgcolor: 'action.hover' }}>
              {['Vendor', 'Category', 'Stall', 'Status', ''].map(h => (
                <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'text.secondary' }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {vendors.length === 0 && (
              <TableRow><TableCell colSpan={5}>
                <Typography fontSize={13} color="text.secondary" textAlign="center" py={2}>No vendors invited yet.</Typography>
              </TableCell></TableRow>
            )}
            {vendors.map(v => (
              <TableRow key={v.id} hover>
                <TableCell><Typography fontWeight={600} fontSize={13}>{v.vendor_name}</Typography></TableCell>
                <TableCell><Chip label={v.vendor_category} size="small" sx={{ textTransform: 'capitalize' }} /></TableCell>
                <TableCell><Typography fontSize={13}>{v.stall_number ?? '—'}</Typography></TableCell>
                <TableCell>
                  <TextField select size="small" value={v.status} onChange={e => setStatus(v.id, e.target.value)}
                    sx={{ minWidth: 120 }}>
                    {VENDOR_STATUSES.map(s => <MenuItem key={s} value={s} sx={{ textTransform: 'capitalize' }}>{s}</MenuItem>)}
                  </TextField>
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => remove(v.id)}><DeleteIcon sx={{ fontSize: 16 }} /></IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Typography fontSize={13} fontWeight={700} sx={{ mb: 1 }}>Invite an existing vendor</Typography>
      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center" sx={{ mb: 3 }}>
        <TextField select size="small" label="Vendor" value={pickVendorId}
          onChange={e => setPickVendorId(e.target.value)} sx={{ minWidth: 200 }}>
          {directory.map(d => <MenuItem key={d.id} value={d.id}>{d.name} ({d.category})</MenuItem>)}
        </TextField>
        <TextField size="small" label="Stall #" value={stall} onChange={e => setStall(e.target.value)} sx={{ width: 100 }} />
        <Button variant="contained" size="small" disabled={saving || !pickVendorId} onClick={inviteVendor}>
          Invite
        </Button>
      </Stack>

      <Typography fontSize={13} fontWeight={700} sx={{ mb: 1 }}>Or add a new vendor to the directory</Typography>
      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
        <TextField size="small" label="Vendor name" value={newVendorName} onChange={e => setNewVendorName(e.target.value)} sx={{ flex: 1, minWidth: 180 }} />
        <TextField select size="small" label="Category" value={newVendorCat} onChange={e => setNewVendorCat(e.target.value)} sx={{ width: 150 }}>
          {VENDOR_CATEGORIES.map(c => <MenuItem key={c} value={c} sx={{ textTransform: 'capitalize' }}>{c}</MenuItem>)}
        </TextField>
        <Button variant="outlined" size="small" disabled={saving || !newVendorName.trim()} onClick={createVendor}>
          Add to Directory
        </Button>
      </Stack>
    </>
  );
}

// ── Revenue distribution tab ─────────────────────────────────────────────────

interface DistributionEntry {
  id: string; recipient_type: string; recipient_name: string | null;
  share_percentage: number | string; amount: number | string; status: string;
}
interface Distribution {
  id: string; total_pool: number | string; status: string; entries: DistributionEntry[];
}

const RECIPIENT_TYPES = ['sponsor', 'organizer', 'resident', 'society'];

function RevenueTab({ eventId, token }: { eventId: string; token: string }) {
  const [dist,    setDist]    = useState<Distribution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [poolAmount, setPoolAmount] = useState('');
  const [recipientType, setRecipientType] = useState('society');
  const [sharePct,      setSharePct]      = useState('');
  const [entryAmount,   setEntryAmount]   = useState('');
  const [saving,        setSaving]        = useState(false);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    apiFetch<Distribution>('payments', `/funds/${eventId}/revenue-distribution`, token)
      .then(setDist)
      .catch(() => setDist(null))
      .finally(() => setLoading(false));
  }, [eventId, token]);

  useEffect(() => { load(); }, [load]);

  const createPool = async () => {
    setSaving(true);
    try {
      await apiMutate('payments', `/funds/${eventId}/revenue-distribution`, token, 'POST', {
        total_pool: Number(poolAmount),
      });
      setPoolAmount(''); load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set up distribution');
    } finally {
      setSaving(false);
    }
  };

  const addEntry = async () => {
    if (!dist) return;
    setSaving(true);
    try {
      await apiMutate('payments', `/funds/revenue-distribution/${dist.id}/entries`, token, 'POST', {
        recipient_type: recipientType, share_percentage: Number(sharePct), amount: Number(entryAmount),
      });
      setSharePct(''); setEntryAmount(''); load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add entry');
    } finally {
      setSaving(false);
    }
  };

  const approve = async () => {
    if (!dist) return;
    await apiMutate('payments', `/funds/revenue-distribution/${dist.id}/approve`, token, 'PATCH');
    load();
  };

  const markDistributed = async () => {
    if (!dist) return;
    await apiMutate('payments', `/funds/revenue-distribution/${dist.id}/mark-distributed`, token, 'PATCH');
    load();
  };

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>;

  if (!dist) {
    return (
      <>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
        <Alert severity="info" sx={{ mb: 3, borderRadius: 2 }}>
          No revenue distribution pool has been set up for this event yet.
        </Alert>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <TextField size="small" label="Total pool (₹)" type="number" value={poolAmount}
            onChange={e => setPoolAmount(e.target.value)} sx={{ width: 160 }} />
          <Button variant="contained" size="small" disabled={saving || !poolAmount} onClick={createPool}>
            Set Up Distribution
          </Button>
        </Stack>
      </>
    );
  }

  return (
    <>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <StatCard label="Total Pool" value={fmtMoney(dist.total_pool, 'INR')} color="#ec4899" />
        <StatCard label="Status" value={dist.status} color="#6366f1" />
      </Grid>
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', mb: 3 }}>
        <Table>
          <TableHead>
            <TableRow sx={{ bgcolor: 'action.hover' }}>
              {['Recipient', 'Type', 'Share', 'Amount', 'Status'].map(h => (
                <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'text.secondary' }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {dist.entries.length === 0 && (
              <TableRow><TableCell colSpan={5}>
                <Typography fontSize={13} color="text.secondary" textAlign="center" py={2}>No payout entries yet.</Typography>
              </TableCell></TableRow>
            )}
            {dist.entries.map(en => (
              <TableRow key={en.id} hover>
                <TableCell><Typography fontSize={13}>{en.recipient_name ?? '—'}</Typography></TableCell>
                <TableCell><Chip label={en.recipient_type} size="small" sx={{ textTransform: 'capitalize' }} /></TableCell>
                <TableCell><Typography fontSize={13}>{en.share_percentage}%</Typography></TableCell>
                <TableCell><Typography fontWeight={700} fontSize={13}>{fmtMoney(en.amount, 'INR')}</Typography></TableCell>
                <TableCell><Chip label={en.status} size="small" color={en.status === 'paid' ? 'success' : 'default'} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      {dist.status === 'draft' && (
        <>
          <Typography fontSize={13} fontWeight={700} sx={{ mb: 1 }}>Add a payout entry</Typography>
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center" sx={{ mb: 3 }}>
            <TextField select size="small" label="Recipient Type" value={recipientType}
              onChange={e => setRecipientType(e.target.value)} sx={{ width: 150 }}>
              {RECIPIENT_TYPES.map(t => <MenuItem key={t} value={t} sx={{ textTransform: 'capitalize' }}>{t}</MenuItem>)}
            </TextField>
            <TextField size="small" label="Share %" type="number" value={sharePct} onChange={e => setSharePct(e.target.value)} sx={{ width: 100 }} />
            <TextField size="small" label="Amount (₹)" type="number" value={entryAmount} onChange={e => setEntryAmount(e.target.value)} sx={{ width: 130 }} />
            <Button variant="outlined" size="small" disabled={saving || !sharePct || !entryAmount} onClick={addEntry}>
              Add Entry
            </Button>
          </Stack>
          <Button variant="contained" size="small" disabled={dist.entries.length === 0} onClick={approve}>
            Approve Distribution
          </Button>
        </>
      )}
      {dist.status === 'approved' && (
        <Button variant="contained" size="small" color="success" onClick={markDistributed}>
          Mark as Fully Distributed
        </Button>
      )}
    </>
  );
}

// ── Small stat card ──────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <Grid item xs={6} md={4}>
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent sx={{ textAlign: 'center', py: 2 }}>
          <Typography fontSize={24} fontWeight={800} sx={{ color }}>{value}</Typography>
          <Typography fontSize={11} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, mt: 0.5 }}>{label}</Typography>
        </CardContent>
      </Card>
    </Grid>
  );
}

// ── Collector & Email tab ────────────────────────────────────────────────────

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

function CollectorSettingsTab({ eventId, token }: { eventId: string; token: string }) {
  const [cfg, setCfg]           = useState<CollectorSettings | null>(null);
  const [upiId, setUpiId]       = useState('');
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState(993);
  const [imapUser, setImapUser] = useState('');
  const [imapPassword, setImapPassword] = useState('');
  const [imapMailbox, setImapMailbox]   = useState('INBOX');
  const [showPw, setShowPw]     = useState(false);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [testing, setTesting]   = useState(false);
  const [testingRecon, setTestingRecon] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [msg, setMsg]           = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    apiFetch<CollectorSettings>('payments', `/registry/${eventId}/settings`, token)
      .then((d) => {
        setCfg(d);
        setUpiId(d.upi_id ?? '');
        setImapHost(d.imap_host);
        setImapPort(d.imap_port);
        setImapUser(d.imap_user);
        setImapMailbox(d.imap_mailbox);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [eventId, token]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      await apiMutate('payments', `/registry/${eventId}/settings`, token, 'PUT', {
        upi_id: upiId,
        imap_host: imapHost, imap_port: imapPort, imap_user: imapUser,
        imap_password: imapPassword, imap_mailbox: imapMailbox,
      });
      setImapPassword('');
      setMsg({ type: 'success', text: 'Collector & email settings saved.' });
      load();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  const useGmailDefaults = () => {
    setImapHost('imap.gmail.com');
    setImapPort(993);
    setImapMailbox('INBOX');
  };

  const testImap = async () => {
    setTesting(true); setMsg(null);
    try {
      const r = await apiMutate<{ mailbox: string; message_count: number }>(
        'payments', `/registry/${eventId}/settings/test-imap`, token, 'POST',
      );
      setMsg({ type: 'success', text: `Connected! Mailbox "${r?.mailbox}" has ${r?.message_count} messages.` });
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : 'IMAP test failed' });
    } finally {
      setTesting(false);
    }
  };

  const testReconciliation = async () => {
    setTestingRecon(true); setMsg(null);
    try {
      const r = await apiMutate<{ fetched: number }>(
        'payments', `/registry/${eventId}/settings/test-reconciliation`, token, 'POST',
      );
      setMsg({
        type: 'success',
        text: `Reconciliation service connected — it read ${r?.fetched ?? 0} message(s) from your inbox just now.`,
      });
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Reconciliation service test failed' });
    } finally {
      setTestingRecon(false);
    }
  };

  const scanNow = async () => {
    setScanning(true); setMsg(null);
    try {
      const r = await apiMutate<{ emails_processed: number; matched: number; unmatched: number }>(
        'payments', `/registry/${eventId}/settings/scan`, token, 'POST',
      );
      setMsg({
        type: 'success',
        text: `Scan complete: ${r?.matched ?? 0} matched, ${r?.unmatched ?? 0} unmatched from ${r?.emails_processed ?? 0} emails.`,
      });
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Scan failed' });
    } finally {
      setScanning(false);
    }
  };

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>;
  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Paper variant="outlined" sx={{ p: 3, borderRadius: 2, maxWidth: 640 }}>
      <Stack spacing={3}>
        {msg && <Alert severity={msg.type} onClose={() => setMsg(null)}>{msg.text}</Alert>}

        <Box>
          <Typography fontWeight={700} mb={1.5}>Receiver UPI ID</Typography>
          <TextField
            label="UPI ID"
            value={upiId}
            onChange={(e) => setUpiId(e.target.value)}
            size="small"
            fullWidth
            placeholder="name@bankname"
            helperText="The UPI ID residents pay into for this event. Can be changed at any time."
          />
          {cfg?.member_name && (
            <Typography variant="caption" color="text.secondary" display="block" mt={1}>
              Collector on record: {cfg.member_name}
            </Typography>
          )}
        </Box>

        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <EmailIcon color="primary" fontSize="small" />
              <Typography fontWeight={700}>Payment-Verification Email Account</Typography>
            </Box>
            <Button size="small" onClick={useGmailDefaults}>Use Gmail</Button>
          </Box>
          <Typography variant="caption" color="text.secondary" display="block" mb={2}>
            The inbox that receives your bank/UPI app's payment notification emails. The
            reconciliation service scans this mailbox to auto-verify payments for this event only.
          </Typography>
          <Stack spacing={2}>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label="IMAP Host" value={imapHost} onChange={(e) => setImapHost(e.target.value)}
                size="small" sx={{ flex: 3 }} placeholder="imap.gmail.com"
              />
              <TextField
                label="Port" value={imapPort} onChange={(e) => setImapPort(Number(e.target.value))}
                size="small" type="number" sx={{ flex: 1 }}
              />
            </Box>
            <TextField
              label="Email address" value={imapUser} onChange={(e) => setImapUser(e.target.value)}
              size="small" fullWidth placeholder="you@gmail.com"
            />
            <TextField
              label={cfg?.imap_password_set ? 'App password (leave blank to keep current)' : 'App password'}
              value={imapPassword} onChange={(e) => setImapPassword(e.target.value)}
              size="small" fullWidth type={showPw ? 'text' : 'password'}
              placeholder={cfg?.imap_password_set ? '••••••••' : 'App password or IMAP password'}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setShowPw((v) => !v)}>
                      {showPw ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
            <Alert severity="info" sx={{ py: 0.5 }}>
              For Gmail, this is <strong>not</strong> your normal Google account password — Gmail
              requires a 16-character <strong>App Password</strong> once 2-Step Verification is
              on. Generate one at{' '}
              <Link href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">
                myaccount.google.com/apppasswords
              </Link>{' '}
              (enable 2-Step Verification first if you haven't) and paste the 16 characters here.
              Other providers (Outlook, Yahoo, etc.) have their own equivalent "app password" page.
            </Alert>
            <TextField
              label="Mailbox / Folder" value={imapMailbox} onChange={(e) => setImapMailbox(e.target.value)}
              size="small" sx={{ maxWidth: 260 }} placeholder="INBOX"
            />
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              <Box>
                <Button
                  variant="outlined" size="small" onClick={testImap}
                  disabled={testing || !imapHost || !imapUser}
                  startIcon={testing ? <CircularProgress size={14} /> : <CheckCircleIcon />}
                >
                  Test IMAP Connection
                </Button>
                <Typography variant="caption" color="text.secondary" display="block" mt={0.75} maxWidth={260}>
                  Verifies the app password can actually log in and read this mailbox right now —
                  use it before saving to confirm it works, and any time after to re-check access.
                </Typography>
              </Box>
              <Box>
                <Tooltip title={cfg?.reconciliation_channel_configured ? '' : 'Save your settings first (with host, address and password filled in) to provision this.'}>
                  <span>
                    <Button
                      variant="outlined" size="small" color="secondary" onClick={testReconciliation}
                      disabled={testingRecon || !cfg?.reconciliation_channel_configured}
                      startIcon={testingRecon ? <CircularProgress size={14} /> : <SyncIcon />}
                    >
                      Test via Reconciliation Service
                    </Button>
                  </span>
                </Tooltip>
                <Typography variant="caption" color="text.secondary" display="block" mt={0.75} maxWidth={260}>
                  Checks the optional payment reconciliation service's own copy of these
                  credentials — the one that powers AI-assisted screenshot verification at
                  checkout. If this fails while the test above succeeds, re-save your settings
                  to re-sync it.
                </Typography>
              </Box>
            </Box>
          </Stack>
        </Box>

        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Button variant="contained" onClick={save} disabled={saving || !upiId.trim()}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button
            variant="outlined" color="success" onClick={scanNow}
            disabled={scanning || !imapHost || !imapUser}
            startIcon={scanning ? <CircularProgress size={14} color="inherit" /> : <SyncIcon />}
          >
            {scanning ? 'Scanning…' : 'Scan Inbox Now'}
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function EventDetails({ token, id: eventId }: { token?: string | null; id?: string }) {
  const [event, setEvent]               = useState<EventInfo | null>(null);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [tickets, setTickets]           = useState<RosterTicket[]>([]);
  const [comps, setComps]               = useState<ComplimentaryEntry[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [tab, setTab]                   = useState(0);

  const load = useCallback(() => {
    if (!token || !eventId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    Promise.all([
      apiFetch<EventInfo>('events', `/events/${eventId}`, token),
      apiFetch<Registration[]>('registrations', `/registrations?event_id=${eventId}`, token),
      apiFetch<RosterTicket[]>('tickets', `/tickets/event/${eventId}`, token),
      apiFetch<ComplimentaryEntry[]>('registrations', `/complimentary/tickets?event_id=${eventId}`, token),
    ])
      .then(([ev, regs, tix, comp]) => {
        setEvent(ev);
        setRegistrations(regs);
        setTickets(tix);
        setComps(comp);
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
          Navigate to this page from an event's row in Manage Events (View Details icon) to see its details.
        </Alert>
        <Button startIcon={<ArrowBackIcon />} onClick={() => { window.location.href = '/manage'; }}>
          Back to Manage Events
        </Button>
      </Box>
    );
  }

  const ss = event ? (STATUS_STYLE[event.status] ?? { label: event.status, color: 'default' as const }) : null;

  return (
    <Box component="main">
      <Box sx={{ bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider', px: 3, pt: 3 }}>
        <Container maxWidth="lg">
          <Button size="small" startIcon={<ArrowBackIcon />} sx={{ mb: 1 }}
            onClick={() => { window.location.href = '/manage'; }}>
            Manage Events
          </Button>
          {event && (
            <>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 1.5, flexWrap: 'wrap' }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="h5" fontWeight={800}>{event.title}</Typography>
                  <Stack direction="row" spacing={2} sx={{ mt: 0.5 }} flexWrap="wrap">
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <CalendarTodayIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                      <Typography fontSize={13} color="text.secondary">{fmtDate(event.start_time)}</Typography>
                    </Stack>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <LocationOnIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                      <Typography fontSize={13} color="text.secondary">{event.venue}</Typography>
                    </Stack>
                  </Stack>
                </Box>
                {ss && <Chip label={ss.label} color={ss.color} sx={{ fontWeight: 700 }} />}
              </Box>
              <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto">
                <Tab icon={<ConfirmationNumberIcon fontSize="small" />} iconPosition="start" label="Purchases" />
                <Tab icon={<HowToRegIcon fontSize="small" />} iconPosition="start" label="Attendance" />
                <Tab icon={<CardGiftcardIcon fontSize="small" />} iconPosition="start" label="Complimentary" />
                <Tab icon={<ReceiptIcon fontSize="small" />} iconPosition="start" label="Finance & Expenses" />
                <Tab icon={<StorefrontIcon fontSize="small" />} iconPosition="start" label="Vendors" />
                <Tab icon={<AccountBalanceIcon fontSize="small" />} iconPosition="start" label="Revenue" />
                <Tab icon={<EmailIcon fontSize="small" />} iconPosition="start" label="Collector & Email" />
              </Tabs>
            </>
          )}
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: 4 }}>
        {error && <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>{error}</Alert>}
        {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>}

        {!loading && event && (
          <>
            {tab === 0 && <PurchasesTab registrations={registrations} />}
            {tab === 1 && <AttendanceTab tickets={tickets} />}
            {tab === 2 && <ComplimentaryTab entries={comps} eventId={eventId} />}
            {tab === 3 && <FinanceTab eventId={eventId} token={token} />}
            {tab === 4 && <VendorsTab eventId={eventId} token={token} />}
            {tab === 5 && <RevenueTab eventId={eventId} token={token} />}
            {tab === 6 && <CollectorSettingsTab eventId={eventId} token={token} />}
          </>
        )}
      </Container>
    </Box>
  );
}
