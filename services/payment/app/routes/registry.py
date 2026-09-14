"""Committee registry — event-to-collector assignment (FR-02, FR-09)."""
import asyncio
import io
import qrcode
import qrcode.image.svg
from urllib.parse import quote_plus

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response as FastAPIResponse

from app import reconciliation_client
from app.auth import get_current_claims, require_event_access
from app.crypto import decrypt, encrypt
from app.database import get_pool
from app.event_client import get_event
from app.models import CollectorOut, CollectorSettingsIn, CollectorSettingsOut
from shared.user_client import get_by_id, get_by_sub

router = APIRouter()


def _qr_svg(uri: str) -> bytes:
    factory = qrcode.image.svg.SvgPathFillImage
    img = qrcode.make(uri, image_factory=factory, box_size=10, border=4)
    buf = io.BytesIO()
    img.save(buf)
    return buf.getvalue()


# ── GET /registry/events/{id}/collector ───────────────────────────────────────

@router.get("/events/{event_id}/collector", response_model=CollectorOut,
            summary="Resolve collector for an event (used to generate QR)")
async def get_collector(
    event_id: str,
    amount: float = Query(..., gt=0),
    claims: dict = Depends(get_current_claims),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT cr.upi_id, cr.member_id::text
               FROM committee_registry cr
               WHERE cr.event_id = $1::uuid""",
            event_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="No collector assigned for this event")
    event = await get_event(event_id)
    member = await get_by_id(row["member_id"])

    upi_id  = row["upi_id"]
    name    = (member or {}).get("name")
    title   = event["title"]
    currency = event.get("price_currency", "INR")
    uri = (
        f"upi://pay?pa={quote_plus(upi_id)}&pn={quote_plus(name)}"
        f"&am={amount:.2f}&cu=INR&tn={quote_plus(title[:50])}"
    )
    return CollectorOut(
        upi_id=upi_id, upi_name=name,
        upi_intent_uri=uri, event_title=title,
        amount=amount, currency=currency,
    )


# ── GET /registry/events/{id}/collector/qr ────────────────────────────────────

@router.get("/events/{event_id}/collector/qr",
            summary="UPI payment QR SVG for an event")
async def get_collector_qr(
    event_id: str,
    amount: float = Query(..., gt=0),
    claims: dict = Depends(get_current_claims),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT cr.upi_id, cr.member_id::text
               FROM committee_registry cr
               WHERE cr.event_id = $1::uuid""",
            event_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="No collector assigned for this event")
    event = await get_event(event_id)
    member = await get_by_id(row["member_id"])

    uri = (
        f"upi://pay?pa={quote_plus(row['upi_id'])}&pn={quote_plus((member or {}).get('name') or '')}"
        f"&am={amount:.2f}&cu=INR&tn={quote_plus(event['title'][:50])}"
    )
    return FastAPIResponse(content=_qr_svg(uri), media_type="image/svg+xml")


# ── Organizer-scoped collector + email-parsing settings ───────────────────────
# Absolute per-event isolation (require_event_access — organizer or granted
# event_permission, no admin/committee_member bypass), mirroring funds.py. These
# sit alongside the admin-only routes above rather than replacing them — the
# admin dashboard's "Assign Collector" flow is untouched.

@router.get("/{event_id}/settings", response_model=CollectorSettingsOut,
            summary="Get this event's collector + email-parsing config (organizer)")
async def get_collector_settings(
    event_id: str,
    claims: dict = Depends(require_event_access()),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT cr.member_id::text, cr.upi_id,
                      cr.imap_host, cr.imap_port, cr.imap_user, cr.imap_password,
                      cr.imap_mailbox, cr.assigned_at, cr.reconciliation_channel_id
               FROM committee_registry cr
               WHERE cr.event_id = $1::uuid""",
            event_id,
        )
    if not row:
        return CollectorSettingsOut(
            event_id=event_id, member_id=None, member_name=None, upi_id=None,
            imap_host="", imap_port=993, imap_user="", imap_password_set=False,
            imap_mailbox="INBOX", assigned_at=None,
            reconciliation_channel_configured=False,
        )
    d = dict(row)
    member = await get_by_id(d["member_id"]) if d["member_id"] else None
    return CollectorSettingsOut(
        event_id=event_id,
        member_id=d["member_id"],
        member_name=(member or {}).get("name"),
        upi_id=d["upi_id"],
        imap_host=d["imap_host"],
        imap_port=d["imap_port"],
        imap_user=d["imap_user"],
        imap_password_set=bool(d["imap_password"]),
        imap_mailbox=d["imap_mailbox"],
        assigned_at=d["assigned_at"],
        reconciliation_channel_configured=d["reconciliation_channel_id"] is not None,
    )


@router.put("/{event_id}/settings", response_model=CollectorSettingsOut,
            summary="Set/change this event's collector UPI + email-parsing config (organizer)")
async def save_collector_settings(
    event_id: str,
    body: CollectorSettingsIn,
    claims: dict = Depends(require_event_access()),
):
    caller = await get_by_sub(claims.get("sub", ""))
    pool = await get_pool()
    async with pool.acquire() as conn:
        member_id = body.member_id or (caller["id"] if caller else None)
        if not member_id:
            raise HTTPException(status_code=404, detail="User record not found")

        current = await conn.fetchrow(
            "SELECT imap_password, reconciliation_channel_id::text AS reconciliation_channel_id "
            "FROM committee_registry WHERE event_id = $1::uuid", event_id,
        )
        password = encrypt(body.imap_password) if body.imap_password else (
            current["imap_password"] if current else ""
        )

        await conn.execute(
            """INSERT INTO committee_registry
                   (event_id, member_id, upi_id, assigned_by,
                    imap_host, imap_port, imap_user, imap_password, imap_mailbox)
               VALUES ($1::uuid, $2::uuid, $3, $2::uuid, $4, $5, $6, $7, $8)
               ON CONFLICT (event_id) DO UPDATE
                 SET member_id     = EXCLUDED.member_id,
                     upi_id        = EXCLUDED.upi_id,
                     imap_host     = EXCLUDED.imap_host,
                     imap_port     = EXCLUDED.imap_port,
                     imap_user     = EXCLUDED.imap_user,
                     imap_password = EXCLUDED.imap_password,
                     imap_mailbox  = EXCLUDED.imap_mailbox,
                     assigned_at   = now()""",
            event_id, member_id, body.upi_id,
            body.imap_host, body.imap_port, body.imap_user, password, body.imap_mailbox,
        )

        # Mirror this event's own inbox credentials into a per-event channel on the
        # sibling payment_reconcilation_service, so AI-vision screenshot verification
        # (payments.py/refunds.py verify-screenshot) searches THIS organizer's inbox
        # instead of a single shared channel. Only when a mailbox is actually configured;
        # never blocks saving the organizer's own settings on failure.
        if body.imap_host and body.imap_user:
            plaintext_password = body.imap_password or (
                decrypt(current["imap_password"]) if current and current["imap_password"] else ""
            )
            if plaintext_password:
                await _sync_reconciliation_channel(
                    conn, event_id,
                    current["reconciliation_channel_id"] if current else None,
                    body.imap_host, body.imap_port, body.imap_user,
                    plaintext_password, body.imap_mailbox,
                )

    return await get_collector_settings(event_id, claims)


async def _sync_reconciliation_channel(
    conn, event_id: str, existing_channel_id: str | None,
    imap_host: str, imap_port: int, imap_user: str, imap_password: str, imap_mailbox: str,
) -> None:
    """Best-effort provision/update of this event's channel on the sibling reconciliation
    service. A failure or unreachable sibling must never block saving the organizer's own
    settings — same degrade-gracefully principle CLAUDE.md documents for this integration."""
    credentials = {
        "host": imap_host, "port": imap_port,
        "username": imap_user, "password": imap_password,
        "use_ssl": True, "mailbox": imap_mailbox,
    }
    try:
        if existing_channel_id:
            await reconciliation_client.update_channel(existing_channel_id, credentials)
        else:
            result = await reconciliation_client.create_channel(f"event:{event_id}", credentials)
            await conn.execute(
                "UPDATE committee_registry SET reconciliation_channel_id = $1::uuid WHERE event_id = $2::uuid",
                result["id"], event_id,
            )
    except Exception as exc:
        print(f"[registry] reconciliation channel sync failed for event {event_id}: {exc}")


@router.post("/{event_id}/settings/test-imap",
             summary="Test this event's own IMAP connection (organizer)")
async def test_event_imap(
    event_id: str,
    claims: dict = Depends(require_event_access()),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT imap_host, imap_port, imap_user, imap_password, imap_mailbox
               FROM committee_registry WHERE event_id = $1::uuid""",
            event_id,
        )
    if not row or not (row["imap_host"] and row["imap_user"] and row["imap_password"]):
        raise HTTPException(status_code=400, detail="IMAP credentials not configured for this event")

    try:
        import aioimaplib
        imap = aioimaplib.IMAP4_SSL(host=row["imap_host"], port=row["imap_port"])
        await asyncio.wait_for(imap.wait_hello_from_server(), timeout=10)
        await asyncio.wait_for(imap.login(row["imap_user"], decrypt(row["imap_password"])), timeout=10)
        ok, data = await asyncio.wait_for(imap.select(row["imap_mailbox"]), timeout=10)
        count = int(data[0].decode()) if data and data[0] else 0
        await imap.logout()
        return {"status": "ok", "mailbox": row["imap_mailbox"], "message_count": count}
    except ImportError:
        raise HTTPException(status_code=500, detail="aioimaplib not installed")
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Connection timed out")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"IMAP error: {exc}")


@router.post("/{event_id}/settings/test-reconciliation",
             summary="Test that the sibling reconciliation service can read this event's inbox (organizer)")
async def test_event_reconciliation_channel(
    event_id: str,
    claims: dict = Depends(require_event_access()),
):
    """Distinct from /settings/test-imap above: that one checks this repo's own IMAP
    connection directly. This one checks the *sibling* payment_reconcilation_service's
    copy of the same credentials (provisioned by _sync_reconciliation_channel when the
    organizer saved their settings) — the one actually used by verify_screenshot /
    verify_refund_screenshot. If this fails while /settings/test-imap succeeds, the
    channel sync itself is the problem (e.g. it failed silently at save time because the
    sibling was briefly unreachable) — save settings again to retry provisioning it."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        channel_id = await conn.fetchval(
            "SELECT reconciliation_channel_id::text FROM committee_registry WHERE event_id = $1::uuid",
            event_id,
        )
    if not channel_id:
        raise HTTPException(
            status_code=400,
            detail="No reconciliation channel configured yet for this event — save your "
                    "email settings first (with a host, address, and password filled in), "
                    "then try this test again.",
        )

    result = await reconciliation_client.test_channel(channel_id)
    return {
        "status": "ok",
        "channel_id": channel_id,
        "fetched": result.get("fetched", 0),
    }


@router.post("/{event_id}/settings/scan",
             summary="Scan just this event's inbox now (organizer)")
async def scan_event_now(
    event_id: str,
    claims: dict = Depends(require_event_access()),
):
    from app.reconciliation import inbox
    result = await inbox.manual_scan_event(event_id)
    return result
