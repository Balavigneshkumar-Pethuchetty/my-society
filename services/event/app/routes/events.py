import json
import math
from decimal import Decimal
from typing import Optional
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from app.auth import _has_event_access, get_current_claims, get_optional_claims, require_event_access, require_role, require_role_or_organizer
from app.cache import cache_delete, cache_delete_pattern, cache_get_json, cache_set_json
from app.config import settings
from app.database import get_pool
from app.models import (
    AnnouncementCreate, AnnouncementOut,
    EventCreate, EventDetail, EventListItem, EventListResponse, EventUpdate,
    EventPermissionGrant, EventPermissionOut,
    TicketTypeOut, TicketTypeCreate, TicketTypeUpdate,
)
from app.notifications import notify_all_users, send_channels
from shared.user_client import get_by_email, get_by_ids, get_by_sub

router = APIRouter()

_SOCIETY = settings.society_id

# ── helpers ───────────────────────────────────────────────────────────────────

_EVENT_COLS = """
    e.id::text,
    e.title,
    e.description,
    e.start_time,
    e.end_time,
    e.venue,
    e.venue_lat,
    e.venue_lng,
    e.venue_place_id,
    e.venue_address,
    e.capacity,
    e.status,
    e.ticket_price,
    e.price_currency,
    e.is_free,
    e.cancel_freeze_at,
    e.created_at,
    e.organizer_id::text,
    ec.id::text          AS category_id,
    ec.name              AS category_name,
    ec.color_hex         AS category_color,
    COALESCE(rc.registration_count, 0)::int  AS registration_count,
    COALESCE(rc.confirmed_tickets,  0)::int  AS confirmed_tickets,
    CASE
        WHEN e.capacity IS NULL THEN NULL
        ELSE GREATEST(0, e.capacity - COALESCE(rc.confirmed_tickets, 0))
    END                  AS spots_remaining,
    (
        SELECT json_agg(
            json_build_object('name', tt.name, 'price', tt.price, 'is_free', tt.is_free)
            ORDER BY tt.sort_order
        )::text
        FROM ticket_type tt
        WHERE tt.event_id = e.id AND tt.is_active = TRUE
    )                    AS ticket_types_json,
    (
        SELECT json_agg(ep.user_id::text ORDER BY ep.granted_at)::text
        FROM event_permission ep
        WHERE ep.event_id = e.id AND ep.revoked_at IS NULL
    )                    AS approved_member_ids_json
"""

_REG_CTE = """
WITH reg_counts AS (
    SELECT event_id,
           COUNT(*)::int                                                    AS registration_count,
           COALESCE(SUM(ticket_count) FILTER (WHERE status='confirmed'),0)::int AS confirmed_tickets
    FROM registration_svc.registration
    GROUP BY event_id
)
"""


async def _hydrate_event_rows(rows) -> dict:
    """organizer_id and approved-member ids are FKs into users, which now lives
    behind user-service's own API (see DB_ISOLATION_PLAN.md) — collect every
    id across all rows and resolve names in one batch call instead of a JOIN
    + a per-row correlated subquery."""
    ids = set()
    for r in rows:
        if r.get("organizer_id"):
            ids.add(r["organizer_id"])
        raw_am = r.get("approved_member_ids_json")
        if raw_am:
            ids.update(json.loads(raw_am))
    return await get_by_ids(ids)


def _to_event_item(row, users: dict, caller_user_id: Optional[str] = None) -> dict:
    d = dict(row)
    capacity  = d.get("capacity")
    remaining = d.get("spots_remaining")
    d["is_sold_out"] = bool(capacity is not None and remaining is not None and remaining <= 0)
    # Parse ticket types JSON (returned as text from the subquery)
    raw = d.pop("ticket_types_json", None)
    d["ticket_types"] = json.loads(raw) if raw else []
    raw_am = d.pop("approved_member_ids_json", None)
    approved_ids = json.loads(raw_am) if raw_am else []
    d["approved_members"] = [users[uid]["name"] for uid in approved_ids if uid in users]
    d["organizer_name"] = users.get(d.get("organizer_id"), {}).get("name")
    # Only meaningful on `mine=true` list responses — lets the frontend hide organizer-only
    # actions (e.g. managing who else has access) from an approved member who isn't the
    # organizer themselves. Left False when the caller isn't resolved (e.g. get_event).
    d["is_organizer"] = caller_user_id is not None and d.get("organizer_id") == caller_user_id
    return d


def _fmt_dt(dt) -> str:
    return dt.strftime("%d %b %Y, %I:%M %p") if dt else "—"


def _fmt_field(field: str, val) -> str:
    if field in ("start_time", "end_time"):
        return _fmt_dt(val)
    if field == "ticket_price":
        return f"₹{Decimal(val):,.2f}"
    if field == "is_free":
        return "Free" if val else "Paid"
    return str(val) if val not in (None, "") else "—"


# Fields worth telling every user about when an organizer edits a *published*
# event — internal-only bookkeeping fields (venue_lat/lng/place_id,
# cancel_freeze_at, category_id) are deliberately left out of the broadcast.
_NOTIFIABLE_FIELDS = [
    ("title",          "Title"),
    ("venue",          "Venue"),
    ("venue_address",  "Address"),
    ("start_time",     "Start"),
    ("end_time",       "End"),
    ("capacity",       "Capacity"),
    ("ticket_price",   "Price"),
    ("is_free",        "Pricing"),
]


def _describe_changes(before: dict, body: "EventUpdate") -> list[str]:
    lines = []
    for field, label in _NOTIFIABLE_FIELDS:
        new_val = getattr(body, field)
        if new_val is None:
            continue
        old_val = before.get(field)
        if str(old_val) == str(new_val):
            continue
        lines.append(f"{label}: {_fmt_field(field, old_val)} → {_fmt_field(field, new_val)}")
    if body.description is not None and body.description != before.get("description"):
        lines.append("Description: updated")
    return lines


# ── GET /events ───────────────────────────────────────────────────────────────

@router.get("", response_model=EventListResponse, summary="Paginated event listing")
async def list_events(
    page:        int            = Query(1,  ge=1),
    limit:       int            = Query(9,  ge=1, le=50),
    search:      Optional[str]  = Query(None),
    category_id: Optional[str]  = Query(None),
    status:      Optional[str]  = Query(None),
    is_free:     Optional[bool] = Query(None),
    sort:        str            = Query("date_asc"),
    mine:        bool           = Query(False, description="Only events the caller organizes or is an approved member of, any status"),
    claims:      Optional[dict] = Depends(get_optional_claims),
):
    order_map = {
        "date_asc":   "e.start_time ASC",
        "date_desc":  "e.start_time DESC",
        "newest":     "e.created_at DESC",
        "price_asc":  "e.ticket_price ASC",
        "price_desc": "e.ticket_price DESC",
        "popular":    "confirmed_tickets DESC",
    }
    order_clause = order_map.get(sort, "e.start_time ASC")
    offset = (page - 1) * limit

    if status is None and not mine:
        status = "published"

    # Only the fully-anonymous default-browsing view is cacheable: no `claims` means
    # `caller_user_id` stays None for the whole request, so the WHERE clause below is
    # 100% deterministic for a given set of query params — no per-user variance to leak.
    cacheable = claims is None and not mine and status == "published"
    cache_key = None
    if cacheable:
        cache_key = "ev:list:" + json.dumps(
            {"page": page, "limit": limit, "search": search, "category_id": category_id,
             "is_free": is_free, "sort": sort},
            sort_keys=True,
        )
        cached = await cache_get_json(cache_key)
        if cached is not None:
            return EventListResponse.model_validate(cached)

    pool = await get_pool()

    is_manager = False
    if claims:
        realm_roles: list[str] = claims.get("realm_access", {}).get("roles", [])
        is_manager = any(r in realm_roles for r in ("admin", "committee_member"))

    # Resolve the caller's internal user id once — used both for `mine=true` and, below, to
    # let a draft's organizer/approved members still see it in the general listing while
    # everyone else can't (drafts aren't "published to everyone" yet, per the isolation model).
    caller_user_id: Optional[str] = None
    if claims:
        caller = await get_by_sub(claims.get("sub", ""))
        if caller:
            caller_user_id = caller["id"]

    if mine:
        if not claims:
            raise HTTPException(status_code=401, detail="Authentication required")
        if not caller_user_id:
            raise HTTPException(status_code=404, detail="User record not found")

    conditions = ["e.society_id = $1"]
    params: list = [_SOCIETY]
    idx = 2

    if status:
        conditions.append(f"e.status = ${idx}")
        params.append(status)
        idx += 1

    if mine:
        # "My Events" — the organizer, or a "person in charge" (active event_permission
        # grantee) sees exactly the events they can actually edit, nothing more.
        conditions.append(
            f"(e.organizer_id = ${idx}::uuid OR EXISTS ("
            f"  SELECT 1 FROM event_permission ep "
            f"  WHERE ep.event_id = e.id AND ep.user_id = ${idx}::uuid AND ep.revoked_at IS NULL"
            f"))"
        )
        params.append(caller_user_id)
        idx += 1
    else:
        # Hide draft events from everyone except their organizer/approved members —
        # only "mine=true" (handled above) or organizer/approved-member access reveals a draft.
        if caller_user_id:
            conditions.append(
                f"(e.status != 'draft' OR e.organizer_id = ${idx}::uuid OR EXISTS ("
                f"  SELECT 1 FROM event_permission ep "
                f"  WHERE ep.event_id = e.id AND ep.user_id = ${idx}::uuid AND ep.revoked_at IS NULL"
                f"))"
            )
            params.append(caller_user_id)
            idx += 1
        else:
            conditions.append("e.status != 'draft'")

    if not is_manager and not mine:
        # Non-managers browsing the general listing (residents, sponsors, security_guard,
        # unauthenticated) never see events that have already ended — admin/committee_member
        # still need past events visible for management/records, and "mine" is an explicit
        # request for the caller's own history regardless of date.
        conditions.append("e.end_time >= now()")

    if search:
        conditions.append(f"(e.title ILIKE ${idx} OR e.title % ${idx})")
        params.append(f"%{search}%")
        idx += 1

    if category_id:
        conditions.append(f"e.category_id = ${idx}::uuid")
        params.append(category_id)
        idx += 1

    if is_free is not None:
        conditions.append(f"e.is_free = ${idx}")
        params.append(is_free)
        idx += 1

    where = " AND ".join(conditions)

    count_sql = (
        f"{_REG_CTE} "
        f"SELECT COUNT(*) FROM event e "
        f"LEFT JOIN event_category ec ON ec.id = e.category_id "
        f"LEFT JOIN reg_counts rc ON rc.event_id = e.id "
        f"WHERE {where}"
    )
    data_sql = (
        f"{_REG_CTE} "
        f"SELECT {_EVENT_COLS} FROM event e "
        f"LEFT JOIN event_category ec ON ec.id = e.category_id "
        f"LEFT JOIN reg_counts rc ON rc.event_id = e.id "
        f"WHERE {where} "
        f"ORDER BY {order_clause} "
        f"LIMIT ${idx} OFFSET ${idx+1}"
    )
    params_page = params + [limit, offset]

    async with pool.acquire() as conn:
        total = await conn.fetchval(count_sql, *params)
        rows  = await conn.fetch(data_sql, *params_page)

    users = await _hydrate_event_rows(rows)
    total = total or 0
    total_pages = max(1, math.ceil(total / limit))
    response = EventListResponse(
        events=[_to_event_item(r, users, caller_user_id) for r in rows],
        total=total,
        page=page,
        limit=limit,
        total_pages=total_pages,
    )
    if cacheable:
        await cache_set_json(cache_key, response.model_dump(mode="json"))
    return response


# ── GET /events/{event_id} ────────────────────────────────────────────────────

@router.get("/{event_id}", response_model=EventDetail, summary="Event detail")
async def get_event(
    event_id: str,
    claims:   Optional[dict] = Depends(get_optional_claims),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"{_REG_CTE} "
            f"SELECT {_EVENT_COLS} FROM event e "
            f"LEFT JOIN event_category ec ON ec.id = e.category_id "
            f"LEFT JOIN reg_counts rc ON rc.event_id = e.id "
            f"WHERE e.id = $1::uuid AND e.society_id = $2::uuid",
            event_id, _SOCIETY,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")

        has_access = await _has_event_access(conn, claims.get("sub") if claims else None, event_id)

        # A draft isn't "published to everyone" yet — hide it from anyone who isn't its
        # organizer or an approved member, same as it's hidden from the general listing.
        # 404 (not 403) so it doesn't even reveal the draft exists.
        if row["status"] == "draft" and not has_access:
            raise HTTPException(status_code=404, detail="Event not found")

        ann_rows = await conn.fetch(
            "SELECT a.id::text, a.event_id::text, a.author_id::text, "
            "a.title, a.body, a.sent_at "
            "FROM announcement a "
            "WHERE a.event_id = $1::uuid ORDER BY a.sent_at DESC",
            event_id,
        )
        tt_rows = await conn.fetch(
            "SELECT id::text, name, description, price, is_free, capacity, "
            "sort_order, is_active "
            "FROM ticket_type WHERE event_id = $1::uuid AND is_active = TRUE "
            "ORDER BY sort_order",
            event_id,
        )

    users = await _hydrate_event_rows([row])
    authors = await get_by_ids(r["author_id"] for r in ann_rows)

    event_dict = _to_event_item(row, users)
    event_dict["announcements"] = [
        {**dict(r), "author_name": authors.get(r["author_id"], {}).get("name")} for r in ann_rows
    ]
    event_dict["ticket_types"]  = [dict(r) for r in tt_rows]
    event_dict["has_access"]    = has_access
    return event_dict


# ── POST /events ──────────────────────────────────────────────────────────────

@router.post("", status_code=201, summary="Create event (admin/committee/resident)")
async def create_event(
    body:   EventCreate,
    claims: dict = Depends(require_role("admin", "committee_member", "resident")),
):
    if body.end_time <= body.start_time:
        raise HTTPException(status_code=422, detail="end_time must be after start_time")
    if body.cancel_freeze_at is not None and body.cancel_freeze_at >= body.start_time:
        raise HTTPException(status_code=422, detail="cancel_freeze_at must be before start_time")

    organizer_sub = claims.get("sub")
    organizer = await get_by_sub(organizer_sub or "")
    if not organizer:
        raise HTTPException(status_code=404, detail="Organizer user record not found")

    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "INSERT INTO event (society_id, category_id, organizer_id, title, description, "
            "start_time, end_time, venue, venue_lat, venue_lng, venue_place_id, venue_address, "
            "capacity, ticket_price, price_currency, is_free, cancel_freeze_at, status) "
            "VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'draft') "
            "RETURNING id::text",
            _SOCIETY,
            body.category_id,
            organizer["id"],
            body.title,
            body.description,
            body.start_time,
            body.end_time,
            body.venue,
            body.venue_lat,
            body.venue_lng,
            body.venue_place_id,
            body.venue_address,
            body.capacity,
            body.ticket_price,
            body.price_currency,
            body.is_free,
            body.cancel_freeze_at,
        )
    await cache_delete_pattern("ev:list:*")
    return {"id": row["id"], "status": "draft"}


# ── PUT /events/{event_id} ────────────────────────────────────────────────────

@router.put("/{event_id}", summary="Update event details (admin/committee/organizer)")
async def update_event(
    event_id:          str,
    body:               EventUpdate,
    background_tasks:  BackgroundTasks,
    claims:            dict = Depends(require_event_access()),
):
    pool = await get_pool()
    recipients: list[dict] = []
    notify_message = ""
    notify_title = ""
    async with pool.acquire() as conn:
        event = await conn.fetchrow(
            "SELECT status, title, description, venue, venue_address, start_time, end_time, "
            "capacity, ticket_price, is_free "
            "FROM event WHERE id=$1::uuid AND society_id=$2::uuid",
            event_id, _SOCIETY,
        )
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")
        if event["status"] not in ("draft", "published"):
            raise HTTPException(status_code=409, detail="Cannot edit a cancelled or completed event")

        if body.cancel_freeze_at is not None:
            effective_start = body.start_time or event["start_time"]
            if body.cancel_freeze_at >= effective_start:
                raise HTTPException(status_code=422, detail="cancel_freeze_at must be before start_time")

        updates: list[str] = []
        params: list = []
        idx = 1

        for field, col in [
            ("title", "title"), ("description", "description"),
            ("venue", "venue"), ("venue_lat", "venue_lat"), ("venue_lng", "venue_lng"),
            ("venue_place_id", "venue_place_id"), ("venue_address", "venue_address"),
            ("start_time", "start_time"), ("end_time", "end_time"),
            ("capacity", "capacity"), ("ticket_price", "ticket_price"),
            ("price_currency", "price_currency"), ("is_free", "is_free"),
            ("category_id", "category_id"), ("cancel_freeze_at", "cancel_freeze_at"),
        ]:
            val = getattr(body, field)
            if val is not None:
                cast = "::uuid" if field == "category_id" else ""
                updates.append(f"{col} = ${idx}{cast}")
                params.append(val)
                idx += 1

        if not updates:
            raise HTTPException(status_code=422, detail="No fields to update")

        params += [event_id, _SOCIETY]
        await conn.execute(
            f"UPDATE event SET {', '.join(updates)} "
            f"WHERE id=${idx}::uuid AND society_id=${idx+1}::uuid",
            *params,
        )

        # Only a *published* event is something residents may already have registered
        # for / planned around — a draft edit has nothing to broadcast yet.
        if event["status"] == "published":
            changes = _describe_changes(dict(event), body)
            if changes:
                notify_title = f'"{event["title"]}" was updated'
                notify_message = (
                    f'The event "{event["title"]}" has been updated:\n' + "\n".join(changes) +
                    f"\n\nView: {settings.app_public_url}/events"
                )
                recipients = await notify_all_users(
                    event_id, "event_updated", notify_title, notify_message, related_id=event_id,
                )

    if recipients:
        background_tasks.add_task(send_channels, recipients, notify_message, notify_title)

    await cache_delete_pattern("ev:list:*")
    return {"id": event_id, "updated": True}


# ── PATCH /events/{event_id}/publish ─────────────────────────────────────────

@router.patch("/{event_id}/publish", summary="Publish a draft event")
async def publish_event(
    event_id: str,
    background_tasks: BackgroundTasks,
    claims:   dict = Depends(require_event_access()),
):
    pool = await get_pool()
    recipients: list[dict] = []
    notify_message = ""
    notify_title = ""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE event SET status='published' "
            "WHERE id=$1::uuid AND society_id=$2::uuid AND status='draft' "
            "RETURNING title",
            event_id, _SOCIETY,
        )
        if not row:
            raise HTTPException(status_code=409, detail="Event not found or not in draft state")

        notify_title = f'New event: "{row["title"]}"'
        notify_message = (
            f'A new event "{row["title"]}" has been published. '
            f"View: {settings.app_public_url}/events"
        )
        recipients = await notify_all_users(
            event_id, "event_published", notify_title, notify_message, related_id=event_id,
        )

    if recipients:
        background_tasks.add_task(send_channels, recipients, notify_message, notify_title)
    await cache_delete_pattern("ev:list:*")
    return {"id": event_id, "status": "published"}


# ── PATCH /events/{event_id}/cancel ──────────────────────────────────────────

@router.patch("/{event_id}/cancel", summary="Cancel a published event")
async def cancel_event(
    event_id: str,
    claims:   dict = Depends(require_event_access()),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            "UPDATE event SET status='cancelled' "
            "WHERE id=$1::uuid AND society_id=$2::uuid AND status='published'",
            event_id, _SOCIETY,
        )
    if result == "UPDATE 0":
        raise HTTPException(status_code=409, detail="Event not found or not published")
    await cache_delete_pattern("ev:list:*")
    return {"id": event_id, "status": "cancelled"}


# ── PATCH /events/{event_id}/complete ────────────────────────────────────────

@router.patch("/{event_id}/complete", summary="Mark an event as completed")
async def complete_event(
    event_id: str,
    claims:   dict = Depends(require_event_access()),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            "UPDATE event SET status='completed' "
            "WHERE id=$1::uuid AND society_id=$2::uuid AND status='published'",
            event_id, _SOCIETY,
        )
    if result == "UPDATE 0":
        raise HTTPException(status_code=409, detail="Event not found or not published")
    await cache_delete_pattern("ev:list:*")
    return {"id": event_id, "status": "completed"}


# ── DELETE /events/{event_id} ─────────────────────────────────────────────────

@router.delete("/{event_id}", status_code=204,
               summary="Delete a draft or completed event (organizer/approved member)")
async def delete_event(
    event_id: str,
    claims:   dict = Depends(require_event_access()),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM event "
            "WHERE id=$1::uuid AND society_id=$2::uuid AND status IN ('draft', 'completed')",
            event_id, _SOCIETY,
        )
    if result == "DELETE 0":
        raise HTTPException(status_code=409,
                             detail="Event not found or not in a deletable state (must be draft or completed)")
    await cache_delete_pattern("ev:list:*")


# ── GET /events/{event_id}/announcements ─────────────────────────────────────

@router.get("/{event_id}/announcements",
            response_model=list[AnnouncementOut],
            summary="List announcements for an event")
async def list_announcements(
    event_id: str,
    _claims:  Optional[dict] = Depends(get_optional_claims),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        exists = await conn.fetchval(
            "SELECT 1 FROM event WHERE id=$1::uuid AND society_id=$2::uuid",
            event_id, _SOCIETY,
        )
        if not exists:
            raise HTTPException(status_code=404, detail="Event not found")

        rows = await conn.fetch(
            "SELECT a.id::text, a.event_id::text, a.author_id::text, "
            "a.title, a.body, a.sent_at "
            "FROM announcement a "
            "WHERE a.event_id = $1::uuid ORDER BY a.sent_at DESC",
            event_id,
        )
    authors = await get_by_ids(r["author_id"] for r in rows)
    return [
        {**dict(r), "author_name": authors.get(r["author_id"], {}).get("name")} for r in rows
    ]


# ── POST /events/{event_id}/announcements ────────────────────────────────────

@router.post("/{event_id}/announcements",
             response_model=AnnouncementOut,
             status_code=201,
             summary="Post an announcement (admin/committee)")
async def create_announcement(
    event_id: str,
    body:     AnnouncementCreate,
    claims:   dict = Depends(require_event_access()),
):
    author_sub = claims.get("sub")
    author = await get_by_sub(author_sub or "")
    if not author:
        raise HTTPException(status_code=404, detail="Author user record not found")

    pool = await get_pool()
    async with pool.acquire() as conn:
        event = await conn.fetchrow(
            "SELECT status FROM event WHERE id=$1::uuid AND society_id=$2::uuid",
            event_id, _SOCIETY,
        )
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")
        if event["status"] not in ("published", "completed"):
            raise HTTPException(status_code=409, detail="Announcements only for published or completed events")

        row = await conn.fetchrow(
            "INSERT INTO announcement (event_id, author_id, title, body) "
            "VALUES ($1::uuid, $2::uuid, $3, $4) "
            "RETURNING id::text, event_id::text, author_id::text, title, body, sent_at",
            event_id, author["id"], body.title, body.body,
        )
    result = dict(row)
    result["author_name"] = author["name"]
    return result


# ── Ticket Type CRUD ──────────────────────────────────────────────────────────

_TT_SELECT = (
    "SELECT id::text, name, description, price, is_free, capacity, sort_order, is_active "
    "FROM ticket_type WHERE event_id = $1::uuid ORDER BY sort_order, name"
)


@router.get("/{event_id}/ticket-types",
            response_model=list[TicketTypeOut],
            summary="List ticket types for an event")
async def list_ticket_types(
    event_id: str,
    _claims: Optional[dict] = Depends(get_optional_claims),
):
    cache_key = f"tt:list:{event_id}"
    cached = await cache_get_json(cache_key)
    if cached is not None:
        return cached

    pool = await get_pool()
    async with pool.acquire() as conn:
        exists = await conn.fetchval(
            "SELECT 1 FROM event WHERE id=$1::uuid AND society_id=$2::uuid",
            event_id, _SOCIETY,
        )
        if not exists:
            raise HTTPException(status_code=404, detail="Event not found")
        rows = await conn.fetch(_TT_SELECT, event_id)
    result = [dict(r) for r in rows]
    await cache_set_json(cache_key, result)
    return result


@router.post("/{event_id}/ticket-types",
             response_model=TicketTypeOut,
             status_code=201,
             summary="Add a ticket type (admin/committee)")
async def create_ticket_type(
    event_id: str,
    body: TicketTypeCreate,
    claims: dict = Depends(require_event_access()),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        exists = await conn.fetchval(
            "SELECT 1 FROM event WHERE id=$1::uuid AND society_id=$2::uuid",
            event_id, _SOCIETY,
        )
        if not exists:
            raise HTTPException(status_code=404, detail="Event not found")

        # Auto-assign sort_order if not provided (append at end)
        if body.sort_order == 0:
            max_order = await conn.fetchval(
                "SELECT COALESCE(MAX(sort_order), 0) FROM ticket_type WHERE event_id=$1::uuid",
                event_id,
            )
            sort_order = (max_order or 0) + 1
        else:
            sort_order = body.sort_order

        row = await conn.fetchrow(
            "INSERT INTO ticket_type (event_id, name, description, price, is_free, "
            "capacity, sort_order, is_active) "
            "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8) "
            "RETURNING id::text, name, description, price, is_free, capacity, sort_order, is_active",
            event_id, body.name, body.description,
            body.price if not body.is_free else 0,
            body.is_free, body.capacity, sort_order, body.is_active,
        )
    await cache_delete(f"tt:list:{event_id}")
    return dict(row)


@router.put("/{event_id}/ticket-types/{type_id}",
            response_model=TicketTypeOut,
            summary="Update a ticket type (admin/committee)")
async def update_ticket_type(
    event_id: str,
    type_id: str,
    body: TicketTypeUpdate,
    claims: dict = Depends(require_event_access()),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT id FROM ticket_type WHERE id=$1::uuid AND event_id=$2::uuid",
            type_id, event_id,
        )
        if not existing:
            raise HTTPException(status_code=404, detail="Ticket type not found")

        updates: list[str] = []
        params: list = []
        idx = 1
        for field in ("name", "description", "price", "is_free", "capacity", "sort_order", "is_active"):
            val = getattr(body, field)
            if val is not None:
                updates.append(f"{field} = ${idx}")
                params.append(val)
                idx += 1

        # If is_free toggled to True, zero out price
        if body.is_free is True:
            if "price" not in [u.split(" = ")[0] for u in updates]:
                updates.append(f"price = ${idx}")
                params.append(0)
                idx += 1

        if not updates:
            raise HTTPException(status_code=422, detail="No fields to update")

        params += [type_id]
        row = await conn.fetchrow(
            f"UPDATE ticket_type SET {', '.join(updates)} WHERE id=${idx}::uuid "
            "RETURNING id::text, name, description, price, is_free, capacity, sort_order, is_active",
            *params,
        )
    await cache_delete(f"tt:list:{event_id}")
    return dict(row)


@router.delete("/{event_id}/ticket-types/{type_id}",
               status_code=204,
               summary="Delete a ticket type (admin/committee)")
async def delete_ticket_type(
    event_id: str,
    type_id: str,
    claims: dict = Depends(require_event_access()),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM ticket_type WHERE id=$1::uuid AND event_id=$2::uuid",
            type_id, event_id,
        )
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Ticket type not found")
    await cache_delete(f"tt:list:{event_id}")


# ── Event permission (approved-member delegation) ─────────────────────────────
# Organizer-only — approved members don't get to grant further access themselves.
# Uses require_role_or_organizer() with no roles passed, which reduces to a pure
# organizer check (the role-bypass list is empty, so only the organizer_id match applies).

_PERMISSION_SELECT = (
    "SELECT ep.id::text, ep.event_id::text, ep.user_id::text, "
    "ep.granted_by::text, ep.granted_at "
    "FROM event_permission ep "
)


async def _hydrate_permission_rows(rows) -> list[dict]:
    """user_id/granted_by are FKs into users, which now lives behind
    user-service's own API (see DB_ISOLATION_PLAN.md) — resolve both in one
    batch call instead of two JOINs."""
    ids = {r["user_id"] for r in rows} | {r["granted_by"] for r in rows}
    users = await get_by_ids(ids)
    hydrated = []
    for r in rows:
        d = dict(r)
        u = users.get(d["user_id"], {})
        d["user_name"] = u.get("name")
        d["user_email"] = u.get("email")
        d["granted_by_name"] = users.get(d["granted_by"], {}).get("name")
        hydrated.append(d)
    return hydrated


@router.get("/{event_id}/permissions", response_model=list[EventPermissionOut],
            summary="List approved members for an event (organizer-only)")
async def list_permissions(
    event_id: str,
    claims: dict = Depends(require_role_or_organizer()),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            _PERMISSION_SELECT + "WHERE ep.event_id = $1::uuid AND ep.revoked_at IS NULL "
            "ORDER BY ep.granted_at DESC",
            event_id,
        )
    return await _hydrate_permission_rows(rows)


@router.post("/{event_id}/permissions", response_model=EventPermissionOut, status_code=201,
             summary="Grant a user access to manage this event (organizer-only)")
async def grant_permission(
    event_id: str,
    body: EventPermissionGrant,
    claims: dict = Depends(require_role_or_organizer()),
):
    target = await get_by_email(body.email)
    if not target:
        raise HTTPException(status_code=404, detail="No user found with that email")
    granter = await get_by_sub(claims.get("sub", ""))
    if not granter:
        raise HTTPException(status_code=404, detail="Granter user record not found")

    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "INSERT INTO event_permission (event_id, user_id, granted_by) "
            "VALUES ($1::uuid, $2::uuid, $3::uuid) "
            "ON CONFLICT (event_id, user_id) DO UPDATE SET "
            "  granted_by = EXCLUDED.granted_by, granted_at = now(), revoked_at = NULL "
            "RETURNING id",
            event_id, target["id"], granter["id"],
        )
        full = await conn.fetchrow(_PERMISSION_SELECT + "WHERE ep.id = $1::uuid", row["id"])
    return (await _hydrate_permission_rows([full]))[0]


@router.delete("/{event_id}/permissions/{user_id}", status_code=204,
               summary="Revoke a user's access to this event (organizer-only)")
async def revoke_permission(
    event_id: str,
    user_id: str,
    claims: dict = Depends(require_role_or_organizer()),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            "UPDATE event_permission SET revoked_at = now() "
            "WHERE event_id = $1::uuid AND user_id = $2::uuid AND revoked_at IS NULL",
            event_id, user_id,
        )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Active permission not found")
