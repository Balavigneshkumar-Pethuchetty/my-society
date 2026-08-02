import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Container, Divider, Paper,
  Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ContactPhoneIcon from '@mui/icons-material/ContactPhone';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import LogoutIcon from '@mui/icons-material/Logout';
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
import PhoneIcon from '@mui/icons-material/Phone';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import SearchIcon from '@mui/icons-material/Search';
import StopCircleIcon from '@mui/icons-material/StopCircle';
import TodayIcon from '@mui/icons-material/Today';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import { Html5Qrcode } from 'html5-qrcode';
import { PhotoUploader } from './components/PhotoUploader';
import { apiBase, apiFetch } from './api';
import {
  AnonymousVisitor, fmtDateTime, ResidentDirectoryEntry, ScanResult,
  statusColor, statusIconColor, statusLabel, VisitorPass,
} from './types';

// ── Tap-to-call — opens the phone's own dialer via a `tel:` link. There is no
// in-app calling/VoIP in this system; this is the realistic "call a resident"
// affordance for a browser-based gate app.
function CallButton({ phone, label = 'Call Resident' }: { phone: string | null | undefined; label?: string }) {
  if (!phone) return null;
  return (
    <Button
      size="small" variant="outlined" color="error" startIcon={<PhoneIcon />}
      component="a" href={`tel:${phone}`}
    >
      {label}
    </Button>
  );
}

// ── QR Scan tab ───────────────────────────────────────────────────────────────
// Group-pass aware: a QR can represent more than one person. Scanning always
// previews the pass first (via /gate/lookup) so that when more than one
// person is still outstanding for this direction (entry or exit), security
// gets a quantity picker instead of blindly admitting/exiting the whole
// group. Single-person passes (the common case) skip straight to a one-tap
// scan exactly like before — the picker only appears when it's needed.

const QR_READER_ID = 'visitor-gate-qr-reader';

function remainingFor(pass: VisitorPass): { direction: 'entry' | 'exit'; remaining: number } {
  if (pass.entered_count < pass.visitor_count) {
    return { direction: 'entry', remaining: pass.visitor_count - pass.entered_count };
  }
  return { direction: 'exit', remaining: Math.max(0, pass.entered_count - pass.exited_count) };
}

function ScanTab({ token, onActivity }: { token: string; onActivity: () => void }) {
  const [qrInput, setQrInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [pendingPreview, setPendingPreview] = useState<VisitorPass | null>(null);
  const [pendingCount, setPendingCount] = useState('1');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const processingRef = useRef(false);

  const performScan = useCallback(async (raw: string, count?: number) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await apiFetch<ScanResult>(`${apiBase('visitors')}/gate/scan`, token, {
        method: 'POST',
        body: JSON.stringify(count ? { token: raw, count } : { token: raw }),
      });
      setResult(data);
      setQrInput('');
      setPendingToken(null);
      setPendingPreview(null);
      onActivity();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token, onActivity]);

  const runScan = useCallback(async (raw: string) => {
    setLoading(true);
    setError(null);
    setResult(null);
    setPendingToken(null);
    setPendingPreview(null);
    try {
      const preview = await apiFetch<VisitorPass>(`${apiBase('visitors')}/gate/lookup/${encodeURIComponent(raw)}`, token);
      const { remaining } = remainingFor(preview);
      if (preview.visitor_count <= 1 || remaining <= 1 || preview.status === 'exited') {
        await performScan(raw);
      } else {
        setPendingToken(raw);
        setPendingPreview(preview);
        setPendingCount(String(remaining));
        setLoading(false);
      }
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  }, [token, performScan]);

  const stopCamera = useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (scanner) {
      try { await scanner.stop(); scanner.clear(); } catch { /* already stopped */ }
    }
    setCameraOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    setCameraOn(true);
    try {
      const scanner = new Html5Qrcode(QR_READER_ID);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          if (processingRef.current) return;
          processingRef.current = true;
          void stopCamera().then(() => void runScan(decodedText).finally(() => { processingRef.current = false; }));
        },
        () => { /* per-frame decode miss */ },
      );
    } catch (e) {
      scannerRef.current = null;
      setCameraOn(false);
      setCameraError(`Could not access camera: ${(e as Error).message ?? e}`);
    }
  }, [runScan, stopCamera]);

  useEffect(() => () => { void stopCamera(); }, [stopCamera]);

  const handleManual = () => {
    const raw = qrInput.trim();
    if (raw) void runScan(raw);
  };

  const confirmPending = () => {
    if (!pendingToken) return;
    const count = parseInt(pendingCount, 10);
    if (!count || count < 1) return;
    void performScan(pendingToken, count);
  };

  const pendingInfo = pendingPreview ? remainingFor(pendingPreview) : null;

  return (
    <Box sx={{ maxWidth: 480, mx: 'auto', mt: 2 }}>
      <Typography variant="body2" color="text.secondary" mb={2}>
        Scan a visitor pass QR to record entry, then scan again on the way out to record exit. For a group pass, scan again anytime to admit or exit the rest.
      </Typography>

      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
        <Button
          variant={cameraOn ? 'outlined' : 'contained'}
          color={cameraOn ? 'error' : 'primary'}
          startIcon={cameraOn ? <StopCircleIcon /> : <CameraAltIcon />}
          onClick={() => (cameraOn ? void stopCamera() : void startCamera())}
        >
          {cameraOn ? 'Stop Camera' : 'Scan with Camera'}
        </Button>
      </Box>

      {cameraError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setCameraError(null)}>{cameraError}</Alert>}

      <Box id={QR_READER_ID} sx={{ display: cameraOn ? 'block' : 'none', mb: 2, borderRadius: 2, overflow: 'hidden', '& video': { width: '100%', borderRadius: 2 } }} />

      <Divider sx={{ my: 2 }}><Typography variant="caption" color="text.secondary">OR</Typography></Divider>

      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          fullWidth size="small" label="Pass QR Token" value={qrInput}
          onChange={(e) => setQrInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleManual()}
          placeholder="Scan or paste QR token…"
        />
        <Button variant="contained" onClick={handleManual} disabled={loading || !qrInput.trim()} sx={{ minWidth: 96 }}>
          {loading ? <CircularProgress size={18} color="inherit" /> : 'Scan'}
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {pendingPreview && pendingInfo && (
        <Paper variant="outlined" sx={{ mt: 2.5, p: 2.5, borderRadius: 2 }}>
          <Typography fontWeight={700} fontSize={16} mb={0.5}>{pendingPreview.visitor_name}'s group</Typography>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {pendingInfo.direction === 'entry'
              ? `${pendingPreview.entered_count}/${pendingPreview.visitor_count} entered so far — ${pendingInfo.remaining} more expected.`
              : `${pendingPreview.exited_count}/${pendingPreview.entered_count} exited so far — ${pendingInfo.remaining} still inside.`}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              size="small" type="number" label={pendingInfo.direction === 'entry' ? 'Admitting now' : 'Exiting now'}
              inputProps={{ min: 1 }} value={pendingCount} onChange={(e) => setPendingCount(e.target.value)}
              sx={{ maxWidth: 160 }}
            />
            <Button variant="contained" disabled={loading} onClick={confirmPending}>
              {loading ? <CircularProgress size={18} color="inherit" /> : `Confirm ${pendingInfo.direction === 'entry' ? 'Entry' : 'Exit'}`}
            </Button>
            <Button disabled={loading} onClick={() => { setPendingToken(null); setPendingPreview(null); }}>Cancel</Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" display="block" mt={1}>
            You can admit/exit more than what's technically remaining — it will never be blocked, only noted.
          </Typography>
        </Paper>
      )}

      {result && (
        <Paper variant="outlined" sx={{ mt: 2.5, p: 2.5, borderRadius: 2, borderColor: `${statusColor(result.status)}.main` }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <CheckCircleIcon color={statusIconColor(result.status)} />
            <Typography fontWeight={700} fontSize={16}>{result.visitor_name}</Typography>
            <Chip label={statusLabel(result.status)} size="small" color={statusColor(result.status)} sx={{ ml: 'auto' }} />
          </Box>
          {result.already_final && <Alert severity="warning" sx={{ mb: 1.5 }}>This pass has already exited.</Alert>}
          {result.visitor_count > 1 && (
            <Typography variant="body2" sx={{ mb: 0.5 }}>
              {result.direction === 'entry'
                ? `${result.admitted_count} admitted just now — ${result.entered_count}/${result.visitor_count} entered.`
                : `${result.admitted_count} exited just now — ${result.exited_count}/${result.entered_count} exited.`}
            </Typography>
          )}
          {result.over_expected_count && (
            <Alert severity="info" sx={{ mb: 1.5 }}>
              More people have entered ({result.entered_count}) than the {result.visitor_count} originally expected.
            </Alert>
          )}
          {result.entry_time && <Typography variant="body2">Entry: {fmtDateTime(result.entry_time)}</Typography>}
          {result.exit_time && <Typography variant="body2">Exit: {fmtDateTime(result.exit_time)}</Typography>}
          {result.resident_phone && (
            <Box sx={{ mt: 1.5 }}>
              <CallButton phone={result.resident_phone} label={`Call ${result.resident_name ?? 'Resident'}`} />
            </Box>
          )}
          <Box sx={{ mt: 1.5 }}>
            <PhotoUploader token={token} passId={result.pass_id} onUploaded={() => onActivity()} />
          </Box>
        </Paper>
      )}
    </Box>
  );
}

// ── Anonymous visitor tab ─────────────────────────────────────────────────────

interface AnonymousFormState {
  purpose: string;
  visitor_name: string;
  contact: string;
  aadhaar: string;
  email: string;
  address: string;
  notes: string;
  vehicle_number: string;
}

const EMPTY_ANON_FORM: AnonymousFormState = {
  purpose: '', visitor_name: '', contact: '', aadhaar: '', email: '', address: '', notes: '', vehicle_number: '',
};

function AnonymousTab({ token, onActivity }: { token: string; onActivity: () => void }) {
  const [form, setForm] = useState<AnonymousFormState>(EMPTY_ANON_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<AnonymousVisitor | null>(null);

  const set = (k: keyof AnonymousFormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSubmit() {
    if (!form.purpose.trim()) { setError('Purpose is required.'); return; }
    setSaving(true);
    setError(null);
    try {
      const data = await apiFetch<AnonymousVisitor>(`${apiBase('visitors')}/gate/anonymous`, token, {
        method: 'POST',
        body: JSON.stringify({
          purpose: form.purpose.trim(),
          visitor_name: form.visitor_name.trim() || null,
          contact: form.contact.trim() || null,
          aadhaar: form.aadhaar.trim() || null,
          email: form.email.trim() || null,
          address: form.address.trim() || null,
          notes: form.notes.trim() || null,
          vehicle_number: form.vehicle_number.trim() || null,
        }),
      });
      setCreated(data);
      setForm(EMPTY_ANON_FORM);
      onActivity();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box sx={{ maxWidth: 480, mx: 'auto', mt: 2 }}>
      <Typography variant="body2" color="text.secondary" mb={2}>
        Log a walk-in visitor with no pre-registered QR pass — ambulance, delivery, emergency worker, etc.
        Only Purpose is required; add the rest only if there's time.
      </Typography>
      <Stack spacing={2}>
        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        <TextField label="Purpose" required size="small" value={form.purpose} onChange={set('purpose')} />
        <TextField label="Visitor Name (optional)" size="small" value={form.visitor_name} onChange={set('visitor_name')} />
        <TextField label="Contact Number (optional)" size="small" value={form.contact} onChange={set('contact')} />
        <TextField label="Email (optional)" size="small" value={form.email} onChange={set('email')} />
        <TextField label="Aadhaar Number (optional)" size="small" value={form.aadhaar} onChange={set('aadhaar')} />
        <TextField label="Address (optional)" size="small" multiline minRows={2} value={form.address} onChange={set('address')} />
        <TextField label="Vehicle Number (optional)" size="small" placeholder="e.g. TN 09 AB 1234" value={form.vehicle_number} onChange={set('vehicle_number')} />
        <TextField label="Notes (optional)" size="small" multiline minRows={2} value={form.notes} onChange={set('notes')} />
        <Button variant="contained" startIcon={<PersonAddAlt1Icon />} disabled={saving} onClick={() => void handleSubmit()}>
          {saving ? <CircularProgress size={18} color="inherit" /> : 'Log Visitor'}
        </Button>
      </Stack>

      {created && (
        <Paper variant="outlined" sx={{ mt: 3, p: 2.5, borderRadius: 2 }}>
          <Typography fontWeight={700} mb={1}>{created.visitor_name || created.purpose}</Typography>
          <Typography variant="body2" color="text.secondary" mb={1.5}>Logged at {fmtDateTime(created.entry_time)}</Typography>
          <PhotoUploader token={token} anonymousId={created.id} onUploaded={() => onActivity()} />
        </Paper>
      )}
    </Box>
  );
}

// ── Today's activity tab (exit + phone-code confirm) ──────────────────────────

function TodayTab({ token, refreshKey }: { token: string; refreshKey: number }) {
  const [passes, setPasses] = useState<VisitorPass[]>([]);
  const [anonymous, setAnonymous] = useState<AnonymousVisitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [codeInputs, setCodeInputs] = useState<Record<string, string>>({});
  const [vehicleInputs, setVehicleInputs] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<{ passes: VisitorPass[]; anonymous: AnonymousVisitor[] }>(`${apiBase('visitors')}/gate/today`, token)
      .then((d) => { setPasses(d.passes); setAnonymous(d.anonymous); setLoading(false); })
      .catch((e) => { setError((e as Error).message); setLoading(false); });
  }, [token]);

  useEffect(() => { load(); }, [load, refreshKey]);

  async function confirmCode(passId: string) {
    const code = codeInputs[passId]?.trim();
    if (!code) return;
    setBusyId(passId);
    setNotice(null);
    try {
      const res = await apiFetch<{ verified: boolean }>(`${apiBase('visitors')}/passes/${passId}/phone-verify/confirm`, token, {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      setNotice(res.verified ? 'Phone verified successfully.' : 'Incorrect code.');
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function saveVehicle(passId: string, current: string | null) {
    const value = (vehicleInputs[passId] ?? current ?? '').trim();
    setBusyId(passId);
    setNotice(null);
    try {
      await apiFetch(`${apiBase('visitors')}/passes/${passId}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ vehicle_number: value || null }),
      });
      setNotice('Vehicle number updated.');
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function saveAnonymousVehicle(anonId: string, current: string | null) {
    const value = (vehicleInputs[anonId] ?? current ?? '').trim();
    setBusyId(anonId);
    setNotice(null);
    try {
      await apiFetch(`${apiBase('visitors')}/gate/anonymous/${anonId}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ vehicle_number: value || null }),
      });
      setNotice('Vehicle number updated.');
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function exitAnonymous(id: string) {
    setBusyId(id);
    try {
      await apiFetch(`${apiBase('visitors')}/gate/anonymous/${id}/exit`, token, { method: 'POST' });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  return (
    <Box sx={{ mt: 2 }}>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}

      <Typography variant="subtitle2" fontWeight={700} mb={1.5}>Visitor Passes ({passes.length})</Typography>
      <Stack spacing={1.5} sx={{ mb: 3 }}>
        {passes.length === 0 && <Typography variant="body2" color="text.secondary">No passes expected or active today.</Typography>}
        {passes.map((p) => (
          <Paper key={p.id} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
              <Box>
                <Typography fontWeight={700}>
                  {p.visitor_name}{p.visitor_count > 1 ? ` +${p.visitor_count - 1}` : ''}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {p.purpose} · visiting {p.resident_name}{p.resident_flat ? ` (${p.resident_flat})` : ''}
                  {p.visitor_count > 1 ? ` · ${p.entered_count}/${p.visitor_count} entered` : ''}
                </Typography>
              </Box>
              <Chip label={statusLabel(p.status)} size="small" color={statusColor(p.status)} />
            </Box>
            {p.resident_phone && (
              <Box sx={{ mt: 1 }}>
                <CallButton phone={p.resident_phone} label={`Call ${p.resident_name}`} />
              </Box>
            )}
            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} alignItems="center">
              <TextField
                size="small" label="Vehicle number" placeholder="e.g. TN 09 AB 1234"
                sx={{ maxWidth: 220 }}
                value={vehicleInputs[p.id] ?? p.vehicle_number ?? ''}
                onChange={(e) => setVehicleInputs((s) => ({ ...s, [p.id]: e.target.value }))}
              />
              <Button
                size="small" variant="outlined" startIcon={<DirectionsCarIcon />}
                disabled={busyId === p.id || (vehicleInputs[p.id] ?? p.vehicle_number ?? '') === (p.vehicle_number ?? '')}
                onClick={() => void saveVehicle(p.id, p.vehicle_number)}
              >
                Save
              </Button>
            </Stack>
            {p.phone_verification && p.phone_verification.verification_status === 'pending' && (
              <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} alignItems="center">
                <TextField
                  size="small" label="Phone code" sx={{ maxWidth: 160 }}
                  value={codeInputs[p.id] ?? ''}
                  onChange={(e) => setCodeInputs((s) => ({ ...s, [p.id]: e.target.value }))}
                />
                <Button
                  size="small" variant="outlined" startIcon={<VerifiedUserIcon />}
                  disabled={busyId === p.id} onClick={() => void confirmCode(p.id)}
                >
                  Verify
                </Button>
              </Stack>
            )}
          </Paper>
        ))}
      </Stack>

      <Typography variant="subtitle2" fontWeight={700} mb={1.5}>Anonymous / Emergency Visitors ({anonymous.length})</Typography>
      <Stack spacing={1.5}>
        {anonymous.length === 0 && <Typography variant="body2" color="text.secondary">None logged today.</Typography>}
        {anonymous.map((a) => (
          <Paper key={a.id} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
              <Box>
                <Typography fontWeight={700}>{a.visitor_name || a.purpose}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {a.visitor_name ? `${a.purpose} · ` : ''}{fmtDateTime(a.entry_time)}
                  {a.linked_resident_name ? ` · visiting ${a.linked_resident_name}` : ''}
                  {a.contact ? ` · ${a.contact}` : ''}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} alignItems="flex-start">
                {a.linked_resident_phone && (
                  <CallButton phone={a.linked_resident_phone} label={`Call ${a.linked_resident_name}`} />
                )}
                {a.exit_time ? (
                  <Chip label="exited" size="small" color="info" />
                ) : (
                  <Button
                    size="small" startIcon={<LogoutIcon />} disabled={busyId === a.id}
                    onClick={() => void exitAnonymous(a.id)}
                  >
                    Mark Exit
                  </Button>
                )}
              </Stack>
            </Box>
            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} alignItems="center">
              <TextField
                size="small" label="Vehicle number" placeholder="e.g. TN 09 AB 1234"
                sx={{ maxWidth: 220 }}
                value={vehicleInputs[a.id] ?? a.vehicle_number ?? ''}
                onChange={(e) => setVehicleInputs((s) => ({ ...s, [a.id]: e.target.value }))}
              />
              <Button
                size="small" variant="outlined" startIcon={<DirectionsCarIcon />}
                disabled={busyId === a.id || (vehicleInputs[a.id] ?? a.vehicle_number ?? '') === (a.vehicle_number ?? '')}
                onClick={() => void saveAnonymousVehicle(a.id, a.vehicle_number)}
              >
                Save
              </Button>
            </Stack>
          </Paper>
        ))}
      </Stack>
    </Box>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

// ── Resident directory tab (emergency call — any resident, not just those with an active pass) ──

function DirectoryTab({ token }: { token: string }) {
  const [residents, setResidents] = useState<ResidentDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    apiFetch<{ items: ResidentDirectoryEntry[] }>(`${apiBase('users')}/users/directory`, token)
      .then((d) => { setResidents(d.items); setLoading(false); })
      .catch((e) => { setError((e as Error).message); setLoading(false); });
  }, [token]);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? residents.filter((r) =>
        r.name.toLowerCase().includes(q)
        || (r.unit_label ?? '').toLowerCase().includes(q)
        || (r.phone ?? '').includes(q))
    : residents;

  return (
    <Box sx={{ maxWidth: 560, mx: 'auto', mt: 2 }}>
      <Typography variant="body2" color="text.secondary" mb={2}>
        Everyone with a flat on record — residents, admins, committee members — not just ones with an active visitor pass right now. For emergencies (fire, medical, etc.) where you need to reach someone directly.
      </Typography>
      <TextField
        fullWidth size="small" placeholder="Search by name, flat, or phone…"
        value={search} onChange={(e) => setSearch(e.target.value)}
        InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> }}
        sx={{ mb: 2 }}
      />
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>}
      {!loading && (
        <Stack spacing={1.5}>
          {filtered.length === 0 && (
            <Typography variant="body2" color="text.secondary" textAlign="center" py={4}>
              {residents.length === 0 ? 'No residents found.' : `No residents match "${search}".`}
            </Typography>
          )}
          {filtered.map((r) => (
            <Paper key={r.id} variant="outlined" sx={{ p: 2, borderRadius: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography fontWeight={700} noWrap>{r.name}</Typography>
                <Typography variant="body2" color="text.secondary" noWrap>
                  {r.unit_label ?? 'No flat on record'}{r.phone ? ` · ${r.phone}` : ''}
                </Typography>
              </Box>
              <CallButton phone={r.phone} label="Call" />
            </Paper>
          ))}
        </Stack>
      )}
    </Box>
  );
}

export interface VisitorSecurityAppProps {
  token?: string | null;
}

export function VisitorSecurityApp({ token }: VisitorSecurityAppProps) {
  const [tab, setTab] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  if (!token) {
    return (
      <Container maxWidth="sm" sx={{ py: 6, textAlign: 'center' }}>
        <Alert severity="warning">You must be logged in to use the visitor gate.</Alert>
      </Container>
    );
  }

  return (
    <Box component="main">
      <Box sx={{ background: 'linear-gradient(135deg,#1e293b 0%,#065f46 100%)', color: '#fff', py: { xs: 4, md: 5 }, px: 3 }}>
        <Container maxWidth="md">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
            <QrCodeScannerIcon sx={{ fontSize: 28 }} />
            <Typography variant="h5" fontWeight={800}>Visitor Gate</Typography>
          </Box>
          <Typography sx={{ fontSize: 15, color: '#a7f3d0' }}>
            Scan visitor passes, log walk-ins, capture photos, and verify identity.
          </Typography>
        </Container>
      </Box>

      <Container maxWidth="md" sx={{ py: 4 }}>
        <Paper variant="outlined" sx={{ borderRadius: 2 }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }} variant="scrollable">
            <Tab icon={<QrCodeScannerIcon fontSize="small" />} iconPosition="start" label="Scan Pass" sx={{ minHeight: 48, textTransform: 'none', fontWeight: 600 }} />
            <Tab icon={<PersonAddAlt1Icon fontSize="small" />} iconPosition="start" label="Anonymous Entry" sx={{ minHeight: 48, textTransform: 'none', fontWeight: 600 }} />
            <Tab icon={<TodayIcon fontSize="small" />} iconPosition="start" label="Today's Activity" sx={{ minHeight: 48, textTransform: 'none', fontWeight: 600 }} />
            <Tab icon={<ContactPhoneIcon fontSize="small" />} iconPosition="start" label="Resident Directory" sx={{ minHeight: 48, textTransform: 'none', fontWeight: 600 }} />
          </Tabs>
          <Box sx={{ p: { xs: 2, sm: 3 } }}>
            {tab === 0 && <ScanTab token={token} onActivity={bump} />}
            {tab === 1 && <AnonymousTab token={token} onActivity={bump} />}
            {tab === 2 && <TodayTab token={token} refreshKey={refreshKey} />}
            {tab === 3 && <DirectoryTab token={token} />}
          </Box>
        </Paper>
      </Container>
    </Box>
  );
}

export default VisitorSecurityApp;
