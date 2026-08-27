import './i18n';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, Container, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, IconButton, Paper, Stack, TextField, ToggleButton,
  ToggleButtonGroup, Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
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

function toIsoOrNull(local: string): string | null {
  return local ? new Date(local).toISOString() : null;
}

// ── Create pass dialog ────────────────────────────────────────────────────────

function CreatePassDialog({ token, onClose, onCreated }: { token: string; onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation('visitors');
  const purposeOptions = t('resident.purposeOptions', { returnObjects: true }) as string[];
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSubmit() {
    if (!form.visitor_name.trim() || !form.purpose.trim() || !form.valid_from || !form.valid_to) {
      setError(t('resident.validation.requiredFields'));
      return;
    }
    if (new Date(form.valid_to) <= new Date(form.valid_from)) {
      setError(t('resident.validation.validToAfterFrom'));
      return;
    }
    const visitorCount = parseInt(form.visitor_count, 10);
    if (!visitorCount || visitorCount < 1) {
      setError(t('resident.validation.minVisitors'));
      return;
    }
    if (form.contact.trim() && !isValidE164(form.contact.trim())) {
      setError(t('resident.validation.invalidPhone'));
      return;
    }
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError(t('resident.validation.invalidEmail'));
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
        {t('resident.createDialog.title')}
        <IconButton size="small" onClick={onClose}><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
          <Box>
            <Typography variant="body2" fontWeight={600} mb={0.5}>{t('resident.createDialog.categoryQuestion')}</Typography>
            <ToggleButtonGroup
              exclusive fullWidth size="small" value={form.visitor_category}
              onChange={(_, v) => v && setForm((f) => ({ ...f, visitor_category: v }))}
            >
              <ToggleButton value="family"><FavoriteIcon fontSize="small" sx={{ mr: 1 }} /> {t('resident.createDialog.categoryFamily')}</ToggleButton>
              <ToggleButton value="other"><GroupIcon fontSize="small" sx={{ mr: 1 }} /> {t('resident.createDialog.categoryOther')}</ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary">
              {t('resident.createDialog.categoryHint')}
            </Typography>
          </Box>
          <TextField label={t('resident.createDialog.nameLabel')} required fullWidth size="small" value={form.visitor_name} onChange={set('visitor_name')} helperText={t('resident.createDialog.nameHelper')} />
          <Autocomplete
            freeSolo
            options={purposeOptions}
            inputValue={form.purpose}
            onInputChange={(_, newValue) => setForm((f) => ({ ...f, purpose: newValue }))}
            renderInput={(params) => (
              <TextField {...params} label={t('resident.createDialog.purposeLabel')} required fullWidth size="small" />
            )}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label={t('resident.createDialog.validFromLabel')} type="datetime-local" required fullWidth size="small"
              value={form.valid_from} onChange={set('valid_from')} InputLabelProps={{ shrink: true }}
            />
            <TextField
              label={t('resident.createDialog.validToLabel')} type="datetime-local" required fullWidth size="small"
              value={form.valid_to} onChange={set('valid_to')} InputLabelProps={{ shrink: true }}
            />
          </Stack>
          <TextField
            label={t('resident.createDialog.countLabel')} type="number" required size="small"
            inputProps={{ min: 1, max: 200 }}
            value={form.visitor_count} onChange={set('visitor_count')}
            helperText={t('resident.createDialog.countHelper')}
            sx={{ maxWidth: 220 }}
          />
          {parseInt(form.visitor_count, 10) > 1 && (
            <TextField
              label={t('resident.createDialog.additionalNamesLabel')} fullWidth size="small" multiline minRows={2}
              value={form.additional_visitor_names} onChange={set('additional_visitor_names')}
              placeholder={t('resident.createDialog.additionalNamesPlaceholder')}
            />
          )}
          <PhoneInputField
            label={t('resident.createDialog.contactLabel')} size="small"
            value={form.contact} onChange={(e164) => setForm((f) => ({ ...f, contact: e164 }))}
          />
          <TextField label={t('resident.createDialog.emailLabel')} fullWidth size="small" value={form.email} onChange={set('email')} />
          <TextField label={t('resident.createDialog.aadhaarLabel')} fullWidth size="small" value={form.aadhaar} onChange={set('aadhaar')} />
          <TextField label={t('resident.createDialog.addressLabel')} fullWidth size="small" multiline minRows={2} value={form.address} onChange={set('address')} />
          <TextField
            label={t('resident.createDialog.vehicleLabel')} fullWidth size="small" value={form.vehicle_number} onChange={set('vehicle_number')}
            helperText={t('resident.createDialog.vehicleHelper')}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving}>
          {saving ? <CircularProgress size={18} color="inherit" /> : t('resident.createDialog.submit')}
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
  const { t } = useTranslation('visitors');
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
      setNotice(t('resident.detailDialog.validityExtended'));
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
      setError(t('resident.validation.nameAndPurposeRequired'));
      return;
    }
    const visitorCount = parseInt(editForm.visitor_count, 10);
    if (!visitorCount || visitorCount < 1) {
      setError(t('resident.validation.minVisitors'));
      return;
    }
    if (visitorCount < pass.entered_count) {
      setError(t('resident.validation.cantReduceBelowEntered', { count: pass.entered_count }));
      return;
    }
    if (editForm.contact.trim() && !isValidE164(editForm.contact.trim())) {
      setError(t('resident.validation.invalidPhone'));
      return;
    }
    if (editForm.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editForm.email.trim())) {
      setError(t('resident.validation.invalidEmail'));
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
      setNotice(t('resident.detailDialog.updated'));
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
      setNotice(res.ok
        ? t('resident.detailDialog.verificationSent', { via: res.sent_via ? t('resident.detailDialog.verificationSentVia', { via: res.sent_via }) : '' })
        : t('resident.detailDialog.verificationFailed'));
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
            alt={t('resident.detailDialog.downloadAlt')}
            sx={{ width: '100%', borderRadius: 1, border: '1px solid', borderColor: 'divider', mb: 2 }}
          />
        )}

        <Stack direction="row" spacing={1} justifyContent="center" sx={{ mb: 2 }}>
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={handleDownload} disabled={!imageUrl}>
            {t('common.download')}
          </Button>
          <Button size="small" variant="outlined" startIcon={<ShareIcon />} onClick={handleShare} disabled={!imageUrl}>
            {t('common.share')}
          </Button>
        </Stack>

        <Divider sx={{ my: 2 }} />

        <Stack spacing={1} sx={{ textAlign: 'left', mb: 2 }}>
          {!pass.is_own_pass && (
            <Typography variant="body2"><strong>{t('resident.detailDialog.createdBy', { name: pass.resident_name })}</strong></Typography>
          )}
          <Typography variant="body2">
            <strong>{t('resident.detailDialog.status')}</strong>{' '}
            <Chip size="small" label={t(`common.status.${pass.status}`, statusLabel(pass.status))} color={statusColor(pass.status)} />{' '}
            <Chip size="small" variant="outlined" label={pass.visitor_category === 'family' ? t('resident.detailDialog.categoryFamily') : t('resident.detailDialog.categoryGuest')} />
          </Typography>
          <Typography variant="body2">
            <strong>{t('resident.detailDialog.valid', { from: fmtDateTime(pass.valid_from), to: fmtDateTime(pass.valid_to) })}</strong>
          </Typography>
          {pass.visitor_count > 1 && (
            <Typography variant="body2">
              <strong>
                {t('resident.detailDialog.group', { entered: pass.entered_count, count: pass.visitor_count })}
                {pass.exited_count > 0 ? t('resident.detailDialog.groupExited', { count: pass.exited_count }) : ''}
              </strong>
            </Typography>
          )}
          {pass.additional_visitor_names && (
            <Typography variant="body2"><strong>{t('resident.detailDialog.also', { names: pass.additional_visitor_names })}</strong></Typography>
          )}
          {pass.vehicle_number && (
            <Typography variant="body2"><strong>{t('resident.detailDialog.vehicle', { number: pass.vehicle_number })}</strong></Typography>
          )}
          {pass.log?.entry_time && <Typography variant="body2"><strong>{t('resident.detailDialog.entered', { time: fmtDateTime(pass.log.entry_time) })}</strong></Typography>}
          {pass.log?.exit_time && <Typography variant="body2"><strong>{t('resident.detailDialog.exited', { time: fmtDateTime(pass.log.exit_time) })}</strong></Typography>}
          {pass.phone_verification && (
            <Typography variant="body2">
              <strong>{t('resident.detailDialog.phoneVerification', { status: pass.phone_verification.verification_status })}</strong>
            </Typography>
          )}
          {pass.photos.length > 0 && (
            <>
              <Typography variant="body2" fontWeight={600}>{t('common.photosCount', { count: pass.photos.length })}</Typography>
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
              {t('resident.detailDialog.extendValidity')}
            </Button>
          )}
          {canEdit && (
            <Button size="small" startIcon={<EditIcon />} onClick={openEdit}>
              {t('common.edit')}
            </Button>
          )}
          {pass.is_own_pass && pass.contact && !pass.phone_verification && (
            <Button size="small" startIcon={<PhoneAndroidIcon />} disabled={busy} onClick={() => void handlePhoneVerify()}>
              {t('resident.detailDialog.verifyPhone')}
            </Button>
          )}
          {canDelete && (
            <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={() => setDeleteConfirmOpen(true)}>
              {t('common.delete')}
            </Button>
          )}
        </Stack>

        {extendOpen && (
          <Stack spacing={1} sx={{ mt: 2 }}>
            <TextField
              label={t('resident.detailDialog.newValidToLabel')} type="datetime-local" size="small"
              value={newValidTo} onChange={(e) => setNewValidTo(e.target.value)} InputLabelProps={{ shrink: true }}
            />
            <Button variant="contained" size="small" disabled={busy || !newValidTo} onClick={() => void handleExtend()}>
              {busy ? <CircularProgress size={16} color="inherit" /> : t('resident.detailDialog.confirmExtension')}
            </Button>
          </Stack>
        )}

        {editOpen && (
          <Stack spacing={1.5} sx={{ mt: 2, textAlign: 'left' }}>
            <ToggleButtonGroup
              exclusive fullWidth size="small" value={editForm.visitor_category}
              onChange={(_, v) => v && setEditForm((f) => ({ ...f, visitor_category: v }))}
            >
              <ToggleButton value="family"><FavoriteIcon fontSize="small" sx={{ mr: 1 }} /> {t('resident.createDialog.categoryFamily')}</ToggleButton>
              <ToggleButton value="other"><GroupIcon fontSize="small" sx={{ mr: 1 }} /> {t('resident.createDialog.categoryOther')}</ToggleButton>
            </ToggleButtonGroup>
            <TextField label={t('resident.createDialog.nameLabel')} size="small" value={editForm.visitor_name} onChange={setEditField('visitor_name')} />
            <TextField label={t('resident.createDialog.purposeLabel')} size="small" value={editForm.purpose} onChange={setEditField('purpose')} />
            <TextField
              label={t('resident.createDialog.countLabel')} type="number" size="small"
              inputProps={{ min: pass.entered_count || 1, max: 200 }}
              value={editForm.visitor_count} onChange={setEditField('visitor_count')}
              helperText={pass.entered_count > 0 ? t('resident.detailDialog.editCountHelper', { count: pass.entered_count }) : undefined}
              sx={{ maxWidth: 260 }}
            />
            <TextField label={t('resident.createDialog.additionalNamesLabel')} size="small" multiline minRows={2} value={editForm.additional_visitor_names} onChange={setEditField('additional_visitor_names')} />
            <PhoneInputField
              label={t('resident.createDialog.contactLabel')} size="small"
              value={editForm.contact} onChange={(e164) => setEditForm((f) => ({ ...f, contact: e164 }))}
            />
            <TextField label={t('resident.createDialog.emailLabel')} size="small" value={editForm.email} onChange={setEditField('email')} />
            <TextField label={t('resident.createDialog.aadhaarLabel')} size="small" value={editForm.aadhaar} onChange={setEditField('aadhaar')} />
            <TextField label={t('resident.createDialog.addressLabel')} size="small" multiline minRows={2} value={editForm.address} onChange={setEditField('address')} />
            <TextField label={t('resident.createDialog.vehicleLabel')} size="small" value={editForm.vehicle_number} onChange={setEditField('vehicle_number')} />
            <Stack direction="row" spacing={1}>
              <Button size="small" onClick={() => setEditOpen(false)} disabled={busy}>{t('common.cancel')}</Button>
              <Button variant="contained" size="small" disabled={busy} onClick={() => void handleEditSave()}>
                {busy ? <CircularProgress size={16} color="inherit" /> : t('resident.detailDialog.saveChanges')}
              </Button>
            </Stack>
          </Stack>
        )}
      </DialogContent>

      <Dialog open={deleteConfirmOpen} onClose={() => !deleting && setDeleteConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('resident.detailDialog.deleteTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {t('resident.detailDialog.deleteBody', { name: pass.visitor_name })}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setDeleteConfirmOpen(false)} disabled={deleting}>{t('resident.detailDialog.keepPass')}</Button>
          <Button variant="contained" color="error" disabled={deleting} onClick={() => void handleDelete()}>
            {deleting ? <CircularProgress size={18} color="inherit" /> : t('resident.detailDialog.deletePass')}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}

// ── Pass list card ────────────────────────────────────────────────────────────

function PassCard({ pass, onClick }: { pass: VisitorPass; onClick: () => void }) {
  const { t } = useTranslation('visitors');
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
            {!pass.is_own_pass ? ` · ${t('resident.card.byResident', { name: pass.resident_name })}` : ''}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {fmtDateTime(pass.valid_from)} → {fmtDateTime(pass.valid_to)}
            {pass.visitor_count > 1 ? ` · ${pass.entered_count}/${pass.visitor_count} ${t('common.status.entered')}` : ''}
          </Typography>
          {(pass.log?.entry_time || pass.log?.exit_time) && (
            <Typography variant="caption" display="block" color="success.main" fontWeight={600}>
              {pass.log?.entry_time && t('resident.card.arrived', { time: fmtDateTime(pass.log.entry_time) })}
              {pass.log?.exit_time && ` ${t('resident.card.left', { time: fmtDateTime(pass.log.exit_time) })}`}
            </Typography>
          )}
        </Box>
        <Chip size="small" label={t(`common.status.${pass.status}`, statusLabel(pass.status))} color={statusColor(pass.status)} />
      </Box>
    </Paper>
  );
}

// ── Walk-in visitors (no QR pass, logged by security at the gate) ────────────

function AnonymousCard({ visitor, onClick }: { visitor: AnonymousVisitor; onClick: () => void }) {
  const { t } = useTranslation('visitors');
  const status = visitor.exit_time ? 'exited' : 'entered';
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, cursor: 'pointer' }} onClick={onClick}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography fontWeight={700} noWrap>{visitor.visitor_name || visitor.purpose}</Typography>
          <Typography variant="body2" color="text.secondary" noWrap>
            {visitor.visitor_name ? visitor.purpose : t('resident.anonymousCard.walkInFallback')}
            {visitor.vehicle_number ? ` · ${visitor.vehicle_number}` : ''}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('resident.card.arrived', { time: fmtDateTime(visitor.entry_time) })}
            {visitor.exit_time ? ` ${t('resident.card.left', { time: fmtDateTime(visitor.exit_time) })}` : ''}
          </Typography>
        </Box>
        <Chip size="small" label={t(`common.status.${status}`, statusLabel(status))} color={statusColor(status)} />
      </Box>
    </Paper>
  );
}

function AnonymousDetailDialog({ visitor, onClose }: { visitor: AnonymousVisitor; onClose: () => void }) {
  const { t } = useTranslation('visitors');
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {visitor.visitor_name || t('resident.anonymousDialog.titleFallback')}
        <IconButton size="small" onClick={onClose}><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1} sx={{ textAlign: 'left' }}>
          <Typography variant="body2"><strong>{t('resident.anonymousDialog.purpose', { purpose: visitor.purpose })}</strong></Typography>
          <Typography variant="body2">
            <strong>
              {t('resident.anonymousDialog.loggedAtGate', { time: fmtDateTime(visitor.entry_time) })}
              {visitor.entry_security_name ? t('resident.anonymousDialog.loggedBy', { name: visitor.entry_security_name }) : ''}
            </strong>
          </Typography>
          {visitor.exit_time && (
            <Typography variant="body2">
              <strong>
                {t('resident.anonymousDialog.left', { time: fmtDateTime(visitor.exit_time) })}
                {visitor.exit_security_name ? t('resident.anonymousDialog.leftBy', { name: visitor.exit_security_name }) : ''}
              </strong>
            </Typography>
          )}
          {visitor.contact && <Typography variant="body2"><strong>{t('resident.anonymousDialog.contact', { contact: visitor.contact })}</strong></Typography>}
          {visitor.vehicle_number && <Typography variant="body2"><strong>{t('resident.anonymousDialog.vehicle', { number: visitor.vehicle_number })}</strong></Typography>}
          {visitor.address && <Typography variant="body2"><strong>{t('resident.anonymousDialog.address', { address: visitor.address })}</strong></Typography>}
          {visitor.notes && <Typography variant="body2"><strong>{t('resident.anonymousDialog.notes', { notes: visitor.notes })}</strong></Typography>}
          {visitor.photos.length > 0 && (
            <>
              <Typography variant="body2" fontWeight={600}>{t('common.photosCount', { count: visitor.photos.length })}</Typography>
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
  const { t } = useTranslation('visitors');
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
        <Typography variant="h6" color="text.secondary" mb={2}>{t('resident.main.loginPrompt')}</Typography>
        <Button variant="contained" onClick={() => { window.location.href = '/'; }}>{t('resident.main.goToLogin')}</Button>
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
          <Typography variant="h5" fontWeight={800}>{t('resident.main.title')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('resident.main.subtitle')}
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
          {t('resident.main.newPass')}
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}><CircularProgress /></Box>
      )}

      {!loading && passes.length === 0 && anonymousVisitors.length === 0 && (
        <Box textAlign="center" py={8} color="text.secondary">
          <Typography>{t('resident.main.empty')}</Typography>
        </Box>
      )}

      {!loading && (passes.length > 0 || anonymousVisitors.length > 0) && (
        <Stack spacing={3}>
          {active.length > 0 && (
            <Box>
              <Typography variant="subtitle2" fontWeight={700} mb={1.5}>{t('resident.main.active', { count: active.length })}</Typography>
              <Stack spacing={1.5}>
                {active.map((p) => <PassCard key={p.id} pass={p} onClick={() => setSelected(p)} />)}
              </Stack>
            </Box>
          )}
          {anonymousVisitors.length > 0 && (
            <Box>
              <Typography variant="subtitle2" fontWeight={700} mb={0.5}>{t('resident.main.walkIns', { count: anonymousVisitors.length })}</Typography>
              <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
                {t('resident.main.walkInsHint')}
              </Typography>
              <Stack spacing={1.5}>
                {anonymousVisitors.map((v) => <AnonymousCard key={v.id} visitor={v} onClick={() => setSelectedAnon(v)} />)}
              </Stack>
            </Box>
          )}
          {past.length > 0 && (
            <Box>
              <Typography variant="subtitle2" color="text.secondary" fontWeight={700} mb={1.5}>{t('resident.main.history', { count: past.length })}</Typography>
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
