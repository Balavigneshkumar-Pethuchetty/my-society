import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('admin');
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
        <StatCard label={t('eventDetails.purchases.statRegistrations')} value={registrations.length} color="#6366f1" />
        <StatCard label={t('eventDetails.purchases.statTicketsPurchased')} value={totalTickets} color="#10b981" />
        <StatCard label={t('eventDetails.purchases.statRevenue')} value={fmtMoney(totalRevenue, registrations[0]?.display_currency ?? 'INR')} color="#0ea5e9" />
      </Grid>
      <Typography fontSize={12} color="text.secondary" sx={{ mb: 2 }}>
        {t('eventDetails.purchases.note')}
      </Typography>
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <Table>
          <TableHead>
            <TableRow sx={{ bgcolor: 'action.hover' }}>
              {[t('eventDetails.purchases.table.resident'), t('eventDetails.purchases.table.tickets'), t('eventDetails.purchases.table.amount'), t('eventDetails.purchases.table.payment'), t('eventDetails.purchases.table.status'), t('eventDetails.purchases.table.registeredAt')].map(h => (
                <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'text.secondary' }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {registrations.length === 0 && (
              <TableRow><TableCell colSpan={6}>
                <Typography fontSize={13} color="text.secondary" textAlign="center" py={2}>{t('eventDetails.purchases.emptyMsg')}</Typography>
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
                      {multi && <Chip label={t('eventDetails.purchases.multiPurchases', { count: countByEmail[key] })} size="small" color="warning" sx={{ fontWeight: 700, fontSize: 10 }} />}
                    </Stack>
                  </TableCell>
                  <TableCell><Typography fontWeight={700} fontSize={14}>{r.ticket_count}</Typography></TableCell>
                  <TableCell><Typography fontSize={13}>{fmtMoney(r.total_amount, r.display_currency)}</Typography></TableCell>
                  <TableCell>
                    {r.payment ? <Chip label={r.payment.status} size="small" /> : <Typography fontSize={12} color="text.secondary">{t('eventDetails.purchases.free')}</Typography>}
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
  const { t } = useTranslation('admin');
  const totalIssued = tickets.reduce((s, t) => s + t.ticket_count, 0);
  const used = tickets.filter(t => t.status === 'used').length;

  return (
    <>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <StatCard label={t('eventDetails.attendance.statTicketsIssued')} value={totalIssued} color="#6366f1" />
        <StatCard label={t('eventDetails.attendance.statCheckedIn')} value={used} color="#10b981" />
        <StatCard label={t('eventDetails.attendance.statNotCheckedIn')} value={tickets.length - used} color="#f59e0b" />
      </Grid>
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <Table>
          <TableHead>
            <TableRow sx={{ bgcolor: 'action.hover' }}>
              {[t('eventDetails.attendance.table.resident'), t('eventDetails.attendance.table.unit'), t('eventDetails.attendance.table.tickets'), t('eventDetails.attendance.table.status'), t('eventDetails.attendance.table.scannedAt')].map(h => (
                <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'text.secondary' }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {tickets.length === 0 && (
              <TableRow><TableCell colSpan={5}>
                <Typography fontSize={13} color="text.secondary" textAlign="center" py={2}>{t('eventDetails.attendance.emptyMsg')}</Typography>
              </TableCell></TableRow>
            )}
            {tickets.map(tk => (
              <TableRow key={tk.ticket_id} hover>
                <TableCell>
                  <Typography fontWeight={600} fontSize={13}>{tk.user_name ?? '—'}</Typography>
                  <Typography fontSize={11} color="text.secondary">{tk.user_email ?? '—'}</Typography>
                </TableCell>
                <TableCell><Typography fontSize={12}>{tk.unit_label ?? '—'}</Typography></TableCell>
                <TableCell><Typography fontWeight={700} fontSize={14}>{tk.ticket_count}</Typography></TableCell>
                <TableCell><Chip label={tk.status === 'used' ? t('eventDetails.attendance.checkedIn') : t('eventDetails.attendance.issued')} size="small" color={tk.status === 'used' ? 'success' : 'default'} /></TableCell>
                <TableCell><Typography fontSize={12}>{tk.scanned_at ? fmtDate(tk.scanned_at) : '—'}</Typography></TableCell>
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
  const { t } = useTranslation('admin');
  const live = entries.filter(e => !e.cancelled_at);
  const total = live.reduce((s, e) => s + e.ticket_count, 0);

  return (
    <>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography fontSize={13} color="text.secondary">{t('eventDetails.complimentary.summary', { count: total })}</Typography>
        <Button size="small" variant="outlined" endIcon={<OpenInNewIcon fontSize="small" />}
          onClick={() => { window.location.href = `/manage/complimentary/${eventId}`; }}>
          {t('eventDetails.complimentary.manageBtn')}
        </Button>
      </Stack>
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <Table>
          <TableHead>
            <TableRow sx={{ bgcolor: 'action.hover' }}>
              {[t('eventDetails.complimentary.table.guest'), t('eventDetails.complimentary.table.type'), t('eventDetails.complimentary.table.tickets'), t('eventDetails.complimentary.table.status'), t('eventDetails.complimentary.table.issuedBy')].map(h => (
                <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'text.secondary' }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {entries.length === 0 && (
              <TableRow><TableCell colSpan={5}>
                <Typography fontSize={13} color="text.secondary" textAlign="center" py={2}>{t('eventDetails.complimentary.emptyMsg')}</Typography>
              </TableCell></TableRow>
            )}
            {entries.map(e => (
              <TableRow key={e.id} hover sx={{ opacity: e.cancelled_at ? 0.5 : 1 }}>
                <TableCell>
                  {e.inviter_type === 'walk_in' && !e.guest_name
                    ? <Typography fontSize={13} color="text.secondary" sx={{ fontStyle: 'italic' }}>{t('eventDetails.complimentary.walkInCounter')}</Typography>
                    : (
                      <>
                        <Typography fontWeight={600} fontSize={13}>{e.guest_name ?? '—'}</Typography>
                        <Typography fontSize={11} color="text.secondary">{t('eventDetails.complimentary.invitedBy', { name: e.invited_by_name ?? '—' })}</Typography>
                      </>
                    )}
                </TableCell>
                <TableCell><Chip label={e.inviter_type.replace('_', ' ')} size="small" /></TableCell>
                <TableCell><Typography fontWeight={700} fontSize={14}>{e.ticket_count}</Typography></TableCell>
                <TableCell>
                  <Chip size="small"
                    label={e.cancelled_at ? t('eventDetails.complimentary.cancelled') : e.ticket_status === 'used' ? t('eventDetails.complimentary.used') : t('eventDetails.complimentary.issued')}
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
  const { t } = useTranslation('admin');
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
      setError(e instanceof Error ? e.message : t('eventDetails.finance.failedToAddExpense'));
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
    if (!res.ok) { setError(t('eventDetails.finance.failedToGenerateExport', { format })); return; }
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
      setShareMsg(t('eventDetails.finance.shareLinkCopied', { date: new Date(link.expires_at).toLocaleDateString('en-IN') }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('eventDetails.finance.failedToCreateShareLink'));
    }
  };

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>;

  return (
    <>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {shareMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setShareMsg(null)}>{shareMsg}</Alert>}
      <Stack direction="row" spacing={1.5} justifyContent="flex-end" sx={{ mb: 2 }}>
        <Button size="small" variant="outlined" onClick={() => downloadExport('xlsx')}>{t('eventDetails.finance.downloadExcel')}</Button>
        <Button size="small" variant="outlined" onClick={() => downloadExport('pdf')}>{t('eventDetails.finance.downloadPdf')}</Button>
        <Button size="small" variant="outlined" onClick={copyShareLink}>{t('eventDetails.finance.copyShareLink')}</Button>
      </Stack>
      {summary && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <StatCard label={t('eventDetails.finance.statTicketRevenue')} value={fmtMoney(summary.ticket_revenue, 'INR')} color="#0ea5e9" />
          <StatCard label={t('eventDetails.finance.statSponsorshipIncome')} value={fmtMoney(summary.sponsorship_income, 'INR')} color="#8b5cf6" />
          <StatCard label={t('eventDetails.finance.statTotalExpenses')} value={fmtMoney(summary.total_expenses, 'INR')} color="#ef4444" />
          <StatCard label={t('eventDetails.finance.statNetBalance')} value={fmtMoney(summary.net_balance, 'INR')}
            color={Number(summary.net_balance) >= 0 ? '#10b981' : '#ef4444'} />
        </Grid>
      )}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', mb: 3 }}>
        <Table>
          <TableHead>
            <TableRow sx={{ bgcolor: 'action.hover' }}>
              {[t('eventDetails.finance.table.description'), t('eventDetails.finance.table.category'), t('eventDetails.finance.table.amount'), t('eventDetails.finance.table.loggedBy'), ''].map(h => (
                <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'text.secondary' }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {expenses.length === 0 && (
              <TableRow><TableCell colSpan={5}>
                <Typography fontSize={13} color="text.secondary" textAlign="center" py={2}>{t('eventDetails.finance.emptyMsg')}</Typography>
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
        <TextField size="small" label={t('eventDetails.finance.descLabel')} value={desc} onChange={e => setDesc(e.target.value)} sx={{ flex: 1, minWidth: 180 }} />
        <TextField size="small" label={t('eventDetails.finance.amountLabel')} type="number" value={amount} onChange={e => setAmount(e.target.value)} sx={{ width: 130 }} />
        <TextField size="small" select label={t('eventDetails.finance.categoryLabel')} value={category} onChange={e => setCategory(e.target.value)} sx={{ width: 140 }}>
          {EXPENSE_CATEGORIES.map(c => <MenuItem key={c} value={c} sx={{ textTransform: 'capitalize' }}>{c}</MenuItem>)}
        </TextField>
        <Button variant="contained" size="small" disabled={saving || !desc.trim() || !amount} onClick={addExpense}>
          {t('eventDetails.finance.addExpenseBtn')}
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
  const { t } = useTranslation('admin');
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
      setError(e instanceof Error ? e.message : t('eventDetails.vendors.failedToAddVendor'));
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
      setError(e instanceof Error ? e.message : t('eventDetails.vendors.failedToInviteVendor'));
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
              {[t('eventDetails.vendors.table.vendor'), t('eventDetails.vendors.table.category'), t('eventDetails.vendors.table.stall'), t('eventDetails.vendors.table.status'), ''].map(h => (
                <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'text.secondary' }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {vendors.length === 0 && (
              <TableRow><TableCell colSpan={5}>
                <Typography fontSize={13} color="text.secondary" textAlign="center" py={2}>{t('eventDetails.vendors.emptyMsg')}</Typography>
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

      <Typography fontSize={13} fontWeight={700} sx={{ mb: 1 }}>{t('eventDetails.vendors.inviteExistingTitle')}</Typography>
      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center" sx={{ mb: 3 }}>
        <TextField select size="small" label={t('eventDetails.vendors.vendorLabel')} value={pickVendorId}
          onChange={e => setPickVendorId(e.target.value)} sx={{ minWidth: 200 }}>
          {directory.map(d => <MenuItem key={d.id} value={d.id}>{d.name} ({d.category})</MenuItem>)}
        </TextField>
        <TextField size="small" label={t('eventDetails.vendors.stallLabel')} value={stall} onChange={e => setStall(e.target.value)} sx={{ width: 100 }} />
        <Button variant="contained" size="small" disabled={saving || !pickVendorId} onClick={inviteVendor}>
          {t('eventDetails.vendors.inviteBtn')}
        </Button>
      </Stack>

      <Typography fontSize={13} fontWeight={700} sx={{ mb: 1 }}>{t('eventDetails.vendors.addNewVendorTitle')}</Typography>
      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
        <TextField size="small" label={t('eventDetails.vendors.vendorNameLabel')} value={newVendorName} onChange={e => setNewVendorName(e.target.value)} sx={{ flex: 1, minWidth: 180 }} />
        <TextField select size="small" label={t('eventDetails.vendors.table.category')} value={newVendorCat} onChange={e => setNewVendorCat(e.target.value)} sx={{ width: 150 }}>
          {VENDOR_CATEGORIES.map(c => <MenuItem key={c} value={c} sx={{ textTransform: 'capitalize' }}>{c}</MenuItem>)}
        </TextField>
        <Button variant="outlined" size="small" disabled={saving || !newVendorName.trim()} onClick={createVendor}>
          {t('eventDetails.vendors.addToDirectoryBtn')}
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
  const { t } = useTranslation('admin');
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
      setError(e instanceof Error ? e.message : t('eventDetails.revenue.failedToSetupDistribution'));
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
      setError(e instanceof Error ? e.message : t('eventDetails.revenue.failedToAddEntry'));
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
          {t('eventDetails.revenue.noPoolMsg')}
        </Alert>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <TextField size="small" label={t('eventDetails.revenue.totalPoolLabel')} type="number" value={poolAmount}
            onChange={e => setPoolAmount(e.target.value)} sx={{ width: 160 }} />
          <Button variant="contained" size="small" disabled={saving || !poolAmount} onClick={createPool}>
            {t('eventDetails.revenue.setupDistributionBtn')}
          </Button>
        </Stack>
      </>
    );
  }

  return (
    <>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <StatCard label={t('eventDetails.revenue.statTotalPool')} value={fmtMoney(dist.total_pool, 'INR')} color="#ec4899" />
        <StatCard label={t('eventDetails.revenue.statStatus')} value={dist.status} color="#6366f1" />
      </Grid>
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', mb: 3 }}>
        <Table>
          <TableHead>
            <TableRow sx={{ bgcolor: 'action.hover' }}>
              {[t('eventDetails.revenue.table.recipient'), t('eventDetails.revenue.table.type'), t('eventDetails.revenue.table.share'), t('eventDetails.revenue.table.amount'), t('eventDetails.revenue.table.status')].map(h => (
                <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'text.secondary' }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {dist.entries.length === 0 && (
              <TableRow><TableCell colSpan={5}>
                <Typography fontSize={13} color="text.secondary" textAlign="center" py={2}>{t('eventDetails.revenue.emptyMsg')}</Typography>
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
          <Typography fontSize={13} fontWeight={700} sx={{ mb: 1 }}>{t('eventDetails.revenue.addPayoutTitle')}</Typography>
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center" sx={{ mb: 3 }}>
            <TextField select size="small" label={t('eventDetails.revenue.recipientTypeLabel')} value={recipientType}
              onChange={e => setRecipientType(e.target.value)} sx={{ width: 150 }}>
              {RECIPIENT_TYPES.map(rt => <MenuItem key={rt} value={rt} sx={{ textTransform: 'capitalize' }}>{rt}</MenuItem>)}
            </TextField>
            <TextField size="small" label={t('eventDetails.revenue.sharePctLabel')} type="number" value={sharePct} onChange={e => setSharePct(e.target.value)} sx={{ width: 100 }} />
            <TextField size="small" label={t('eventDetails.revenue.amountLabel')} type="number" value={entryAmount} onChange={e => setEntryAmount(e.target.value)} sx={{ width: 130 }} />
            <Button variant="outlined" size="small" disabled={saving || !sharePct || !entryAmount} onClick={addEntry}>
              {t('eventDetails.revenue.addEntryBtn')}
            </Button>
          </Stack>
          <Button variant="contained" size="small" disabled={dist.entries.length === 0} onClick={approve}>
            {t('eventDetails.revenue.approveDistributionBtn')}
          </Button>
        </>
      )}
      {dist.status === 'approved' && (
        <Button variant="contained" size="small" color="success" onClick={markDistributed}>
          {t('eventDetails.revenue.markDistributedBtn')}
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
  const { t } = useTranslation('admin');
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
      setMsg({ type: 'success', text: t('eventDetails.collector.savedMsg') });
      load();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : t('common.saveFailed') });
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
      setMsg({ type: 'success', text: t('eventDetails.collector.connectedMsg', { mailbox: r?.mailbox, count: r?.message_count }) });
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : t('eventDetails.collector.imapTestFailed') });
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
        text: t('eventDetails.collector.reconConnectedMsg', { count: r?.fetched ?? 0 }),
      });
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : t('eventDetails.collector.reconTestFailed') });
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
        text: t('eventDetails.collector.scanCompleteMsg', { matched: r?.matched ?? 0, unmatched: r?.unmatched ?? 0, processed: r?.emails_processed ?? 0 }),
      });
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : t('eventDetails.collector.scanFailed') });
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
          <Typography fontWeight={700} mb={1.5}>{t('eventDetails.collector.receiverUpiTitle')}</Typography>
          <TextField
            label={t('eventDetails.collector.upiLabel')}
            value={upiId}
            onChange={(e) => setUpiId(e.target.value)}
            size="small"
            fullWidth
            placeholder={t('eventDetails.collector.upiPlaceholder')}
            helperText={t('eventDetails.collector.upiHelper')}
          />
          {cfg?.member_name && (
            <Typography variant="caption" color="text.secondary" display="block" mt={1}>
              {t('eventDetails.collector.collectorOnRecord', { name: cfg.member_name })}
            </Typography>
          )}
        </Box>

        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <EmailIcon color="primary" fontSize="small" />
              <Typography fontWeight={700}>{t('eventDetails.collector.emailAccountTitle')}</Typography>
            </Box>
            <Button size="small" onClick={useGmailDefaults}>{t('eventDetails.collector.useGmailBtn')}</Button>
          </Box>
          <Typography variant="caption" color="text.secondary" display="block" mb={2}>
            {t('eventDetails.collector.emailAccountDesc')}
          </Typography>
          <Stack spacing={2}>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label={t('eventDetails.collector.imapHostLabel')} value={imapHost} onChange={(e) => setImapHost(e.target.value)}
                size="small" sx={{ flex: 3 }} placeholder="imap.gmail.com"
              />
              <TextField
                label={t('eventDetails.collector.portLabel')} value={imapPort} onChange={(e) => setImapPort(Number(e.target.value))}
                size="small" type="number" sx={{ flex: 1 }}
              />
            </Box>
            <TextField
              label={t('eventDetails.collector.emailAddressLabel')} value={imapUser} onChange={(e) => setImapUser(e.target.value)}
              size="small" fullWidth placeholder="you@gmail.com"
            />
            <TextField
              label={cfg?.imap_password_set ? t('eventDetails.collector.appPasswordLabelKeep') : t('eventDetails.collector.appPasswordLabel')}
              value={imapPassword} onChange={(e) => setImapPassword(e.target.value)}
              size="small" fullWidth type={showPw ? 'text' : 'password'}
              placeholder={cfg?.imap_password_set ? '••••••••' : t('eventDetails.collector.appPasswordPlaceholder')}
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
              {t('eventDetails.collector.gmailNoteBefore')} <strong>{t('eventDetails.collector.gmailNoteNot')}</strong> {t('eventDetails.collector.gmailNoteMid')} <strong>{t('eventDetails.collector.gmailNoteAppPassword')}</strong> {t('eventDetails.collector.gmailNoteAfter')}{' '}
              <Link href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">
                myaccount.google.com/apppasswords
              </Link>{' '}
              {t('eventDetails.collector.gmailNoteEnd')}
            </Alert>
            <TextField
              label={t('eventDetails.collector.mailboxLabel')} value={imapMailbox} onChange={(e) => setImapMailbox(e.target.value)}
              size="small" sx={{ maxWidth: 260 }} placeholder="INBOX"
            />
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              <Box>
                <Button
                  variant="outlined" size="small" onClick={testImap}
                  disabled={testing || !imapHost || !imapUser}
                  startIcon={testing ? <CircularProgress size={14} /> : <CheckCircleIcon />}
                >
                  {t('eventDetails.collector.testImapBtn')}
                </Button>
                <Typography variant="caption" color="text.secondary" display="block" mt={0.75} maxWidth={260}>
                  {t('eventDetails.collector.testImapDesc')}
                </Typography>
              </Box>
              <Box>
                <Tooltip title={cfg?.reconciliation_channel_configured ? '' : t('eventDetails.collector.testReconTooltip')}>
                  <span>
                    <Button
                      variant="outlined" size="small" color="secondary" onClick={testReconciliation}
                      disabled={testingRecon || !cfg?.reconciliation_channel_configured}
                      startIcon={testingRecon ? <CircularProgress size={14} /> : <SyncIcon />}
                    >
                      {t('eventDetails.collector.testReconBtn')}
                    </Button>
                  </span>
                </Tooltip>
                <Typography variant="caption" color="text.secondary" display="block" mt={0.75} maxWidth={260}>
                  {t('eventDetails.collector.testReconDesc')}
                </Typography>
              </Box>
            </Box>
          </Stack>
        </Box>

        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Button variant="contained" onClick={save} disabled={saving || !upiId.trim()}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
          <Button
            variant="outlined" color="success" onClick={scanNow}
            disabled={scanning || !imapHost || !imapUser}
            startIcon={scanning ? <CircularProgress size={14} color="inherit" /> : <SyncIcon />}
          >
            {scanning ? t('eventDetails.collector.scanning') : t('eventDetails.collector.scanNowBtn')}
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function EventDetails({ token, id: eventId }: { token?: string | null; id?: string }) {
  const { t } = useTranslation('admin');
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
    return <Container maxWidth="md" sx={{ pt: 6 }}><Alert severity="warning">{t('eventDetails.loginRequired')}</Alert></Container>;
  }

  if (!eventId) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('eventDetails.noEventSelected')}
        </Alert>
        <Button startIcon={<ArrowBackIcon />} onClick={() => { window.location.href = '/manage'; }}>
          {t('eventDetails.backToManageEventsBtn')}
        </Button>
      </Box>
    );
  }

  const ss = event ? (STATUS_STYLE[event.status] ? { labelKey: `manageEvents.status.${event.status}`, color: STATUS_STYLE[event.status].color } : { labelKey: '', color: 'default' as const }) : null;

  return (
    <Box component="main">
      <Box sx={{ bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider', px: 3, pt: 3 }}>
        <Container maxWidth="lg">
          <Button size="small" startIcon={<ArrowBackIcon />} sx={{ mb: 1 }}
            onClick={() => { window.location.href = '/manage'; }}>
            {t('eventDetails.manageEventsBtn')}
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
                {ss && <Chip label={ss.labelKey ? t(ss.labelKey) : event.status} color={ss.color} sx={{ fontWeight: 700 }} />}
              </Box>
              <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto">
                <Tab icon={<ConfirmationNumberIcon fontSize="small" />} iconPosition="start" label={t('eventDetails.tabs.purchases')} />
                <Tab icon={<HowToRegIcon fontSize="small" />} iconPosition="start" label={t('eventDetails.tabs.attendance')} />
                <Tab icon={<CardGiftcardIcon fontSize="small" />} iconPosition="start" label={t('eventDetails.tabs.complimentary')} />
                <Tab icon={<ReceiptIcon fontSize="small" />} iconPosition="start" label={t('eventDetails.tabs.financeExpenses')} />
                <Tab icon={<StorefrontIcon fontSize="small" />} iconPosition="start" label={t('eventDetails.tabs.vendors')} />
                <Tab icon={<AccountBalanceIcon fontSize="small" />} iconPosition="start" label={t('eventDetails.tabs.revenue')} />
                <Tab icon={<EmailIcon fontSize="small" />} iconPosition="start" label={t('eventDetails.tabs.collectorEmail')} />
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
