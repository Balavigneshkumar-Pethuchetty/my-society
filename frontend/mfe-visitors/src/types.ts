export interface VisitorLog {
  entry_time: string | null;
  entry_security_name: string | null;
  exit_time: string | null;
  exit_security_name: string | null;
}

export interface Photo {
  id: string;
  security_id: string;
  security_name: string | null;
  file_path: string;
  captured_at: string;
}

export interface PhoneVerification {
  id: string;
  phone_number: string;
  verification_status: string; // pending | verified | failed | expired
  requested_at: string;
  verified_at: string | null;
}

export interface VisitorPass {
  id: string;
  resident_user_id: string;
  resident_name: string;
  resident_flat: string | null;
  // Lets security tap-to-call the resident (e.g. in an emergency, or to
  // confirm a visitor's claim in real time).
  resident_phone: string | null;
  visitor_name: string;
  purpose: string;
  valid_from: string;
  valid_to: string;
  contact: string | null;
  aadhaar: string | null;
  email: string | null;
  address: string | null;
  qr_token: string;
  status: string; // pending | partially_entered | entered | partially_exited | exited | cancelled | expired
  created_at: string;
  // Group pass: one QR can represent more than one person. visitor_count
  // defaults to 1 (ordinary single-person passes are unaffected).
  visitor_count: number;
  additional_visitor_names: string | null;
  vehicle_number: string | null;
  // Cosmetic only — picks which themed background pass-image.png renders.
  visitor_category: 'family' | 'other';
  entered_count: number;
  exited_count: number;
  log: VisitorLog | null;
  photos: Photo[];
  phone_verification: PhoneVerification | null;
  // False when this pass was created by a different household member sharing
  // the same unit — GET /passes/my now returns the whole household's passes,
  // but only the creator may edit/delete/extend/verify-phone on it.
  is_own_pass: boolean;
}

export interface ScanResult {
  pass_id: string;
  visitor_name: string;
  status: string;
  direction: 'entry' | 'exit';
  admitted_count: number;
  visitor_count: number;
  entered_count: number;
  exited_count: number;
  over_expected_count: boolean;
  entry_time: string | null;
  exit_time: string | null;
  already_final: boolean;
  resident_name: string | null;
  resident_phone: string | null;
}

export interface AnonymousVisitor {
  id: string;
  purpose: string;
  visitor_name: string | null;
  notes: string | null;
  contact: string | null;
  aadhaar: string | null;
  email: string | null;
  address: string | null;
  entry_time: string;
  exit_time: string | null;
  entry_security_name: string | null;
  exit_security_name: string | null;
  linked_resident_name: string | null;
  linked_resident_flat: string | null;
  linked_resident_phone: string | null;
  vehicle_number: string | null;
  photos: Photo[];
}

export interface ResidentDirectoryEntry {
  id: string;
  name: string;
  phone: string | null;
  unit_label: string | null;
}

export interface LedgerRow {
  kind: 'pass' | 'anonymous';
  id: string;
  visitor_name: string;
  purpose: string;
  resident_name: string | null;
  resident_flat: string | null;
  status: string;
  entry_time: string | null;
  exit_time: string | null;
  created_at: string;
  has_photo: boolean;
  aadhaar_provided: boolean;
  visitor_count: number;
  entered_count: number;
  exited_count: number;
}

export function statusColor(status: string): 'default' | 'success' | 'warning' | 'error' | 'info' {
  switch (status) {
    case 'entered': return 'success';
    case 'partially_entered': return 'info';
    case 'exited': return 'info';
    case 'partially_exited': return 'warning';
    case 'pending': return 'warning';
    case 'cancelled':
    case 'expired': return 'error';
    default: return 'default';
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'partially_entered': return 'partially entered';
    case 'partially_exited': return 'partially exited';
    default: return status;
  }
}

// MUI icon `color` (unlike Chip's) has no "default" option — map separately.
export function statusIconColor(status: string): 'action' | 'success' | 'warning' | 'error' | 'info' {
  const c = statusColor(status);
  return c === 'default' ? 'action' : c;
}

export function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
