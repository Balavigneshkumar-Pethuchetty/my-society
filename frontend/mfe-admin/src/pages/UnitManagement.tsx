import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Avatar, Box, Button, Chip, CircularProgress, Dialog,
  DialogActions, DialogContent, DialogTitle, Divider, FormControl,
  IconButton, InputLabel, MenuItem, Paper, Select, Skeleton,
  Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs,
  TextField, Tooltip, Typography,
} from '@mui/material';
import ApartmentIcon from '@mui/icons-material/Apartment';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/Edit';
import MenuIcon from '@mui/icons-material/Menu';
import { AdminSidebar } from '../components/AdminSidebar';

// ── Shared constants ──────────────────────────────────────────────────────────

function apiBase() {
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (isLocal && ['4004', '4005'].includes(window.location.port)) return `${window.location.origin}/api/users`;
  return '/api/users';
}

async function apiFetch<T>(path: string, token: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { detail?: string }).detail ?? `HTTP ${res.status}`);
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface StructureNode {
  id: string;
  name: string;
  level_index: number;
  level_name: string;
  parent_id: string | null;
}

interface DbUser {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  is_active: boolean;
  structure_node_id: string | null;
  unit_node_ids: string[];
}

interface UnitRequest {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string | null;
  node_id: string;
  notes: string | null;
  type: 'add' | 'remove';
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  committee_member: 'Committee',
  resident: 'Resident',
  security_guard: 'Security',
  sponsor: 'Sponsor',
};

const ROLE_COLOR: Record<string, string> = {
  admin: '#6366f1',
  committee_member: '#0ea5e9',
  resident: '#10b981',
  security_guard: '#f59e0b',
  sponsor: '#ec4899',
};

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function buildNodePath(nodes: StructureNode[], nodeId: string): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const path: string[] = [];
  let cur = byId.get(nodeId);
  while (cur) {
    path.unshift(cur.name);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return path.join(' › ');
}

function leafNodes(nodes: StructureNode[]): StructureNode[] {
  const hasChildren = new Set(nodes.map((n) => n.parent_id).filter(Boolean));
  return nodes.filter((n) => !hasChildren.has(n.id));
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Manage Flats Dialog ───────────────────────────────────────────────────────

interface ManageFlatsDialogProps {
  user: DbUser | null;
  nodes: StructureNode[];
  token: string;
  onClose: () => void;
  onChanged: (userId: string, newNodeIds: string[]) => void;
}

function ManageFlatsDialog({ user, nodes, token, onClose, onChanged }: ManageFlatsDialogProps) {
  const [currentIds, setCurrentIds] = useState<string[]>([]);
  const [addNodeId,  setAddNodeId]  = useState('');
  const [busyAdd,    setBusyAdd]    = useState(false);
  const [busyRem,    setBusyRem]    = useState<string | null>(null);
  const [error,      setError]      = useState<string | null>(null);

  const available = useMemo(
    () => leafNodes(nodes).filter((n) => !currentIds.includes(n.id)),
    [nodes, currentIds],
  );

  useEffect(() => {
    if (user) { setCurrentIds(user.unit_node_ids ?? []); setAddNodeId(''); setError(null); }
  }, [user]);

  const handleAdd = async () => {
    if (!user || !addNodeId) return;
    setBusyAdd(true);
    setError(null);
    try {
      await apiFetch(`/building/users/${user.id}/units`, token, {
        method: 'POST',
        body: JSON.stringify({ node_id: addNodeId }),
      });
      const next = [...currentIds, addNodeId];
      setCurrentIds(next);
      onChanged(user.id, next);
      setAddNodeId('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add');
    } finally {
      setBusyAdd(false);
    }
  };

  const handleRemove = async (nodeId: string) => {
    if (!user) return;
    setBusyRem(nodeId);
    setError(null);
    try {
      await apiFetch(`/building/users/${user.id}/units/${nodeId}`, token, { method: 'DELETE' });
      const next = currentIds.filter((id) => id !== nodeId);
      setCurrentIds(next);
      onChanged(user.id, next);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to remove');
    } finally {
      setBusyRem(null);
    }
  };

  return (
    <Dialog open={!!user} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1 }}>
        <ApartmentIcon color="primary" />
        Manage Flats — {user?.name}
      </DialogTitle>
      <Divider />
      <DialogContent sx={{ pt: 2.5 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

        {/* Current flats */}
        <Typography fontSize={12} fontWeight={600} color="text.secondary" sx={{ mb: 1 }}>
          CURRENT FLATS
        </Typography>
        {currentIds.length === 0 ? (
          <Box sx={{ p: 1.5, borderRadius: 1, border: '1px dashed', borderColor: 'divider',
            fontSize: 13, color: 'text.secondary', textAlign: 'center', mb: 2 }}>
            No flats assigned
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mb: 2 }}>
            {currentIds.map((nodeId) => (
              <Box key={nodeId} sx={{ display: 'flex', alignItems: 'center', gap: 1,
                p: 1.25, borderRadius: 1, bgcolor: '#ede9fe', border: '1px solid #c4b5fd' }}>
                <ApartmentIcon sx={{ fontSize: 15, color: '#6366f1', flexShrink: 0 }} />
                <Typography fontSize={13} color="#3730a3" sx={{ flex: 1 }} noWrap>
                  {nodes.length ? buildNodePath(nodes, nodeId) : nodeId}
                </Typography>
                <Tooltip title="Remove">
                  <span>
                    <IconButton size="small" disabled={busyRem === nodeId}
                      onClick={() => handleRemove(nodeId)}
                      sx={{ color: '#dc2626', '&:hover': { bgcolor: '#fee2e2' } }}>
                      {busyRem === nodeId
                        ? <CircularProgress size={14} />
                        : <CloseIcon fontSize="small" />}
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
            ))}
          </Box>
        )}

        {/* Add flat */}
        <Typography fontSize={12} fontWeight={600} color="text.secondary" sx={{ mb: 1 }}>
          ADD FLAT
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <FormControl size="small" sx={{ flex: 1 }}>
            <InputLabel>Select flat</InputLabel>
            <Select
              label="Select flat"
              value={addNodeId}
              onChange={(e) => setAddNodeId(e.target.value)}
            >
              <MenuItem value=""><em>— choose —</em></MenuItem>
              {available.map((n) => (
                <MenuItem key={n.id} value={n.id}>
                  {buildNodePath(nodes, n.id)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button
            variant="contained"
            onClick={handleAdd}
            disabled={busyAdd || !addNodeId}
            startIcon={busyAdd ? <CircularProgress size={14} color="inherit" /> : <CheckIcon />}
            sx={{ px: 2, flexShrink: 0 }}
          >
            Add
          </Button>
        </Box>
        <Typography fontSize={12} color="text.secondary" sx={{ mt: 1.5 }}>
          Multiple members can share the same flat (co-owners, family).
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Members tab ───────────────────────────────────────────────────────────────

interface MembersTabProps {
  token: string;
  nodes: StructureNode[];
  nodesLoading: boolean;
}

function MembersTab({ token, nodes, nodesLoading }: MembersTabProps) {
  const [users, setUsers] = useState<DbUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<DbUser | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ total: number; items: DbUser[] }>('/users?active=true&limit=200', token);
      setUsers(res.items);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleChanged = (userId: string, newNodeIds: string[]) => {
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, unit_node_ids: newNodeIds } : u))
    );
  };

  if (loading || nodesLoading) {
    return (
      <Box sx={{ p: 3 }}>
        {[1, 2, 3, 4].map((n) => <Skeleton key={n} height={52} sx={{ mb: 1 }} />)}
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" action={<Button size="small" onClick={load}>Retry</Button>}>{error}</Alert>
      </Box>
    );
  }

  return (
    <>
      {/* Mobile cards */}
      <Box sx={{ display: { xs: 'block', md: 'none' }, p: 2 }}>
        {users.map((u) => {
          const ids = u.unit_node_ids ?? [];
          return (
            <Paper key={u.id} variant="outlined" sx={{ p: 2, mb: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                <Avatar sx={{ width: 36, height: 36, fontSize: 13, bgcolor: ROLE_COLOR[u.role] ?? '#64748b' }}>
                  {initials(u.name)}
                </Avatar>
                <Box sx={{ flex: 1 }}>
                  <Typography fontWeight={600} fontSize={14}>{u.name}</Typography>
                  <Typography fontSize={12} color="text.secondary">{u.email}</Typography>
                </Box>
                <Chip label={ROLE_LABEL[u.role] ?? u.role} size="small"
                  sx={{ bgcolor: ROLE_COLOR[u.role] ?? '#64748b', color: '#fff', fontWeight: 600, fontSize: 11 }} />
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mt: 0.5, gap: 1 }}>
                <Box sx={{ flex: 1 }}>
                  {ids.length === 0 ? (
                    <Typography fontSize={13} color="text.disabled">No flats</Typography>
                  ) : ids.map((nodeId) => (
                    <Box key={nodeId} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
                      <ApartmentIcon sx={{ fontSize: 12, color: '#6366f1' }} />
                      <Typography fontSize={12} color="#3730a3" noWrap>
                        {nodes.length ? buildNodePath(nodes, nodeId) : nodeId}
                      </Typography>
                    </Box>
                  ))}
                </Box>
                <Tooltip title="Manage flats">
                  <IconButton size="small" onClick={() => setAssignTarget(u)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            </Paper>
          );
        })}
      </Box>

      {/* Desktop table */}
      <Box sx={{ display: { xs: 'none', md: 'block' }, overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'action.hover' }}>
              <TableCell sx={{ fontWeight: 700 }}>Member</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Role</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Assigned Flats</TableCell>
              <TableCell sx={{ fontWeight: 700, width: 80 }} align="center">Manage</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((u) => {
              const ids = u.unit_node_ids ?? [];
              return (
                <TableRow key={u.id} hover>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Avatar sx={{ width: 32, height: 32, fontSize: 12, bgcolor: ROLE_COLOR[u.role] ?? '#64748b' }}>
                        {initials(u.name)}
                      </Avatar>
                      <Box>
                        <Typography fontSize={13} fontWeight={600}>{u.name}</Typography>
                        <Typography fontSize={11} color="text.secondary">{u.email}</Typography>
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Chip label={ROLE_LABEL[u.role] ?? u.role} size="small"
                      sx={{ bgcolor: ROLE_COLOR[u.role] ?? '#64748b', color: '#fff', fontWeight: 600, fontSize: 11 }} />
                  </TableCell>
                  <TableCell>
                    {ids.length === 0 ? (
                      <Typography fontSize={13} color="text.disabled">None</Typography>
                    ) : (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                        {ids.map((nodeId) => (
                          <Box key={nodeId} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <ApartmentIcon sx={{ fontSize: 13, color: '#6366f1' }} />
                            <Typography fontSize={12}>
                              {nodes.length ? buildNodePath(nodes, nodeId) : nodeId}
                            </Typography>
                          </Box>
                        ))}
                      </Box>
                    )}
                  </TableCell>
                  <TableCell align="center">
                    <Tooltip title="Manage flats">
                      <IconButton size="small" onClick={() => setAssignTarget(u)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Box>

      <ManageFlatsDialog
        user={assignTarget}
        nodes={nodes}
        token={token}
        onClose={() => setAssignTarget(null)}
        onChanged={handleChanged}
      />
    </>
  );
}

// ── Type chip ─────────────────────────────────────────────────────────────────

function TypeChip({ type }: { type: UnitRequest['type'] }) {
  return type === 'remove'
    ? <Chip label="Remove" size="small" sx={{ bgcolor: '#ffe4e6', color: '#9f1239', fontWeight: 700, fontSize: 11 }} />
    : <Chip label="Add" size="small" sx={{ bgcolor: '#dcfce7', color: '#166534', fontWeight: 700, fontSize: 11 }} />;
}

// ── Status chip ───────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: UnitRequest['status'] }) {
  const cfg = {
    pending:  { label: 'Pending',  bg: '#fef9c3', color: '#854d0e' },
    approved: { label: 'Approved', bg: '#dcfce7', color: '#166534' },
    rejected: { label: 'Rejected', bg: '#fee2e2', color: '#991b1b' },
  }[status];
  return (
    <Chip label={cfg.label} size="small"
      sx={{ bgcolor: cfg.bg, color: cfg.color, fontWeight: 700, fontSize: 11 }} />
  );
}

// ── Requests tab ──────────────────────────────────────────────────────────────

interface RequestsTabProps {
  token: string;
  nodes: StructureNode[];
  nodesLoading: boolean;
}

function RequestsTab({ token, nodes, nodesLoading }: RequestsTabProps) {
  const [requests, setRequests] = useState<UnitRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('pending');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = filterStatus !== 'all' ? `?status=${filterStatus}` : '';
      const data = await apiFetch<UnitRequest[]>(`/building/unit-requests${qs}`, token);
      setRequests(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [token, filterStatus]);

  useEffect(() => { load(); }, [load]);

  const review = async (id: string, status: 'approved' | 'rejected') => {
    setBusy(id);
    try {
      const updated = await apiFetch<UnitRequest>(`/building/unit-requests/${id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setRequests((prev) =>
        filterStatus === 'pending'
          ? prev.filter((r) => r.id !== id)
          : prev.map((r) => (r.id === id ? updated : r))
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Review failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Box>
      {/* Filter bar */}
      <Box sx={{ px: 3, py: 2, display: 'flex', alignItems: 'center', gap: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography fontSize={13} color="text.secondary" sx={{ mr: 1 }}>Show:</Typography>
        {(['pending', 'approved', 'rejected', 'all'] as const).map((s) => (
          <Button key={s} size="small" variant={filterStatus === s ? 'contained' : 'outlined'}
            onClick={() => setFilterStatus(s)}
            sx={{ textTransform: 'capitalize', minWidth: 0, px: 1.5, fontSize: 12 }}>
            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </Button>
        ))}
      </Box>

      {error && (
        <Box sx={{ px: 3, pt: 2 }}>
          <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>
        </Box>
      )}

      {loading || nodesLoading ? (
        <Box sx={{ p: 3 }}>
          {[1, 2, 3].map((n) => <Skeleton key={n} height={60} sx={{ mb: 1 }} />)}
        </Box>
      ) : requests.length === 0 ? (
        <Box sx={{ py: 8, textAlign: 'center', color: 'text.secondary', fontSize: 14 }}>
          No {filterStatus !== 'all' ? filterStatus : ''} requests found.
        </Box>
      ) : (
        <>
          {/* Mobile */}
          <Box sx={{ display: { xs: 'block', md: 'none' }, p: 2 }}>
            {requests.map((req) => (
              <Paper key={req.id} variant="outlined" sx={{ p: 2, mb: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1 }}>
                  <Box>
                    <Typography fontWeight={600} fontSize={14}>{req.user_name}</Typography>
                    <Typography fontSize={12} color="text.secondary">{req.user_email}</Typography>
                  </Box>
                  <StatusChip status={req.status} />
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                  <ApartmentIcon sx={{ fontSize: 14, color: '#6366f1' }} />
                  <Typography fontSize={13}>{buildNodePath(nodes, req.node_id)}</Typography>
                </Box>
                {req.notes && (
                  <Typography fontSize={12} color="text.secondary" sx={{ mb: 0.5 }}>
                    Note: {req.notes}
                  </Typography>
                )}
                <Typography fontSize={11} color="text.disabled">{fmt(req.created_at)}</Typography>
                {req.status === 'pending' && (
                  <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
                    <Button size="small" variant="contained" color="success"
                      startIcon={busy === req.id ? <CircularProgress size={14} color="inherit" /> : <CheckIcon />}
                      disabled={!!busy} onClick={() => review(req.id, 'approved')}>
                      Approve
                    </Button>
                    <Button size="small" variant="outlined" color="error"
                      startIcon={busy === req.id ? <CircularProgress size={14} color="inherit" /> : <CloseIcon />}
                      disabled={!!busy} onClick={() => review(req.id, 'rejected')}>
                      Reject
                    </Button>
                  </Box>
                )}
                {req.status !== 'pending' && req.reviewed_by_name && (
                  <Typography fontSize={11} color="text.disabled" sx={{ mt: 0.5 }}>
                    Reviewed by {req.reviewed_by_name} · {req.reviewed_at ? fmt(req.reviewed_at) : ''}
                  </Typography>
                )}
              </Paper>
            ))}
          </Box>

          {/* Desktop */}
          <Box sx={{ display: { xs: 'none', md: 'block' }, overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'action.hover' }}>
                  <TableCell sx={{ fontWeight: 700 }}>Member</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Unit</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Notes</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Submitted</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 700, width: 160 }} align="center">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {requests.map((req) => (
                  <TableRow key={req.id} hover>
                    <TableCell>
                      <Typography fontSize={13} fontWeight={600}>{req.user_name}</Typography>
                      <Typography fontSize={11} color="text.secondary">{req.user_email}</Typography>
                    </TableCell>
                    <TableCell>
                      <TypeChip type={req.type ?? 'add'} />
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <ApartmentIcon sx={{ fontSize: 13, color: '#6366f1' }} />
                        <Typography fontSize={13}>{buildNodePath(nodes, req.node_id)}</Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography fontSize={12} color="text.secondary">{req.notes ?? '—'}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography fontSize={12} color="text.secondary">{fmt(req.created_at)}</Typography>
                    </TableCell>
                    <TableCell>
                      <StatusChip status={req.status} />
                      {req.status !== 'pending' && req.reviewed_by_name && (
                        <Typography fontSize={10} color="text.disabled" sx={{ mt: 0.25 }}>
                          by {req.reviewed_by_name}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="center">
                      {req.status === 'pending' ? (
                        <Box sx={{ display: 'flex', gap: 0.75, justifyContent: 'center' }}>
                          <Tooltip title="Approve">
                            <span>
                              <IconButton size="small" color="success"
                                disabled={!!busy}
                                onClick={() => review(req.id, 'approved')}>
                                {busy === req.id
                                  ? <CircularProgress size={16} />
                                  : <CheckIcon fontSize="small" />}
                              </IconButton>
                            </span>
                          </Tooltip>
                          <Tooltip title="Reject">
                            <span>
                              <IconButton size="small" color="error"
                                disabled={!!busy}
                                onClick={() => review(req.id, 'rejected')}>
                                <CloseIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </Box>
                      ) : (
                        <Typography fontSize={11} color="text.disabled">Reviewed</Typography>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </>
      )}
    </Box>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

interface UnitManagementProps {
  token?: string | null;
}

export function UnitManagement({ token }: UnitManagementProps) {
  const [tab, setTab] = useState(0);
  const [nodes, setNodes] = useState<StructureNode[]>([]);
  const [nodesLoading, setNodesLoading] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!token) return;
    setNodesLoading(true);
    apiFetch<StructureNode[]>('/building/nodes', token)
      .then(setNodes)
      .catch(() => {/* silent */})
      .finally(() => setNodesLoading(false));
  }, [token]);

  if (!token) {
    return (
      <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
        <Typography>Please log in to access this page.</Typography>
      </Box>
    );
  }

  return (
    <Box component="main" sx={{ display: 'flex', minHeight: 'calc(100vh - 64px)' }}>
      <AdminSidebar active="Units" mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />

      <Box sx={{ flex: 1, overflow: 'hidden' }}>
        {/* Page header */}
        <Box
          sx={{
            px: { xs: 2, md: 4 }, py: 3,
            background: 'linear-gradient(135deg, #1e293b 0%, #312e81 100%)',
            color: '#fff',
            display: 'flex', alignItems: 'center', gap: 2,
          }}
        >
          <IconButton
            sx={{ display: { xs: 'inline-flex', md: 'none' }, color: '#fff', mr: 1 }}
            onClick={() => setMobileOpen(true)}
            size="small"
          >
            <MenuIcon />
          </IconButton>
          <ApartmentIcon sx={{ fontSize: 28, color: '#a5b4fc' }} />
          <Box>
            <Typography variant="h6" fontWeight={800}>Unit Management</Typography>
            <Typography fontSize={13} sx={{ color: '#a5b4fc' }}>
              Assign or change flat / unit for members, and review resident requests
            </Typography>
          </Box>
        </Box>

        {/* Tabs */}
        <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: { xs: 1, md: 3 } }}>
            <Tab label="Members & Units" sx={{ fontWeight: 600, fontSize: 13 }} />
            <Tab label="Unit Requests" sx={{ fontWeight: 600, fontSize: 13 }} />
          </Tabs>
        </Box>

        {/* Tab panels */}
        <Box sx={{ bgcolor: 'background.default', minHeight: 'calc(100vh - 200px)' }}>
          {tab === 0 && (
            <MembersTab token={token} nodes={nodes} nodesLoading={nodesLoading} />
          )}
          {tab === 1 && (
            <RequestsTab token={token} nodes={nodes} nodesLoading={nodesLoading} />
          )}
        </Box>
      </Box>
    </Box>
  );
}
