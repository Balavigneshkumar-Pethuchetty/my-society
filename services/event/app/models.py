from datetime import datetime
from decimal import Decimal
from typing import Optional
from pydantic import BaseModel, Field


# ── Category ──────────────────────────────────────────────────────────────────

class CategoryOut(BaseModel):
    id: str
    name: str
    icon: Optional[str] = None
    color_hex: Optional[str] = None


class CategoryCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    icon: Optional[str] = None
    color_hex: Optional[str] = Field(None, pattern=r'^#[0-9A-Fa-f]{6}$')


# ── Event ─────────────────────────────────────────────────────────────────────

class TicketTypeSummary(BaseModel):
    name: str
    price: Decimal
    is_free: bool


class EventListItem(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    start_time: datetime
    end_time: datetime
    venue: str
    venue_lat: Optional[float] = None
    venue_lng: Optional[float] = None
    venue_place_id: Optional[str] = None
    venue_address: Optional[str] = None
    capacity: Optional[int] = None
    status: str
    ticket_price: Decimal
    price_currency: str
    is_free: bool
    cancel_freeze_at: Optional[datetime] = None
    category_id: Optional[str] = None
    category_name: Optional[str] = None
    category_color: Optional[str] = None
    organizer_id: str
    organizer_name: str
    # Names of active (non-revoked) event_permission grantees — co-organizers/"person in
    # charge" who share edit access to this specific event alongside the organizer.
    approved_members: list[str] = []
    # True only when the caller IS the organizer — meaningful on `mine=true` responses only,
    # so the frontend can hide organizer-only actions (e.g. managing who else has access)
    # from an approved member who shares edit access but isn't the organizer themselves.
    is_organizer: bool = False
    registration_count: int
    confirmed_tickets: int
    spots_remaining: Optional[int] = None
    is_sold_out: bool
    created_at: datetime
    ticket_types: list[TicketTypeSummary] = []


class EventDetail(EventListItem):
    announcements: list["AnnouncementOut"] = []
    ticket_types: list["TicketTypeOut"] = []
    # Whether the caller (organizer or an approved member) may edit/publish/cancel/complete/
    # delete this specific event — mirrors require_event_access()'s absolute per-event check,
    # so the frontend can hide edit affordances instead of letting them 403 on click.
    has_access: bool = False


class EventCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    venue: str = Field(..., min_length=1, max_length=255)
    venue_lat: Optional[float] = None
    venue_lng: Optional[float] = None
    venue_place_id: Optional[str] = None
    venue_address: Optional[str] = None
    start_time: datetime
    end_time: datetime
    capacity: Optional[int] = Field(None, gt=0)
    ticket_price: Decimal = Field(Decimal("0.00"), ge=0)
    price_currency: str = Field("INR", min_length=3, max_length=3)
    is_free: bool = True
    category_id: Optional[str] = None
    cancel_freeze_at: Optional[datetime] = None


class EventUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    venue: Optional[str] = Field(None, min_length=1, max_length=255)
    venue_lat: Optional[float] = None
    venue_lng: Optional[float] = None
    venue_place_id: Optional[str] = None
    venue_address: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    capacity: Optional[int] = Field(None, gt=0)
    ticket_price: Optional[Decimal] = Field(None, ge=0)
    price_currency: Optional[str] = Field(None, min_length=3, max_length=3)
    is_free: Optional[bool] = None
    category_id: Optional[str] = None
    cancel_freeze_at: Optional[datetime] = None


class EventListResponse(BaseModel):
    events: list[EventListItem]
    total: int
    page: int
    limit: int
    total_pages: int


# ── Internal API (other services, via X-Internal-Key) ────────────────────────
# Lean shapes — raw columns only, no registration/ticket aggregation — since
# these back point-lookups from other services, not the admin UI.

class EventInternal(BaseModel):
    id: str
    society_id: str
    title: str
    start_time: datetime
    end_time: datetime
    venue: str
    venue_lat: Optional[float] = None
    venue_lng: Optional[float] = None
    venue_place_id: Optional[str] = None
    venue_address: Optional[str] = None
    capacity: Optional[int] = None
    status: str
    ticket_price: Decimal
    price_currency: str
    is_free: bool
    cancel_freeze_at: Optional[datetime] = None
    organizer_id: str
    category_id: Optional[str] = None
    category_name: Optional[str] = None
    category_color: Optional[str] = None


class EventManagersOut(BaseModel):
    organizer_id: str
    manager_user_ids: list[str] = []


class AuthorshipSummaryOut(BaseModel):
    organized_event_titles: list[str] = []
    announcement_count: int = 0
    event_permission_granted_count: int = 0


class TicketTypeInternal(BaseModel):
    id: str
    name: str
    sort_order: int


# ── Announcement ──────────────────────────────────────────────────────────────

class AnnouncementOut(BaseModel):
    id: str
    event_id: str
    author_id: str
    author_name: str
    title: str
    body: str
    sent_at: datetime


class AnnouncementCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    body: str = Field(..., min_length=1)


# ── Ticket Type ───────────────────────────────────────────────────────────────

class TicketTypeOut(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    price: Decimal
    is_free: bool
    capacity: Optional[int] = None
    sort_order: int
    is_active: bool


class TicketTypeCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    price: Decimal = Field(Decimal("0.00"), ge=0)
    is_free: bool = False
    capacity: Optional[int] = Field(None, gt=0)
    sort_order: int = Field(0, ge=0)
    is_active: bool = True


class TicketTypeUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    price: Optional[Decimal] = Field(None, ge=0)
    is_free: Optional[bool] = None
    capacity: Optional[int] = Field(None, gt=0)
    sort_order: Optional[int] = Field(None, ge=0)
    is_active: Optional[bool] = None


EventDetail.model_rebuild()


# ── Event permission (per-event delegation) ───────────────────────────────────

class EventPermissionGrant(BaseModel):
    email: str = Field(..., min_length=3)


class EventPermissionOut(BaseModel):
    id: str
    event_id: str
    user_id: str
    user_name: str
    user_email: Optional[str] = None
    granted_by: str
    granted_by_name: str
    granted_at: datetime
