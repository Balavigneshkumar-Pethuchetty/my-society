"""Internal endpoints — only reachable by other containers on society_net.
Protected by X-Internal-Key header; never proxied through nginx.

Exists so that registration/ticket/payment/user-service, which used to JOIN
directly into `event`/`event_category`/`ticket_type`/`announcement`/
`event_permission`, can keep working now that those tables live in the
`event_svc` Postgres schema (see DB_ISOLATION_PLAN.md) instead of `public`.
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query

from app.database import get_pool
from app.auth import require_internal_key
from app.models import AuthorshipSummaryOut, EventInternal, EventManagersOut, TicketTypeInternal

router = APIRouter(dependencies=[Depends(require_internal_key)])
ticket_types_router = APIRouter(dependencies=[Depends(require_internal_key)])

_EVENT_COLS = """
    e.id::text, e.society_id::text, e.title, e.start_time, e.end_time,
    e.venue, e.venue_lat, e.venue_lng, e.venue_place_id, e.venue_address,
    e.capacity, e.status, e.ticket_price, e.price_currency, e.is_free,
    e.cancel_freeze_at, e.organizer_id::text, e.category_id::text,
    ec.name AS category_name, ec.color_hex AS category_color
"""
_EVENT_FROM = "FROM event e LEFT JOIN event_category ec ON ec.id = e.category_id"


@router.get("/{event_id}", response_model=EventInternal, summary="Single event detail")
async def get_event(event_id: str, pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"SELECT {_EVENT_COLS} {_EVENT_FROM} WHERE e.id = $1::uuid", event_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Event not found")
    return dict(row)


@router.get("", response_model=list[EventInternal], summary="Batch event detail")
async def get_events(ids: str = Query(..., description="Comma-separated event ids"), pool=Depends(get_pool)):
    id_list = [i for i in ids.split(",") if i]
    if not id_list:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"SELECT {_EVENT_COLS} {_EVENT_FROM} WHERE e.id = ANY($1::uuid[])", id_list,
        )
    return [dict(r) for r in rows]


@router.get("/{event_id}/managers", response_model=EventManagersOut,
            summary="Organizer + active event_permission holders")
async def get_managers(event_id: str, pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        event = await conn.fetchrow("SELECT organizer_id::text FROM event WHERE id = $1::uuid", event_id)
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")
        rows = await conn.fetch(
            "SELECT user_id::text FROM event_permission WHERE event_id = $1::uuid AND revoked_at IS NULL",
            event_id,
        )
    return EventManagersOut(
        organizer_id=event["organizer_id"],
        manager_user_ids=[r["user_id"] for r in rows],
    )


@router.get("/authorship-summary/{user_id}", response_model=AuthorshipSummaryOut,
            summary="Events organized/authored/permission-granted by a user (leave-request blockers)")
async def get_authorship_summary(user_id: str, pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        organized = await conn.fetch("SELECT title FROM event WHERE organizer_id = $1::uuid", user_id)
        announcement_count = await conn.fetchval(
            "SELECT COUNT(*) FROM announcement WHERE author_id = $1::uuid", user_id,
        )
        granted_count = await conn.fetchval(
            "SELECT COUNT(*) FROM event_permission WHERE granted_by = $1::uuid", user_id,
        )
    return AuthorshipSummaryOut(
        organized_event_titles=[r["title"] for r in organized],
        announcement_count=announcement_count,
        event_permission_granted_count=granted_count,
    )


@ticket_types_router.get("", response_model=dict[str, TicketTypeInternal],
                          summary="Batch ticket-type name/sort_order, keyed by id")
async def get_ticket_types(ids: str = Query(..., description="Comma-separated ticket_type ids"), pool=Depends(get_pool)):
    id_list = [i for i in ids.split(",") if i]
    if not id_list:
        return {}
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id::text, name, sort_order FROM ticket_type WHERE id = ANY($1::uuid[])",
            id_list,
        )
    return {r["id"]: TicketTypeInternal(**dict(r)) for r in rows}
