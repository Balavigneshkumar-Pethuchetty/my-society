import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Avatar, Box, Button, Chip, CircularProgress, Container,
  Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  IconButton, Paper, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, Typography,
} from '@mui/material';
import CheckCircleIcon    from '@mui/icons-material/CheckCircle';
import CancelIcon         from '@mui/icons-material/Cancel';
import BlockIcon          from '@mui/icons-material/Block';
import ExitToAppIcon      from '@mui/icons-material/ExitToApp';
import MenuIcon           from '@mui/icons-material/Menu';
import WarningAmberIcon   from '@mui/icons-material/WarningAmber';
import { AdminSidebar } from '../components/AdminSidebar';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LeaveRequest {
  id: string;
  user_id: string | null;
  user_name: string;
  user_email: string | null;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'revoked' | 'completed';
  requested_at: string;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  completed_at: string | null;
  has_pending_payment: boolean;
  blockers: string[];
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  pending:   { bg: '#fef3c7', color: '#92400e' },
  approved:  { bg: '#dcfce7', color: '#166534' },
  rejected:  { bg: '#fee2e2', color: '#991b1b' },
  revoked:   { bg: '#fef3c7', color: '#92400e' },
  completed: { bg: '#e0f2fe', color: '#0369a1' },
};

// ── API helpers ───────────────────────────────────────────────────────────────

function apiBase() {
  const isLocalDevHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (isLocalDevHost && ['4004', '4005'].includes(window.location.port)) return `${window.location.origin}/api/users`;
  return '/api/users';
}

async function apiFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
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

const listRequests = (t: string, status?: string) =>
  apiFetch<{ total: number; items: LeaveRequest[] }>(`/leave-requests${status ? `?status=${status}` : ''}`, t);
const approveRequest = (t: string, id: string) =>
  apiFetch<LeaveRequest>(`/leave-requests/${id}/approve`, t, { method: 'POST' });
const rejectRequest = (t: string, id: string, note?: string) =>
  apiFetch<LeaveRequest>(`/leave-requests/${id}/reject`, t, { method: 'POST', body: JSON.stringify({ note: note || null }) });
const revokeRequest = (t: string, id: string, note?: string) =>
  apiFetch<LeaveRequest>(`/leave-requests/${id}/revoke`, t, { method: 'POST', body: JSON.stringify({ note: note || null }) });

// ── Main component ─────────────────────────────────────────────────────────────

interface LeaveRequestsProps {
  token: string | null;
}

export function LeaveRequests({ token }: LeaveRequestsProps) {
  const [items,       setItems]       = useState<LeaveRequest[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [actionId,    setActionId]    = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [rejectTarget, setRejectTarget] = useState<LeaveRequest | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<LeaveRequest | null>(null);
  const [note,         setNote]         = useState('');

  // Deep link from a notification (?request_id=...) — scroll to and highlight
  // the specific request the admin was pointed at, instead of just the list.
  const [highlightId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('request_id'),
  );
  const highlightRef = useRef<HTMLTableRowElement | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const data = await listRequests(token);
      setItems(data.items);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (highlightId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightId, items]);

  const initials = (name: string) =>
    name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  const handleApprove = async (req: LeaveRequest) => {
    if (!token) return;
    setActionId(req.id); setError(null);
    try { await approveRequest(token, req.id); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setActionId(null); }
  };

  const handleRejectConfirm = async () => {
    if (!rejectTarget || !token) return;
    const req = rejectTarget; setRejectTarget(null);
    setActionId(req.id); setError(null);
    try { await rejectRequest(token, req.id, note); setNote(''); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setActionId(null); }
  };

  const handleRevokeConfirm = async () => {
    if (!revokeTarget || !token) return;
    const req = revokeTarget; setRevokeTarget(null);
    setActionId(req.id); setError(null);
    try { await revokeRequest(token, req.id, note); setNote(''); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setActionId(null); }
  };

  if (!token) {
    return (
      <Container maxWidth="sm" sx={{ pt: 8, textAlign: 'center' }}>
        <Alert severity="warning">Not authenticated. Sign in with Keycloak to view this page.</Alert>
      </Container>
    );
  }

  const openRequests = items.filter(r => r.status === 'pending' || r.status === 'approved');
  const closedRequests = items.filter(r => r.status === 'rejected' || r.status === 'revoked' || r.status === 'completed');

  return (
    <Box sx={{ display: 'flex', minHeight: 'calc(100vh - 64px)' }}>
      <AdminSidebar active="Leave Requests" mobileOpen={sidebarOpen} onMobileClose={() => setSidebarOpen(false)} />

      <Box sx={{ flex: 1, p: { xs: 2, md: 3 }, bgcolor: 'background.default', overflow: 'auto', minWidth: 0 }}>

        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3, flexWrap: 'wrap' }}>
          <IconButton onClick={() => setSidebarOpen(true)}
            sx={{ display: { md: 'none' }, color: 'text.secondary' }} aria-label="Open admin menu">
            <MenuIcon />
          </IconButton>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h5" fontWeight={700} sx={{ fontSize: { xs: 20, md: 24 }, display: 'flex', alignItems: 'center', gap: 1 }}>
              <ExitToAppIcon color="error" /> Leave Requests
            </Typography>
            <Typography color="text.secondary" fontSize={14}>Review and approve residents' requests to leave the society.</Typography>
          </Box>
          {openRequests.filter(r => r.status === 'pending').length > 0 && (
            <Chip label={`${openRequests.filter(r => r.status === 'pending').length} pending`}
              sx={{ bgcolor: '#fef3c7', color: '#92400e', fontWeight: 600, border: '1px solid #fde68a' }} />
          )}
        </Box>

        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress size={28} />
          </Box>
        ) : (
          <>
            <Paper variant="outlined" sx={{ mb: 3, overflow: 'hidden' }}>
              <Typography sx={{ p: 2, fontWeight: 600, fontSize: 14, borderBottom: '1px solid', borderColor: 'divider' }}>
                Open requests
              </Typography>
              {openRequests.length === 0 ? (
                <Box sx={{ p: 4, textAlign: 'center' }}>
                  <Typography color="text.secondary">No open leave requests.</Typography>
                </Box>
              ) : (
                <Box sx={{ overflowX: 'auto' }}>
                  <Table sx={{ minWidth: 720 }}>
                    <TableHead>
                      <TableRow sx={{ bgcolor: 'action.hover' }}>
                        <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>Resident</TableCell>
                        <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>Reason</TableCell>
                        <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>Requested</TableCell>
                        <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>Status</TableCell>
                        <TableCell sx={{ fontWeight: 600, fontSize: 12, width: 280 }}>Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {openRequests.map(req => {
                        const busy = actionId === req.id;
                        return (
                          <TableRow key={req.id}
                            ref={req.id === highlightId ? highlightRef : undefined}
                            sx={{
                              '&:last-child td': { borderBottom: 0 },
                              ...(req.id === highlightId && { bgcolor: 'action.selected' }),
                            }}>
                            <TableCell>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                <Avatar sx={{ width: 30, height: 30, fontSize: 11, bgcolor: '#94a3b8' }}>{initials(req.user_name)}</Avatar>
                                <Box>
                                  <Typography fontWeight={600} fontSize={14}>{req.user_name}</Typography>
                                  <Typography fontSize={12} color="text.secondary">{req.user_email}</Typography>
                                </Box>
                              </Box>
                            </TableCell>
                            <TableCell><Typography fontSize={13} color="text.secondary">{req.reason || '—'}</Typography></TableCell>
                            <TableCell><Typography fontSize={13} color="text.secondary">{new Date(req.requested_at).toLocaleString()}</Typography></TableCell>
                            <TableCell>
                              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: 'flex-start' }}>
                                <Chip size="small" label={req.status}
                                  sx={{ bgcolor: STATUS_COLORS[req.status]?.bg, color: STATUS_COLORS[req.status]?.color, fontWeight: 600, fontSize: 11 }} />
                                {req.has_pending_payment && (
                                  <Chip size="small" icon={<WarningAmberIcon sx={{ fontSize: '14px !important' }} />} label="Pending payment"
                                    sx={{ bgcolor: '#fee2e2', color: '#991b1b', fontWeight: 600, fontSize: 11 }} />
                                )}
                              </Box>
                            </TableCell>
                            <TableCell>
                              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                {req.status === 'pending' && (
                                  <>
                                    <Button size="small" variant="contained" disabled={busy}
                                      onClick={() => handleApprove(req)}
                                      startIcon={busy ? <CircularProgress size={12} color="inherit" /> : <CheckCircleIcon />}
                                      sx={{ bgcolor: '#16a34a', '&:hover': { bgcolor: '#15803d' }, fontSize: 12, textTransform: 'none' }}>
                                      Approve
                                    </Button>
                                    <Button size="small" variant="outlined" color="error" disabled={busy}
                                      onClick={() => setRejectTarget(req)} startIcon={<CancelIcon />}
                                      sx={{ fontSize: 12, textTransform: 'none' }}>
                                      Reject
                                    </Button>
                                  </>
                                )}
                                {req.has_pending_payment && (
                                  <Button size="small" variant="outlined" disabled={busy}
                                    onClick={() => setRevokeTarget(req)} startIcon={<BlockIcon />}
                                    sx={{ fontSize: 12, textTransform: 'none', borderColor: '#f59e0b', color: '#b45309',
                                      '&:hover': { bgcolor: '#fef3c7', borderColor: '#d97706' } }}>
                                    Revoke
                                  </Button>
                                )}
                              </Box>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Box>
              )}
            </Paper>

            <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
              <Typography sx={{ p: 2, fontWeight: 600, fontSize: 14, borderBottom: '1px solid', borderColor: 'divider' }}>
                History
              </Typography>
              {closedRequests.length === 0 ? (
                <Box sx={{ p: 4, textAlign: 'center' }}>
                  <Typography color="text.secondary">No resolved leave requests yet.</Typography>
                </Box>
              ) : (
                <Box sx={{ overflowX: 'auto' }}>
                  <Table sx={{ minWidth: 720 }}>
                    <TableHead>
                      <TableRow sx={{ bgcolor: 'action.hover' }}>
                        <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>Resident</TableCell>
                        <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>Status</TableCell>
                        <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>Note</TableCell>
                        <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>Reviewed by</TableCell>
                        <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>Reviewed</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {closedRequests.map(req => (
                        <TableRow key={req.id}
                          ref={req.id === highlightId ? highlightRef : undefined}
                          sx={{
                            '&:last-child td': { borderBottom: 0 },
                            ...(req.id === highlightId && { bgcolor: 'action.selected' }),
                          }}>
                          <TableCell>
                            <Typography fontWeight={600} fontSize={14}>{req.user_name}</Typography>
                            <Typography fontSize={12} color="text.secondary">{req.user_email}</Typography>
                          </TableCell>
                          <TableCell>
                            <Chip size="small" label={req.status}
                              sx={{ bgcolor: STATUS_COLORS[req.status]?.bg, color: STATUS_COLORS[req.status]?.color, fontWeight: 600, fontSize: 11 }} />
                          </TableCell>
                          <TableCell><Typography fontSize={13} color="text.secondary">{req.review_note || '—'}</Typography></TableCell>
                          <TableCell><Typography fontSize={13} color="text.secondary">{req.reviewed_by_name || '—'}</Typography></TableCell>
                          <TableCell><Typography fontSize={13} color="text.secondary">{req.reviewed_at ? new Date(req.reviewed_at).toLocaleString() : '—'}</Typography></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}
            </Paper>
          </>
        )}
      </Box>

      {/* Reject dialog */}
      <Dialog open={!!rejectTarget} onClose={() => setRejectTarget(null)} fullWidth maxWidth="sm">
        <DialogTitle>Reject Leave Request</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Reject {rejectTarget?.user_name}'s request to leave the society?
          </DialogContentText>
          <TextField label="Note (optional)" fullWidth multiline minRows={2} value={note} onChange={e => setNote(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectTarget(null)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleRejectConfirm}>Reject</Button>
        </DialogActions>
      </Dialog>

      {/* Revoke dialog */}
      <Dialog open={!!revokeTarget} onClose={() => setRevokeTarget(null)} fullWidth maxWidth="sm">
        <DialogTitle>Revoke Leave Request</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            {revokeTarget?.user_name} has a pending event payment. Revoking will notify them to
            cancel their ticket before they can leave.
          </DialogContentText>
          <TextField label="Note (optional)" fullWidth multiline minRows={2} value={note} onChange={e => setNote(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevokeTarget(null)}>Cancel</Button>
          <Button variant="contained" sx={{ bgcolor: '#f59e0b', '&:hover': { bgcolor: '#d97706' } }} onClick={handleRevokeConfirm}>Revoke</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
