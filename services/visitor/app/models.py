from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


# ── Visitor pass ────────────────────────────────────────────────────────────

class PassCreateRequest(BaseModel):
    visitor_name: str = Field(..., min_length=1, max_length=255)
    purpose: str = Field(..., min_length=1, max_length=500)
    valid_from: datetime
    valid_to: datetime
    contact: Optional[str] = None
    aadhaar: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    # Group pass support: visitor_count is the expected headcount for this one
    # QR pass (default 1 — the vast majority of passes are single-person and
    # behave exactly as before). additional_visitor_names is free-text, not
    # structured per-person records — see services/visitor's group-pass notes
    # for why (headcount tracking, not per-person identity/photos).
    visitor_count: int = Field(1, ge=1, le=200)
    additional_visitor_names: Optional[str] = Field(None, max_length=2000)
    vehicle_number: Optional[str] = Field(None, max_length=20)
    # Cosmetic only — picks the themed background pass_image.py renders.
    visitor_category: str = Field("other", pattern="^(family|other)$")


class PassExtendRequest(BaseModel):
    valid_to: datetime


class PassUpdateRequest(BaseModel):
    # Partial edit — only supplied fields are changed. valid_to is deliberately
    # not editable here; use PATCH /passes/{id}/extend for that (it has its
    # own validation against the current valid_from and notifies security).
    visitor_name: Optional[str] = Field(None, min_length=1, max_length=255)
    purpose: Optional[str] = Field(None, min_length=1, max_length=500)
    contact: Optional[str] = None
    aadhaar: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    # Raising this after the group has fully entered (status 'entered') is the
    # supported way to let more people in on the same pass — see routes/passes.py
    # update_pass, which re-derives status from the new count vs entered_count.
    visitor_count: Optional[int] = Field(None, ge=1, le=200)
    additional_visitor_names: Optional[str] = Field(None, max_length=2000)
    # Deliberately editable by security_guard callers too (unlike every other
    # field on this request) — see routes/passes.py update_pass, which is the
    # only field a non-privileged, non-owning security caller may set.
    vehicle_number: Optional[str] = Field(None, max_length=20)
    visitor_category: Optional[str] = Field(None, pattern="^(family|other)$")


class PhotoOut(BaseModel):
    id: str
    security_id: str
    security_name: Optional[str] = None
    file_path: str
    captured_at: datetime


class PhoneVerificationOut(BaseModel):
    id: str
    phone_number: str
    verification_status: str
    requested_at: datetime
    verified_at: Optional[datetime] = None


class VisitorLogOut(BaseModel):
    entry_time: Optional[datetime] = None
    entry_security_name: Optional[str] = None
    exit_time: Optional[datetime] = None
    exit_security_name: Optional[str] = None


class PassOut(BaseModel):
    id: str
    resident_user_id: str
    resident_name: str
    resident_flat: Optional[str] = None
    # Lets security call the resident directly (tap-to-call `tel:` link) —
    # e.g. in an emergency, or to confirm a visitor's claim in real time.
    resident_phone: Optional[str] = None
    visitor_name: str
    purpose: str
    valid_from: datetime
    valid_to: datetime
    contact: Optional[str] = None
    aadhaar: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    qr_token: str
    status: str
    created_at: datetime
    visitor_count: int = 1
    additional_visitor_names: Optional[str] = None
    vehicle_number: Optional[str] = None
    visitor_category: str = "other"
    entered_count: int = 0
    exited_count: int = 0
    log: Optional[VisitorLogOut] = None
    photos: list[PhotoOut] = []
    phone_verification: Optional[PhoneVerificationOut] = None
    # Only meaningful (and only ever set to False) on GET /passes/my, which can
    # now also return passes a household member created — resident-only edit
    # actions (edit/delete/extend/phone-verify) are for the pass's own creator.
    is_own_pass: bool = True


# ── Gate / anonymous visitors ───────────────────────────────────────────────

class ScanBody(BaseModel):
    token: str = Field(..., min_length=1)
    # How many people to admit/exit on this scan. Omitted = admit the whole
    # remaining group in one action (the original single-scan behavior, still
    # exactly what happens for the common visitor_count=1 case). Security can
    # set this higher than what's technically "remaining" — see scan()'s
    # comment: actual headcount at the gate is allowed to exceed what the
    # resident originally stated, it's never blocked, only flagged.
    count: Optional[int] = Field(None, ge=1)


class ScanOut(BaseModel):
    pass_id: str
    visitor_name: str
    status: str
    direction: str  # "entry" | "exit"
    admitted_count: int
    visitor_count: int
    entered_count: int
    exited_count: int
    over_expected_count: bool = False
    entry_time: Optional[datetime] = None
    exit_time: Optional[datetime] = None
    already_final: bool = False
    # So the scan result screen can offer a "Call Resident" tap-to-call button.
    resident_name: Optional[str] = None
    resident_phone: Optional[str] = None


class AnonymousCreateRequest(BaseModel):
    # Only purpose is mandatory — security needs to be able to log a walk-in
    # (ambulance, emergency worker) in seconds; everything else is optional
    # detail captured only if there's time/reason to ask for it.
    purpose: str = Field(..., min_length=1, max_length=500)
    visitor_name: Optional[str] = None
    notes: Optional[str] = None
    contact: Optional[str] = None
    aadhaar: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    vehicle_number: Optional[str] = Field(None, max_length=20)
    linked_resident_user_id: Optional[str] = None


class AnonymousUpdateRequest(BaseModel):
    # Deliberately just the one field — security can correct/add the vehicle
    # number after logging a walk-in, same as PassUpdateRequest.vehicle_number.
    vehicle_number: Optional[str] = Field(None, max_length=20)


class AnonymousOut(BaseModel):
    id: str
    purpose: str
    visitor_name: Optional[str] = None
    notes: Optional[str] = None
    contact: Optional[str] = None
    aadhaar: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    entry_time: datetime
    exit_time: Optional[datetime] = None
    entry_security_name: Optional[str] = None
    exit_security_name: Optional[str] = None
    linked_resident_name: Optional[str] = None
    linked_resident_flat: Optional[str] = None
    linked_resident_phone: Optional[str] = None
    vehicle_number: Optional[str] = None
    photos: list[PhotoOut] = []


class GateTodayOut(BaseModel):
    passes: list[PassOut] = []
    anonymous: list[AnonymousOut] = []


# ── Phone verification ──────────────────────────────────────────────────────

class PhoneVerifyConfirmRequest(BaseModel):
    code: str = Field(..., min_length=1)


# ── Ledger ───────────────────────────────────────────────────────────────────

class LedgerRow(BaseModel):
    kind: str  # "pass" | "anonymous"
    id: str
    visitor_name: str
    purpose: str
    resident_name: Optional[str] = None
    resident_flat: Optional[str] = None
    status: str
    entry_time: Optional[datetime] = None
    exit_time: Optional[datetime] = None
    created_at: datetime
    has_photo: bool = False
    aadhaar_provided: bool = False
    visitor_count: int = 1
    entered_count: int = 0
    exited_count: int = 0


class VisitorSettingsOut(BaseModel):
    overdue_threshold_minutes: int
    daily_summary_enabled: bool
    summary_interval: str
    summary_hour_utc: int


class VisitorSettingsUpdateRequest(BaseModel):
    overdue_threshold_minutes: Optional[int] = None
    daily_summary_enabled: Optional[bool] = None
    summary_interval: Optional[str] = None
    summary_hour_utc: Optional[int] = None
