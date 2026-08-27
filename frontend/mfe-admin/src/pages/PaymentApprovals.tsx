import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert, Box, Button, Chip, CircularProgress, Container,
  Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, IconButton, Paper, Stack, Tab, Tabs,
  TextField, Tooltip, Typography,
} from '@mui/material';
import { AdminSidebar } from '../components/AdminSidebar';
import CancelIcon       from '@mui/icons-material/Cancel';
import CheckCircleIcon   from '@mui/icons-material/CheckCircle';
import CloseIcon         from '@mui/icons-material/Close';
import ErrorOutlineIcon  from '@mui/icons-material/ErrorOutline';
import HourglassTopIcon  from '@mui/icons-material/HourglassTop';
import OpenInNewIcon     from '@mui/icons-material/OpenInNew';
import PaymentIcon       from '@mui/icons-material/Payment';
import ThumbDownIcon     from '@mui/icons-material/ThumbDown';
import ThumbUpIcon       from '@mui/icons-material/ThumbUp';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PaymentOut {
  id: string; status: string; payment_method: string | null;
  screenshot_path: string | null; utr_number: string | null;
  review_notes: string | null; created_at: string; reviewed_at: string | null;
}

interface Registration {
  id: string; event_id: string; event_title: string;
  event_start_time: string; event_end_time: string;
  event_venue: string; event_is_free: boolean;
  event_image_color: string | null;
  ticket_count: number; total_amount: number;
  display_currency: string; status: string;
  registered_at: string; payment: PaymentOut | null;
  user_name?: string; user_email?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtAmount(amount: number, t: (k: string) => string) {
  if (amount === 0) return t('paymentApprovals.free');
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

function screenshotUrl(path: string) {
  return `/api/registrations/uploads/${path}`;
}

function statusChip(reg: Registration, t: (k: string) => string) {
  const ps = reg.payment?.status;
  if (reg.status === 'cancelled')  return <Chip label={t('paymentApprovals.status.dropped')} color="default" size="small" icon={<CancelIcon />} />;
  if (ps === 'pending_review')     return <Chip label={t('paymentApprovals.status.pendingReview')} color="warning" size="small" icon={<HourglassTopIcon />} />;
  if (ps === 'approved')           return <Chip label={t('paymentApprovals.status.approved')} color="success" size="small" icon={<CheckCircleIcon />} />;
  if (ps === 'rejected')           return <Chip label={t('paymentApprovals.status.rejected')} color="error" size="small" icon={<ErrorOutlineIcon />} />;
  if (ps === 'pending_screenshot') return <Chip label={t('paymentApprovals.status.noScreenshot')} color="default" size="small" icon={<PaymentIcon />} />;
  return <Chip label={ps ?? '—'} size="small" />;
}

// ── Review dialog ─────────────────────────────────────────────────────────────

function ReviewDialog({
  reg, token, onClose, onDone,
}: {
  reg: Registration;
  token: string;
  onClose: () => void;
  onDone: (updated: Registration) => void;
}) {
  const { t } = useTranslation('admin');
  const [notes, setNotes]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  async function submit(action: 'approve' | 'reject') {
    if (action === 'reject' && !notes.trim()) {
      setError(t('paymentApprovals.dialog.rejectReasonRequired')); return;
    }
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/registrations/registrations/${reg.id}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, notes: notes || null }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.detail ?? `HTTP ${res.status}`);
      }
      onDone(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('paymentApprovals.dialog.actionFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {t('paymentApprovals.dialog.title')}
        <IconButton size="small" onClick={onClose}><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Stack spacing={1.5} mb={2}>
          <Box>
            <Typography variant="caption" color="text.secondary">{t('paymentApprovals.dialog.eventLabel')}</Typography>
            <Typography fontWeight={600}>{reg.event_title}</Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            <Box>
              <Typography variant="caption" color="text.secondary">{t('paymentApprovals.dialog.residentLabel')}</Typography>
              <Typography fontWeight={600}>{reg.user_name ?? '—'}</Typography>
              <Typography variant="caption" color="text.secondary">{reg.user_email ?? ''}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">{t('paymentApprovals.dialog.amountLabel')}</Typography>
              <Typography fontWeight={600}>{fmtAmount(reg.total_amount, t)}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">{t('paymentApprovals.dialog.ticketsLabel')}</Typography>
              <Typography fontWeight={600}>{reg.ticket_count}</Typography>
            </Box>
          </Box>

          {reg.payment?.utr_number && (
            <Box>
              <Typography variant="caption" color="text.secondary">{t('paymentApprovals.dialog.utrRefLabel')}</Typography>
              <Typography fontWeight={600} fontFamily="monospace">{reg.payment.utr_number}</Typography>
            </Box>
          )}

          {reg.payment?.screenshot_path && (
            <Box>
              <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                {t('paymentApprovals.dialog.screenshotLabel')}
                <Tooltip title={t('paymentApprovals.dialog.openInNewTab')}>
                  <IconButton size="small" sx={{ ml: 0.5 }}
                    onClick={() => window.open(screenshotUrl(reg.payment!.screenshot_path!), '_blank')}>
                    <OpenInNewIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Tooltip>
              </Typography>
              <Box
                component="img"
                src={screenshotUrl(reg.payment.screenshot_path)}
                alt={t('paymentApprovals.dialog.screenshotLabel')}
                sx={{ maxWidth: '100%', maxHeight: 280, borderRadius: 1, border: '1px solid', borderColor: 'divider', objectFit: 'contain' }}
              />
            </Box>
          )}
        </Stack>

        <Divider sx={{ mb: 2 }} />

        <TextField
          label={t('paymentApprovals.dialog.notesLabel')}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          fullWidth multiline rows={2}
          placeholder={t('paymentApprovals.dialog.notesPlaceholder')}
        />
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={onClose} disabled={loading}>{t('common.cancel')}</Button>
        <Button
          variant="outlined" color="error" startIcon={<ThumbDownIcon />}
          disabled={loading} onClick={() => submit('reject')}
        >
          {t('paymentApprovals.dialog.rejectBtn')}
        </Button>
        <Button
          variant="contained" color="success" startIcon={<ThumbUpIcon />}
          disabled={loading} onClick={() => submit('approve')}
        >
          {loading ? <CircularProgress size={18} color="inherit" /> : t('paymentApprovals.dialog.approveBtn')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Registration row ──────────────────────────────────────────────────────────

function RegRow({
  reg, onReview,
}: {
  reg: Registration;
  onReview: (r: Registration) => void;
}) {
  const { t } = useTranslation('admin');
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
        <Box sx={{ flex: 1, minWidth: 200 }}>
          <Typography fontWeight={700} sx={{ fontSize: 14 }}>{reg.event_title}</Typography>
          <Typography variant="caption" color="text.secondary">
            {reg.user_name ?? t('paymentApprovals.unknownResident')} · {reg.user_email ?? '—'}
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, mt: 0.5, flexWrap: 'wrap' }}>
            <Typography variant="caption">{t('paymentApprovals.ticketsCount', { count: reg.ticket_count })}</Typography>
            <Typography variant="caption" fontWeight={600}>{fmtAmount(reg.total_amount, t)}</Typography>
            {reg.payment?.utr_number && (
              <Typography variant="caption" fontFamily="monospace">{t('paymentApprovals.utrLabel', { utr: reg.payment.utr_number })}</Typography>
            )}
          </Box>
          <Typography variant="caption" color="text.secondary">
            {t('paymentApprovals.registeredLabel', { date: fmtDate(reg.registered_at) })}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
          {statusChip(reg, t)}
          {reg.status !== 'cancelled' && (reg.payment?.status === 'pending_review' || reg.payment?.status === 'pending_screenshot') && (
            <Button size="small" variant="contained" onClick={() => onReview(reg)}>
              {t('paymentApprovals.reviewBtn')}
            </Button>
          )}
          {reg.payment?.screenshot_path && reg.payment.status !== 'pending_review' && (
            <Button size="small" variant="text" startIcon={<OpenInNewIcon />}
              onClick={() => window.open(screenshotUrl(reg.payment!.screenshot_path!), '_blank')}>
              {t('paymentApprovals.screenshotBtn')}
            </Button>
          )}
        </Box>
      </Box>

      {reg.payment?.review_notes && (
        <Alert severity={reg.payment.status === 'approved' ? 'success' : 'error'} sx={{ mt: 1, py: 0.25, fontSize: 12 }}>
          {reg.payment.review_notes}
        </Alert>
      )}
    </Paper>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PaymentApprovals({ token, role }: { token?: string | null; role?: string }) {
  const { t } = useTranslation('admin');
  const [tab, setTab]             = useState(0);
  const [regs, setRegs]           = useState<Registration[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<Registration | null>(null);

  // Deep link from a notification (?registration_id=...) — land on the right
  // tab and open the review dialog for that specific registration directly.
  const [highlightId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('registration_id'),
  );
  const [handledHighlight, setHandledHighlight] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    fetch('/api/registrations/registrations', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data: Registration[]) => { setRegs(data); setLoading(false); })
      .catch((e: Error) => { setError(e.message); setLoading(false); });
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const live      = regs.filter(r => r.status !== 'cancelled');
  const pending   = live.filter(r => r.payment?.status === 'pending_review');
  const approved  = live.filter(r => r.payment?.status === 'approved' || r.status === 'confirmed');
  const rejected  = live.filter(r => r.payment?.status === 'rejected');
  const noUpload  = live.filter(r => r.payment?.status === 'pending_screenshot');
  const dropped   = regs.filter(r => r.status === 'cancelled');

  const tabs = [
    { label: t('paymentApprovals.tabs.pendingReview', { count: pending.length }),  data: pending },
    { label: t('paymentApprovals.tabs.noUpload', { count: noUpload.length }),       data: noUpload },
    { label: t('paymentApprovals.tabs.approved', { count: approved.length }),        data: approved },
    { label: t('paymentApprovals.tabs.rejected', { count: rejected.length }),        data: rejected },
    { label: t('paymentApprovals.tabs.dropped', { count: dropped.length }),          data: dropped },
  ];

  useEffect(() => {
    if (!highlightId || handledHighlight || regs.length === 0) return;
    const target = regs.find(r => r.id === highlightId);
    if (!target) return;
    const tabIndex = tabs.findIndex(t => t.data.some(r => r.id === highlightId));
    if (tabIndex >= 0) setTab(tabIndex);
    if (target.status !== 'cancelled' &&
        (target.payment?.status === 'pending_review' || target.payment?.status === 'pending_screenshot')) {
      setReviewing(target);
    }
    setHandledHighlight(true);
  }, [highlightId, handledHighlight, regs, tabs]);

  if (!token) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography color="text.secondary">{t('paymentApprovals.notAuthenticated')}</Typography>
      </Box>
    );
  }

  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  return (
    <Box sx={{ display: 'flex' }}>
      <AdminSidebar active="Payment Approvals" mobileOpen={sidebarOpen} onMobileClose={() => setSidebarOpen(false)} role={role} />
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h5" fontWeight={800} mb={0.5}>{t('paymentApprovals.title')}</Typography>
      <Typography variant="body2" color="text.secondary" mb={3}>
        {t('paymentApprovals.subtitle')}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
        {tabs.map((t, i) => <Tab key={i} label={t.label} />)}
      </Tabs>

      {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>}

      {!loading && (
        <Stack spacing={1.5}>
          {tabs[tab].data.length === 0 && (
            <Typography color="text.secondary" textAlign="center" py={4}>
              {t('paymentApprovals.noRegistrations')}
            </Typography>
          )}
          {tabs[tab].data.map(r => (
            <RegRow key={r.id} reg={r} onReview={setReviewing} />
          ))}
        </Stack>
      )}

      {reviewing && (
        <ReviewDialog
          reg={reviewing}
          token={token}
          onClose={() => setReviewing(null)}
          onDone={updated => {
            setRegs(prev => prev.map(r => r.id === updated.id ? updated : r));
            setReviewing(null);
          }}
        />
      )}
    </Container>
    </Box>
  );
}
