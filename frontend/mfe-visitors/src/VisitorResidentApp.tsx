import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, Container, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, IconButton, Paper, Stack, TextField, ToggleButton,
  ToggleButtonGroup, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import EditIcon from '@mui/icons-material/Edit';
import FavoriteIcon from '@mui/icons-material/Favorite';
import GroupIcon from '@mui/icons-material/Group';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import ShareIcon from '@mui/icons-material/Share';
import UpdateIcon from '@mui/icons-material/Update';
import { PhoneInputField } from './components/PhoneInputField';
import { apiBase, apiFetch, apiFetchBlob } from './api';
import { AnonymousVisitor, fmtDateTime, statusColor, statusLabel, VisitorPass } from './types';

// Broad E.164 sanity check (7-15 digits after '+', no leading 0) — PhoneInputField
// already caps digit count per-country and only emits this shape, so this mainly
// catches an incomplete number (fewer digits than the country expects) being submitted.
function isValidE164(v: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(v);
}

interface FormState {
  visitor_name: string;
  purpose: string;
  valid_from: string;
  valid_to: string;
  contact: string;
  aadhaar: string;
  email: string;
  address: string;
  visitor_count: string;
  additional_visitor_names: string;
  vehicle_number: string;
  visitor_category: 'family' | 'other';
}

const EMPTY_FORM: FormState = {
  visitor_name: '', purpose: '', valid_from: '', valid_to: '',
  contact: '', aadhaar: '', email: '', address: '',
  visitor_count: '1', additional_visitor_names: '', vehicle_number: '', visitor_category: 'other',
};

const PURPOSE_OPTIONS = [
  'Delivery',
  'Guest Visit',
  'Cab / Driver',
  'Domestic Help',
  'Maintenance / Repair Work',
  'Interview',
  'Function / Event',
  'Courier',
  'Vendor',
];

function toIsoOrNull(local: string): string | null {
  return local ? new Date(local).toISOString() : null;
}

// ── Create pass dialog ────────────────────────────────────────────────────────

function CreatePassDialog({ token, onClose, onCreated }: { token: string; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSubmit() {
    if (!form.visitor_name.trim() || !form.purpose.trim() || !form.valid_from || !form.valid_to) {
      setError('Visitor name, purpose, and validity period are required.');
      return;
    }
    if (new Date(form.valid_to) <= new Date(form.valid_from)) {
      setError('"Valid To" must be after "Valid From".');
      return;
    }
    const visitorCount = parseInt(form.visitor_count, 10);
    if (!visitorCount || visitorCount < 1) {
      setError('Number of visitors must be at least 1.');
      return;
    }
    if (form.contact.trim() && !isValidE164(form.contact.trim())) {
      setError('Please enter a complete contact number.');
      return;
    }
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`${apiBase('visitors')}/passes`, token, {
        method: 'POST',
        body: JSON.stringify({
          visitor_name: form.visitor_name.trim(),
          purpose: form.purpose.trim(),
          valid_from: toIsoOrNull(form.valid_from),
          valid_to: toIsoOrNull(form.valid_to),
          contact: form.contact.trim() || null,
          aadhaar: form.aadhaar.trim() || null,
          email: form.email.trim() || null,
          address: form.address.trim() || null,
          visitor_count: visitorCount,
          additional_visitor_names: form.additional_visitor_names.trim() || null,
          vehicle_number: form.vehicle_number.trim() || null,
          visitor_category: form.visitor_category,
        }),
      });
      onCreated();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        Create Visitor Pass
        <IconButton size="small" onClick={onClose}><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
          <Box>
            <Typography variant="body2" fontWeight={600} mb={0.5}>Who is this pass for?</Typography>
            <ToggleButtonGroup
              exclusive fullWidth size="small" value={form.visitor_category}
              onChange={(_, v) => v && setForm((f) => ({ ...f, visitor_category: v }))}
            >
              <ToggleButton value="family"><FavoriteIcon fontSize="small" sx={{ mr: 1 }} /> Family Member</ToggleButton>
              <ToggleButton value="other"><GroupIcon fontSize="small" sx={{ mr: 1 }} /> Guest / Other</ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary">
              Just changes the look of the pass — family gets a warm welcome theme, others get a standard access-pass theme.
            </Typography>
          </Box>
          <TextField label="Visitor Name" required fullWidth size="small" value={form.visitor_name} onChange={set('visitor_name')} helperText="Group lead / primary contact if this pass covers more than one person" />
          <Autocomplete
            freeSolo
            options={PURPOSE_OPTIONS}
            inputValue={form.purpose}
            onInputChange={(_, newValue) => setForm((f) => ({ ...f, purpose: newValue }))}
            renderInput={(params) => (
              <TextField {...params} label="Purpose of Visit" required fullWidth size="small" />
            )}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Valid From" type="datetime-local" required fullWidth size="small"
              value={form.valid_from} onChange={set('valid_from')} InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="Valid To" type="datetime-local" required fullWidth size="small"
              value={form.valid_to} onChange={set('valid_to')} InputLabelProps={{ shrink: true }}
            />
          </Stack>
          <TextField
            label="Number of Visitors" type="number" required size="small"
            inputProps={{ min: 1, max: 200 }}
            value={form.visitor_count} onChange={set('visitor_count')}
            helperText="More than 1 for a family/group visiting on the same pass — security can let them in together or in batches."
            sx={{ maxWidth: 220 }}
          />
          {parseInt(form.visitor_count, 10) > 1 && (
            <TextField
              label="Additional Visitor Names (optional)" fullWidth size="small" multiline minRows={2}
              value={form.additional_visitor_names} onChange={set('additional_visitor_names')}
              placeholder="e.g. Ravi, Sita, Meena…"
            />
          )}
          <PhoneInputField
            label="Contact Number (optional)" size="small"
            value={form.contact} onChange={(e164) => setForm((f) => ({ ...f, contact: e164 }))}
          />
          <TextField label="Email (optional)" fullWidth size="small" value={form.email} onChange={set('email')} />
          <TextField label="Aadhaar Number (optional)" fullWidth size="small" value={form.aadhaar} onChange={set('aadhaar')} />
          <TextField label="Address (optional)" fullWidth size="small" multiline minRows={2} value={form.address} onChange={set('address')} />
          <TextField
            label="Vehicle Number (optional)" fullWidth size="small" value={form.vehicle_number} onChange={set('vehicle_number')}
            helperText="If the guest is coming by car/bike — security can also add or correct this at the gate"
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving}>
          {saving ? <CircularProgress size={18} color="inherit" /> : 'Create Pass'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Pass detail dialog (preview / download / share / extend / edit / delete / phone-verify) ──

interface EditFormState {
  visitor_name: string;
  purpose: string;
  contact: string;
  aadhaar: string;
  email: string;
  address: string;
  visitor_count: string;
  additional_visitor_names: string;
  vehicle_number: string;
  visitor_category: 'family' | 'other';
}

function toEditForm(pass: VisitorPass): EditFormState {
  return {
    visitor_name: pass.visitor_name,
    purpose: pass.purpose,
    contact: pass.contact ?? '',
    aadhaar: pass.aadhaar ?? '',
    email: pass.email ?? '',
    address: pass.address ?? '',
    visitor_count: String(pass.visitor_count),
    additional_visitor_names: pass.additional_visitor_names ?? '',
    vehicle_number: pass.vehicle_number ?? '',
    visitor_category: pass.visitor_category === 'family' ? 'family' : 'other',
  };
}

const _NON_EDITABLE_STATUSES = new Set(['cancelled', 'expired', 'exited']);

function PassDetailDialog({
  pass, token, onClose, onChanged,
}: {
  pass: VisitorPass; token: string; onClose: () => void; onChanged: () => void;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [extendOpen, setExtendOpen] = useState(false);
  const [newValidTo, setNewValidTo] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<EditFormState>(() => toEditForm(pass));
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let revoke: string | null = null;
    apiFetchBlob(`${apiBase('visitors')}/passes/${pass.id}/pass-image.png`, token)
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        revoke = url;
        setImageUrl(url);
      })
      .catch((e) => setImageError((e as Error).message));
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [pass.id, token]);

  async function handleDownload() {
    if (!imageUrl) return;
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = `visitor-pass-${pass.visitor_name.replace(/\s+/g, '-')}.png`;
    a.click();
  }

  async function handleShare() {
    if (!imageUrl) return;
    try {
      const blob = await (await fetch(imageUrl)).blob();
      const file = new File([blob], 'visitor-pass.png', { type: 'image/png' });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Visitor Pass' });
      } else {
        handleDownload();
      }
    } catch {
      // user cancelled the share sheet — not an error
    }
  }

  async function handleExtend() {
    if (!newValidTo) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`${apiBase('visitors')}/passes/${pass.id}/extend`, token, {
        method: 'PATCH',
        body: JSON.stringify({ valid_to: toIsoOrNull(newValidTo) }),
      });
      setNotice('Validity extended.');
      setExtendOpen(false);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function openEdit() {
    setEditForm(toEditForm(pass));
    setExtendOpen(false);
    setEditOpen(true);
  }

  async function handleEditSave() {
    if (!editForm.visitor_name.trim() || !editForm.purpose.trim()) {
      setError('Visitor name and purpose cannot be empty.');
      return;
    }
    const visitorCount = parseInt(editForm.visitor_count, 10);
    if (!visitorCount || visitorCount < 1) {
      setError('Number of visitors must be at least 1.');
      return;
    }
    if (visitorCount < pass.entered_count) {
      setError(`Number of visitors can't be less than the ${pass.entered_count} already entered.`);
      return;
    }
    if (editForm.contact.trim() && !isValidE164(editForm.contact.trim())) {
      setError('Please enter a complete contact number.');
      return;
    }
    if (editForm.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editForm.email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`${apiBase('visitors')}/passes/${pass.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({
          visitor_name: editForm.visitor_name.trim(),
          purpose: editForm.purpose.trim(),
          contact: editForm.contact.trim() || null,
          aadhaar: editForm.aadhaar.trim() || null,
          email: editForm.email.trim() || null,
          address: editForm.address.trim() || null,
          visitor_count: visitorCount,
          additional_visitor_names: editForm.additional_visitor_names.trim() || null,
          vehicle_number: editForm.vehicle_number.trim() || null,
          visitor_category: editForm.visitor_category,
        }),
      });
      setNotice('Visitor pass updated — security has been notified.');
      setEditOpen(false);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await apiFetch(`${apiBase('visitors')}/passes/${pass.id}`, token, { method: 'DELETE' });
      onChanged();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setDeleting(false);
    }
  }

  async function handlePhoneVerify() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ ok: boolean; sent_via?: string }>(
        `${apiBase('visitors')}/passes/${pass.id}/phone-verify/request`, token, { method: 'POST' },
      );
      setNotice(res.ok ? `Verification code sent${res.sent_via ? ` via ${res.sent_via}` : ''}.` : 'Could not send verification code.');
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canExtend = pass.is_own_pass && (pass.status === 'pending' || pass.status === 'entered');
  const canEdit = pass.is_own_pass && !_NON_EDITABLE_STATUSES.has(pass.status);
  const canDelete = pass.is_own_pass && pass.status === 'pending';
  const setEditField = (k: keyof EditFormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setEditForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {pass.visitor_name}
        <IconButton size="small" onClick={onClose}><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent sx={{ textAlign: 'center' }}>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
        {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}

        {imageError && <Alert severity="error">{imageError}</Alert>}
        {!imageUrl && !imageError && <CircularProgress sx={{ my: 4 }} />}
        {imageUrl && (
          <Box
            component="img"
            src={imageUrl}
            alt="Visitor pass"
            sx={{ width: '100%', borderRadius: 1, border: '1px solid', borderColor: 'divider', mb: 2 }}
          />
        )}

        <Stack direction="row" spacing={1} justifyContent="center" sx={{ mb: 2 }}>
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={handleDownload} disabled={!imageUrl}>
            Download
          </Button>
          <Button size="small" variant="outlined" startIcon={<ShareIcon />} onClick={handleShare} disabled={!imageUrl}>
            Share
          </Button>
        </Stack>

        <Divider sx={{ my: 2 }} />

        <Stack spacing={1} sx={{ textAlign: 'left', mb: 2 }}>
          {!pass.is_own_pass && (
            <Typography variant="body2"><strong>Created by:</strong> {pass.resident_name}</Typography>
          )}
          <Typography variant="body2">
            <strong>Status:</strong> <Chip size="small" label={statusLabel(pass.status)} color={statusColor(pass.status)} />{' '}
            <Chip size="small" variant="outlined" label={pass.visitor_category === 'family' ? 'Family' : 'Guest'} />
          </Typography>
          <Typography variant="body2"><strong>Valid:</strong> {fmtDateTime(pass.valid_from)} → {fmtDateTime(pass.valid_to)}</Typography>
          {pass.visitor_count > 1 && (
            <Typography variant="body2">
              <strong>Group:</strong> {pass.entered_count}/{pass.visitor_count} entered
              {pass.exited_count > 0 ? `, ${pass.exited_count} exited` : ''}
            </Typography>
          )}
          {pass.additional_visitor_names && (
            <Typography variant="body2"><strong>Also with:</strong> {pass.additional_visitor_names}</Typography>
          )}
          {pass.vehicle_number && (
            <Typography variant="body2"><strong>Vehicle:</strong> {pass.vehicle_number}</Typography>
          )}
          {pass.log?.entry_time && <Typography variant="body2"><strong>Entered:</strong> {fmtDateTime(pass.log.entry_time)}</Typography>}
          {pass.log?.exit_time && <Typography variant="body2"><strong>Exited:</strong> {fmtDateTime(pass.log.exit_time)}</Typography>}
          {pass.phone_verification && (
            <Typography variant="body2">
              <strong>Phone verification:</strong> {pass.phone_verification.verification_status}
            </Typography>
          )}
          {pass.photos.length > 0 && (
            <>
              <Typography variant="body2" fontWeight={600}>Photos ({pass.photos.length})</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap">
                {pass.photos.map((p) => (
                  <Box
                    key={p.id}
                    component="img"
                    src={`${apiBase('visitors')}/uploads/${p.file_path}`}
                    sx={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}
                  />
                ))}
              </Stack>
            </>
          )}
        </Stack>

        <Stack direction="row" spacing={1} justifyContent="center" flexWrap="wrap" useFlexGap>
          {canExtend && (
            <Button size="small" startIcon={<UpdateIcon />} onClick={() => { setExtendOpen(true); setEditOpen(false); }}>
              Extend Validity
            </Button>
          )}
          {canEdit && (
            <Button size="small" startIcon={<EditIcon />} onClick={openEdit}>
              Edit
            </Button>
          )}
          {pass.is_own_pass && pass.contact && !pass.phone_verification && (
            <Button size="small" startIcon={<PhoneAndroidIcon />} disabled={busy} onClick={() => void handlePhoneVerify()}>
              Verify Phone
            </Button>
          )}
          {canDelete && (
            <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={() => setDeleteConfirmOpen(true)}>
              Delete
            </Button>
          )}
        </Stack>

        {extendOpen && (
          <Stack spacing={1} sx={{ mt: 2 }}>
            <TextField
              label="New Valid To" type="datetime-local" size="small"
              value={newValidTo} onChange={(e) => setNewValidTo(e.target.value)} InputLabelProps={{ shrink: true }}
            />
            <Button variant="contained" size="small" disabled={busy || !newValidTo} onClick={() => void handleExtend()}>
              {busy ? <CircularProgress size={16} color="inherit" /> : 'Confirm Extension'}
            </Button>
          </Stack>
        )}

        {editOpen && (
          <Stack spacing={1.5} sx={{ mt: 2, textAlign: 'left' }}>
            <ToggleButtonGroup
              exclusive fullWidth size="small" value={editForm.visitor_category}
              onChange={(_, v) => v && setEditForm((f) => ({ ...f, visitor_category: v }))}
            >
              <ToggleButton value="family"><FavoriteIcon fontSize="small" sx={{ mr: 1 }} /> Family Member</ToggleButton>
              <ToggleButton value="other"><GroupIcon fontSize="small" sx={{ mr: 1 }} /> Guest / Other</ToggleButton>
            </ToggleButtonGroup>
            <TextField label="Visitor Name" size="small" value={editForm.visitor_name} onChange={setEditField('visitor_name')} />
            <TextField label="Purpose" size="small" value={editForm.purpose} onChange={setEditField('purpose')} />
            <TextField
              label="Number of Visitors" type="number" size="small"
              inputProps={{ min: pass.entered_count || 1, max: 200 }}
              value={editForm.visitor_count} onChange={setEditField('visitor_count')}
              helperText={pass.entered_count > 0 ? `Raise this to let more people in — ${pass.entered_count} already entered` : undefined}
              sx={{ maxWidth: 260 }}
            />
            <TextField label="Additional Visitor Names" size="small" multiline minRows={2} value={editForm.additional_visitor_names} onChange={setEditField('additional_visitor_names')} />
            <PhoneInputField
              label="Contact Number" size="small"
              value={editForm.contact} onChange={(e164) => setEditForm((f) => ({ ...f, contact: e164 }))}
            />
            <TextField label="Email" size="small" value={editForm.email} onChange={setEditField('email')} />
            <TextField label="Aadhaar Number" size="small" value={editForm.aadhaar} onChange={setEditField('aadhaar')} />
            <TextField label="Address" size="small" multiline minRows={2} value={editForm.address} onChange={setEditField('address')} />
            <TextField label="Vehicle Number" size="small" value={editForm.vehicle_number} onChange={setEditField('vehicle_number')} />
            <Stack direction="row" spacing={1}>
              <Button size="small" onClick={() => setEditOpen(false)} disabled={busy}>Cancel</Button>
              <Button variant="contained" size="small" disabled={busy} onClick={() => void handleEditSave()}>
                {busy ? <CircularProgress size={16} color="inherit" /> : 'Save Changes'}
              </Button>
            </Stack>
          </Stack>
        )}
      </DialogContent>

      <Dialog open={deleteConfirmOpen} onClose={() => !deleting && setDeleteConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Visitor Pass</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Delete the pass for "{pass.visitor_name}"? This cannot be undone, and security will be notified.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setDeleteConfirmOpen(false)} disabled={deleting}>Keep Pass</Button>
          <Button variant="contained" color="error" disabled={deleting} onClick={() => void handleDelete()}>
            {deleting ? <CircularProgress size={18} color="inherit" /> : 'Delete Pass'}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}

// ── Pass list card ────────────────────────────────────────────────────────────

function PassCard({ pass, onClick }: { pass: VisitorPass; onClick: () => void }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, cursor: 'pointer' }} onClick={onClick}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography fontWeight={700} noWrap sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            {pass.visitor_category === 'family' && <FavoriteIcon fontSize="inherit" color="error" />}
            {pass.visitor_name}{pass.visitor_count > 1 ? ` +${pass.visitor_count - 1}` : ''}
          </Typography>
          <Typography variant="body2" color="text.secondary" noWrap>
            {pass.purpose}{pass.vehicle_number ? ` · ${pass.vehicle_number}` : ''}
            {!pass.is_own_pass ? ` · by ${pass.resident_name}` : ''}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {fmtDateTime(pass.valid_from)} → {fmtDateTime(pass.valid_to)}
            {pass.visitor_count > 1 ? ` · ${pass.entered_count}/${pass.visitor_count} entered` : ''}
          </Typography>
          {(pass.log?.entry_time || pass.log?.exit_time) && (
            <Typography variant="caption" display="block" color="success.main" fontWeight={600}>
              {pass.log?.entry_time && `Arrived ${fmtDateTime(pass.log.entry_time)}`}
              {pass.log?.exit_time && ` · Left ${fmtDateTime(pass.log.exit_time)}`}
            </Typography>
          )}
        </Box>
        <Chip size="small" label={statusLabel(pass.status)} color={statusColor(pass.status)} />
      </Box>
    </Paper>
  );
}

// ── Walk-in visitors (no QR pass, logged by security at the gate) ────────────

function AnonymousCard({ visitor, onClick }: { visitor: AnonymousVisitor; onClick: () => void }) {
  const status = visitor.exit_time ? 'exited' : 'entered';
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, cursor: 'pointer' }} onClick={onClick}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography fontWeight={700} noWrap>{visitor.visitor_name || visitor.purpose}</Typography>
          <Typography variant="body2" color="text.secondary" noWrap>
            {visitor.visitor_name ? visitor.purpose : 'Walk-in visitor (no QR pass)'}
            {visitor.vehicle_number ? ` · ${visitor.vehicle_number}` : ''}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Arrived {fmtDateTime(visitor.entry_time)}
            {visitor.exit_time ? ` · Left ${fmtDateTime(visitor.exit_time)}` : ''}
          </Typography>
        </Box>
        <Chip size="small" label={statusLabel(status)} color={statusColor(status)} />
      </Box>
    </Paper>
  );
}

function AnonymousDetailDialog({ visitor, onClose }: { visitor: AnonymousVisitor; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {visitor.visitor_name || 'Walk-in Visitor'}
        <IconButton size="small" onClick={onClose}><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1} sx={{ textAlign: 'left' }}>
          <Typography variant="body2"><strong>Purpose:</strong> {visitor.purpose}</Typography>
          <Typography variant="body2">
            <strong>Logged at gate:</strong> {fmtDateTime(visitor.entry_time)}
            {visitor.entry_security_name ? ` by ${visitor.entry_security_name}` : ''}
          </Typography>
          {visitor.exit_time && (
            <Typography variant="body2">
              <strong>Left:</strong> {fmtDateTime(visitor.exit_time)}
              {visitor.exit_security_name ? ` (${visitor.exit_security_name})` : ''}
            </Typography>
          )}
          {visitor.contact && <Typography variant="body2"><strong>Contact:</strong> {visitor.contact}</Typography>}
          {visitor.vehicle_number && <Typography variant="body2"><strong>Vehicle:</strong> {visitor.vehicle_number}</Typography>}
          {visitor.address && <Typography variant="body2"><strong>Address:</strong> {visitor.address}</Typography>}
          {visitor.notes && <Typography variant="body2"><strong>Notes:</strong> {visitor.notes}</Typography>}
          {visitor.photos.length > 0 && (
            <>
              <Typography variant="body2" fontWeight={600}>Photos ({visitor.photos.length})</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap">
                {visitor.photos.map((p) => (
                  <Box
                    key={p.id}
                    component="img"
                    src={`${apiBase('visitors')}/uploads/${p.file_path}`}
                    sx={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}
                  />
                ))}
              </Stack>
            </>
          )}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface VisitorResidentAppProps {
  token?: string | null;
}

export function VisitorResidentApp({ token }: VisitorResidentAppProps) {
  const [passes, setPasses] = useState<VisitorPass[]>([]);
  const [anonymousVisitors, setAnonymousVisitors] = useState<AnonymousVisitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<VisitorPass | null>(null);
  const [selectedAnon, setSelectedAnon] = useState<AnonymousVisitor | null>(null);

  const load = useCallback(() => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    Promise.all([
      apiFetch<VisitorPass[]>(`${apiBase('visitors')}/passes/my`, token),
      apiFetch<AnonymousVisitor[]>(`${apiBase('visitors')}/gate/anonymous/my`, token),
    ])
      .then(([passData, anonData]) => { setPasses(passData); setAnonymousVisitors(anonData); setLoading(false); })
      .catch((e) => { setError((e as Error).message); setLoading(false); });
  }, [token]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (selected) {
      const fresh = passes.find((p) => p.id === selected.id);
      if (fresh) setSelected(fresh);
    }
  }, [passes]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!token) {
    return (
      <Container maxWidth="sm" sx={{ pt: 8, textAlign: 'center' }}>
        <Typography variant="h6" color="text.secondary" mb={2}>Please log in to manage visitor passes.</Typography>
        <Button variant="contained" onClick={() => { window.location.href = '/'; }}>Go to Login</Button>
      </Container>
    );
  }

  const _PAST_STATUSES = new Set(['exited', 'cancelled', 'expired']);
  const active = passes.filter((p) => !_PAST_STATUSES.has(p.status));
  const past = passes.filter((p) => _PAST_STATUSES.has(p.status));

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
        <Box>
          <Typography variant="h5" fontWeight={800}>Visitor Passes</Typography>
          <Typography variant="body2" color="text.secondary">
            Create QR passes for your guests and track entry — includes passes anyone in your household created.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
          New Pass
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}><CircularProgress /></Box>
      )}

      {!loading && passes.length === 0 && anonymousVisitors.length === 0 && (
        <Box textAlign="center" py={8} color="text.secondary">
          <Typography>No visitor passes yet. Create one for your next guest.</Typography>
        </Box>
      )}

      {!loading && (passes.length > 0 || anonymousVisitors.length > 0) && (
        <Stack spacing={3}>
          {active.length > 0 && (
            <Box>
              <Typography variant="subtitle2" fontWeight={700} mb={1.5}>Active ({active.length})</Typography>
              <Stack spacing={1.5}>
                {active.map((p) => <PassCard key={p.id} pass={p} onClick={() => setSelected(p)} />)}
              </Stack>
            </Box>
          )}
          {anonymousVisitors.length > 0 && (
            <Box>
              <Typography variant="subtitle2" fontWeight={700} mb={0.5}>Walk-in Visitors ({anonymousVisitors.length})</Typography>
              <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
                Logged directly by security at the gate — no QR pass was created for these (e.g. deliveries, couriers, emergencies).
              </Typography>
              <Stack spacing={1.5}>
                {anonymousVisitors.map((v) => <AnonymousCard key={v.id} visitor={v} onClick={() => setSelectedAnon(v)} />)}
              </Stack>
            </Box>
          )}
          {past.length > 0 && (
            <Box>
              <Typography variant="subtitle2" color="text.secondary" fontWeight={700} mb={1.5}>History ({past.length})</Typography>
              <Stack spacing={1.5}>
                {past.map((p) => <PassCard key={p.id} pass={p} onClick={() => setSelected(p)} />)}
              </Stack>
            </Box>
          )}
        </Stack>
      )}

      {createOpen && <CreatePassDialog token={token} onClose={() => setCreateOpen(false)} onCreated={load} />}
      {selected && (
        <PassDetailDialog pass={selected} token={token} onClose={() => setSelected(null)} onChanged={load} />
      )}
      {selectedAnon && (
        <AnonymousDetailDialog visitor={selectedAnon} onClose={() => setSelectedAnon(null)} />
      )}
    </Container>
  );
}

export default VisitorResidentApp;
