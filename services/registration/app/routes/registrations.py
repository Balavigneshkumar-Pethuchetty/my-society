import io
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

import qrcode
import qrcode.image.svg
from fastapi import APIRouter, BackgroundTasks, Body, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response as FastAPIResponse

from app.auth import get_current_claims, require_role
from app.config import settings
from app.database import get_pool
from app.event_client import get_event, get_events
from app.object_storage import upload_bytes
from app.models import (
    CancelBody, PaymentReviewBody, RegistrationCreate, RegistrationOut, PaymentOut,
)
from app.notifications import resolve_and_record, send_channels
from app.ticket_client import cancel_ticket_by_reg
from shared.user_client import get_by_ids, get_by_sub

router = APIRouter()

_ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
_MAX_BYTES = 10 * 1024 * 1024  # 10 MB


# ── helpers ───────────────────────────────────────────────────────────────────

async def _get_db_user_id(keycloak_sub: str) -> str:
    user = await get_by_sub(keycloak_sub)
    if not user:
        raise HTTPException(status_code=404, detail="User not found in database")
    return user["id"]


def _build_reg_out(row: dict) -> RegistrationOut:
    pay = None
    if row.get("payment_id"):
        pay = PaymentOut(
            id=row["payment_id"],
            status=row["payment_status"],
            payment_method=row.get("payment_method"),
            screenshot_path=row.get("screenshot_path"),
            utr_number=row.get("utr_number"),
            review_notes=row.get("review_notes"),
            created_at=row["payment_created_at"],
            reviewed_at=row.get("reviewed_at"),
        )
    return RegistrationOut(
        id=row["id"],
        event_id=row["event_id"],
        event_title=row["event_title"],
        event_start_time=row["event_start_time"],
        event_end_time=row["event_end_time"],
        event_venue=row["event_venue"],
        event_is_free=row["event_is_free"],
        event_image_color=row.get("category_color"),
        ticket_count=row["ticket_count"],
        total_amount=row["total_amount"],
        display_currency=row["display_currency"],
        status=row["status"],
        registered_at=row["registered_at"],
        qr_token=row.get("qr_code"),
        payment=pay,
        user_name=row.get("user_name"),
        user_email=row.get("user_email"),
    )


_REG_QUERY = """
    SELECT
        r.id::text,
        r.event_id::text,
        r.user_id::text,
        r.ticket_count,
        r.total_amount,
        r.display_currency,
        r.status,
        r.registered_at,
        r.qr_code,
        p.id::text     AS payment_id,
        p.status       AS payment_status,
        p.payment_method,
        p.screenshot_path,
        p.utr_number,
        p.review_notes,
        p.created_at   AS payment_created_at,
        p.reviewed_at
    FROM registration r
    LEFT JOIN payment p ON p.registration_id = r.id
"""


async def _hydrate_reg_rows(rows) -> list[dict]:
    """event/event_category now live in event-service's own schema, and users
    stays out of registration-service's own DB access entirely (see
    DB_ISOLATION_PLAN.md) — merge in event + user fields via internal API calls
    instead of JOINs."""
    events = await get_events(r["event_id"] for r in rows)
    users = await get_by_ids(r["user_id"] for r in rows)
    hydrated = []
    for r in rows:
        d = dict(r)
        e = events.get(d["event_id"], {})
        u = users.get(d["user_id"], {})
        d["event_title"] = e.get("title")
        d["event_start_time"] = e.get("start_time")
        d["event_end_time"] = e.get("end_time")
        d["event_venue"] = e.get("venue")
        d["event_is_free"] = e.get("is_free")
        d["category_color"] = e.get("category_color")
        d["user_name"] = u.get("name")
        d["user_email"] = u.get("email")
        hydrated.append(d)
    return hydrated


async def _hydrate_reg_row(row) -> dict:
    return (await _hydrate_reg_rows([row]))[0]


def _generate_qr_svg(token: str) -> bytes:
    """Used only for UPI payment QR (payment-qr endpoint). Gate-entry QR is in ticket-service."""
    factory = qrcode.image.svg.SvgPathFillImage
    img = qrcode.make(token, image_factory=factory, box_size=10, border=4)
    buf = io.BytesIO()
    img.save(buf)
    return buf.getvalue()


# ── POST /registrations ───────────────────────────────────────────────────────

@router.post("", status_code=201, response_model=RegistrationOut,
             summary="Register for an event")
async def create_registration(
    background_tasks: BackgroundTasks,
    body: RegistrationCreate,
    claims: dict = Depends(get_current_claims),
):
    sub = claims.get("sub", "")
    pool = await get_pool()
    recipients: list[dict] = []
    reg_message = ""
    async with pool.acquire() as conn:
        user_id = await _get_db_user_id(sub)

        event = await get_event(body.event_id)
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")
        if event["status"] != "published":
            raise HTTPException(status_code=400, detail="Event is not open for registration")
        if event["end_time"] < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="Event has already ended")

        # Capacity check
        if event["capacity"] is not None:
            confirmed = await conn.fetchval(
                "SELECT COALESCE(SUM(ticket_count), 0) FROM registration "
                "WHERE event_id = $1::uuid AND status IN ('confirmed','pending_payment','attended')",
                body.event_id,
            )
            requested = sum(t.quantity for t in body.tickets) if body.tickets else body.ticket_count
            if confirmed + requested > event["capacity"]:
                raise HTTPException(status_code=400, detail="Not enough spots available")

        # Calculate total
        if body.tickets:
            ticket_count = sum(t.quantity for t in body.tickets)
            total_amount = sum(Decimal(str(t.unit_price)) * t.quantity for t in body.tickets)
        else:
            ticket_count = body.ticket_count
            total_amount = Decimal(str(event["ticket_price"])) * ticket_count

        is_free = event["is_free"] or total_amount == Decimal("0")
        reg_status = "confirmed" if is_free else "pending_payment"

        reg_id = await conn.fetchval(
            "INSERT INTO registration (event_id, user_id, ticket_count, total_amount, display_currency, status) "
            "VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6) RETURNING id::text",
            body.event_id, user_id, ticket_count, total_amount,
            event["price_currency"], reg_status,
        )

        # Persist the per-ticket-type breakdown (only possible for events with real
        # ticket_type rows — the legacy single flat-price flow has no type to reference,
        # so those selections have ticket_type_id=None and are skipped here). ticket-service
        # reads this back to show residents/admins what tiers/quantities made up the order,
        # instead of just the aggregate ticket_count/total_amount on `registration`.
        for t in body.tickets:
            if t.ticket_type_id:
                await conn.execute(
                    """INSERT INTO registration_item (registration_id, ticket_type_id, quantity, unit_price)
                       VALUES ($1::uuid, $2::uuid, $3, $4)
                       ON CONFLICT (registration_id, ticket_type_id) DO NOTHING""",
                    reg_id, t.ticket_type_id, t.quantity, t.unit_price,
                )

        if not is_free:
            await conn.fetchval(
                "INSERT INTO payment "
                "(registration_id, gateway_name, payment_method, original_amount, original_currency, "
                "settled_amount, settled_currency, status) "
                "VALUES ($1::uuid, 'manual', 'manual_upi', $2, $3, $2, 'INR', 'pending_screenshot') "
                "RETURNING id::text",
                reg_id, total_amount, event["price_currency"],
            )

        row = await conn.fetchrow(_REG_QUERY + " WHERE r.id = $1::uuid", reg_id)

        # Paid registrations start as pending_payment with no screenshot yet —
        # notifying the organizer now would be premature (they can't verify
        # anything). That notification instead fires from upload_screenshot()
        # once the resident has actually paid and submitted proof. Free
        # registrations are confirmed immediately, so there's no payment step
        # to wait for.
        if is_free:
            link = f"{settings.app_public_url}/manage/details/{body.event_id}?tab=purchases&registration_id={reg_id}"
            reg_message = (
                f"A resident registered for \"{event['title']}\" ({ticket_count} ticket(s)). "
                f"View: {link}"
            )
            recipients = await resolve_and_record(
                body.event_id, user_id, "event_registration_created",
                "New registration", reg_message, related_id=reg_id,
            )

    if is_free and recipients:
        background_tasks.add_task(send_channels, recipients, reg_message)

    return _build_reg_out(await _hydrate_reg_row(row))


# ── GET /registrations/my ─────────────────────────────────────────────────────

@router.get("/my", response_model=list[RegistrationOut],
            summary="Get my registrations")
async def my_registrations(claims: dict = Depends(get_current_claims)):
    sub = claims.get("sub", "")
    pool = await get_pool()
    async with pool.acquire() as conn:
        user_id = await _get_db_user_id(sub)
        rows = await conn.fetch(
            _REG_QUERY + " WHERE r.user_id = $1::uuid ORDER BY r.registered_at DESC",
            user_id,
        )
    return [_build_reg_out(r) for r in await _hydrate_reg_rows(rows)]


# ── GET /registrations/{id} ───────────────────────────────────────────────────

@router.get("/{reg_id}", response_model=RegistrationOut,
            summary="Get a single registration")
async def get_registration(
    reg_id: str,
    claims: dict = Depends(get_current_claims),
):
    sub = claims.get("sub", "")
    realm_roles: list[str] = claims.get("realm_access", {}).get("roles", [])
    is_admin = any(r in realm_roles for r in ("admin", "committee_member", "security_guard"))

    pool = await get_pool()
    async with pool.acquire() as conn:
        user_id = await _get_db_user_id(sub)
        row = await conn.fetchrow(_REG_QUERY + " WHERE r.id = $1::uuid", reg_id)
        if not row:
            raise HTTPException(status_code=404, detail="Registration not found")
        if not is_admin and row["user_id"] != user_id:
            raise HTTPException(status_code=403, detail="Not your registration")
    return _build_reg_out(await _hydrate_reg_row(row))


# ── GET /registrations/{id}/payment-qr — UPI QR for paying ──────────────────

@router.get("/{reg_id}/payment-qr", summary="Get UPI payment QR code SVG")
async def get_payment_qr(
    reg_id: str,
    claims: dict = Depends(get_current_claims),
):
    sub = claims.get("sub", "")
    pool = await get_pool()
    async with pool.acquire() as conn:
        user_id = await _get_db_user_id(sub)
        row = await conn.fetchrow(
            "SELECT r.user_id::text, r.total_amount, r.event_id::text "
            "FROM registration r WHERE r.id = $1::uuid",
            reg_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Registration not found")
        if row["user_id"] != user_id:
            raise HTTPException(status_code=403, detail="Not your registration")

    upi_id   = settings.society_upi_id
    upi_name = settings.society_upi_name
    if not upi_id:
        raise HTTPException(status_code=404, detail="UPI not configured")

    event = await get_event(row["event_id"])
    amount = float(row["total_amount"])
    title  = ((event or {}).get("title") or "Event")[:50]
    upi_link = (
        f"upi://pay?pa={upi_id}&pn={upi_name}&am={amount:.2f}"
        f"&cu=INR&tn=Event+Registration+-+{title.replace(' ', '+')}&tr={reg_id[:8].upper()}"
    )
    svg_bytes = _generate_qr_svg(upi_link)
    return FastAPIResponse(content=svg_bytes, media_type="image/svg+xml")


# ── DELETE /registrations/{id} — cancel ──────────────────────────────────────

@router.delete("/{reg_id}", summary="Cancel a registration")
async def cancel_registration(
    background_tasks: BackgroundTasks,
    reg_id: str,
    body: Optional[CancelBody] = Body(default=None),
    claims: dict = Depends(get_current_claims),
):
    sub = claims.get("sub", "")
    realm_roles: list[str] = claims.get("realm_access", {}).get("roles", [])
    is_admin = any(r in realm_roles for r in ("admin", "committee_member"))

    pool = await get_pool()
    recipients: list[dict] = []
    refund_recipients: list[dict] = []
    async with pool.acquire() as conn:
        user_id = await _get_db_user_id(sub)

        row = await conn.fetchrow(
            "SELECT r.id, r.user_id::text, r.status, r.total_amount, r.event_id::text "
            "FROM registration r WHERE r.id = $1::uuid",
            reg_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Registration not found")
        if not is_admin and row["user_id"] != user_id:
            raise HTTPException(status_code=403, detail="Not your registration")
        if row["status"] == "attended":
            raise HTTPException(status_code=400, detail="Cannot cancel an already-attended registration")
        if row["status"] == "cancelled":
            raise HTTPException(status_code=400, detail="Registration already cancelled")

        event = await get_event(row["event_id"])

        if not is_admin:
            now = datetime.now(timezone.utc)
            if event["start_time"].replace(tzinfo=timezone.utc) <= now:
                raise HTTPException(status_code=400, detail="Cannot cancel after event has started")

            # A confirmed (ticketed) booking can be self-cancelled any time before
            # the event starts, unless the organizer configured an earlier freeze
            # time — in which case it must be cancelled before that.
            if row["status"] == "confirmed" and event["cancel_freeze_at"] is not None:
                if event["cancel_freeze_at"].replace(tzinfo=timezone.utc) <= now:
                    raise HTTPException(status_code=400, detail="Cancellation window has closed")

        await conn.execute(
            "UPDATE registration SET status = 'cancelled' WHERE id = $1::uuid", reg_id
        )

        event_title = event["title"] or "an event"
        cancel_link = f"{settings.app_public_url}/manage/details/{row['event_id']}?tab=purchases&registration_id={reg_id}"
        cancel_message = f"A resident cancelled their registration for \"{event_title}\". View: {cancel_link}"
        recipients = await resolve_and_record(
            row["event_id"], user_id, "cancellation_requested",
            "Registration cancelled", cancel_message, related_id=reg_id,
        )

        refund_requested = False
        refund_message = ""
        if row["total_amount"] > 0:
            txn = await conn.fetchrow(
                "SELECT id::text FROM payment_svc.payment_transaction "
                "WHERE registration_id = $1::uuid AND status = 'verified'",
                reg_id,
            )
            if txn:
                refund_upi_id = (body.refund_upi_id.strip() if body and body.refund_upi_id else None) or None
                await conn.execute(
                    "UPDATE payment_svc.payment_transaction SET status = 'refund_requested', "
                    "refund_upi_id = COALESCE($2, payer_upi), updated_at = now() "
                    "WHERE id = $1::uuid",
                    txn["id"], refund_upi_id,
                )
                await conn.execute(
                    "INSERT INTO payment_svc.payment_audit_log (txn_id, from_status, to_status, updated_by, note) "
                    "VALUES ($1::uuid, 'verified', 'refund_requested', $2, 'Refund requested by resident on ticket cancellation')",
                    txn["id"], sub,
                )
                refund_requested = True
                refund_link = f"{settings.app_public_url}/admin/pay-refunds?txn_id={txn['id']}"
                refund_message = (
                    f"A refund was requested for the cancelled registration on \"{event_title}\". "
                    f"Process it: {refund_link}"
                )
                refund_recipients = await resolve_and_record(
                    row["event_id"], user_id, "refund_requested",
                    "Refund requested", refund_message, related_id=txn["id"],
                )

    await cancel_ticket_by_reg(reg_id)

    if recipients:
        background_tasks.add_task(send_channels, recipients, cancel_message)
    if refund_recipients:
        background_tasks.add_task(send_channels, refund_recipients, refund_message)

    return {"status": "cancelled", "refund_requested": refund_requested}


# ── POST /registrations/{id}/screenshot ───────────────────────────────────────

@router.post("/{reg_id}/screenshot", response_model=RegistrationOut,
             summary="Upload payment screenshot")
async def upload_screenshot(
    reg_id: str,
    background_tasks: BackgroundTasks,
    utr_number: Optional[str] = Form(None),
    file: UploadFile = File(...),
    claims: dict = Depends(get_current_claims),
):
    if file.content_type not in _ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, or WebP images accepted")
    content = await file.read()
    if len(content) > _MAX_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 10 MB)")

    sub = claims.get("sub", "")
    pool = await get_pool()
    async with pool.acquire() as conn:
        user_id = await _get_db_user_id(sub)

        reg = await conn.fetchrow(
            "SELECT r.id, r.event_id::text, r.user_id::text, r.status, p.id::text AS payment_id "
            "FROM registration r LEFT JOIN payment p ON p.registration_id = r.id "
            "WHERE r.id = $1::uuid",
            reg_id,
        )
        if not reg:
            raise HTTPException(status_code=404, detail="Registration not found")
        if reg["user_id"] != user_id:
            raise HTTPException(status_code=403, detail="Not your registration")
        if reg["status"] != "pending_payment":
            raise HTTPException(status_code=400, detail=f"Cannot upload screenshot for status: {reg['status']}")
        if not reg["payment_id"]:
            raise HTTPException(status_code=400, detail="No payment record found")
        event = await get_event(reg["event_id"])

        ext = (file.filename or "screenshot.jpg").rsplit(".", 1)[-1].lower()
        filename = f"{uuid.uuid4()}.{ext}"
        object_key = f"payment-screenshots/{filename}"
        await upload_bytes(object_key, content, file.content_type)

        await conn.execute(
            "UPDATE payment SET screenshot_path = $1, utr_number = $2, status = 'pending_review' "
            "WHERE id = $3::uuid",
            object_key, utr_number, reg["payment_id"],
        )

        row = await conn.fetchrow(_REG_QUERY + " WHERE r.id = $1::uuid", reg_id)

        # Only now — payment actually made and proof attached — is the organizer
        # worth notifying (see create_registration, which deliberately skips this
        # for paid registrations).
        screenshot_link = f"{settings.app_public_url}/admin/payments?registration_id={reg_id}"
        screenshot_message = (
            f"A resident submitted a payment screenshot for \"{event['title']}\" — "
            f"please review: {screenshot_link}"
        )
        recipients = await resolve_and_record(
            reg["event_id"], user_id, "payment_screenshot_submitted",
            "Payment Screenshot Submitted", screenshot_message, related_id=reg_id,
        )

    if recipients:
        background_tasks.add_task(send_channels, recipients, screenshot_message)
    return _build_reg_out(await _hydrate_reg_row(row))


# ── GET /registrations (admin) ────────────────────────────────────────────────

@router.get("", response_model=list[RegistrationOut],
            summary="List all registrations (admin/committee)")
async def list_registrations(
    payment_status: Optional[str] = None,
    event_id: Optional[str] = None,
    claims: dict = Depends(require_role("admin", "committee_member")),
):
    pool = await get_pool()
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if payment_status:
        conditions.append(f"p.status = ${idx}")
        params.append(payment_status)
        idx += 1

    if event_id:
        conditions.append(f"r.event_id = ${idx}::uuid")
        params.append(event_id)
        idx += 1

    where = " WHERE " + " AND ".join(conditions)
    async with (await get_pool()).acquire() as conn:
        rows = await conn.fetch(
            _REG_QUERY + where + " ORDER BY r.registered_at DESC",
            *params,
        )
    return [_build_reg_out(r) for r in await _hydrate_reg_rows(rows)]


# ── PATCH /registrations/{id}/review (admin) ─────────────────────────────────

@router.patch("/{reg_id}/review", response_model=RegistrationOut,
              summary="Approve or reject a payment (admin/committee)")
async def review_payment(
    reg_id: str,
    body: PaymentReviewBody,
    claims: dict = Depends(require_role("admin", "committee_member")),
):
    sub = claims.get("sub", "")
    pool = await get_pool()
    async with pool.acquire() as conn:
        reviewer_id = await _get_db_user_id(sub)

        reg = await conn.fetchrow(
            "SELECT r.id, r.status, p.id::text AS payment_id, p.status AS payment_status "
            "FROM registration r LEFT JOIN payment p ON p.registration_id = r.id "
            "WHERE r.id = $1::uuid",
            reg_id,
        )
        if not reg:
            raise HTTPException(status_code=404, detail="Registration not found")
        if reg["payment_status"] not in ("pending_review", "pending_screenshot"):
            raise HTTPException(
                status_code=400,
                detail=f"Payment is not pending review (current: {reg['payment_status']})",
            )

        now = datetime.now(timezone.utc)

        if body.action == "approve":
            await conn.execute(
                "UPDATE payment SET status = 'approved', review_notes = $1, "
                "reviewed_by = $2::uuid, reviewed_at = $3, paid_at = $3 WHERE id = $4::uuid",
                body.notes, reviewer_id, now, reg["payment_id"],
            )
            await conn.execute(
                "UPDATE registration SET status = 'confirmed' WHERE id = $1::uuid", reg_id
            )
            # Ticket service lazily issues the QR ticket when user visits /tickets
        else:
            await conn.execute(
                "UPDATE payment SET status = 'rejected', review_notes = $1, "
                "reviewed_by = $2::uuid, reviewed_at = $3, screenshot_path = NULL "
                "WHERE id = $4::uuid",
                body.notes, reviewer_id, now, reg["payment_id"],
            )
            await conn.execute(
                "UPDATE registration SET status = 'pending_payment' WHERE id = $1::uuid", reg_id
            )

        row = await conn.fetchrow(_REG_QUERY + " WHERE r.id = $1::uuid", reg_id)
    return _build_reg_out(await _hydrate_reg_row(row))
