import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress,
  Dialog, DialogActions, DialogContent, DialogTitle,
  Grid, Paper, Stack, Tab, Tabs, Table, TableBody,
  TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';

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

type RefundStatus = 'pending' | 'approved' | 'rejected' | 'processed';

interface RefundRequest {
  id: string;
  sponsor_name: string;
  sponsor_contact: string | null;
  event_title: string;
  sponsorship_amount: number | string;
  sponsorship_status: string;
  amount: number | string;
  created_at: string;
  reason: string | null;
  status: RefundStatus;
}

const SIDEBAR = ['Dashboard', 'Users', 'Events', 'Sponsors', 'Categories', 'Payments & Refunds', 'Reports', 'Settings'];

function AdminSidebar({ active }: { active: string }) {
  return (
    <Box sx={{ width: 220, borderRight: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', flexShrink: 0 }}>
      {SIDEBAR.map((item) => (
        <Box
          key={item}
          sx={{
            px: 2.5, py: 1.25, fontSize: 14, cursor: 'pointer',
            color: item === active ? '#6366f1' : 'text.secondary',
            fontWeight: item === active ? 700 : 400,
            bgcolor: item === active ? '#ede9fe' : 'transparent',
            borderRight: item === active ? '3px solid #6366f1' : '3px solid transparent',
            transition: 'all .15s',
            '&:hover': { bgcolor: item === active ? '#ede9fe' : 'action.hover', color: item === active ? '#6366f1' : 'text.primary' },
          }}
        >
          {item}
        </Box>
      ))}
    </Box>
  );
}

const STATUS_MAP: Record<RefundStatus, { label: string; color: 'warning' | 'success' | 'error' | 'default' }> = {
  pending:   { label: 'Pending',   color: 'warning' },
  approved:  { label: 'Approved',  color: 'success' },
  rejected:  { label: 'Rejected',  color: 'error' },
  processed: { label: 'Processed', color: 'default' },
};

export function SponsorshipRefunds({ token = null }: { token?: string | null }) {
  const [tab, setTab] = useState(1);
  const [requests, setRequests] = useState<RefundRequest[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen,  setRejectOpen]  = useState(false);
  const [activeId,    setActiveId]    = useState<string | null>(null);
  const [approvedAmt, setApprovedAmt] = useState('5000');

  const load = useCallback(() => {
    if (!token) { setLoading(false); return; }
    setLoading(true); setError(null);
    apiFetch<RefundRequest[]>('payments', '/sponsors/refunds', token)
      .then(setRequests)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const activeReq = requests.find((r) => r.id === activeId);

  const handleApprove = async () => {
    if (!token || !activeId) return;
    try {
      await apiMutate('payments', `/sponsors/refunds/${activeId}/approve`, token, 'PATCH', {
        approved_amount: Number(approvedAmt),
      });
      setApproveOpen(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to approve refund');
    }
  };

  const handleReject = async () => {
    if (!token || !activeId) return;
    try {
      await apiMutate('payments', `/sponsors/refunds/${activeId}/reject`, token, 'PATCH');
      setRejectOpen(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reject refund');
    }
  };

  const pending   = requests.filter((r) => r.status === 'pending').length;
  const approved  = requests.filter((r) => r.status === 'approved').length;
  const totalAmt  = requests.reduce((a, r) => a + Number(r.amount), 0);

  const stats = [
    { label: 'Total Requests',    value: requests.length, color: '#6366f1' },
    { label: 'Pending Review',    value: pending,          color: '#f59e0b' },
    { label: 'Approved',          value: approved,         color: '#10b981' },
    { label: 'Total Refund Amt',  value: `₹${totalAmt.toLocaleString()}`, color: 'text.primary' },
  ];

  return (
    <Box component="main" sx={{ display: 'flex', minHeight: 'calc(100vh - 60px)' }}>
      <AdminSidebar active="Payments & Refunds" />

      <Box sx={{ flex: 1, p: { xs: 2, md: 4 } }}>
        <Typography variant="h5" fontWeight={800} sx={{ mb: 3 }}>Payments &amp; Refunds</Typography>

        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 4, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Tab label="Resident Payment Refunds" />
          <Tab label="Sponsorship Refunds" />
        </Tabs>

        {error && !approveOpen && !rejectOpen && <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>{error}</Alert>}
        {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>}

        {!loading && (
        <>
        <Grid container spacing={2.5} sx={{ mb: 4 }}>
          {stats.map((s) => (
            <Grid item xs={6} md={3} key={s.label}>
              <Card variant="outlined" sx={{ borderRadius: 2 }}>
                <CardContent sx={{ textAlign: 'center', py: 2 }}>
                  <Typography fontSize={28} fontWeight={800} sx={{ color: s.color }}>{s.value}</Typography>
                  <Typography fontSize={11} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, mt: 0.5 }}>{s.label}</Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Table>
            <TableHead>
              <TableRow sx={{ bgcolor: 'action.hover' }}>
                {['Sponsor', 'Event', 'Sponsorship', 'Refund Req.', 'Requested', 'Reason', 'Status', 'Actions'].map((h) => (
                  <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'text.secondary', letterSpacing: 0.4 }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {requests.length === 0 && (
                <TableRow><TableCell colSpan={8}>
                  <Typography fontSize={13} color="text.secondary" textAlign="center" py={2}>No sponsorship refund requests yet.</Typography>
                </TableCell></TableRow>
              )}
              {requests.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell>
                    <Typography fontWeight={700} fontSize={14}>{r.sponsor_name}</Typography>
                    <Typography fontSize={12} color="text.secondary">{r.sponsor_contact}</Typography>
                  </TableCell>
                  <TableCell><Typography fontWeight={600} fontSize={13}>{r.event_title}</Typography></TableCell>
                  <TableCell>
                    <Typography fontSize={13}>₹{Number(r.sponsorship_amount).toLocaleString()}</Typography>
                    <Chip label={r.sponsorship_status} size="small" color="warning" sx={{ fontSize: 10, fontWeight: 700, mt: 0.5 }} />
                  </TableCell>
                  <TableCell><Typography fontWeight={700} color="error.main">₹{Number(r.amount).toLocaleString()}</Typography></TableCell>
                  <TableCell><Typography fontSize={13}>{new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Typography></TableCell>
                  <TableCell sx={{ maxWidth: 200 }}>
                    <Typography fontSize={12} color="text.secondary">{r.reason}</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip label={STATUS_MAP[r.status].label} color={STATUS_MAP[r.status].color} size="small" sx={{ fontWeight: 700 }} />
                  </TableCell>
                  <TableCell>
                    {r.status === 'pending' && (
                      <Stack direction="row" spacing={1}>
                        <Button
                          size="small"
                          variant="contained"
                          color="success"
                          startIcon={<CheckIcon />}
                          onClick={() => { setActiveId(r.id); setApprovedAmt(String(r.amount)); setApproveOpen(true); }}
                        >
                          Approve
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          startIcon={<CloseIcon />}
                          onClick={() => { setActiveId(r.id); setRejectOpen(true); }}
                        >
                          Reject
                        </Button>
                      </Stack>
                    )}
                    {r.status === 'approved' && (
                      <Button size="small" variant="contained" onClick={async () => {
                        if (!token) return;
                        await apiMutate('payments', `/sponsors/refunds/${r.id}/process`, token, 'PATCH');
                        load();
                      }}>
                        Mark Processed
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
        </>
        )}
      </Box>

      <Dialog open={approveOpen} onClose={() => setApproveOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle fontWeight={700}>Approve Sponsorship Refund</DialogTitle>
        <DialogContent dividers>
          {error && <Alert severity="error" sx={{ mb: 2.5 }} onClose={() => setError(null)}>{error}</Alert>}
          {activeReq && (
            <>
              <Typography fontSize={14} color="text.secondary" sx={{ mb: 2.5 }}>
                {activeReq.sponsor_name} · {activeReq.event_title}
              </Typography>
              <Grid container spacing={2} sx={{ mb: 2.5 }}>
                <Grid item xs={6}>
                  <Typography fontSize={11} fontWeight={700} color="text.secondary" sx={{ mb: 0.5, textTransform: 'uppercase', letterSpacing: 0.5 }}>Sponsorship Amount</Typography>
                  <Typography fontWeight={700}>₹{Number(activeReq.sponsorship_amount).toLocaleString()}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography fontSize={11} fontWeight={700} color="text.secondary" sx={{ mb: 0.5, textTransform: 'uppercase', letterSpacing: 0.5 }}>Requested Refund</Typography>
                  <Typography fontWeight={700} color="error.main">₹{Number(activeReq.amount).toLocaleString()}</Typography>
                </Grid>
              </Grid>
            </>
          )}
          <Stack spacing={2.5}>
            <TextField
              label="Approved Refund Amount (₹)"
              type="number"
              fullWidth
              size="small"
              value={approvedAmt}
              onChange={(e) => setApprovedAmt(e.target.value)}
            />
            <Alert severity="info" sx={{ borderRadius: 1.5 }}>
              Approving marks this refund request approved — use "Mark Processed" once the money has actually been paid out.
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setApproveOpen(false)}>Cancel</Button>
          <Button variant="contained" color="success" startIcon={<CheckIcon />} onClick={handleApprove}>
            Confirm Approval
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={rejectOpen} onClose={() => setRejectOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle fontWeight={700}>Reject Refund Request</DialogTitle>
        <DialogContent dividers>
          {activeReq && (
            <Typography fontSize={14} color="text.secondary" sx={{ mb: 2 }}>
              {activeReq.sponsor_name} · ₹{Number(activeReq.amount).toLocaleString()} refund request
            </Typography>
          )}
          <Typography fontSize={13} color="text.secondary">
            Are you sure you want to reject this refund request? The sponsorship will revert to its prior status.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setRejectOpen(false)}>Cancel</Button>
          <Button variant="contained" color="error" startIcon={<CloseIcon />} onClick={handleReject}>
            Confirm Rejection
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
