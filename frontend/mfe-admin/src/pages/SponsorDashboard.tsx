import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Container,
  Dialog, DialogActions, DialogContent, DialogTitle,
  Grid, InputAdornment, Paper, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import MonetizationOnIcon from '@mui/icons-material/MonetizationOn';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import UndoIcon from '@mui/icons-material/Undo';

// ── API helpers ───────────────────────────────────────────────────────────────

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

interface Sponsor { id: string; organization_name: string; total_pledged: number | string; event_count: number }

interface Sponsorship {
  id: string; event_id: string; event_title: string; event_start_time: string;
  amount: number | string; currency_code: string;
  status: 'pledged' | 'received' | 'refund_requested' | 'refunded';
  notes: string | null;
}

interface RefundRequest {
  id: string; sponsorship_id: string; event_title: string; amount: number | string;
  reason: string | null; created_at: string;
  status: 'pending' | 'approved' | 'rejected' | 'processed';
}

const STATUS_MAP = {
  received:         { label: 'Received',        color: 'success' as const },
  pledged:          { label: 'Pledged',          color: 'warning' as const },
  refund_requested: { label: 'Refund Requested', color: 'error'   as const },
  refunded:         { label: 'Refunded',         color: 'default' as const },
  pending:          { label: 'Pending Review',   color: 'warning' as const },
  approved:         { label: 'Approved',         color: 'success' as const },
  rejected:         { label: 'Rejected',         color: 'error'   as const },
  processed:        { label: 'Processed',        color: 'default' as const },
};

interface Props { firstName?: string; token?: string | null }

export function SponsorDashboard({ firstName = 'Sponsor', token = null }: Props) {
  const [sponsor,       setSponsor]       = useState<Sponsor | null>(null);
  const [sponsorships,  setSponsorships]  = useState<Sponsorship[]>([]);
  const [refunds,       setRefunds]       = useState<RefundRequest[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);

  const [refundOpen, setRefundOpen] = useState(false);
  const [refundTarget, setRefundTarget] = useState<Sponsorship | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    if (!token) { setLoading(false); return; }
    setLoading(true); setError(null);
    apiFetch<Sponsor>('payments', '/sponsors/me', token)
      .then(s => {
        setSponsor(s);
        return Promise.all([
          apiFetch<Sponsorship[]>('payments', `/sponsors/${s.id}/sponsorships`, token),
          apiFetch<RefundRequest[]>('payments', '/sponsors/refunds', token),
        ]);
      })
      .then(([sp, myRefunds]) => {
        setSponsorships(sp);
        setRefunds(myRefunds);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const received = sponsorships.filter(s => s.status === 'received');
  const pledged  = sponsorships.filter(s => s.status === 'pledged');
  const pendingRefunds = refunds.filter(r => r.status === 'pending');

  const stats = [
    { label: 'Total Sponsored',   value: `₹${Number(sponsor?.total_pledged ?? 0).toLocaleString()}`, sub: `${sponsor?.event_count ?? 0} events`, icon: <MonetizationOnIcon />,     color: '#7c3aed' },
    { label: 'Received',          value: `₹${received.reduce((a, s) => a + Number(s.amount), 0).toLocaleString()}`, sub: `${received.length} confirmed`, icon: <CheckCircleOutlineIcon />, color: '#10b981' },
    { label: 'Pledged',           value: `₹${pledged.reduce((a, s) => a + Number(s.amount), 0).toLocaleString()}`, sub: `${pledged.length} pending receipt`, icon: <HourglassEmptyIcon />,    color: '#f59e0b' },
    { label: 'Refund Requests',   value: String(refunds.length), sub: `${pendingRefunds.length} under review`, icon: <UndoIcon />, color: '#ef4444' },
  ];

  const handleSubmit = async () => {
    if (!token || !refundTarget) return;
    setSaving(true);
    try {
      await apiMutate('payments', `/sponsors/sponsorships/${refundTarget.id}/refunds`, token, 'POST', {
        amount: Number(refundAmount), reason: refundReason,
      });
      setSubmitted(true);
      setRefundOpen(false);
      setRefundAmount('');
      setRefundReason('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit refund request');
    } finally {
      setSaving(false);
    }
  };

  if (!token) {
    return <Container maxWidth="md" sx={{ pt: 6 }}><Alert severity="warning">You must be logged in.</Alert></Container>;
  }

  return (
    <Box component="main">
      <Box sx={{ background: 'linear-gradient(135deg,#1e293b 0%,#3b0764 100%)', color: '#fff', py: { xs: 5, md: 7 }, px: 3 }}>
        <Container maxWidth="lg">
          <Typography fontSize={13} sx={{ color: '#c4b5fd', fontWeight: 600, mb: 1, letterSpacing: 0.4 }}>
            Sponsor Portal
          </Typography>
          <Typography variant="h4" fontWeight={800} sx={{ mb: 0.75, fontSize: { xs: 24, md: 32 } }}>
            Welcome, {firstName} 👋
          </Typography>
          <Typography sx={{ color: '#ddd6fe', fontSize: 15 }}>{sponsor?.organization_name ?? ''}</Typography>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: 5 }}>
        {submitted && (
          <Alert severity="success" sx={{ mb: 3, borderRadius: 2 }} onClose={() => setSubmitted(false)}>
            Refund request submitted successfully. The organizer will review it shortly.
          </Alert>
        )}
        {error && <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }} onClose={() => setError(null)}>{error}</Alert>}
        {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>}

        {!loading && (
        <>
        <Grid container spacing={2.5} sx={{ mb: 5 }}>
          {stats.map((s) => (
            <Grid item xs={12} sm={6} md={3} key={s.label}>
              <Card variant="outlined" sx={{ borderRadius: 2, transition: 'box-shadow .2s', '&:hover': { boxShadow: 3 } }}>
                <CardContent sx={{ p: 2.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                    <Box sx={{ width: 40, height: 40, borderRadius: 1.5, bgcolor: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                      {s.icon}
                    </Box>
                    <Typography fontSize={11} fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {s.label}
                    </Typography>
                  </Box>
                  <Typography fontSize={28} fontWeight={800} lineHeight={1} sx={{ color: s.color }}>{s.value}</Typography>
                  <Typography fontSize={12} color="text.secondary" sx={{ mt: 0.5 }}>{s.sub}</Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>Sponsored Events</Typography>
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', mb: 5 }}>
          <Table>
            <TableHead>
              <TableRow sx={{ bgcolor: 'action.hover' }}>
                {['Event', 'Date', 'Amount', 'Purpose', 'Status', ''].map((h) => (
                  <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'text.secondary', letterSpacing: 0.4 }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {sponsorships.length === 0 && (
                <TableRow><TableCell colSpan={6}>
                  <Typography fontSize={13} color="text.secondary" textAlign="center" py={2}>No sponsorships yet.</Typography>
                </TableCell></TableRow>
              )}
              {sponsorships.map((s) => (
                <TableRow key={s.id} hover>
                  <TableCell>
                    <Typography fontWeight={700} fontSize={14}>{s.event_title}</Typography>
                  </TableCell>
                  <TableCell><Typography fontSize={13}>{new Date(s.event_start_time).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Typography></TableCell>
                  <TableCell><Typography fontWeight={700}>₹{Number(s.amount).toLocaleString()}</Typography></TableCell>
                  <TableCell><Typography fontSize={12} color="text.secondary">{s.notes ?? '—'}</Typography></TableCell>
                  <TableCell>
                    <Chip label={STATUS_MAP[s.status].label} color={STATUS_MAP[s.status].color} size="small" sx={{ fontWeight: 700 }} />
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1}>
                      {(s.status === 'pledged' || s.status === 'received') && (
                        <Button size="small" variant="contained" color="error" onClick={() => {
                          setRefundTarget(s); setRefundAmount(String(s.amount)); setRefundReason(''); setRefundOpen(true);
                        }}>
                          Request Refund
                        </Button>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>

        <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>My Refund Requests</Typography>
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Table>
            <TableHead>
              <TableRow sx={{ bgcolor: 'action.hover' }}>
                {['Event', 'Refund Amount', 'Reason', 'Requested On', 'Status'].map((h) => (
                  <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'text.secondary', letterSpacing: 0.4 }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {refunds.length === 0 && (
                <TableRow><TableCell colSpan={5}>
                  <Typography fontSize={13} color="text.secondary" textAlign="center" py={2}>No refund requests yet.</Typography>
                </TableCell></TableRow>
              )}
              {refunds.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell><Typography fontWeight={700} fontSize={14}>{r.event_title}</Typography></TableCell>
                  <TableCell><Typography fontWeight={700} color="error.main">₹{Number(r.amount).toLocaleString()}</Typography></TableCell>
                  <TableCell sx={{ maxWidth: 280 }}><Typography fontSize={12} color="text.secondary">{r.reason}</Typography></TableCell>
                  <TableCell><Typography fontSize={13}>{new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Typography></TableCell>
                  <TableCell>
                    <Chip label={STATUS_MAP[r.status].label} color={STATUS_MAP[r.status].color} size="small" sx={{ fontWeight: 700 }} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
        </>
        )}
      </Container>

      <Dialog open={refundOpen} onClose={() => setRefundOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle fontWeight={700}>Request Sponsorship Refund</DialogTitle>
        <DialogContent dividers>
          {refundTarget && (
            <Typography fontSize={14} color="text.secondary" sx={{ mb: 2.5 }}>
              {refundTarget.event_title} · ₹{Number(refundTarget.amount).toLocaleString()} {refundTarget.status}
            </Typography>
          )}
          <Stack spacing={2.5}>
            <TextField
              label="Refund Amount (₹)"
              type="number"
              fullWidth
              size="small"
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
              InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }}
            />
            <TextField
              label="Reason for Refund"
              multiline
              rows={3}
              fullWidth
              size="small"
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
              placeholder="Explain why you are requesting a refund…"
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setRefundOpen(false)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleSubmit} disabled={!refundAmount || !refundReason || saving}>
            Submit Request
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
