import asyncio
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException

from app.auth import require_role
from app.database import get_pool
from app.email import send_complimentary_ticket_email
from app.event_client import get_event
from app.models import ComplimentaryTicketCreate, ComplimentaryTicketOut, WalkInCreate
from app.ticket_client import cancel_ticket_by_reg, get_tickets_by_reg_ids, issue_ticket
from shared.user_client import create_guest, get_by_id, get_by_ids, get_by_sub

router = APIRouter()

_ELIGIBLE_ROLES = {
    "organizer": ("admin", "committee_member"),
    "committee_member": ("committee_member",),
    "sponsor": ("sponsor",),
}

_COMP_QUERY = """
    SELECT
        ct.id::text, ct.event_id::text, ct.inviter_type,
        ct.invited_by_user_id::text,
        ct.guest_name, ct.guest_email, ct.registration_id::text,
        ct.ticket_count, ct.notes,
        ct.created_by::text,
        ct.created_at, ct.cancelled_at, ct.emailed_at
    FROM complimentary_ticket ct
"""


async def _get_db_user_id(sub: str) -> str:
    user = await get_by_sub(sub)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user["id"]


async def _hydrate_comp_rows(rows) -> list[dict]:
    """invited_by_user_id/created_by are FKs into users, which now lives behind
    user-service's own API (see DB_ISOLATION_PLAN.md) — resolve both ids' names
    via one batch call instead of two JOINs. ticket_id/ticket_status/qr_token
    used to come from a LEFT JOIN ticket — ticket now lives in ticket-service's
    own schema, so batch-fetch those from its internal API instead."""
    ids = [r["invited_by_user_id"] for r in rows if r["invited_by_user_id"]]
    ids += [r["created_by"] for r in rows if r["created_by"]]
    users = await get_by_ids(ids)
    tickets = await get_tickets_by_reg_ids(r["registration_id"] for r in rows)
    hydrated = []
    for r in rows:
        d = dict(r)
        d["invited_by_name"] = users.get(d["invited_by_user_id"], {}).get("name")
        d["created_by_name"] = users.get(d["created_by"], {}).get("name")
        t = tickets.get(d["registration_id"], {})
        d["ticket_id"] = t.get("id")
        d["ticket_status"] = t.get("status")
        d["qr_token"] = t.get("qr_token")
        hydrated.append(d)
    return hydrated


async def _hydrate_comp_row(row) -> dict:
    return (await _hydrate_comp_rows([row]))[0]


def _build_out(row) -> ComplimentaryTicketOut:
    return ComplimentaryTicketOut(
        id=row["id"], event_id=row["event_id"], inviter_type=row["inviter_type"],
        invited_by_user_id=row["invited_by_user_id"], invited_by_name=row.get("invited_by_name"),
        guest_name=row.get("guest_name"), guest_email=row.get("guest_email"),
        ticket_id=row.get("ticket_id"), ticket_status=row.get("ticket_status"), qr_token=row.get("qr_token"),
        ticket_count=row["ticket_count"], notes=row.get("notes"),
        created_by=row["created_by"], created_by_name=row.get("created_by_name"),
        created_at=row["created_at"], cancelled_at=row.get("cancelled_at"), emailed_at=row.get("emailed_at"),
    )


# ── POST /complimentary/tickets — named guest or named walk-in, real ticket + QR ──

@router.post("/tickets", response_model=ComplimentaryTicketOut, status_code=201,
             summary="Issue a complimentary ticket to a named guest, incl. a named walk-in (admin/committee)")
async def create_complimentary_ticket(
    body: ComplimentaryTicketCreate,
    claims: dict = Depends(require_role("admin", "committee_member")),
):
    sub = claims.get("sub", "")
    issuer_id = await _get_db_user_id(sub)

    event = await get_event(body.event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event["status"] in ("completed", "cancelled"):
        raise HTTPException(status_code=400, detail=f"Event is {event['status']} — complimentary tickets can no longer be issued")

    if body.inviter_type == "walk_in":
        # Named walk-in: no specific inviter — the guest just showed up and gave a name.
        invited_by_user_id = None
    else:
        if not body.invited_by_user_id:
            raise HTTPException(status_code=422, detail="invited_by_user_id is required for this inviter type")
        inviter = await get_by_id(body.invited_by_user_id)
        if not inviter:
            raise HTTPException(status_code=404, detail="Inviter not found")
        if inviter["role"] not in _ELIGIBLE_ROLES[body.inviter_type]:
            raise HTTPException(
                status_code=422,
                detail=f"Selected inviter must have role: {', '.join(_ELIGIBLE_ROLES[body.inviter_type])}",
            )
        invited_by_user_id = body.invited_by_user_id

    # Guests may not have an account — create a lightweight placeholder
    # (no keycloak_sub, so it can never log in) to satisfy the FK on
    # registration/ticket, same as any other resident row.
    guest_id = await create_guest(body.guest_name)

    pool = await get_pool()
    async with pool.acquire() as conn:
        reg_id = await conn.fetchval(
            "INSERT INTO registration (event_id, user_id, ticket_count, total_amount, display_currency, status) "
            "VALUES ($1::uuid, $2::uuid, $3, 0, $4, 'confirmed') RETURNING id::text",
            body.event_id, guest_id, body.ticket_count, event["price_currency"],
        )

        comp_id = await conn.fetchval(
            "INSERT INTO complimentary_ticket "
            "(event_id, invited_by_user_id, inviter_type, registration_id, guest_user_id, "
            "guest_name, guest_email, ticket_count, notes, created_by) "
            "VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6, $7, $8, $9, $10::uuid) "
            "RETURNING id::text",
            body.event_id, invited_by_user_id, body.inviter_type, reg_id, guest_id,
            body.guest_name, body.guest_email, body.ticket_count, body.notes, issuer_id,
        )

        row = await conn.fetchrow(_COMP_QUERY + " WHERE ct.id = $1::uuid", comp_id)

    await issue_ticket(reg_id, guest_id, body.event_id)
    return _build_out(await _hydrate_comp_row(row))


# ── GET /complimentary/tickets — list for an event ────────────────────────────

@router.get("/tickets", response_model=list[ComplimentaryTicketOut],
            summary="List complimentary tickets + walk-ins for an event (admin/committee)")
async def list_complimentary_tickets(
    event_id: str,
    claims: dict = Depends(require_role("admin", "committee_member")),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            _COMP_QUERY + " WHERE ct.event_id = $1::uuid ORDER BY ct.created_at DESC",
            event_id,
        )
    return [_build_out(r) for r in await _hydrate_comp_rows(rows)]


# ── DELETE /complimentary/tickets/{id} — revoke (soft-cancel, keeps history) ──

@router.delete("/tickets/{comp_id}", status_code=204,
                summary="Revoke a complimentary ticket or walk-in log entry (admin/committee)")
async def cancel_complimentary_ticket(
    comp_id: str,
    claims: dict = Depends(require_role("admin", "committee_member")),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, registration_id::text, cancelled_at FROM complimentary_ticket WHERE id = $1::uuid",
            comp_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Entry not found")
        if row["cancelled_at"] is not None:
            raise HTTPException(status_code=400, detail="Already cancelled")

        await conn.execute(
            "UPDATE complimentary_ticket SET cancelled_at = now() WHERE id = $1::uuid", comp_id
        )
        if row["registration_id"]:
            await conn.execute(
                "UPDATE registration SET status = 'cancelled' WHERE id = $1::uuid", row["registration_id"]
            )

    if row["registration_id"]:
        await cancel_ticket_by_reg(row["registration_id"])


# ── POST /complimentary/tickets/{id}/email — email the QR ticket to the guest ─

@router.post("/tickets/{comp_id}/email", response_model=ComplimentaryTicketOut,
             summary="Email the QR ticket to the guest (admin/committee)")
async def email_complimentary_ticket(
    comp_id: str,
    claims: dict = Depends(require_role("admin", "committee_member")),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            _COMP_QUERY + " WHERE ct.id = $1::uuid", comp_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Entry not found")
        if row["cancelled_at"] is not None:
            raise HTTPException(status_code=400, detail="Cannot email a cancelled ticket")
        if not row["ticket_id"] or not row["qr_token"]:
            raise HTTPException(status_code=400, detail="This entry has no ticket to email (e.g. a walk-in log)")
        if not row["guest_email"]:
            raise HTTPException(status_code=400, detail="No email address on file for this guest")

        event = await get_event(row["event_id"])
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")

        if event["venue_lat"] is not None and event["venue_lng"] is not None:
            maps_url = f"https://www.google.com/maps?q={event['venue_lat']},{event['venue_lng']}"
        else:
            maps_query = event["venue_address"] or event["venue"]
            maps_url = f"https://www.google.com/maps/search/?api=1&query={quote(maps_query)}"

        try:
            await asyncio.to_thread(
                send_complimentary_ticket_email,
                row["guest_email"], row["guest_name"] or "Guest",
                event["title"], event["start_time"].strftime("%d %b %Y, %I:%M %p"), event["venue"],
                row["ticket_count"], row["qr_token"], maps_url,
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Failed to send email: {exc}") from exc

        await conn.execute(
            "UPDATE complimentary_ticket SET emailed_at = now() WHERE id = $1::uuid", comp_id
        )
        row = await conn.fetchrow(_COMP_QUERY + " WHERE ct.id = $1::uuid", comp_id)
    return _build_out(await _hydrate_comp_row(row))


# ── POST /complimentary/walk-ins — headcount log, no ticket/QR ───────────────

@router.post("/walk-ins", response_model=ComplimentaryTicketOut, status_code=201,
             summary="Log a walk-in headcount batch (admin/committee/security)")
async def create_walk_in(
    body: WalkInCreate,
    claims: dict = Depends(require_role("admin", "committee_member", "security_guard")),
):
    sub = claims.get("sub", "")
    logger_id = await _get_db_user_id(sub)
    pool = await get_pool()
    async with pool.acquire() as conn:
        event = await get_event(body.event_id)
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")
        if event["status"] in ("completed", "cancelled"):
            raise HTTPException(status_code=400, detail=f"Event is {event['status']} — walk-ins can no longer be logged")

        comp_id = await conn.fetchval(
            "INSERT INTO complimentary_ticket (event_id, inviter_type, ticket_count, notes, created_by) "
            "VALUES ($1::uuid, 'walk_in', $2, $3, $4::uuid) RETURNING id::text",
            body.event_id, body.ticket_count, body.notes, logger_id,
        )
        row = await conn.fetchrow(_COMP_QUERY + " WHERE ct.id = $1::uuid", comp_id)
    return _build_out(await _hydrate_comp_row(row))
