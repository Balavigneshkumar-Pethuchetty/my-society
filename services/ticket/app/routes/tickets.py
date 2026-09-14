import io
import uuid
from datetime import datetime, timezone

import qrcode
import qrcode.image.svg
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response as FastAPIResponse

from app.auth import get_current_claims, require_role
from app.database import get_pool
from app.event_client import get_event, get_events, get_ticket_types
from app.models import EventTicketItem, ScanBody, ScanOut, TicketOut
from shared.user_client import get_by_id, get_by_ids, get_by_sub

router = APIRouter()

_TICKET_QUERY = """
    SELECT
        t.id::text,
        t.reg_id::text,
        t.event_id::text,
        t.user_id::text,
        t.qr_token,
        t.status,
        t.issued_at,
        t.scanned_at,
        r.id::text AS registration_id,
        r.ticket_count,
        r.total_amount,
        r.display_currency,
        -- When this registration was actually paid/reconciled: prefer the centralized
        -- reconciliation flow's audit trail (exact moment it flipped to 'verified', not
        -- its `updated_at` which also moves on later refund transitions), falling back
        -- to the legacy manual-payment flow's `payment.paid_at`. NULL for free tickets.
        COALESCE(
            (SELECT pal.at
             FROM payment_svc.payment_transaction pt
             JOIN payment_svc.payment_audit_log pal ON pal.txn_id = pt.id AND pal.to_status = 'verified'
             WHERE pt.registration_id = r.id
             ORDER BY pal.at DESC LIMIT 1),
            (SELECT p.paid_at FROM registration_svc.payment p
             WHERE p.registration_id = r.id AND p.paid_at IS NOT NULL
             ORDER BY p.paid_at DESC LIMIT 1)
        ) AS paid_at,
        -- On a self/admin cancellation, the ticket row itself just flips to 'cancelled' —
        -- whether the refund has actually been paid out lives on payment_transaction instead,
        -- so surface it here too rather than leaving the resident with no way to tell
        -- "still waiting on the committee" from "already refunded".
        (SELECT pt.status FROM payment_svc.payment_transaction pt
         WHERE pt.registration_id = r.id
         ORDER BY pt.updated_at DESC LIMIT 1) AS refund_status,
        (SELECT pal.at
         FROM payment_svc.payment_transaction pt
         JOIN payment_svc.payment_audit_log pal ON pal.txn_id = pt.id AND pal.to_status = 'refunded'
         WHERE pt.registration_id = r.id
         ORDER BY pal.at DESC LIMIT 1) AS refunded_at
    FROM ticket t
    JOIN registration_svc.registration r  ON r.id  = t.reg_id
"""


async def _hydrate_tickets(conn, rows) -> list[dict]:
    """event/event_category/ticket_type now live in event-service's own schema,
    and users stays out of ticket-service's own DB access entirely (see
    DB_ISOLATION_PLAN.md) — merge in event + user fields + per-item ticket-type
    names via internal API calls instead of JOINs/a correlated subquery."""
    events = await get_events(r["event_id"] for r in rows)
    users = await get_by_ids(r["user_id"] for r in rows)

    reg_ids = list({r["registration_id"] for r in rows})
    items_by_reg: dict[str, list[dict]] = {}
    if reg_ids:
        item_rows = await conn.fetch(
            "SELECT registration_id::text, ticket_type_id::text, quantity, unit_price "
            "FROM registration_svc.registration_item WHERE registration_id = ANY($1::uuid[])",
            reg_ids,
        )
        ticket_types = await get_ticket_types(r["ticket_type_id"] for r in item_rows)
        for r in item_rows:
            tt = ticket_types.get(r["ticket_type_id"], {})
            items_by_reg.setdefault(r["registration_id"], []).append({
                "ticket_type_name": tt.get("name", "Ticket"),
                "quantity": r["quantity"],
                "unit_price": r["unit_price"],
                "_sort_order": tt.get("sort_order", 0),
            })
        for items in items_by_reg.values():
            items.sort(key=lambda it: (it["_sort_order"], it["ticket_type_name"]))
            for it in items:
                del it["_sort_order"]

    hydrated = []
    for r in rows:
        d = dict(r)
        e = events.get(d["event_id"], {})
        u = users.get(d["user_id"], {})
        d["event_title"] = e.get("title")
        d["event_start_time"] = e.get("start_time")
        d["event_end_time"] = e.get("end_time")
        d["event_venue"] = e.get("venue")
        d["cancel_freeze_at"] = e.get("cancel_freeze_at")
        d["event_image_color"] = e.get("category_color")
        d["ticket_items"] = items_by_reg.get(d["registration_id"], [])
        d["user_name"] = u.get("name")
        d["user_email"] = u.get("email")
        d["keycloak_sub"] = u.get("keycloak_sub")
        hydrated.append(d)
    return hydrated


def _build_out(row) -> TicketOut:
    return TicketOut(
        id=row["id"],
        reg_id=row["reg_id"],
        event_id=row["event_id"],
        event_title=row["event_title"],
        event_start_time=row["event_start_time"],
        event_end_time=row["event_end_time"],
        event_venue=row["event_venue"],
        event_image_color=row.get("event_image_color"),
        cancel_freeze_at=row.get("cancel_freeze_at"),
        ticket_count=row["ticket_count"],
        total_amount=float(row["total_amount"]),
        display_currency=row["display_currency"],
        status=row["status"],
        qr_token=row.get("qr_token"),
        issued_at=row["issued_at"],
        scanned_at=row.get("scanned_at"),
        user_name=row.get("user_name"),
        user_email=row.get("user_email"),
        ticket_items=row.get("ticket_items", []),
        paid_at=row.get("paid_at"),
        refund_status=row.get("refund_status"),
        refunded_at=row.get("refunded_at"),
    )


def _generate_qr_svg(token: str) -> bytes:
    factory = qrcode.image.svg.SvgPathFillImage
    img = qrcode.make(token, image_factory=factory, box_size=10, border=4)
    buf = io.BytesIO()
    img.save(buf)
    return buf.getvalue()


async def _get_db_user_id(sub: str) -> str:
    user = await get_by_sub(sub)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user["id"]


async def _ensure_tickets_issued(conn, user_id: str) -> None:
    """Lazily issue tickets for any confirmed registration that doesn't have one yet."""
    unissued = await conn.fetch(
        """
        SELECT r.id::text AS reg_id, r.event_id::text, r.user_id::text,
               r.qr_code AS existing_qr
        FROM registration_svc.registration r
        LEFT JOIN ticket t ON t.reg_id = r.id
        WHERE r.user_id = $1::uuid
          AND r.status   = 'confirmed'
          AND t.id IS NULL
        """,
        user_id,
    )
    for reg in unissued:
        # Reuse existing qr_code from registration table if present (backward compat)
        qr_token = reg["existing_qr"] or str(uuid.uuid4())
        await conn.execute(
            """
            INSERT INTO ticket (reg_id, user_id, event_id, qr_token)
            VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
            ON CONFLICT (reg_id) DO NOTHING
            """,
            reg["reg_id"], reg["user_id"], reg["event_id"], qr_token,
        )


# ── GET /tickets/my ───────────────────────────────────────────────────────────

@router.get("/my", response_model=list[TicketOut], summary="Get the current user's tickets")
async def get_my_tickets(claims: dict = Depends(get_current_claims)):
    sub = claims.get("sub", "")
    pool = await get_pool()
    async with pool.acquire() as conn:
        user_id = await _get_db_user_id(sub)
        await _ensure_tickets_issued(conn, user_id)
        rows = await conn.fetch(
            _TICKET_QUERY + " WHERE t.user_id = $1::uuid",
            user_id,
        )
        hydrated = await _hydrate_tickets(conn, rows)
    # ORDER BY e.start_time DESC can no longer run in SQL since `event` moved to
    # event-service's own schema — sort here instead, after hydration.
    hydrated.sort(key=lambda d: d["event_start_time"], reverse=True)
    return [_build_out(d) for d in hydrated]


# ── Shared roster query ───────────────────────────────────────────────────────

_ROSTER_QUERY = """
    SELECT t.id::text AS ticket_id,
           t.user_id::text,
           r.ticket_count,
           t.status,
           t.scanned_at
    FROM ticket t
    JOIN registration_svc.registration r ON r.id  = t.reg_id
    WHERE t.event_id = $1::uuid
      AND t.status  != 'cancelled'
"""


# ── GET /tickets/event/{event_id} — all tickets for an event (guard / admin) ──

@router.get("/event/{event_id}", response_model=list[EventTicketItem], summary="List all tickets for an event")
async def list_event_tickets(
    event_id: str,
    claims: dict = Depends(require_role("admin", "committee_member", "security_guard")),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(_ROSTER_QUERY, event_id)
    # users now lives behind user-service's own API (see DB_ISOLATION_PLAN.md) —
    # unit_label is already computed server-side there, so this one batch call
    # replaces both the old JOIN and the local user_units/user_apartments subqueries.
    users = await get_by_ids(r["user_id"] for r in rows)
    roster = []
    for r in rows:
        u = users.get(r["user_id"], {})
        roster.append({
            "ticket_id": r["ticket_id"],
            "user_name": u.get("name"),
            "user_email": u.get("email"),
            "user_phone": u.get("phone"),
            "ticket_count": r["ticket_count"],
            "status": r["status"],
            "scanned_at": r["scanned_at"],
            "unit_label": u.get("unit_label"),
        })
    roster.sort(key=lambda d: d["user_name"] or "")
    return roster


# ── POST /tickets/{ticket_id}/enter — mark entry by ticket ID (guard / admin) ─

@router.post("/{ticket_id}/enter", response_model=ScanOut, summary="Mark gate entry by ticket ID")
async def enter_by_ticket_id(
    ticket_id: str,
    claims: dict = Depends(require_role("admin", "committee_member", "security_guard")),
):
    sub = claims.get("sub", "")
    pool = await get_pool()
    async with pool.acquire() as conn:
        scanner_id = await _get_db_user_id(sub)
        row = await conn.fetchrow(
            """
            SELECT t.id::text, t.reg_id::text, t.event_id::text, t.user_id::text, t.status,
                   t.scanned_at, r.ticket_count
            FROM ticket t
            JOIN registration_svc.registration r ON r.id = t.reg_id
            WHERE t.id = $1::uuid
            """,
            ticket_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Ticket not found")
        event = await get_event(row["event_id"])
        ticket_holder = await get_by_id(row["user_id"])

        already_scanned = row["status"] == "used"

        if not already_scanned:
            now = datetime.now(timezone.utc)
            await conn.execute(
                "UPDATE ticket SET status = 'used', scanned_at = $1, scanned_by = $2::uuid WHERE id = $3::uuid",
                now, scanner_id, ticket_id,
            )
            await conn.execute(
                "UPDATE registration_svc.registration SET status = 'attended' WHERE id = $1::uuid",
                row["reg_id"],
            )

    return ScanOut(
        ticket_id=row["id"],
        reg_id=row["reg_id"],
        event_id=row["event_id"],
        event_title=event["title"],
        event_start_time=event["start_time"],
        event_venue=event["venue"],
        ticket_count=row["ticket_count"],
        status="used",
        scanned_at=row["scanned_at"] if already_scanned else datetime.now(timezone.utc),
        user_name=(ticket_holder or {}).get("name"),
        already_scanned=already_scanned,
    )


# ── GET /tickets/{id} ─────────────────────────────────────────────────────────

@router.get("/{ticket_id}", response_model=TicketOut, summary="Get a single ticket")
async def get_ticket(ticket_id: str, claims: dict = Depends(get_current_claims)):
    sub = claims.get("sub", "")
    realm_roles: list[str] = claims.get("realm_access", {}).get("roles", [])
    is_privileged = any(r in realm_roles for r in ("admin", "committee_member", "security_guard"))

    pool = await get_pool()
    async with pool.acquire() as conn:
        user_id = await _get_db_user_id(sub)
        row = await conn.fetchrow(_TICKET_QUERY + " WHERE t.id = $1::uuid", ticket_id)
        if not row:
            raise HTTPException(status_code=404, detail="Ticket not found")
        hydrated = (await _hydrate_tickets(conn, [row]))[0]
    # ownership: ticket belongs to the calling user OR caller is privileged
    reg_owner = hydrated.get("keycloak_sub") == sub or is_privileged
    if not reg_owner:
        raise HTTPException(status_code=403, detail="Not your ticket")
    return _build_out(hydrated)


# ── GET /tickets/{id}/qr ──────────────────────────────────────────────────────

@router.get("/{ticket_id}/qr", summary="Get the gate-entry QR code SVG (public)")
async def get_ticket_qr(ticket_id: str):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT t.qr_token, t.status FROM ticket t WHERE t.id = $1::uuid",
            ticket_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if row["status"] == "cancelled":
        raise HTTPException(status_code=400, detail="Ticket is cancelled")

    svg_bytes = _generate_qr_svg(row["qr_token"])
    return FastAPIResponse(content=svg_bytes, media_type="image/svg+xml")


# ── POST /tickets/scan — gate entry ───────────────────────────────────────────

@router.post("/scan", response_model=ScanOut, summary="Scan QR at gate (security guard / admin)")
async def scan_ticket(
    body: ScanBody,
    claims: dict = Depends(require_role("admin", "committee_member", "security_guard")),
):
    sub = claims.get("sub", "")
    pool = await get_pool()
    async with pool.acquire() as conn:
        scanner_id = await _get_db_user_id(sub)

        row = await conn.fetchrow(
            """
            SELECT t.id::text, t.reg_id::text, t.event_id::text, t.user_id::text, t.status,
                   t.scanned_at, r.ticket_count
            FROM ticket t
            JOIN registration_svc.registration r ON r.id = t.reg_id
            WHERE t.qr_token = $1
            """,
            body.token,
        )
        if not row:
            raise HTTPException(status_code=404, detail="QR code not found or invalid")
        event = await get_event(row["event_id"])
        ticket_holder = await get_by_id(row["user_id"])

        already_scanned = row["status"] == "used"

        if not already_scanned:
            now = datetime.now(timezone.utc)
            await conn.execute(
                "UPDATE ticket SET status = 'used', scanned_at = $1, scanned_by = $2::uuid WHERE qr_token = $3",
                now, scanner_id, body.token,
            )
            # Keep registration table in sync so other services stay consistent
            await conn.execute(
                "UPDATE registration_svc.registration SET status = 'attended' WHERE id = $1::uuid",
                row["reg_id"],
            )

    return ScanOut(
        ticket_id=row["id"],
        reg_id=row["reg_id"],
        event_id=row["event_id"],
        event_title=event["title"],
        event_start_time=event["start_time"],
        event_venue=event["venue"],
        ticket_count=row["ticket_count"],
        status="used",
        scanned_at=row["scanned_at"] if already_scanned else datetime.now(timezone.utc),
        user_name=(ticket_holder or {}).get("name"),
        already_scanned=already_scanned,
    )


# ── DELETE /tickets/{id} — cancel ─────────────────────────────────────────────

@router.delete("/{ticket_id}", status_code=204, summary="Cancel a ticket (admin only)")
async def cancel_ticket(
    ticket_id: str,
    claims: dict = Depends(require_role("admin", "committee_member")),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, status FROM ticket WHERE id = $1::uuid", ticket_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="Ticket not found")
        if row["status"] == "used":
            raise HTTPException(status_code=400, detail="Cannot cancel a used ticket")
        await conn.execute(
            "UPDATE ticket SET status = 'cancelled' WHERE id = $1::uuid", ticket_id
        )
    return FastAPIResponse(status_code=204)
