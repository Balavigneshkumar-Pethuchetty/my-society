import React, { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Alert, Box, Button, Chip, CircularProgress, Container,
  Dialog, DialogActions, DialogContent, DialogTitle, Divider,
  IconButton, Paper, Stack, TextField, Typography,
} from '@mui/material';
import AccountBalanceIcon     from '@mui/icons-material/AccountBalance';
import CalendarTodayIcon      from '@mui/icons-material/CalendarToday';
import CheckCircleIcon        from '@mui/icons-material/CheckCircle';
import CloseIcon              from '@mui/icons-material/Close';
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber';
import EventBusyIcon          from '@mui/icons-material/EventBusy';
import HourglassTopIcon       from '@mui/icons-material/HourglassTop';
import LocationOnIcon         from '@mui/icons-material/LocationOn';
import QrCode2Icon            from '@mui/icons-material/QrCode2';
import TaskAltIcon            from '@mui/icons-material/TaskAlt';
import './i18n';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TicketTypeLine {
  ticket_type_name: string;
  quantity: number;
  unit_price: number;
}

interface Ticket {
  id: string;
  reg_id: string;
  event_id: string;
  event_title: string;
  event_start_time: string;
  event_end_time: string;
  event_venue: string;
  event_image_color: string | null;
  cancel_freeze_at: string | null;
  ticket_count: number;
  total_amount: number;
  display_currency: string;
  status: string;       // active | used | cancelled
  qr_token: string | null;
  issued_at: string;
  scanned_at: string | null;
  ticket_items: TicketTypeLine[];
  paid_at: string | null;
  refund_status: string | null;   // refund_requested | refunded | ... | null
  refunded_at: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtAmount(amount: number, t: TFunction) {
  if (amount === 0) return t('common.free');
  return `₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`;
}

// Falls back to the plain "N ticket(s)" count for registrations made before per-type
// breakdown was tracked, or for legacy flat-price events with no real ticket types.
function ticketBreakdownText(ticket: Ticket, t: TFunction): string {
  if (ticket.ticket_items.length === 0) {
    return t('ticketCount', { count: ticket.ticket_count });
  }
  return ticket.ticket_items.map(i => `${i.quantity}× ${i.ticket_type_name}`).join(', ');
}

function statusChip(ticket: Ticket, t: TFunction) {
  if (ticket.status === 'used')
    return <Chip label={t('status.attended')} color="success" size="small" icon={<TaskAltIcon />} />;
  if (ticket.status === 'cancelled') {
    if (ticket.refund_status === 'refunded')
      return <Chip label={t('status.refunded')} color="success" size="small" icon={<AccountBalanceIcon />} />;
    if (ticket.refund_status === 'refund_requested')
      return <Chip label={t('status.refundPending')} color="warning" size="small" icon={<HourglassTopIcon />} />;
    return <Chip label={t('status.cancelled')} color="error" size="small" />;
  }

  const now = new Date();
  const start = new Date(ticket.event_start_time);
  const end   = new Date(ticket.event_end_time);
  if (now > end)
    return <Chip label={t('status.eventEnded')} color="default" size="small" />;
  if (now >= start)
    return <Chip label={t('status.inProgress')} color="warning" size="small" />;
  return <Chip label={t('status.confirmed')} color="success" size="small" icon={<CheckCircleIcon />} />;
}

// ── QR Dialog ─────────────────────────────────────────────────────────────────

function QrDialog({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const { t } = useTranslation('tickets');
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box>
          <Typography fontWeight={700} fontSize={16}>{ticket.event_title}</Typography>
          <Typography variant="caption" color="text.secondary">{fmtDate(ticket.event_start_time)}</Typography>
        </Box>
        <IconButton size="small" onClick={onClose} sx={{ mt: -0.5 }} aria-label={t('qrDialog.close')}><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent sx={{ textAlign: 'center', pb: 3 }}>
        {ticket.status === 'used' ? (
          <Box sx={{ py: 2 }}>
            <TaskAltIcon sx={{ fontSize: 72, color: 'success.main' }} />
            <Typography variant="h6" fontWeight={700} color="success.main" mt={1}>{t('qrDialog.ticketUsed')}</Typography>
            <Typography variant="body2" color="text.secondary" mt={0.5}>
              {t('qrDialog.scannedOn', { date: ticket.scanned_at ? fmtDate(ticket.scanned_at) : '—' })}
            </Typography>
          </Box>
        ) : (
          <>
            <Typography variant="caption" color="text.secondary" display="block" mb={2}>
              {t('qrDialog.showQrHint')}
            </Typography>
            {ticket.qr_token ? (
              <Box sx={{ display: 'inline-block', p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <QRCodeSVG value={ticket.qr_token} size={200} level="M" includeMargin={false} />
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary">{t('qrDialog.qrUnavailable')}</Typography>
            )}
          </>
        )}
        <Divider sx={{ my: 2 }} />
        {ticket.ticket_items.length > 0 && (
          <Stack spacing={0.5} sx={{ mb: 2, textAlign: 'left' }}>
            {ticket.ticket_items.map((item, i) => (
              <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2">{item.quantity}× {item.ticket_type_name}</Typography>
                <Typography variant="body2" fontWeight={600}>{fmtAmount(item.quantity * item.unit_price, t)}</Typography>
              </Box>
            ))}
          </Stack>
        )}
        <Stack direction="row" justifyContent="center" spacing={3}>
          <Box textAlign="center">
            <Typography variant="caption" color="text.secondary">{t('qrDialog.ticketsLabel')}</Typography>
            <Typography fontWeight={700}>{ticket.ticket_count}</Typography>
          </Box>
          <Box textAlign="center">
            <Typography variant="caption" color="text.secondary">{t('qrDialog.paidLabel')}</Typography>
            <Typography fontWeight={700}>{fmtAmount(ticket.total_amount, t)}</Typography>
          </Box>
          <Box textAlign="center">
            <Typography variant="caption" color="text.secondary">{t('qrDialog.ticketIdLabel')}</Typography>
            <Typography fontWeight={700} sx={{ fontFamily: 'monospace', fontSize: 11 }}>
              {ticket.id.slice(0, 8).toUpperCase()}
            </Typography>
          </Box>
        </Stack>
        {ticket.paid_at && (
          <Typography variant="caption" color="text.secondary" display="block" textAlign="center" mt={1.5}>
            {t('qrDialog.paidReconciledOn', { date: fmtDate(ticket.paid_at) })}
          </Typography>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Ticket card ───────────────────────────────────────────────────────────────

function TicketCard({
  ticket, token, onCancelled,
}: {
  ticket: Ticket;
  token: string;
  onCancelled: (message: string) => void;
}) {
  const { t } = useTranslation('tickets');
  const [qrOpen, setQrOpen]         = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [refundUpi, setRefundUpi]   = useState('');
  const color = ticket.event_image_color ?? '#6366f1';

  const canCancel = ticket.status === 'active'
    && new Date(ticket.event_start_time) > new Date()
    && (ticket.cancel_freeze_at === null || new Date(ticket.cancel_freeze_at) > new Date());

  async function handleCancel() {
    setCancelling(true);
    try {
      const res = await fetch(`/api/registrations/registrations/${ticket.reg_id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refund_upi_id: refundUpi.trim() || null }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body: { refund_requested: boolean } = await res.json();
      setCancelOpen(false);
      onCancelled(body.refund_requested
        ? t('notices.cancelledWithRefund')
        : t('notices.cancelledPlain'));
    } catch {
      setCancelling(false);
    }
  }

  return (
    <>
      <Paper
        variant="outlined"
        sx={{ borderRadius: 2, overflow: 'hidden', opacity: ticket.status === 'cancelled' ? 0.55 : 1 }}
      >
        <Box sx={{ height: 4, bgcolor: color }} />
        <Box sx={{ p: 2.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1.5 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography fontWeight={700} fontSize={15} mb={0.5} noWrap>{ticket.event_title}</Typography>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ color: 'text.secondary', mb: 0.25 }}>
                <CalendarTodayIcon sx={{ fontSize: 13 }} />
                <Typography variant="caption">{fmtDate(ticket.event_start_time)}</Typography>
              </Stack>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ color: 'text.secondary' }}>
                <LocationOnIcon sx={{ fontSize: 13 }} />
                <Typography variant="caption" noWrap>{ticket.event_venue}</Typography>
              </Stack>
            </Box>
            {statusChip(ticket, t)}
          </Box>

          <Divider sx={{ my: 1.5 }} />

          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <Box>
              {ticket.ticket_items.length > 1 ? (
                <Stack spacing={0.25} mb={0.25}>
                  {ticket.ticket_items.map((item, i) => (
                    <Typography key={i} variant="body2" color="text.secondary">
                      {item.quantity}× {item.ticket_type_name} ({fmtAmount(item.quantity * item.unit_price, t)})
                    </Typography>
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {ticketBreakdownText(ticket, t)} · {fmtAmount(ticket.total_amount, t)}
                </Typography>
              )}
              {ticket.paid_at && (
                <Typography variant="caption" color="text.secondary" display="block">
                  {t('card.paidOn', { date: fmtDate(ticket.paid_at) })}
                </Typography>
              )}
              {ticket.status === 'cancelled' && ticket.total_amount > 0 && (
                <Typography variant="caption" display="block"
                  color={ticket.refund_status === 'refunded' ? 'success.main' : 'warning.main'}>
                  {ticket.refund_status === 'refunded'
                    ? (ticket.refunded_at
                        ? t('card.refundedOn', { date: fmtDate(ticket.refunded_at) })
                        : t('card.refunded'))
                    : ticket.refund_status === 'refund_requested'
                      ? t('card.refundPendingReview')
                      : t('card.cancelledNoRefund')}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary" display="block" sx={{ fontFamily: 'monospace' }}>
                {t('card.ticketIdPrefix', { id: ticket.id.slice(0, 8).toUpperCase() })}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              {canCancel && (
                <Button
                  size="small" variant="outlined" color="error"
                  startIcon={<EventBusyIcon />}
                  onClick={() => setCancelOpen(true)}
                >
                  {ticket.total_amount > 0 ? t('card.cancelRefundButton') : t('card.cancelButton')}
                </Button>
              )}
              {ticket.status !== 'cancelled' && (
                <Button
                  size="small"
                  variant={ticket.status === 'used' ? 'outlined' : 'contained'}
                  startIcon={ticket.status === 'used' ? <TaskAltIcon /> : <QrCode2Icon />}
                  color={ticket.status === 'used' ? 'success' : 'primary'}
                  onClick={() => setQrOpen(true)}
                >
                  {ticket.status === 'used' ? t('card.viewEntry') : t('card.showTicket')}
                </Button>
              )}
            </Stack>
          </Box>
        </Box>
      </Paper>

      {qrOpen && <QrDialog ticket={ticket} onClose={() => setQrOpen(false)} />}

      <Dialog open={cancelOpen} onClose={() => !cancelling && setCancelOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('cancelDialog.title')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: ticket.total_amount > 0 ? 2 : 0 }}>
            {t('cancelDialog.confirmText', { title: ticket.event_title })}
            {ticket.total_amount > 0 && ` ${t('cancelDialog.refundNotice')}`}
          </Typography>
          {ticket.total_amount > 0 && (
            <TextField
              label={t('cancelDialog.upiLabel')}
              placeholder={t('cancelDialog.upiPlaceholder')}
              value={refundUpi} onChange={e => setRefundUpi(e.target.value)}
              fullWidth size="small" disabled={cancelling}
              helperText={t('cancelDialog.upiHelper')}
            />
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setCancelOpen(false)} disabled={cancelling}>{t('cancelDialog.keepTicket')}</Button>
          <Button variant="contained" color="error" disabled={cancelling} onClick={handleCancel}>
            {cancelling
              ? <CircularProgress size={18} color="inherit" />
              : ticket.total_amount > 0 ? t('cancelDialog.confirmCancelRefund') : t('cancelDialog.confirmCancel')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface TicketsAppProps {
  token?: string | null;
}

export function TicketsApp({ token }: TicketsAppProps) {
  const { t } = useTranslation('tickets');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [notice,  setNotice]  = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    fetch('/api/tickets/tickets/my', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data: Ticket[]) => { setTickets(data); setLoading(false); })
      .catch((e: Error) => { setError(e.message); setLoading(false); });
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (!token) {
    return (
      <Container maxWidth="sm" sx={{ pt: 8, textAlign: 'center' }}>
        <Typography variant="h6" color="text.secondary" mb={2}>{t('page.loginPrompt')}</Typography>
        <Button variant="contained" onClick={() => { window.location.href = '/'; }}>{t('page.goToLogin')}</Button>
      </Container>
    );
  }

  const active    = tickets.filter(tk => tk.status === 'active');
  const used      = tickets.filter(tk => tk.status === 'used');
  const cancelled = tickets.filter(tk => tk.status === 'cancelled');

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
        <Box>
          <Typography variant="h5" fontWeight={800}>{t('page.title')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('page.subtitle')}
          </Typography>
        </Box>
        <Button size="small" variant="outlined" onClick={() => { window.location.href = '/registrations'; }}>
          {t('page.viewAllRegistrations')}
        </Button>
      </Box>

      {error  && <Alert severity="error"   sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {!loading && tickets.length === 0 && (
        <Box textAlign="center" py={8}>
          <ConfirmationNumberIcon sx={{ fontSize: 56, color: 'text.disabled', mb: 2 }} />
          <Typography variant="h6" color="text.secondary">{t('page.emptyTitle')}</Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            {t('page.emptyDesc')}
          </Typography>
          <Button variant="contained" onClick={() => { window.location.href = '/events'; }}>
            {t('page.browseEvents')}
          </Button>
        </Box>
      )}

      {!loading && tickets.length > 0 && (
        <Stack spacing={3}>
          {active.length > 0 && (
            <Box>
              <Typography variant="subtitle2" color="success.main" fontWeight={700} mb={1.5}>
                {t('page.activeTickets', { count: active.length })}
              </Typography>
              <Stack spacing={1.5}>
                {active.map(tk => (
                  <TicketCard
                    key={tk.id} ticket={tk} token={token!}
                    onCancelled={message => { setNotice(message); load(); }}
                  />
                ))}
              </Stack>
            </Box>
          )}

          {used.length > 0 && (
            <Box>
              <Typography variant="subtitle2" color="text.secondary" fontWeight={700} mb={1.5}>
                {t('page.pastEvents', { count: used.length })}
              </Typography>
              <Stack spacing={1.5}>
                {used.map(tk => (
                  <TicketCard
                    key={tk.id} ticket={tk} token={token!}
                    onCancelled={message => { setNotice(message); load(); }}
                  />
                ))}
              </Stack>
            </Box>
          )}

          {cancelled.length > 0 && (
            <Box>
              <Typography variant="subtitle2" color="text.secondary" fontWeight={700} mb={1.5}>
                {t('page.cancelledSection', { count: cancelled.length })}
              </Typography>
              <Stack spacing={1.5}>
                {cancelled.map(tk => (
                  <TicketCard
                    key={tk.id} ticket={tk} token={token!}
                    onCancelled={message => { setNotice(message); load(); }}
                  />
                ))}
              </Stack>
            </Box>
          )}
        </Stack>
      )}
    </Container>
  );
}

export default TicketsApp;
