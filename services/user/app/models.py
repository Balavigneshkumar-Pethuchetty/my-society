from __future__ import annotations
from datetime import datetime
from typing import Literal, Optional
from uuid import UUID
from pydantic import BaseModel, EmailStr, field_validator


class ApartmentBrief(BaseModel):
    id: UUID
    block: str
    unit_number: str
    type: str


class UserResponse(BaseModel):
    id: UUID
    apartments: list[ApartmentBrief] = []
    username: Optional[str] = None
    name: str
    email: Optional[str] = None   # nullable for phone-only accounts
    phone: Optional[str] = None
    avatar_url: Optional[str] = None   # relative path, e.g. "avatars/<uuid>.jpg"
    email_verified: bool = False
    phone_verified: bool = False
    role: str
    keycloak_sub: Optional[str] = None
    identity_provider: str
    is_active: bool
    created_at: datetime
    structure_node_id: Optional[UUID] = None  # kept for compat; use unit_node_ids
    unit_node_ids: list[UUID] = []            # all flats this user is linked to
    unit_label: Optional[str] = None          # resolved display label, e.g. "A-W1-F1-102" or
                                               # "Block A – 101"; only populated by internal.py's
                                               # endpoints (see services/visitor's user_client.py,
                                               # which has no local DB to join structure_nodes/
                                               # apartment itself)


class UserUpdateRequest(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None


class PhoneVerifyRequestBody(BaseModel):
    # None = let auth-service pick automatically (Telegram if linked, else SMS)
    channel: Optional[Literal["telegram", "sms"]] = None


class PhoneVerifyRequestResponse(BaseModel):
    ok: bool
    request_id: Optional[str] = None
    expires_in: Optional[int] = None
    sent_via: Optional[str] = None
    error: Optional[str] = None
    retry_after: Optional[int] = None


class TelegramLinkStatusResponse(BaseModel):
    linked: bool
    deep_link: Optional[str] = None


class PhoneVerifyConfirmRequest(BaseModel):
    request_id: str
    code: str


class PhoneVerifyConfirmResponse(BaseModel):
    verified: bool
    status: str
    attempts_remaining: Optional[int] = None
    user: Optional[UserResponse] = None


class PhoneLoginRequest(BaseModel):
    phone: str
    # None = let auth-service pick automatically (Telegram if linked, else SMS)
    channel: Optional[Literal["telegram", "sms"]] = None


class PhoneLoginRequestResponse(BaseModel):
    ok: bool
    request_id: Optional[str] = None
    expires_in: Optional[int] = None
    sent_via: Optional[str] = None
    error: Optional[str] = None
    retry_after: Optional[int] = None


class PhoneLoginVerifyRequest(BaseModel):
    request_id: str
    code: str


class PhoneLoginVerifyResponse(BaseModel):
    verified: bool
    status: str
    attempts_remaining: Optional[int] = None
    access_token: Optional[str] = None
    expires_in: Optional[int] = None
    session_token: Optional[str] = None
    session_expires_in: Optional[int] = None


class PhoneLoginRefreshRequest(BaseModel):
    session_token: str


class PhoneLoginRefreshResponse(BaseModel):
    access_token: str
    expires_in: int


class PhoneLoginLogoutRequest(BaseModel):
    session_token: str


class ApartmentAssignRequest(BaseModel):
    apartment_id: UUID


class RoleUpdateRequest(BaseModel):
    role: str

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        allowed = {"admin", "committee_member", "resident", "security_guard", "sponsor"}
        if v not in allowed:
            raise ValueError(f"role must be one of {sorted(allowed)}")
        return v


class ApartmentResponse(BaseModel):
    id: UUID
    society_id: UUID
    block: str
    unit_number: str
    type: str


class UserListResponse(BaseModel):
    total: int
    items: list[UserResponse]


class ResidentDirectoryEntry(BaseModel):
    id: UUID
    name: str
    phone: Optional[str] = None
    unit_label: Optional[str] = None


class ResidentDirectoryResponse(BaseModel):
    items: list[ResidentDirectoryEntry]


class ForgotPasswordRequest(BaseModel):
    email: str


class SocietyConfig(BaseModel):
    name: str
    shortName: str
    city: str
    baseCurrency: str = "INR"


class NotificationResponse(BaseModel):
    id: UUID
    event_id: Optional[UUID] = None
    type: str
    title: str
    message: str
    is_read: bool
    created_at: datetime


class NotificationListResponse(BaseModel):
    unread_count: int
    total: int
    items: list[NotificationResponse]


class AdminBreakdown(BaseModel):
    admin_id: Optional[UUID] = None
    admin_name: str
    approved: int = 0
    rejected: int = 0
    removed: int = 0
    revoked: int = 0


class AdminActionResponse(BaseModel):
    id: UUID
    admin_name: str
    target_user_name: str
    target_user_email: str
    action: str
    role: Optional[str] = None
    performed_at: datetime


class AdminStatsResponse(BaseModel):
    total_pending: int
    total_approved: int
    total_rejected: int
    total_removed: int
    total_revoked: int
    by_admin: list[AdminBreakdown]
    recent_actions: list[AdminActionResponse]


# ── Building Structure models ─────────────────────────────────────────────────

class HierarchyLevel(BaseModel):
    level_index: int
    level_name: str
    is_billable: bool = False


class HierarchyConfigRequest(BaseModel):
    levels: list[HierarchyLevel]


class StructureNodeCreate(BaseModel):
    name: str
    level_index: int
    parent_id: Optional[UUID] = None


class StructureNodesBulkCreate(BaseModel):
    nodes: list[StructureNodeCreate]


class ImportRowsRequest(BaseModel):
    rows: list[list[str]]


class UserStructureNodeRequest(BaseModel):
    structure_node_id: Optional[UUID] = None


class UserUnitRequest(BaseModel):
    node_id: UUID


# ── Unit assignment request models ───────────────────────────────────────────

class UnitRequestCreate(BaseModel):
    node_id: UUID
    notes: Optional[str] = None
    type: str = "add"

    @field_validator("type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        if v not in {"add", "remove"}:
            raise ValueError("type must be 'add' or 'remove'")
        return v


class UnitRequestReview(BaseModel):
    status: str
    notes: Optional[str] = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        if v not in {"approved", "rejected"}:
            raise ValueError("status must be 'approved' or 'rejected'")
        return v


class UnitRequestResponse(BaseModel):
    id: UUID
    user_id: UUID
    user_name: str
    user_email: Optional[str]
    node_id: UUID
    notes: Optional[str]
    type: str
    status: str
    reviewed_by: Optional[UUID]
    reviewed_by_name: Optional[str]
    reviewed_at: Optional[datetime]
    created_at: datetime


# ── Leave-society request models ─────────────────────────────────────────────

class LeaveRequestCreate(BaseModel):
    reason: Optional[str] = None


class LeaveRequestReview(BaseModel):
    note: Optional[str] = None


class LeaveRequestResponse(BaseModel):
    id: UUID
    user_id: Optional[UUID]
    user_name: str
    user_email: Optional[str]
    reason: Optional[str]
    status: str
    requested_at: datetime
    reviewed_by: Optional[UUID]
    reviewed_by_name: Optional[str]
    reviewed_at: Optional[datetime]
    review_note: Optional[str]
    completed_at: Optional[datetime]
    has_pending_payment: bool = False
    blockers: list[str] = []


class LeaveRequestListResponse(BaseModel):
    total: int
    items: list[LeaveRequestResponse]
