import './i18n';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Container, MenuItem, Paper,
  Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import DescriptionIcon from '@mui/icons-material/Description';
import FilterListIcon from '@mui/icons-material/FilterList';
import GridOnIcon from '@mui/icons-material/GridOn';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import { apiBase, apiFetchBlob } from './api';
import { fmtDateTime, LedgerRow, statusColor, statusLabel } from './types';

interface Filters {
  from_date: string;
  to_date: string;
  purpose: string;
  status: string;
}

const EMPTY_FILTERS: Filters = { from_date: '', to_date: '', purpose: '', status: '' };

function buildQuery(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.from_date) params.set('from_date', new Date(filters.from_date).toISOString());
  if (filters.to_date) params.set('to_date', new Date(filters.to_date).toISOString());
  if (filters.purpose) params.set('purpose', filters.purpose);
  if (filters.status) params.set('status', filters.status);
  return params.toString();
}

async function downloadFile(url: string, token: string, filename: string) {
  const blob = await apiFetchBlob(url, token);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export interface VisitorAdminAppProps {
  token?: string | null;
}

export function VisitorAdminApp({ token }: VisitorAdminAppProps) {
  const { t } = useTranslation('visitors');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null);

  const load = useCallback(() => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    fetch(`${apiBase('visitors')}/ledger?${buildQuery(filters)}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data: LedgerRow[]) => { setRows(data); setLoading(false); })
      .catch((e) => { setError((e as Error).message); setLoading(false); });
  }, [token, filters]);

  useEffect(() => { load(); }, [load]);

  async function handleExport(kind: 'xlsx' | 'pdf') {
    if (!token) return;
    setExporting(kind);
    try {
      await downloadFile(`${apiBase('visitors')}/ledger/export.${kind}?${buildQuery(filters)}`, token, `visitor-ledger.${kind}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(null);
    }
  }

  if (!token) {
    return (
      <Container maxWidth="sm" sx={{ py: 6, textAlign: 'center' }}>
        <Alert severity="warning">{t('admin.loginRequired')}</Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight={800}>{t('admin.title')}</Typography>
        <Typography variant="body2" color="text.secondary">
          {t('admin.subtitle')}
        </Typography>
      </Box>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 3 }}>
        <Stack direction="row" spacing={1} alignItems="center" mb={1.5}>
          <FilterListIcon fontSize="small" color="action" />
          <Typography variant="subtitle2" fontWeight={700}>{t('admin.filtersTitle')}</Typography>
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} flexWrap="wrap" useFlexGap>
          <TextField
            label={t('admin.fromLabel')} type="date" size="small" InputLabelProps={{ shrink: true }}
            value={filters.from_date} onChange={(e) => setFilters((f) => ({ ...f, from_date: e.target.value }))}
          />
          <TextField
            label={t('admin.toLabel')} type="date" size="small" InputLabelProps={{ shrink: true }}
            value={filters.to_date} onChange={(e) => setFilters((f) => ({ ...f, to_date: e.target.value }))}
          />
          <TextField
            label={t('admin.purposeLabel')} size="small"
            value={filters.purpose} onChange={(e) => setFilters((f) => ({ ...f, purpose: e.target.value }))}
          />
          <TextField
            label={t('admin.statusLabel')} size="small" select sx={{ minWidth: 140 }}
            value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
          >
            <MenuItem value="">{t('admin.statusAll')}</MenuItem>
            <MenuItem value="pending">{t('admin.statusOptions.pending')}</MenuItem>
            <MenuItem value="partially_entered">{t('admin.statusOptions.partially_entered')}</MenuItem>
            <MenuItem value="entered">{t('admin.statusOptions.entered')}</MenuItem>
            <MenuItem value="partially_exited">{t('admin.statusOptions.partially_exited')}</MenuItem>
            <MenuItem value="exited">{t('admin.statusOptions.exited')}</MenuItem>
            <MenuItem value="cancelled">{t('admin.statusOptions.cancelled')}</MenuItem>
            <MenuItem value="expired">{t('admin.statusOptions.expired')}</MenuItem>
          </TextField>
          <Button variant="outlined" size="small" onClick={() => setFilters(EMPTY_FILTERS)}>{t('admin.clear')}</Button>
        </Stack>
      </Paper>

      <Stack direction="row" spacing={1} justifyContent="flex-end" mb={2}>
        <Button size="small" startIcon={<GridOnIcon />} disabled={exporting !== null} onClick={() => void handleExport('xlsx')}>
          {exporting === 'xlsx' ? <CircularProgress size={16} /> : t('admin.exportExcel')}
        </Button>
        <Button size="small" startIcon={<DescriptionIcon />} disabled={exporting !== null} onClick={() => void handleExport('pdf')}>
          {exporting === 'pdf' ? <CircularProgress size={16} /> : t('admin.exportPdf')}
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('admin.table.visitor')}</TableCell>
                <TableCell>{t('admin.table.purpose')}</TableCell>
                <TableCell>{t('admin.table.resident')}</TableCell>
                <TableCell>{t('admin.table.status')}</TableCell>
                <TableCell align="center">{t('admin.table.visitors')}</TableCell>
                <TableCell>{t('admin.table.entry')}</TableCell>
                <TableCell>{t('admin.table.exit')}</TableCell>
                <TableCell align="center">{t('admin.table.photo')}</TableCell>
                <TableCell align="center">{t('admin.table.aadhaar')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={9} align="center" sx={{ py: 4, color: 'text.secondary' }}>{t('admin.empty')}</TableCell></TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={`${r.kind}-${r.id}`} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{r.visitor_name}</Typography>
                    <Typography variant="caption" color="text.secondary">{r.kind === 'anonymous' ? t('admin.walkIn') : t('admin.registeredPass')}</Typography>
                  </TableCell>
                  <TableCell>{r.purpose}</TableCell>
                  <TableCell>
                    {r.resident_name ? `${r.resident_name}${r.resident_flat ? ` (${r.resident_flat})` : ''}` : t('common.dash')}
                  </TableCell>
                  <TableCell><Chip size="small" label={t(`common.status.${r.status}`, statusLabel(r.status))} color={statusColor(r.status)} /></TableCell>
                  <TableCell align="center">
                    {r.visitor_count > 1
                      ? `${r.entered_count}/${r.visitor_count}${r.exited_count > 0 ? ` ${t('admin.table.outSuffix', { count: r.exited_count })}` : ''}`
                      : t('common.dash')}
                  </TableCell>
                  <TableCell>{fmtDateTime(r.entry_time)}</TableCell>
                  <TableCell>{fmtDateTime(r.exit_time)}</TableCell>
                  <TableCell align="center">
                    {r.has_photo ? <PhotoCameraIcon fontSize="small" color="success" /> : t('common.dash')}
                  </TableCell>
                  <TableCell align="center">
                    {r.aadhaar_provided
                      ? <AssignmentIndIcon fontSize="small" color="action" titleAccess={t('admin.aadhaarTooltip')} />
                      : t('common.dash')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Alert severity="info" sx={{ mt: 3 }}>
        {t('admin.aadhaarNotice')}
      </Alert>
    </Container>
  );
}

export default VisitorAdminApp;
