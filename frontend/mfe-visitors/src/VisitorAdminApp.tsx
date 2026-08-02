import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Container, MenuItem, Paper,
  Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
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
        <Alert severity="warning">You must be logged in to view the visitor ledger.</Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight={800}>Visitor Ledger</Typography>
        <Typography variant="body2" color="text.secondary">
          All visitor passes and anonymous entries, with photos and Aadhaar/identity status.
        </Typography>
      </Box>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 3 }}>
        <Stack direction="row" spacing={1} alignItems="center" mb={1.5}>
          <FilterListIcon fontSize="small" color="action" />
          <Typography variant="subtitle2" fontWeight={700}>Filters</Typography>
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} flexWrap="wrap" useFlexGap>
          <TextField
            label="From" type="date" size="small" InputLabelProps={{ shrink: true }}
            value={filters.from_date} onChange={(e) => setFilters((f) => ({ ...f, from_date: e.target.value }))}
          />
          <TextField
            label="To" type="date" size="small" InputLabelProps={{ shrink: true }}
            value={filters.to_date} onChange={(e) => setFilters((f) => ({ ...f, to_date: e.target.value }))}
          />
          <TextField
            label="Purpose contains" size="small"
            value={filters.purpose} onChange={(e) => setFilters((f) => ({ ...f, purpose: e.target.value }))}
          />
          <TextField
            label="Status" size="small" select sx={{ minWidth: 140 }}
            value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="pending">Pending</MenuItem>
            <MenuItem value="partially_entered">Partially entered</MenuItem>
            <MenuItem value="entered">Entered</MenuItem>
            <MenuItem value="partially_exited">Partially exited</MenuItem>
            <MenuItem value="exited">Exited</MenuItem>
            <MenuItem value="cancelled">Cancelled</MenuItem>
            <MenuItem value="expired">Expired</MenuItem>
          </TextField>
          <Button variant="outlined" size="small" onClick={() => setFilters(EMPTY_FILTERS)}>Clear</Button>
        </Stack>
      </Paper>

      <Stack direction="row" spacing={1} justifyContent="flex-end" mb={2}>
        <Button size="small" startIcon={<GridOnIcon />} disabled={exporting !== null} onClick={() => void handleExport('xlsx')}>
          {exporting === 'xlsx' ? <CircularProgress size={16} /> : 'Export Excel'}
        </Button>
        <Button size="small" startIcon={<DescriptionIcon />} disabled={exporting !== null} onClick={() => void handleExport('pdf')}>
          {exporting === 'pdf' ? <CircularProgress size={16} /> : 'Export PDF'}
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
                <TableCell>Visitor</TableCell>
                <TableCell>Purpose</TableCell>
                <TableCell>Resident</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="center">Visitors</TableCell>
                <TableCell>Entry</TableCell>
                <TableCell>Exit</TableCell>
                <TableCell align="center">Photo</TableCell>
                <TableCell align="center">Aadhaar</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={9} align="center" sx={{ py: 4, color: 'text.secondary' }}>No visitor records match these filters.</TableCell></TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={`${r.kind}-${r.id}`} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{r.visitor_name}</Typography>
                    <Typography variant="caption" color="text.secondary">{r.kind === 'anonymous' ? 'Walk-in' : 'Registered pass'}</Typography>
                  </TableCell>
                  <TableCell>{r.purpose}</TableCell>
                  <TableCell>
                    {r.resident_name ? `${r.resident_name}${r.resident_flat ? ` (${r.resident_flat})` : ''}` : '—'}
                  </TableCell>
                  <TableCell><Chip size="small" label={statusLabel(r.status)} color={statusColor(r.status)} /></TableCell>
                  <TableCell align="center">
                    {r.visitor_count > 1
                      ? `${r.entered_count}/${r.visitor_count}${r.exited_count > 0 ? ` (${r.exited_count} out)` : ''}`
                      : '—'}
                  </TableCell>
                  <TableCell>{fmtDateTime(r.entry_time)}</TableCell>
                  <TableCell>{fmtDateTime(r.exit_time)}</TableCell>
                  <TableCell align="center">
                    {r.has_photo ? <PhotoCameraIcon fontSize="small" color="success" /> : '—'}
                  </TableCell>
                  <TableCell align="center">
                    {r.aadhaar_provided
                      ? <AssignmentIndIcon fontSize="small" color="action" titleAccess="Aadhaar provided (verification not implemented)" />
                      : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Alert severity="info" sx={{ mt: 3 }}>
        Aadhaar verification is a future integration — the Aadhaar column only shows whether a number
        was captured on the pass, not whether it has been verified against any government API.
      </Alert>
    </Container>
  );
}

export default VisitorAdminApp;
