"""Refund task queue and completion (FR-07)."""
import io
import os
import uuid
from datetime import timezone
from typing import Optional

import aiofiles
import qrcode
import qrcode.image.svg
from dateutil import parser as dateutil_parser
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from app import reconciliation_client
from app.adapters.factory import get_processor
from app.auth import _has_event_access, get_current_claims, require_role
from app.config import settings
from app.database import get_pool
from app.event_client import get_events
from app.models import ScreenshotExtraction, TransactionOut
from app.notifications import notify_refund_processed, send_channels
from app.splunk_logger import log_app_error
from app.uploads import save_screenshot
from shared.user_client import get_by_id, get_by_ids

router = APIRouter()

_TXN_QUERY = """
    SELECT pt.id::text, pt.txn_ref, pt.event_id::text,
           pt.registration_id::text, pt.user_id::text,
           pt.amount, pt.currency, pt.payee_upi, pt.payer_upi, pt.refund_upi_id,
           pt.status, pt.payment_utr, pt.refund_utr, pt.reconciliation_txn_id,
           pt.screenshot_path, pt.refund_screenshot_path,
           pt.created_at, pt.updated_at
    FROM payment_transaction pt
"""


def _build_out(row, event_title: str | None = None, user: dict | None = None) -> dict:
    user = user or {}
    d = dict(row)
    d["event_title"] = event_title
    d["user_name"] = user.get("name")
    d["user_email"] = user.get("email")
    d["keycloak_sub"] = user.get("keycloak_sub")
    d["amount"] = float(d["amount"])
    d["screenshot_url"] = f"/api/payments/uploads/{d['screenshot_path']}" if d.get("screenshot_path") else None
    d["refund_screenshot_url"] = (
        f"/api/payments/uploads/{d['refund_screenshot_path']}" if d.get("refund_screenshot_path") else None
    )
    d.pop("screenshot_path", None)
    d.pop("refund_screenshot_path", None)
    return d


def _generate_qr_svg(upi_link: str) -> bytes:
    factory = qrcode.image.svg.SvgPathFillImage
    img = qrcode.make(upi_link, image_factory=factory, box_size=10, border=4)
    buf = io.BytesIO()
    img.save(buf)
    return buf.getvalue()


# ── GET /refunds ──────────────────────────────────────────────────────────────

@router.get("", summary="Refund task queue (committee members / admin)")
async def list_refunds(
    claims: dict = Depends(require_role("admin", "committee_member")),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            _TXN_QUERY + " WHERE pt.status = 'refund_requested' ORDER BY pt.updated_at ASC"
        )
    events = await get_events(r["event_id"] for r in rows)
    users = await get_by_ids(r["user_id"] for r in rows)
    return [
        _build_out(r, events.get(r["event_id"], {}).get("title"), users.get(r["user_id"]))
        for r in rows
    ]


# ── GET /refunds/{txn_ref}/qr — UPI QR to pay the refund ─────────────────────
# Admin scans this with their own UPI app instead of hand-copying the UPI ID and
# retyping the amount — pre-fills payee, amount, and a reference note.

@router.get("/{txn_ref}/qr", summary="UPI QR code to pay this refund (admin/committee)")
async def get_refund_qr(
    txn_ref: str,
    claims: dict = Depends(require_role("admin", "committee_member")),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            _TXN_QUERY + " WHERE pt.txn_ref = $1 AND pt.status = 'refund_requested'",
            txn_ref,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Refund task not found")

    upi_id = row["refund_upi_id"] or row["payer_upi"]
    if not upi_id:
        raise HTTPException(
            status_code=400,
            detail="No UPI ID on file for this refund — ask the resident directly, "
                   "then complete the refund with POST /refunds/{txn_ref}/complete.",
        )

    events = await get_events([row["event_id"]])
    ticket_holder = await get_by_id(row["user_id"])
    name   = ((ticket_holder or {}).get("name") or "Resident")[:50].replace(" ", "+")
    title  = (events.get(row["event_id"], {}).get("title") or "Event")[:40].replace(" ", "+")
    amount = float(row["amount"])
    upi_link = (
        f"upi://pay?pa={upi_id}&pn={name}&am={amount:.2f}"
        f"&cu=INR&tn=Refund+-+{title}&tr={txn_ref}"
    )
    svg_bytes = _generate_qr_svg(upi_link)
    return Response(content=svg_bytes, media_type="image/svg+xml")


# ── POST /refunds/{txn_ref}/verify-screenshot ────────────────────────────────
# Bridges to the centralized reconciliation service's own refund verification
# (POST /verifyPaymentScreenshot with is_refund=True): admin uploads a screenshot of
# the outgoing refund transfer they just made, AI extracts the UTR/RRN + amount,
# the service searches Gmail for the matching bank debit email, and cross-checks
# amounts — same rigor as verifying an incoming payment, just for money going out.
# On a CONFIRMED verdict the centralized PaymentIntent flips RECONCILED → REFUNDED,
# and this repo's own payment_transaction is completed in the same call (via the
# existing manual-UTR completion path, using the AI-extracted reference), so an
# admin never has to separately type in what the screenshot already proves.

# DISABLED (manual-only payment flow) — re-enable to restore AI-assisted refund-transfer
# verification. Refunds now go through POST /refunds/{txn_ref}/complete with a manually
# entered UTR only.
# @router.post("/{txn_ref}/verify-screenshot",
#              summary="Verify a refund transfer screenshot via AI + bank email; "
#                       "auto-completes the refund on a CONFIRMED verdict (admin/committee)")
# async def verify_refund_screenshot(
#     txn_ref: str,
#     background_tasks: BackgroundTasks,
#     file: UploadFile = File(..., description="Screenshot of the outgoing refund UPI transfer"),
#     search_days: int = Form(default=3, ge=1, le=14, description="How many days back to search the mailbox"),
#     manual_upi_ref: Optional[str] = Form(default=None, description="Manual UTR/RRN override if AI extraction fails"),
#     manual_amount: Optional[float] = Form(default=None, description="Manual amount override if AI extraction fails"),
#     refund_timestamp: Optional[str] = Form(
#         default=None,
#         description="Refund transfer date/time as reviewed by the admin (free text, e.g. "
#                     "'08 Jul 2026, 9:01 PM') — sanity-checked against the original purchase date",
#     ),
#     claims: dict = Depends(get_current_claims),
# ):
#     pool = await get_pool()
#     async with pool.acquire() as conn:
#         row = await conn.fetchrow(
#             "SELECT status, reconciliation_txn_id, created_at, event_id::text AS event_id "
#             "FROM payment_transaction WHERE txn_ref = $1",
#             txn_ref,
#         )
#         if not row:
#             raise HTTPException(status_code=404, detail="Refund task not found")
#         if not await _has_event_access(conn, claims.get("sub"), row["event_id"]):
#             raise HTTPException(status_code=403, detail="You don't have access to this event")
#     if row["status"] != "refund_requested":
#         raise HTTPException(status_code=400, detail=f"Not awaiting refund (current status: {row['status']})")
#     if not row["reconciliation_txn_id"]:
#         raise HTTPException(
#             status_code=400,
#             detail="This payment wasn't verified through the centralized reconciliation flow "
#                    "(no reconciliation_txn_id on file), so its refund can't be AI-verified. "
#                    "Use POST /refunds/{txn_ref}/complete with the UTR instead.",
#         )
#
#     # A refund can only have happened AFTER the original purchase — catch an implausible
#     # date (wrong screenshot uploaded, stale AI extraction, admin typo) before spending
#     # up to 2 minutes on the AI+email verification below, not after. Skipped in testing
#     # mode (PAYMENT_SERVICE_ENV=testing) so old/reused screenshots can exercise the
#     # OCR + email-parser pipeline end to end without a real, freshly-dated transfer.
#     if refund_timestamp and refund_timestamp.strip() and not settings.is_testing:
#         try:
#             parsed_refund_ts = dateutil_parser.parse(refund_timestamp, fuzzy=True)
#             if parsed_refund_ts.tzinfo is None:
#                 parsed_refund_ts = parsed_refund_ts.replace(tzinfo=timezone.utc)
#         except (ValueError, OverflowError):
#             parsed_refund_ts = None
#         if parsed_refund_ts and parsed_refund_ts <= row["created_at"]:
#             raise HTTPException(
#                 status_code=400,
#                 detail=f"Refund date ({parsed_refund_ts.isoformat()}) is not after the original "
#                        f"purchase ({row['created_at'].isoformat()}) — check you uploaded the right "
#                        "screenshot, or correct the reviewed date/time.",
#             )
#
#     async with pool.acquire() as conn:
#         collector = await conn.fetchrow(
#             "SELECT reconciliation_channel_id::text AS reconciliation_channel_id "
#             "FROM committee_registry WHERE event_id = $1::uuid",
#             row["event_id"],
#         )
#     channel_id = collector["reconciliation_channel_id"] if collector else None
#     if not channel_id:
#         raise HTTPException(
#             status_code=400,
#             detail="No reconciliation channel configured for this event's collector — "
#                    "this refund can't be AI-verified. Use POST /refunds/{txn_ref}/complete "
#                    "with the UTR instead.",
#         )
#
#     content = await file.read()
#
#     # Save the refund-transfer screenshot alongside the resident's original payment
#     # screenshot — before calling out, same reasoning as the original payment's
#     # verify-screenshot: keep proof on file even if the AI verdict is slow, ambiguous,
#     # or never confirms, not only on a successful match.
#     ext = (file.filename or "screenshot.jpg").rsplit(".", 1)[-1].lower()
#     filename = f"{uuid.uuid4()}.{ext}"
#     save_dir = os.path.join(settings.uploads_dir, "payment-screenshots")
#     os.makedirs(save_dir, exist_ok=True)
#     async with aiofiles.open(os.path.join(save_dir, filename), "wb") as f:
#         await f.write(content)
#     refund_screenshot_path = f"payment-screenshots/{filename}"
#
#     async with pool.acquire() as conn:
#         await conn.execute(
#             "UPDATE payment_transaction SET refund_screenshot_path = $1 WHERE txn_ref = $2",
#             refund_screenshot_path, txn_ref,
#         )
#
#     result = await reconciliation_client.verify_refund_screenshot(
#         content, file.filename or "screenshot", file.content_type or "image/jpeg",
#         channel_id=channel_id, reconciliation_txn_id=row["reconciliation_txn_id"],
#         manual_upi_ref=manual_upi_ref, manual_amount=manual_amount, search_days=search_days,
#     )
#
#     verdict = (result.get("verification") or {}).get("verdict")
#     reconcile = result.get("reconcile")
#     if verdict == "CONFIRMED" and reconcile and reconcile.get("new_status") == "REFUNDED":
#         screenshot = result.get("screenshot") or {}
#         refund_ref = reconcile.get("refund_ref_id") or screenshot.get("upi_ref") or screenshot.get("rrn")
#         if refund_ref:
#             processor = get_processor()
#             await processor.process_refund(txn_ref, refund_ref)
#             result["local_status"] = "refunded"
#
#             pool = await get_pool()
#             async with pool.acquire() as conn:
#                 recipients, notify_message = await notify_refund_processed(conn, txn_ref, claims.get("sub"))
#             if recipients:
#                 background_tasks.add_task(send_channels, recipients, notify_message)
#
#     return result


# ── POST /refunds/{txn_ref}/extract-screenshot ────────────────────────────────
# Same plain AI extraction the resident's checkout screenshot upload uses
# (POST /payments/{txn_ref}/screenshot) — lets the admin prefill the refund UTR
# from the outgoing-transfer screenshot instead of hand-copying it. Read-only:
# does not save the file or touch payment_transaction; the actual proof image is
# saved (again) by POST /refunds/{txn_ref}/complete once the admin submits. Not
# the disabled AI-verification path above — no bank-email cross-check, no
# auto-completion.

@router.post("/{txn_ref}/extract-screenshot", response_model=ScreenshotExtraction,
             summary="Best-effort AI extraction of UTR/amount from a refund transfer screenshot (admin/committee)")
async def extract_refund_screenshot(
    txn_ref: str,
    file: UploadFile = File(..., description="Screenshot of the outgoing refund UPI transfer"),
    claims: dict = Depends(require_role("admin", "committee_member")),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        event_id = await conn.fetchval(
            "SELECT event_id::text FROM payment_transaction WHERE txn_ref = $1", txn_ref
        )
        if not event_id:
            raise HTTPException(status_code=404, detail="Transaction not found")
        if not await _has_event_access(conn, claims.get("sub"), event_id):
            raise HTTPException(status_code=403, detail="You don't have access to this event")

    content = await file.read()
    try:
        result = await reconciliation_client.parse_screenshot(
            content, file.filename or "screenshot.jpg", file.content_type or "image/jpeg",
        )
    except Exception as exc:
        await log_app_error({"event": "parse_refund_screenshot_failed", "error": str(exc)[:200]})
        result = {}

    return ScreenshotExtraction(
        parsed_amount=result.get("extracted_amount"),
        parsed_upi_ref=result.get("extracted_upi_ref"),
        parsed_rrn=result.get("extracted_rrn"),
        parsed_bank=result.get("extracted_bank"),
        parsed_timestamp=result.get("extracted_timestamp"),
    )


# ── POST /refunds/{txn_ref}/complete ─────────────────────────────────────────

@router.post("/{txn_ref}/complete", response_model=dict,
             summary="Log refund UTR + transfer screenshot and close the ledger entry (FR-07)")
async def complete_refund(
    txn_ref: str,
    background_tasks: BackgroundTasks,
    refund_utr: str = Form(..., min_length=6),
    file: UploadFile = File(..., description="Screenshot of the outgoing refund UPI transfer"),
    claims: dict = Depends(get_current_claims),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        event_id = await conn.fetchval(
            "SELECT event_id::text FROM payment_transaction WHERE txn_ref = $1", txn_ref
        )
        if not event_id:
            raise HTTPException(status_code=404, detail="Transaction not found")
        if not await _has_event_access(conn, claims.get("sub"), event_id):
            raise HTTPException(status_code=403, detail="You don't have access to this event")

    refund_screenshot_path = await save_screenshot(await file.read(), file.filename or "screenshot.jpg")

    processor = get_processor()
    result = await processor.process_refund(txn_ref, refund_utr, refund_screenshot_path)

    async with pool.acquire() as conn:
        recipients, notify_message = await notify_refund_processed(conn, txn_ref, claims.get("sub"))
    if recipients:
        background_tasks.add_task(send_channels, recipients, notify_message)

    return result
