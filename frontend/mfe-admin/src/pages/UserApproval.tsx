import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert, Avatar, Box, Button, Chip, CircularProgress, Container,
  Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  IconButton, InputAdornment, MenuItem, Paper, Select,
  Stack, Tab, Table, TableBody, TableCell, TableHead, TablePagination,
  TableRow, TableSortLabel, Tabs, TextField, Tooltip, Typography,
} from '@mui/material';
import CheckCircleIcon  from '@mui/icons-material/CheckCircle';
import CancelIcon       from '@mui/icons-material/Cancel';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import BlockIcon        from '@mui/icons-material/Block';
import PeopleIcon       from '@mui/icons-material/People';
import SaveIcon         from '@mui/icons-material/Save';
import MenuIcon         from '@mui/icons-material/Menu';
import SearchIcon       from '@mui/icons-material/Search';
import { AdminSidebar } from '../components/AdminSidebar';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DbUser {
  id: string; name: string; username: string | null; email: string;
  role: string; is_active: boolean; created_at: string;
}

interface AdminBreakdown {
  admin_id: string | null; admin_name: string;
  approved: number; rejected: number; removed: number; revoked: number;
}

interface AdminAction {
  id: string; admin_name: string;
  target_user_name: string; target_user_username: string | null; target_user_email: string;
  action: string; role?: string; performed_at: string;
}

interface AdminStats {
  total_pending: number; total_approved: number; total_rejected: number;
  total_removed: number; total_revoked: number;
  by_admin: AdminBreakdown[]; recent_actions: AdminAction[];
}

const ASSIGNABLE_ROLES = ['resident', 'committee_member', 'security_guard'];
const ALL_ROLES = ['admin', 'committee_member', 'resident', 'security_guard', 'sponsor'];

const ACTION_COLORS: Record<string, { bg: string; color: string }> = {
  approved:     { bg: '#dcfce7', color: '#166534' },
  rejected:     { bg: '#fee2e2', color: '#991b1b' },
  removed:      { bg: '#fce7f3', color: '#9d174d' },
  revoked:      { bg: '#fef3c7', color: '#92400e' },
  role_changed: { bg: '#e0f2fe', color: '#0369a1' },
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

const listPending    = (t: string) => apiFetch<{ total: number; items: DbUser[] }>('/users?active=false', t);
const listActive     = (t: string) => apiFetch<{ total: number; items: DbUser[] }>('/users?active=true', t);
const getAdminStats  = (t: string) => apiFetch<AdminStats>('/users/admin-stats', t);
const approveUser    = (t: string, id: string, role: string) =>
  apiFetch<DbUser>(`/users/${id}/approve`, t, { method: 'POST', body: JSON.stringify({ role }) });
const rejectUser     = (t: string, id: string) =>
  apiFetch<void>(`/users/${id}/reject`, t, { method: 'DELETE' });
const revokeUser     = (t: string, id: string) =>
  apiFetch<DbUser>(`/users/${id}/revoke`, t, { method: 'PATCH' });
const removeUser     = (t: string, id: string) =>
  apiFetch<void>(`/users/${id}`, t, { method: 'DELETE' });
const changeUserRole = (t: string, id: string, role: string) =>
  apiFetch<DbUser>(`/users/${id}/role`, t, { method: 'PATCH', body: JSON.stringify({ role }) });

// ── Sort helpers ──────────────────────────────────────────────────────────────

type SortDir = 'asc' | 'desc';
type PendingSortKey = 'name' | 'email' | 'created_at';
type ActiveSortKey  = 'name' | 'email' | 'role' | 'created_at';

function sortUsers(list: DbUser[], key: keyof DbUser, dir: SortDir): DbUser[] {
  return [...list].sort((a, b) => {
    const va = String(a[key] ?? '');
    const vb = String(b[key] ?? '');
    return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
  });
}

// ── Mobile card sub-components ────────────────────────────────────────────────

interface PendingCardProps {
  u: DbUser;
  busy: boolean;
  roleValue: string;
  onRoleChange: (v: string) => void;
  onApprove: () => void;
  onReject: () => void;
  initials: (n: string) => string;
}

function PendingUserCard({ u, busy, roleValue, onRoleChange, onApprove, onReject, initials }: PendingCardProps) {
  const { t } = useTranslation('admin');
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, borderLeft: '4px solid', borderLeftColor: 'warning.main' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
        <Avatar sx={{ width: 40, height: 40, fontSize: 13, bgcolor: '#94a3b8', flexShrink: 0 }}>
          {initials(u.name)}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography fontWeight={700} fontSize={15}>{u.name}</Typography>
          <Typography fontSize={12} color="text.secondary" noWrap>@{u.username || 'user'}</Typography>
          <Typography fontSize={11} color="warning.main" mt={0.25}>
            {new Date(u.created_at).toLocaleDateString()}
          </Typography>
        </Box>
      </Box>
      <Select
        size="small" fullWidth displayEmpty value={roleValue} disabled={busy}
        onChange={e => onRoleChange(e.target.value)}
        sx={{ fontSize: 13, mb: 1.5 }}
      >
        <MenuItem value="" disabled><em>{t('userApproval.selectRolePlaceholder')}</em></MenuItem>
        {ASSIGNABLE_ROLES.map(r => <MenuItem key={r} value={r} sx={{ fontSize: 13 }}>{r}</MenuItem>)}
      </Select>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button fullWidth size="small" variant="contained" disabled={busy || !roleValue}
          onClick={onApprove}
          startIcon={busy ? <CircularProgress size={12} color="inherit" /> : <CheckCircleIcon />}
          sx={{ bgcolor: '#16a34a', '&:hover': { bgcolor: '#15803d' }, fontSize: 12, textTransform: 'none' }}>
          {t('userApproval.approve')}
        </Button>
        <Button fullWidth size="small" variant="outlined" color="error" disabled={busy}
          onClick={onReject} startIcon={<CancelIcon />}
          sx={{ fontSize: 12, textTransform: 'none' }}>
          {t('userApproval.reject')}
        </Button>
      </Box>
    </Paper>
  );
}

interface ActiveCardProps {
  u: DbUser;
  busy: boolean;
  pendingRole: string | undefined;
  onRoleChange: (v: string) => void;
  onSaveRole: () => void;
  onRevoke: () => void;
  onRemove: () => void;
  initials: (n: string) => string;
}

function ActiveUserCard({ u, busy, pendingRole, onRoleChange, onSaveRole, onRevoke, onRemove, initials }: ActiveCardProps) {
  const { t } = useTranslation('admin');
  const hasRoleChange = pendingRole !== undefined && pendingRole !== u.role;
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, '&:hover': { bgcolor: 'action.hover' } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
        <Avatar sx={{ width: 40, height: 40, fontSize: 13, bgcolor: '#6366f1', flexShrink: 0 }}>
          {initials(u.name)}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography fontWeight={700} fontSize={15}>{u.name}</Typography>
          <Typography fontSize={12} color="text.secondary" noWrap>@{u.username || 'user'}</Typography>
          <Typography fontSize={11} color="text.secondary" mt={0.25}>
            {t('userApproval.since', { date: new Date(u.created_at).toLocaleDateString() })}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', gap: 1, mb: 1.5, alignItems: 'center' }}>
        <Select size="small" sx={{ fontSize: 12, flex: 1 }} value={pendingRole ?? u.role}
          onChange={e => onRoleChange(e.target.value)} disabled={busy}>
          {ALL_ROLES.map(r => <MenuItem key={r} value={r} sx={{ fontSize: 13 }}>{r}</MenuItem>)}
        </Select>
        {hasRoleChange && (
          <Button size="small" variant="contained" disabled={busy} onClick={onSaveRole}
            startIcon={busy ? <CircularProgress size={12} color="inherit" /> : <SaveIcon />}
            sx={{ bgcolor: '#6366f1', '&:hover': { bgcolor: '#4f46e5' }, fontSize: 11, textTransform: 'none', flexShrink: 0 }}>
            {t('common.save')}
          </Button>
        )}
      </Box>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button fullWidth size="small" variant="outlined" disabled={busy}
          onClick={onRevoke} startIcon={<BlockIcon />}
          sx={{ fontSize: 11, textTransform: 'none', borderColor: '#f59e0b', color: '#b45309',
            '&:hover': { bgcolor: '#fef3c7', borderColor: '#d97706' } }}>
          {t('userApproval.revoke')}
        </Button>
        <Button fullWidth size="small" variant="outlined" color="error" disabled={busy}
          onClick={onRemove} startIcon={<DeleteForeverIcon />}
          sx={{ fontSize: 11, textTransform: 'none' }}>
          {t('userApproval.remove')}
        </Button>
      </Box>
    </Paper>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface UserApprovalProps {
  token: string | null;
  onLogin?: () => void;
}

export function UserApproval({ token, onLogin }: UserApprovalProps) {
  const { t } = useTranslation('admin');
  const [tab,           setTab]           = useState(0);
  const [pending,       setPending]       = useState<DbUser[]>([]);
  const [activeUsers,   setActiveUsers]   = useState<DbUser[]>([]);
  const [stats,         setStats]         = useState<AdminStats | null>(null);
  const [roleMap,       setRoleMap]       = useState<Record<string, string>>({});
  const [roleChangeMap, setRoleChangeMap] = useState<Record<string, string>>({});
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);
  const [actionId,      setActionId]      = useState<string | null>(null);
  const [rejectTarget,  setRejectTarget]  = useState<DbUser | null>(null);
  const [revokeTarget,  setRevokeTarget]  = useState<DbUser | null>(null);
  const [removeTarget,  setRemoveTarget]  = useState<DbUser | null>(null);
  const [sidebarOpen,   setSidebarOpen]   = useState(false);

  const [pendingSearch,  setPendingSearch]  = useState('');
  const [pendingSort,    setPendingSort]    = useState<PendingSortKey>('created_at');
  const [pendingSortDir, setPendingSortDir] = useState<SortDir>('desc');
  const [pendingPage,    setPendingPage]    = useState(0);
  const [pendingRPP,     setPendingRPP]     = useState(10);

  const [activeSearch,     setActiveSearch]     = useState('');
  const [activeRoleFilter, setActiveRoleFilter] = useState('');
  const [activeSort,       setActiveSort]       = useState<ActiveSortKey>('name');
  const [activeSortDir,    setActiveSortDir]    = useState<SortDir>('asc');
  const [activePage,       setActivePage]       = useState(0);
  const [activeRPP,        setActiveRPP]        = useState(10);

  const [actionsPage, setActionsPage] = useState(0);
  const ACTIONS_PER_PAGE = 10;

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const [pendingData, activeData, statsData] = await Promise.all([
        listPending(token), listActive(token), getAdminStats(token),
      ]);
      setPending(pendingData.items);
      setActiveUsers(activeData.items);
      setStats(statsData);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (user: DbUser) => {
    const role = roleMap[user.id];
    if (!role) { setError(t('userApproval.selectRoleError')); return; }
    if (!token) return;
    setActionId(user.id); setError(null);
    try { await approveUser(token, user.id, role); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setActionId(null); }
  };

  const handleRejectConfirm = async () => {
    if (!rejectTarget || !token) return;
    const user = rejectTarget; setRejectTarget(null);
    setActionId(user.id); setError(null);
    try { await rejectUser(token, user.id); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setActionId(null); }
  };

  const handleRevokeConfirm = async () => {
    if (!revokeTarget || !token) return;
    const user = revokeTarget; setRevokeTarget(null);
    setActionId(user.id); setError(null);
    try { await revokeUser(token, user.id); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setActionId(null); }
  };

  const handleRoleChange = async (user: DbUser) => {
    const newRole = roleChangeMap[user.id];
    if (!newRole || newRole === user.role || !token) return;
    setActionId(user.id); setError(null);
    try {
      await changeUserRole(token, user.id, newRole);
      setRoleChangeMap(prev => { const n = { ...prev }; delete n[user.id]; return n; });
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setActionId(null); }
  };

  const handleRemoveConfirm = async () => {
    if (!removeTarget || !token) return;
    const user = removeTarget; setRemoveTarget(null);
    setActionId(user.id); setError(null);
    try { await removeUser(token, user.id); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setActionId(null); }
  };

  const initials = (name: string) =>
    name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  // ── Derived data ──────────────────────────────────────────────────────────

  const filteredPending = useMemo(() => {
    const q = pendingSearch.toLowerCase();
    const f = pending.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    return sortUsers(f, pendingSort, pendingSortDir);
  }, [pending, pendingSearch, pendingSort, pendingSortDir]);

  const paginatedPending = filteredPending.slice(pendingPage * pendingRPP, (pendingPage + 1) * pendingRPP);

  const filteredActive = useMemo(() => {
    const q = activeSearch.toLowerCase();
    const f = activeUsers.filter(u =>
      (u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) &&
      (activeRoleFilter === '' || u.role === activeRoleFilter)
    );
    return sortUsers(f, activeSort, activeSortDir);
  }, [activeUsers, activeSearch, activeRoleFilter, activeSort, activeSortDir]);

  const paginatedActive = filteredActive.slice(activePage * activeRPP, (activePage + 1) * activeRPP);

  const paginatedActions = useMemo(() =>
    (stats?.recent_actions ?? []).slice(actionsPage * ACTIONS_PER_PAGE, (actionsPage + 1) * ACTIONS_PER_PAGE),
    [stats, actionsPage],
  );

  function togglePendingSort(key: PendingSortKey) {
    if (pendingSort === key) setPendingSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setPendingSort(key); setPendingSortDir('asc'); }
    setPendingPage(0);
  }

  function toggleActiveSort(key: ActiveSortKey) {
    if (activeSort === key) setActiveSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setActiveSort(key); setActiveSortDir('asc'); }
    setActivePage(0);
  }

  if (!token) {
    return (
      <Container maxWidth="sm" sx={{ pt: 8, textAlign: 'center' }}>
        <Alert severity="warning" action={onLogin
          ? <Button color="inherit" size="small" onClick={onLogin}>{t('userApproval.signIn')}</Button>
          : undefined}>
          {t('userApproval.notAuthenticated')}
        </Alert>
      </Container>
    );
  }

  // ── Shared search/filter toolbar ──────────────────────────────────────────

  const PendingSearchBar = (
    <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
      <TextField
        size="small" placeholder={t('userApproval.searchPlaceholder')} value={pendingSearch}
        onChange={e => { setPendingSearch(e.target.value); setPendingPage(0); }}
        InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 16, color: 'text.secondary' }} /></InputAdornment> }}
        sx={{ minWidth: 200, flex: 1, maxWidth: 360, bgcolor: 'background.paper' }}
      />
      {pendingSearch && (
        <Typography fontSize={13} color="text.secondary">{t('userApproval.resultsCount', { filtered: filteredPending.length, total: pending.length })}</Typography>
      )}
    </Box>
  );

  const ActiveSearchBar = (
    <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
      <TextField
        size="small" placeholder={t('userApproval.searchPlaceholder')} value={activeSearch}
        onChange={e => { setActiveSearch(e.target.value); setActivePage(0); }}
        InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 16, color: 'text.secondary' }} /></InputAdornment> }}
        sx={{ minWidth: 200, flex: 1, maxWidth: 300, bgcolor: 'background.paper' }}
      />
      <Select size="small" displayEmpty value={activeRoleFilter}
        onChange={e => { setActiveRoleFilter(e.target.value); setActivePage(0); }}
        sx={{ minWidth: 140, fontSize: 13, bgcolor: 'background.paper' }}>
        <MenuItem value="" sx={{ fontSize: 13 }}><em>{t('userApproval.allRoles')}</em></MenuItem>
        {ALL_ROLES.map(r => <MenuItem key={r} value={r} sx={{ fontSize: 13 }}>{r}</MenuItem>)}
      </Select>
      {(activeSearch || activeRoleFilter) && (
        <Typography fontSize={13} color="text.secondary">{t('userApproval.resultsCount', { filtered: filteredActive.length, total: activeUsers.length })}</Typography>
      )}
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: 'calc(100vh - 64px)' }}>
      <AdminSidebar active="Users" mobileOpen={sidebarOpen} onMobileClose={() => setSidebarOpen(false)} />

      <Box sx={{ flex: 1, p: { xs: 2, md: 3 }, bgcolor: 'background.default', overflow: 'auto', minWidth: 0 }}>

        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3, flexWrap: 'wrap' }}>
          <IconButton onClick={() => setSidebarOpen(true)}
            sx={{ display: { md: 'none' }, color: 'text.secondary' }} aria-label={t('userApproval.openMenuAria')}>
            <MenuIcon />
          </IconButton>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h5" fontWeight={700} sx={{ fontSize: { xs: 20, md: 24 } }}>{t('userApproval.title')}</Typography>
            <Typography color="text.secondary" fontSize={14}>{t('userApproval.subtitle')}</Typography>
          </Box>
          {pending.length > 0 && (
            <Chip label={t('userApproval.pendingChip', { count: pending.length })}
              sx={{ bgcolor: '#fef3c7', color: '#92400e', fontWeight: 600, border: '1px solid #fde68a' }} />
          )}
        </Box>

        {/* Stats grid — 2 cols on mobile, 3 on sm, 5 on lg */}
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', lg: 'repeat(5, 1fr)' },
          gap: { xs: 1.5, md: 2 }, mb: 3,
        }}>
          {[
            { label: t('userApproval.stats.pending'),  value: stats?.total_pending  ?? pending.length, color: '#f59e0b', icon: <HourglassTopIcon fontSize="small" /> },
            { label: t('userApproval.stats.approved'), value: stats?.total_approved ?? 0,              color: '#10b981', icon: <CheckCircleIcon fontSize="small" /> },
            { label: t('userApproval.stats.rejected'), value: stats?.total_rejected ?? 0,              color: '#ef4444', icon: <CancelIcon fontSize="small" /> },
            { label: t('userApproval.stats.revoked'),  value: stats?.total_revoked  ?? 0,              color: '#f59e0b', icon: <BlockIcon fontSize="small" /> },
            { label: t('userApproval.stats.removed'),  value: stats?.total_removed  ?? 0,              color: '#ec4899', icon: <DeleteForeverIcon fontSize="small" /> },
          ].map(({ label, value, color, icon }) => (
            <Paper key={label} variant="outlined" sx={{ p: { xs: 1.5, md: 2 }, borderLeft: `4px solid ${color}` }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, color }}>
                {icon}
                <Typography fontSize={12} color="text.secondary">{label}</Typography>
              </Box>
              <Typography fontWeight={700} sx={{ color, fontSize: { xs: 24, md: 32 } }}>{value}</Typography>
            </Paper>
          ))}
        </Box>

        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

        {/* Tabs */}
        <Paper variant="outlined" sx={{ mb: 3, overflow: 'hidden' }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)}
            sx={{ borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'action.hover', px: 1 }}
            variant="scrollable" scrollButtons="auto">
            <Tab label={t('userApproval.tabs.pending', { count: pending.length })} sx={{ fontSize: 13, textTransform: 'none', fontWeight: 600 }} />
            <Tab label={t('userApproval.tabs.active', { count: activeUsers.length })} sx={{ fontSize: 13, textTransform: 'none', fontWeight: 600 }} />
          </Tabs>

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress size={28} />
            </Box>

          ) : tab === 0 ? (
            /* ── Pending Queue ── */
            <>
              {PendingSearchBar}
              {filteredPending.length === 0 ? (
                <Box sx={{ p: 4, textAlign: 'center' }}>
                  {pending.length === 0
                    ? <><Typography fontSize={40} lineHeight={1} mb={1}>🎉</Typography>
                        <Typography color="text.secondary">{t('userApproval.noPendingTitle')}</Typography></>
                    : <Typography color="text.secondary">{t('userApproval.noResultsSearch')}</Typography>}
                </Box>
              ) : (
                <>
                  {/* ── Mobile: card list ── */}
                  <Stack spacing={1.5} sx={{ display: { xs: 'flex', md: 'none' }, p: 2 }}>
                    {paginatedPending.map(u => (
                      <PendingUserCard
                        key={u.id} u={u} busy={actionId === u.id}
                        roleValue={roleMap[u.id] ?? ''}
                        onRoleChange={v => setRoleMap(prev => ({ ...prev, [u.id]: v }))}
                        onApprove={() => handleApprove(u)}
                        onReject={() => setRejectTarget(u)}
                        initials={initials}
                      />
                    ))}
                  </Stack>

                  {/* ── Desktop: table ── */}
                  <Box sx={{ display: { xs: 'none', md: 'block' }, overflowX: 'auto' }}>
                    <Table sx={{ minWidth: 600 }}>
                      <TableHead>
                        <TableRow sx={{ bgcolor: 'action.hover' }}>
                          {(['name', 'email', 'created_at'] as PendingSortKey[]).map((k, i) => (
                            <TableCell key={k} sx={{ fontWeight: 600, fontSize: 12 }}>
                              <TableSortLabel active={pendingSort === k} direction={pendingSort === k ? pendingSortDir : 'asc'} onClick={() => togglePendingSort(k)}>
                                {[t('userApproval.table.name'), t('userApproval.table.email'), t('userApproval.table.registered')][i]}
                              </TableSortLabel>
                            </TableCell>
                          ))}
                          <TableCell sx={{ fontWeight: 600, fontSize: 12, width: 200 }}>{t('userApproval.table.assignRole')}</TableCell>
                          <TableCell sx={{ fontWeight: 600, fontSize: 12, width: 220 }}>{t('userApproval.table.actions')}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {paginatedPending.map(u => {
                          const busy = actionId === u.id;
                          return (
                            <TableRow key={u.id} sx={{ bgcolor: 'action.hover', '&:last-child td': { borderBottom: 0 } }}>
                              <TableCell sx={{ borderLeft: '3px solid', borderLeftColor: 'warning.main' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                  <Avatar sx={{ width: 30, height: 30, fontSize: 11, bgcolor: '#94a3b8' }}>{initials(u.name)}</Avatar>
                                  <Typography fontWeight={600} fontSize={14}>{u.name}</Typography>
                                </Box>
                              </TableCell>
                              <TableCell><Typography fontSize={13} color="text.secondary">@{u.username || 'user'}</Typography></TableCell>
                              <TableCell><Typography fontSize={13} color="text.secondary">{new Date(u.created_at).toLocaleString()}</Typography></TableCell>
                              <TableCell>
                                <Select size="small" displayEmpty value={roleMap[u.id] ?? ''}
                                  onChange={e => setRoleMap(prev => ({ ...prev, [u.id]: e.target.value }))}
                                  sx={{ fontSize: 13, minWidth: 160 }} disabled={busy}>
                                  <MenuItem value="" disabled><em>{t('userApproval.selectRolePlaceholder')}</em></MenuItem>
                                  {ASSIGNABLE_ROLES.map(r => <MenuItem key={r} value={r} sx={{ fontSize: 13 }}>{r}</MenuItem>)}
                                </Select>
                              </TableCell>
                              <TableCell>
                                <Box sx={{ display: 'flex', gap: 1 }}>
                                  <Button size="small" variant="contained" disabled={busy || !roleMap[u.id]}
                                    onClick={() => handleApprove(u)}
                                    startIcon={busy ? <CircularProgress size={12} color="inherit" /> : <CheckCircleIcon />}
                                    sx={{ bgcolor: '#16a34a', '&:hover': { bgcolor: '#15803d' }, fontSize: 12, textTransform: 'none' }}>
                                    {t('userApproval.approve')}
                                  </Button>
                                  <Button size="small" variant="outlined" color="error" disabled={busy}
                                    onClick={() => setRejectTarget(u)} startIcon={<CancelIcon />}
                                    sx={{ fontSize: 12, textTransform: 'none' }}>
                                    {t('userApproval.reject')}
                                  </Button>
                                </Box>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </Box>

                  <TablePagination
                    component="div" count={filteredPending.length}
                    page={pendingPage} onPageChange={(_, p) => setPendingPage(p)}
                    rowsPerPage={pendingRPP} rowsPerPageOptions={[5, 10, 25]}
                    onRowsPerPageChange={e => { setPendingRPP(parseInt(e.target.value, 10)); setPendingPage(0); }}
                    sx={{ borderTop: '1px solid', borderColor: 'divider' }}
                  />
                </>
              )}
            </>

          ) : (
            /* ── Active Users ── */
            <>
              {ActiveSearchBar}
              {filteredActive.length === 0 ? (
                <Box sx={{ p: 4, textAlign: 'center' }}>
                  <Typography color="text.secondary">
                    {activeUsers.length === 0 ? t('userApproval.noActiveUsers') : t('userApproval.noResultsFilter')}
                  </Typography>
                </Box>
              ) : (
                <>
                  {/* ── Mobile: card list ── */}
                  <Stack spacing={1.5} sx={{ display: { xs: 'flex', md: 'none' }, p: 2 }}>
                    {paginatedActive.map(u => (
                      <ActiveUserCard
                        key={u.id} u={u} busy={actionId === u.id}
                        pendingRole={roleChangeMap[u.id]}
                        onRoleChange={v => setRoleChangeMap(prev => ({ ...prev, [u.id]: v }))}
                        onSaveRole={() => handleRoleChange(u)}
                        onRevoke={() => setRevokeTarget(u)}
                        onRemove={() => setRemoveTarget(u)}
                        initials={initials}
                      />
                    ))}
                  </Stack>

                  {/* ── Desktop: table ── */}
                  <Box sx={{ display: { xs: 'none', md: 'block' }, overflowX: 'auto' }}>
                    <Table sx={{ minWidth: 700 }}>
                      <TableHead>
                        <TableRow sx={{ bgcolor: 'action.hover' }}>
                          {(['name', 'email', 'role', 'created_at'] as ActiveSortKey[]).map((k, i) => (
                            <TableCell key={k} sx={{ fontWeight: 600, fontSize: 12, ...(k === 'role' ? { width: 230 } : {}) }}>
                              <TableSortLabel active={activeSort === k} direction={activeSort === k ? activeSortDir : 'asc'} onClick={() => toggleActiveSort(k)}>
                                {[t('userApproval.table.name'), t('userApproval.table.email'), t('userApproval.table.role'), t('userApproval.table.registered')][i]}
                              </TableSortLabel>
                            </TableCell>
                          ))}
                          <TableCell sx={{ fontWeight: 600, fontSize: 12, width: 200 }}>{t('userApproval.table.actions')}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {paginatedActive.map(u => {
                          const busy = actionId === u.id;
                          return (
                            <TableRow key={u.id} sx={{ '&:last-child td': { borderBottom: 0 }, '&:hover': { bgcolor: 'action.hover' } }}>
                              <TableCell>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                  <Avatar sx={{ width: 30, height: 30, fontSize: 11, bgcolor: '#6366f1' }}>{initials(u.name)}</Avatar>
                                  <Typography fontWeight={600} fontSize={14}>{u.name}</Typography>
                                </Box>
                              </TableCell>
                              <TableCell><Typography fontSize={13} color="text.secondary">@{u.username || 'user'}</Typography></TableCell>
                              <TableCell>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <Select size="small" value={roleChangeMap[u.id] ?? u.role}
                                    onChange={e => setRoleChangeMap(prev => ({ ...prev, [u.id]: e.target.value }))}
                                    sx={{ fontSize: 12, minWidth: 155 }} disabled={busy}>
                                    {ALL_ROLES.map(r => <MenuItem key={r} value={r} sx={{ fontSize: 13 }}>{r}</MenuItem>)}
                                  </Select>
                                  {roleChangeMap[u.id] && roleChangeMap[u.id] !== u.role && (
                                    <Tooltip title={t('userApproval.saveRoleTooltip')}>
                                      <span>
                                        <Button size="small" variant="contained" disabled={busy}
                                          onClick={() => handleRoleChange(u)}
                                          startIcon={busy ? <CircularProgress size={12} color="inherit" /> : <SaveIcon />}
                                          sx={{ fontSize: 11, textTransform: 'none', bgcolor: '#6366f1',
                                            '&:hover': { bgcolor: '#4f46e5' }, minWidth: 0, px: 1.5 }}>
                                          {t('common.save')}
                                        </Button>
                                      </span>
                                    </Tooltip>
                                  )}
                                </Box>
                              </TableCell>
                              <TableCell><Typography fontSize={13} color="text.secondary">{new Date(u.created_at).toLocaleString()}</Typography></TableCell>
                              <TableCell>
                                <Box sx={{ display: 'flex', gap: 1 }}>
                                  <Tooltip title={t('userApproval.revokeTooltip')}>
                                    <span>
                                      <Button size="small" variant="outlined" disabled={busy}
                                        onClick={() => setRevokeTarget(u)} startIcon={<BlockIcon />}
                                        sx={{ fontSize: 11, textTransform: 'none', borderColor: '#f59e0b', color: '#b45309',
                                          '&:hover': { bgcolor: '#fef3c7', borderColor: '#d97706' } }}>
                                        {t('userApproval.revoke')}
                                      </Button>
                                    </span>
                                  </Tooltip>
                                  <Tooltip title={t('userApproval.removeTooltip')}>
                                    <span>
                                      <Button size="small" variant="outlined" color="error" disabled={busy}
                                        onClick={() => setRemoveTarget(u)} startIcon={<DeleteForeverIcon />}
                                        sx={{ fontSize: 11, textTransform: 'none' }}>
                                        {t('userApproval.remove')}
                                      </Button>
                                    </span>
                                  </Tooltip>
                                </Box>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </Box>

                  <TablePagination
                    component="div" count={filteredActive.length}
                    page={activePage} onPageChange={(_, p) => setActivePage(p)}
                    rowsPerPage={activeRPP} rowsPerPageOptions={[5, 10, 25, 50]}
                    onRowsPerPageChange={e => { setActiveRPP(parseInt(e.target.value, 10)); setActivePage(0); }}
                    sx={{ borderTop: '1px solid', borderColor: 'divider' }}
                  />
                </>
              )}
            </>
          )}
        </Paper>

        {/* Admin breakdown */}
        {stats && stats.by_admin.length > 0 && (
          <Paper variant="outlined" sx={{ mb: 3, overflow: 'hidden' }}>
            <Box sx={{ px: 2, py: 1.25, bgcolor: 'action.hover', borderBottom: '1px solid', borderColor: 'divider',
              display: 'flex', alignItems: 'center', gap: 1 }}>
              <PeopleIcon sx={{ fontSize: 16, color: 'primary.main' }} />
              <Typography fontSize={13} fontWeight={600} color="primary.main">{t('userApproval.adminBreakdownTitle')}</Typography>
            </Box>

            {/* Mobile: compact cards */}
            <Stack spacing={1} sx={{ display: { xs: 'flex', md: 'none' }, p: 1.5 }}>
              {stats.by_admin.map((a, i) => (
                <Paper key={i} variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
                  <Typography fontWeight={700} fontSize={14} mb={1}>{a.admin_name}</Typography>
                  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    {[[t('userApproval.stats.approved'), a.approved, '#16a34a'], [t('userApproval.stats.rejected'), a.rejected, '#dc2626'], [t('userApproval.stats.revoked'), a.revoked, '#d97706'], [t('userApproval.stats.removed'), a.removed, '#db2777']].map(([l, v, c]) => (
                      <Box key={l as string} sx={{ textAlign: 'center', minWidth: 52 }}>
                        <Typography fontSize={18} fontWeight={700} sx={{ color: c as string }}>{v as number}</Typography>
                        <Typography fontSize={10} color="text.secondary">{l}</Typography>
                      </Box>
                    ))}
                  </Box>
                </Paper>
              ))}
            </Stack>

            {/* Desktop: table */}
            <Box sx={{ display: { xs: 'none', md: 'block' }, overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 400 }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>{t('userApproval.activityTable.admin')}</TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: 12, color: '#16a34a' }}>{t('userApproval.stats.approved')}</TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: 12, color: '#dc2626' }}>{t('userApproval.stats.rejected')}</TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: 12, color: '#d97706' }}>{t('userApproval.stats.revoked')}</TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: 12, color: '#db2777' }}>{t('userApproval.stats.removed')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {stats.by_admin.map((a, i) => (
                    <TableRow key={i} sx={{ '&:last-child td': { borderBottom: 0 } }}>
                      <TableCell><Typography fontSize={13} fontWeight={600}>{a.admin_name}</Typography></TableCell>
                      <TableCell><Typography fontSize={13} color="#16a34a" fontWeight={600}>{a.approved}</Typography></TableCell>
                      <TableCell><Typography fontSize={13} color="#dc2626" fontWeight={600}>{a.rejected}</Typography></TableCell>
                      <TableCell><Typography fontSize={13} color="#d97706" fontWeight={600}>{a.revoked}</Typography></TableCell>
                      <TableCell><Typography fontSize={13} color="#db2777" fontWeight={600}>{a.removed}</Typography></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Paper>
        )}

        {/* Recent activity */}
        {stats && stats.recent_actions.length > 0 && (
          <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
            <Box sx={{ px: 2, py: 1.25, bgcolor: 'action.hover', borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography fontSize={13} fontWeight={600} color="text.secondary">
                {t('userApproval.recentActivityTitle')}
              </Typography>
            </Box>

            {/* Mobile: card list */}
            <Stack spacing={1} sx={{ display: { xs: 'flex', md: 'none' }, p: 1.5 }}>
              {paginatedActions.map(a => {
                const c = ACTION_COLORS[a.action] ?? { bg: 'action.hover', color: 'text.secondary' };
                return (
                  <Paper key={a.id} variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 0.75, gap: 1 }}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography fontWeight={700} fontSize={13} noWrap>{a.target_user_name}</Typography>
                        <Typography fontSize={11} color="text.secondary" noWrap>@{a.target_user_username || 'user'}</Typography>
                      </Box>
                      <Chip size="small" label={a.action} sx={{ bgcolor: c.bg, color: c.color, fontWeight: 600, flexShrink: 0 }} />
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                      {a.role && <Chip size="small" label={a.role} sx={{ bgcolor: '#ede9fe', color: '#4c1d95', fontWeight: 600 }} />}
                      <Typography fontSize={11} color="text.secondary">{t('userApproval.byAdmin', { name: a.admin_name })}</Typography>
                      <Typography fontSize={11} color="text.secondary" sx={{ ml: 'auto' }}>
                        {new Date(a.performed_at).toLocaleDateString()}
                      </Typography>
                    </Box>
                  </Paper>
                );
              })}
            </Stack>

            {/* Desktop: table */}
            <Box sx={{ display: { xs: 'none', md: 'block' }, overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 560 }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    {[t('userApproval.activityTable.user'), t('userApproval.activityTable.email'), t('userApproval.activityTable.action'), t('userApproval.activityTable.role'), t('userApproval.activityTable.byAdmin'), t('userApproval.activityTable.time')].map(h => (
                      <TableCell key={h} sx={{ fontWeight: 600, fontSize: 12 }}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {paginatedActions.map(a => {
                    const c = ACTION_COLORS[a.action] ?? { bg: 'action.hover', color: 'text.secondary' };
                    return (
                      <TableRow key={a.id} sx={{ '&:last-child td': { borderBottom: 0 } }}>
                        <TableCell><Typography fontSize={13} fontWeight={600}>{a.target_user_name}</Typography></TableCell>
                        <TableCell><Typography fontSize={13} color="text.secondary">@{a.target_user_username || 'user'}</Typography></TableCell>
                        <TableCell><Chip size="small" label={a.action} sx={{ bgcolor: c.bg, color: c.color, fontWeight: 600 }} /></TableCell>
                        <TableCell>
                          {a.role
                            ? <Chip size="small" label={a.role} sx={{ bgcolor: '#ede9fe', color: '#4c1d95', fontWeight: 600 }} />
                            : <Typography fontSize={12} color="text.secondary">—</Typography>}
                        </TableCell>
                        <TableCell><Typography fontSize={13}>{a.admin_name}</Typography></TableCell>
                        <TableCell><Typography fontSize={12} color="text.secondary">{new Date(a.performed_at).toLocaleString()}</Typography></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>

            <TablePagination
              component="div" count={stats.recent_actions.length}
              page={actionsPage} onPageChange={(_, p) => setActionsPage(p)}
              rowsPerPage={ACTIONS_PER_PAGE} rowsPerPageOptions={[ACTIONS_PER_PAGE]}
              sx={{ borderTop: '1px solid', borderColor: 'divider' }}
            />
          </Paper>
        )}
      </Box>

      {/* ── Dialogs ── */}

      <Dialog open={!!rejectTarget} onClose={() => setRejectTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, color: '#991b1b' }}>{t('userApproval.dialogs.rejectTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('userApproval.dialogs.rejectBody', { name: rejectTarget?.name ?? '', email: rejectTarget?.email ?? '' })}
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRejectTarget(null)} variant="outlined" size="small">{t('common.cancel')}</Button>
          <Button onClick={handleRejectConfirm} variant="contained" color="error" size="small">{t('userApproval.dialogs.confirmReject')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!revokeTarget} onClose={() => setRevokeTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, color: '#b45309' }}>{t('userApproval.dialogs.revokeTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('userApproval.dialogs.revokeBody', { name: revokeTarget?.name ?? '', email: revokeTarget?.email ?? '' })}
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRevokeTarget(null)} variant="outlined" size="small">{t('common.cancel')}</Button>
          <Button onClick={handleRevokeConfirm} variant="contained" size="small"
            sx={{ bgcolor: '#d97706', '&:hover': { bgcolor: '#b45309' } }}>
            {t('userApproval.dialogs.confirmRevoke')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!removeTarget} onClose={() => setRemoveTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, color: '#991b1b' }}>{t('userApproval.dialogs.removeTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('userApproval.dialogs.removeBody', { name: removeTarget?.name ?? '', email: removeTarget?.email ?? '' })}
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRemoveTarget(null)} variant="outlined" size="small">{t('common.cancel')}</Button>
          <Button onClick={handleRemoveConfirm} variant="contained" color="error" size="small">{t('userApproval.dialogs.confirmRemove')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
