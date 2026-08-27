import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './i18n';
import {
  Alert, Box, Button, Chip, CircularProgress, Container,
  Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, Paper, Stack, TextField, Typography,
} from '@mui/material';
import CalendarTodayIcon      from '@mui/icons-material/CalendarToday';
import CheckCircleIcon        from '@mui/icons-material/CheckCircle';
import CloudUploadIcon        from '@mui/icons-material/CloudUpload';
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber';
import DeleteOutlineIcon      from '@mui/icons-material/DeleteOutline';
import ErrorOutlineIcon       from '@mui/icons-material/ErrorOutline';
import HourglassTopIcon       from '@mui/icons-material/HourglassTop';
import LocationOnIcon         from '@mui/icons-material/LocationOn';
import PaymentIcon            from '@mui/icons-material/Payment';
import QrCode2Icon            from '@mui/icons-material/QrCode2';

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
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtAmount(amount: number, t: (key: string) => string) {
  if (amount === 0) return t('amount.free');
  return `₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`;
}

function statusInfo(reg: Registration, t: (key: string) => string): { label: string; color: 'success' | 'warning' | 'info' | 'error' | 'default'; icon: React.ReactNode } {
  const ps = reg.payment?.status;
  if (reg.status === 'confirmed')     return { label: t('status.confirmed'),        color: 'success', icon: <CheckCircleIcon /> };
  if (reg.status === 'attended')      return { label: t('status.attended'),         color: 'success', icon: <CheckCircleIcon /> };
  if (reg.status === 'cancelled')     return { label: t('status.cancelled'),        color: 'error',   icon: <ErrorOutlineIcon /> };
  if (ps === 'pending_screenshot')    return { label: t('status.paymentPending'),   color: 'warning', icon: <PaymentIcon /> };
  if (ps === 'pending_review')        return { label: t('status.underReview'),      color: 'info',    icon: <HourglassTopIcon /> };
  if (ps === 'rejected')              return { label: t('status.paymentRejected'),  color: 'error',   icon: <ErrorOutlineIcon /> };
  return { label: reg.status, color: 'default', icon: <ConfirmationNumberIcon /> };
}

// ── Registration card ─────────────────────────────────────────────────────────

function RegCard({ reg, token, onCancelled }: { reg: Registration; token: string; onCancelled: (message: string) => void }) {
  const { t } = useTranslation('booking');
  const { label, color, icon } = statusInfo(reg, t);
  const colorBar = reg.event_image_color ?? '#6366f1';
  const isConfirmed = reg.status === 'confirmed' || reg.status === 'attended';
  const [cancelling, setCancelling]   = useState(false);
  const [cancelOpen, setCancelOpen]   = useState(false);
  const [refundUpi, setRefundUpi]     = useState('');

  async function handleCancel() {
    setCancelling(true);
    try {
      const res = await fetch(`/api/registrations/registrations/${reg.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refund_upi_id: refundUpi.trim() || null }),
      });
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
      // 204 (no body, e.g. an unpaid registration) has nothing to parse for refund_requested.
      const body: { refund_requested?: boolean } = res.status === 204 ? {} : await res.json();
      setCancelOpen(false);
      onCancelled(body.refund_requested
        ? t('notices.droppedWithRefund')
        : t('notices.dropped'));
    } catch {
      setCancelling(false);
    }
  }

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      <Box sx={{ height: 4, bgcolor: colorBar }} />
      <Box sx={{ p: 2.5 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1.5 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography fontWeight={700} sx={{ fontSize: 15, mb: 0.5 }} noWrap>{reg.event_title}</Typography>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ color: 'text.secondary', fontSize: 13, mb: 0.25 }}>
              <CalendarTodayIcon sx={{ fontSize: 14 }} />
              <Typography variant="caption">{fmtDate(reg.event_start_time)}</Typography>
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ color: 'text.secondary', fontSize: 13 }}>
              <LocationOnIcon sx={{ fontSize: 14 }} />
              <Typography variant="caption" noWrap>{reg.event_venue}</Typography>
            </Stack>
          </Box>
          <Chip label={label} color={color} size="small" icon={icon as React.ReactElement} />
        </Box>

        <Divider sx={{ my: 1.5 }} />

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t('card.ticketCount', { count: reg.ticket_count })} · {fmtAmount(reg.total_amount, t)}
          </Typography>

          <Stack direction="row" spacing={1}>
            {isConfirmed && (
              <Button size="small" variant="outlined" startIcon={<QrCode2Icon />}
                onClick={() => { window.location.href = '/tickets'; }}>
                {t('card.viewTicket')}
              </Button>
            )}
            {reg.payment?.status === 'pending_screenshot' && (
              <Button size="small" variant="contained" startIcon={<CloudUploadIcon />}
                onClick={() => { window.location.href = `/checkout?registration_id=${reg.id}`; }}>
                {t('card.uploadPayment')}
              </Button>
            )}
            {reg.payment?.status === 'rejected' && (
              <Button size="small" variant="outlined" color="error" startIcon={<CloudUploadIcon />}
                onClick={() => { window.location.href = `/checkout?registration_id=${reg.id}`; }}>
                {t('card.reupload')}
              </Button>
            )}
            {!isConfirmed && (
              <Button size="small" variant="outlined" color="error"
                startIcon={<DeleteOutlineIcon />}
                onClick={() => setCancelOpen(true)}>
                {t('card.drop')}
              </Button>
            )}
          </Stack>
        </Box>

        {reg.payment?.status === 'rejected' && reg.payment.review_notes && (
          <Alert severity="error" sx={{ mt: 1.5, py: 0.5, fontSize: 12 }}>
            {t('card.rejectedPrefix', { notes: reg.payment.review_notes })}
          </Alert>
        )}
      </Box>

      <Dialog open={cancelOpen} onClose={() => !cancelling && setCancelOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('dialog.title')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: reg.total_amount > 0 ? 2 : 0 }}>
            {t('dialog.confirmText', { title: reg.event_title })}
            {reg.total_amount > 0 && ` ${t('dialog.refundNote')}`}
          </Typography>
          {reg.total_amount > 0 && (
            <TextField
              label={t('dialog.upiLabel')}
              placeholder={t('dialog.upiPlaceholder')}
              value={refundUpi} onChange={e => setRefundUpi(e.target.value)}
              fullWidth size="small" disabled={cancelling}
              helperText={t('dialog.upiHelper')}
            />
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setCancelOpen(false)} disabled={cancelling}>{t('dialog.keep')}</Button>
          <Button variant="contained" color="error" disabled={cancelling} onClick={handleCancel}>
            {cancelling ? <CircularProgress size={18} color="inherit" /> : t('dialog.dropIt')}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface BookingAppProps {
  token?: string | null;
}

export function BookingApp({ token }: BookingAppProps) {
  const { t } = useTranslation('booking');
  const [regs, setRegs]       = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [notice, setNotice]   = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    fetch('/api/registrations/registrations/my', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data: Registration[]) => { setRegs(data); setLoading(false); })
      .catch((e: Error) => { setError(e.message); setLoading(false); });
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (!token) {
    return (
      <Container maxWidth="sm" sx={{ pt: 8, textAlign: 'center' }}>
        <Typography variant="h6" color="text.secondary" mb={2}>{t('login.prompt')}</Typography>
        <Button variant="contained" onClick={() => { window.location.href = '/'; }}>{t('login.cta')}</Button>
      </Container>
    );
  }

  const live      = regs.filter(r => r.status !== 'cancelled');
  const confirmed = live.filter(r => r.status === 'confirmed' || r.status === 'attended');
  // The legacy `payment` row's status and the registration's own status are set by two
  // independent systems (CLAUDE.md: legacy manual-payment flow vs. centralized
  // reconciliation flow) — a registration confirmed via reconciliation never touches the
  // legacy payment row, so payment?.status can be stuck at 'pending_screenshot' even
  // though the registration itself is already confirmed. Exclude anything already
  // confirmed/attended from these buckets so it doesn't show up in both places at once.
  const unconfirmed = live.filter(r => r.status !== 'confirmed' && r.status !== 'attended');
  const pending   = unconfirmed.filter(r => r.payment?.status === 'pending_screenshot');
  const reviewing = unconfirmed.filter(r => r.payment?.status === 'pending_review');
  const rejected  = unconfirmed.filter(r => r.payment?.status === 'rejected');

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
        <Box>
          <Typography variant="h5" fontWeight={800}>{t('page.title')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('page.subtitle')}
          </Typography>
        </Box>
        <Button size="small" variant="outlined" startIcon={<QrCode2Icon />}
          onClick={() => { window.location.href = '/tickets'; }}>
          {t('page.myTickets')}
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}
      {loading && <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}><CircularProgress /></Box>}

      {!loading && regs.length === 0 && (
        <Box textAlign="center" py={8}>
          <ConfirmationNumberIcon sx={{ fontSize: 56, color: 'text.disabled', mb: 2 }} />
          <Typography variant="h6" color="text.secondary">{t('empty.title')}</Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            {t('empty.subtitle')}
          </Typography>
          <Button variant="contained" onClick={() => { window.location.href = '/events'; }}>
            {t('empty.cta')}
          </Button>
        </Box>
      )}

      {!loading && regs.length > 0 && (
        <Stack spacing={3}>
          {pending.length > 0 && (
            <Box>
              <Typography variant="subtitle2" color="warning.main" fontWeight={700} mb={1.5}>
                {t('sections.pending', { count: pending.length })}
              </Typography>
              <Stack spacing={1.5}>{pending.map(r => <RegCard key={r.id} reg={r} token={token!} onCancelled={message => { setNotice(message); load(); }} />)}</Stack>
            </Box>
          )}
          {reviewing.length > 0 && (
            <Box>
              <Typography variant="subtitle2" color="info.main" fontWeight={700} mb={1.5}>
                {t('sections.reviewing', { count: reviewing.length })}
              </Typography>
              <Stack spacing={1.5}>{reviewing.map(r => <RegCard key={r.id} reg={r} token={token!} onCancelled={message => { setNotice(message); load(); }} />)}</Stack>
            </Box>
          )}
          {rejected.length > 0 && (
            <Box>
              <Typography variant="subtitle2" color="error.main" fontWeight={700} mb={1.5}>
                {t('sections.rejected', { count: rejected.length })}
              </Typography>
              <Stack spacing={1.5}>{rejected.map(r => <RegCard key={r.id} reg={r} token={token!} onCancelled={message => { setNotice(message); load(); }} />)}</Stack>
            </Box>
          )}
          {confirmed.length > 0 && (
            <Box>
              <Typography variant="subtitle2" color="success.main" fontWeight={700} mb={1.5}>
                {t('sections.confirmed', { count: confirmed.length })}
              </Typography>
              <Stack spacing={1.5}>{confirmed.map(r => <RegCard key={r.id} reg={r} token={token!} onCancelled={message => { setNotice(message); load(); }} />)}</Stack>
            </Box>
          )}
        </Stack>
      )}
    </Container>
  );
}

export default BookingApp;
