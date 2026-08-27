// Points at nginx on port 8080 when Vite dev server is on 3000; same origin otherwise.
const BASE =
  window.location.port === '3000'
    ? `${window.location.protocol}//${window.location.hostname}:8080/api/users`
    : `${window.location.origin}/api/users`;

async function apiFetch<T>(path: string, token: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
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

// No explicit Content-Type here — the browser sets the multipart boundary itself
// when the body is a FormData instance; setting it manually would drop the boundary.
async function apiFetchForm<T>(path: string, token: string, formData: FormData, method = 'POST'): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { detail?: string }).detail ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Build a browsable URL for a relative avatar path stored on users.avatar_url. */
export function avatarUrl(path: string | null | undefined): string | undefined {
  return path ? `${BASE}/uploads/${path}` : undefined;
}

export interface ApartmentBrief {
  id: string;
  block: string;
  unit_number: string;
  type: string;
}

export interface Apartment extends ApartmentBrief {
  society_id: string;
}

export interface DbUser {
  id: string;
  apartments: ApartmentBrief[];
  name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  email_verified: boolean;
  phone_verified: boolean;
  role: string;
  keycloak_sub: string;
  identity_provider: string;
  is_active: boolean;
  created_at: string;
  structure_node_id?: string | null;
  unit_node_ids: string[];
  theme: 'light' | 'dark' | 'system';
  locale: string;
  notify_sms: boolean;
  notify_email: boolean;
  notify_telegram: boolean;
}

export type OtpChannel = 'telegram' | 'sms';

export interface TelegramLinkStatusResponse {
  linked: boolean;
  deep_link: string | null;
}

export interface PhoneVerifyRequestResponse {
  ok: boolean;
  request_id: string | null;
  expires_in: number | null;
  sent_via: string | null;
  error: string | null;
  retry_after: number | null;
}

export interface PhoneVerifyConfirmResponse {
  verified: boolean;
  status: string;
  attempts_remaining: number | null;
  user: DbUser | null;
}

export interface PhoneLoginRequestResponse {
  ok: boolean;
  request_id: string | null;
  expires_in: number | null;
  sent_via: string | null;
  error: string | null;
  retry_after: number | null;
}

export interface PhoneLoginVerifyResponse {
  verified: boolean;
  status: string;
  attempts_remaining: number | null;
  access_token: string | null;
  expires_in: number | null;
  session_token: string | null;
  session_expires_in: number | null;
}

export interface PhoneLoginRefreshResponse {
  access_token: string;
  expires_in: number;
}

export interface StructureNode {
  id: string;
  name: string;
  level_index: number;
  level_name: string;
  parent_id: string | null;
}

export interface UnitRequest {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string | null;
  node_id: string;
  notes: string | null;
  type: 'add' | 'remove';
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface UserListResponse {
  total: number;
  items: DbUser[];
}

export interface LeaveRequest {
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

async function publicPost<T = void>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { detail?: string }).detail ?? `HTTP ${res.status}`);
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

async function publicGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { detail?: string }).detail ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface NotificationItem {
  id: string;
  event_id: string | null;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface NotificationListResponse {
  unread_count: number;
  total: number;
  items: NotificationItem[];
}

export const userService = {
  /** Upsert local DB row from JWT on first login. */
  sync: (token: string) =>
    apiFetch<DbUser>('/users/sync', token, { method: 'POST' }),

  me: (token: string) =>
    apiFetch<DbUser>('/users/me', token),

  // phone: null explicitly clears the number on file (frees it up for another resident to
  // register with) — omitting the key entirely leaves it untouched.
  update: (token: string, data: {
    name?: string; phone?: string | null;
    theme?: 'light' | 'dark' | 'system'; locale?: string;
    notify_sms?: boolean; notify_email?: boolean; notify_telegram?: boolean;
  }) =>
    apiFetch<DbUser>('/users/me', token, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  uploadAvatar: (token: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return apiFetchForm<DbUser>('/users/me/avatar', token, fd, 'POST');
  },

  removeAvatar: (token: string) =>
    apiFetch<DbUser>('/users/me/avatar', token, { method: 'DELETE' }),

  verifyEmail: {
    send: (token: string) =>
      apiFetch<void>('/users/me/verify-email/send', token, { method: 'POST' }),
    check: (token: string) =>
      apiFetch<DbUser>('/users/me/verify-email/check', token, { method: 'POST' }),
  },

  verifyPhone: {
    request: (token: string, channel?: OtpChannel) =>
      apiFetch<PhoneVerifyRequestResponse>('/users/me/phone/verify/request', token, {
        method: 'POST',
        body: JSON.stringify({ channel: channel ?? null }),
      }),
    confirm: (token: string, request_id: string, code: string) =>
      apiFetch<PhoneVerifyConfirmResponse>('/users/me/phone/verify/confirm', token, {
        method: 'POST',
        body: JSON.stringify({ request_id, code }),
      }),
  },

  // Phone-number login for already-registered, already phone-verified users
  // only — no bearer token exists yet, so these go through publicPost.
  phoneLogin: {
    request: (phone: string, channel?: OtpChannel) =>
      publicPost<PhoneLoginRequestResponse>('/users/auth/phone-login/request', { phone, channel: channel ?? null }),
    verify: (request_id: string, code: string) =>
      publicPost<PhoneLoginVerifyResponse>('/users/auth/phone-login/verify', { request_id, code }),
    refresh: (session_token: string) =>
      publicPost<PhoneLoginRefreshResponse>('/users/auth/phone-login/refresh', { session_token }),
    logout: (session_token: string) =>
      publicPost('/users/auth/phone-login/logout', { session_token }),
  },

  // Unauthenticated — same trust level as a phone number, not a secret.
  telegram: {
    linkStatus: (phone: string) =>
      publicGet<TelegramLinkStatusResponse>(`/users/telegram/link-status?phone=${encodeURIComponent(phone)}`),
  },

  addApartment: (token: string, apartment_id: string) =>
    apiFetch<DbUser>('/users/me/apartments', token, {
      method: 'POST',
      body: JSON.stringify({ apartment_id }),
    }),

  removeApartment: (token: string, apartment_id: string) =>
    apiFetch<DbUser>(`/users/me/apartments/${apartment_id}`, token, { method: 'DELETE' }),

  listApartments: (token: string) =>
    apiFetch<Apartment[]>('/users/apartments/list', token),

  listUsers: (token: string, params?: { active?: boolean; role?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.active !== undefined) qs.set('active', String(params.active));
    if (params?.role)   qs.set('role', params.role);
    if (params?.limit)  qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<UserListResponse>(`/users${query}`, token);
  },

  approveUser: (token: string, userId: string, role: string) =>
    apiFetch<DbUser>(`/users/${userId}/approve`, token, {
      method: 'POST',
      body: JSON.stringify({ role }),
    }),

  rejectUser: (token: string, userId: string) =>
    apiFetch<void>(`/users/${userId}/reject`, token, { method: 'DELETE' }),

  forgotPassword: (email: string) =>
    publicPost('/users/forgot-password', { email }),

  notifications: {
    list: (token: string, params?: { unread?: boolean; limit?: number; offset?: number }) => {
      const qs = new URLSearchParams();
      if (params?.unread !== undefined) qs.set('unread', String(params.unread));
      if (params?.limit)  qs.set('limit',  String(params.limit));
      if (params?.offset) qs.set('offset', String(params.offset));
      const query = qs.toString() ? `?${qs.toString()}` : '';
      return apiFetch<NotificationListResponse>(`/notifications${query}`, token);
    },
    markRead: (token: string, id: string) =>
      apiFetch<void>(`/notifications/${id}/read`, token, { method: 'PATCH' }),
    markAllRead: (token: string) =>
      apiFetch<void>('/notifications/read-all', token, { method: 'PATCH' }),
  },

  buildingNodes: (token: string) =>
    apiFetch<StructureNode[]>('/building/nodes', token),

  /** Self-service: add or remove own flats directly (no approval needed) */
  units: {
    add: (token: string, node_id: string) =>
      apiFetch<DbUser>('/users/me/units', token, {
        method: 'POST',
        body: JSON.stringify({ node_id }),
      }),
    remove: (token: string, node_id: string) =>
      apiFetch<DbUser>(`/users/me/units/${node_id}`, token, { method: 'DELETE' }),
  },

  unitRequests: {
    list: (token: string, status?: string) => {
      const qs = status ? `?status=${status}` : '';
      return apiFetch<UnitRequest[]>(`/building/unit-requests${qs}`, token);
    },
    create: (token: string, node_id: string, notes?: string, type: 'add' | 'remove' = 'add') =>
      apiFetch<UnitRequest>('/building/unit-requests', token, {
        method: 'POST',
        body: JSON.stringify({ node_id, notes: notes ?? null, type }),
      }),
    review: (token: string, id: string, status: 'approved' | 'rejected') =>
      apiFetch<UnitRequest>(`/building/unit-requests/${id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
  },

  /** Admin/committee: manage any user's flat assignments */
  adminUnits: {
    add: (token: string, userId: string, node_id: string) =>
      apiFetch<{ ok: boolean }>(`/building/users/${userId}/units`, token, {
        method: 'POST',
        body: JSON.stringify({ node_id }),
      }),
    remove: (token: string, userId: string, node_id: string) =>
      apiFetch<void>(`/building/users/${userId}/units/${node_id}`, token, { method: 'DELETE' }),
  },

  /** Self-service leave-society request lifecycle */
  leaveRequests: {
    create: (token: string, reason?: string) =>
      apiFetch<LeaveRequest>('/leave-requests', token, {
        method: 'POST',
        body: JSON.stringify({ reason: reason ?? null }),
      }),
    mine: (token: string) =>
      apiFetch<LeaveRequest | null>('/leave-requests/me', token),
    activityExport: (token: string, id: string) =>
      apiFetch<Record<string, unknown>>(`/leave-requests/${id}/activity-export`, token),
    confirm: (token: string, id: string) =>
      apiFetch<{ status: string }>(`/leave-requests/${id}/confirm`, token, { method: 'POST' }),
  },
};
