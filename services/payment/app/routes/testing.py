"""Test-only endpoints for exercising the centralized reconciliation service's
/parseEmail without a real checkout. Only mounted when PAYMENT_SERVICE_ENV=testing
(see app/config.py, app/main.py) — never available in production.
"""
import os
import secrets
import shutil
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app import reconciliation_client
from app.auth import require_role
from app.config import settings
from app.database import get_pool
from app.event_client import get_event
from shared.user_client import get_by_id, get_by_role, get_by_sub

router = APIRouter()

# Values transcribed from services/payment/test_screenshot/IMG-20260627-WA0008.jpg
# (a real PhonePe/UPI confirmation) so a seeded transaction and its screenshot agree.
_TEST_SCREENSHOT = Path(__file__).resolve().parents[2] / "test_screenshot" / "IMG-20260627-WA0008.jpg"
_TEST_AMOUNT = 1.0
_TEST_UTR = "586264656963"
_TEST_PAYEE_UPI = "6362588131@pz"
_TEST_PAYEE_NAME = "Balavigneshkumar P"


_TEST_EVENT_TITLE = "Payment Reconciliation Test Event (SEEDED)"


class SeedTransactionBody(BaseModel):
    event_id: Optional[str] = None


class SeedRegistrationBody(BaseModel):
    user_id: Optional[str] = None  # defaults to the caller


# ── DELETE /test/clear-transactions ──────────────────────────────────────────

@router.delete("/clear-transactions",
                summary="Delete ALL payment_transaction rows (testing only)")
async def clear_transactions(claims: dict = Depends(require_role("admin"))):
    pool = await get_pool()
    async with pool.acquire() as conn:
        deleted = await conn.fetchval("SELECT COUNT(*) FROM payment_transaction")
        await conn.execute("DELETE FROM payment_transaction")
    return {"deleted": deleted}


# ── POST /test/seed-transaction ──────────────────────────────────────────────

@router.post("/seed-transaction",
             summary="Seed a reconciliation-service transaction + local payment_transaction "
                      "row (with the bundled test screenshot) for testing /parseEmail")
async def seed_transaction(
    body: SeedTransactionBody,
    claims: dict = Depends(require_role("admin")),
):
    if not _TEST_SCREENSHOT.exists():
        raise HTTPException(status_code=500, detail=f"Test screenshot not found at {_TEST_SCREENSHOT}")

    sub = claims.get("sub", "")
    caller = await get_by_sub(sub)
    if not caller:
        raise HTTPException(status_code=404, detail="Calling user not found")
    user_id = caller["id"]
    pool = await get_pool()
    async with pool.acquire() as conn:
        if body.event_id:
            event = await get_event(body.event_id)
            if not event:
                raise HTTPException(status_code=404, detail="event_id not found")
        else:
            # No batch/most-recent lookup on the internal API — this whole router is
            # gated behind PAYMENT_SERVICE_ENV=testing (never mounted in production, see
            # app/main.py), so a direct read against event_svc here is acceptable as
            # long as the operator has granted this role read access for local testing
            # (see DB_ISOLATION_PLAN.md's rollback-window note).
            event = await conn.fetchrow("SELECT id::text, title FROM event ORDER BY created_at DESC LIMIT 1")
            if not event:
                raise HTTPException(status_code=400, detail="No events exist to attach the test transaction to")

        collector = await conn.fetchrow(
            "SELECT reconciliation_channel_id::text AS reconciliation_channel_id "
            "FROM committee_registry WHERE event_id = $1::uuid",
            event["id"],
        )

    intent = await reconciliation_client.create_payment_intent({
        "ctx_type": "EVENT",
        "amount": _TEST_AMOUNT,
        "upi_vpa": _TEST_PAYEE_UPI,
        "upi_display_name": _TEST_PAYEE_NAME,
        "reference": f"{event['title']} Ticket (TEST)",
        "description": "Seeded test transaction for parseEmail testing",
        "member_id": user_id,
        "payment_category": "test_seed",
        "tags": ["test"],
        "expiry_hours": 24,
    })
    transaction_id = intent["transaction_id"]

    channel_id = collector["reconciliation_channel_id"] if collector else None
    if not channel_id:
        # Event predates this feature or never configured a mailbox — fall back to
        # any shared active channel, same as this endpoint's previous behavior.
        channels = await reconciliation_client.list_channels()
        active = next((c for c in channels if c.get("is_active")), None)
        if active:
            channel_id = active["id"]

    ext = _TEST_SCREENSHOT.suffix.lstrip(".") or "jpg"
    filename = f"{uuid.uuid4()}.{ext}"
    save_dir = os.path.join(settings.uploads_dir, "payment-screenshots")
    os.makedirs(save_dir, exist_ok=True)
    shutil.copyfile(_TEST_SCREENSHOT, os.path.join(save_dir, filename))
    screenshot_path = f"payment-screenshots/{filename}"

    txn_ref = "TESTTXN" + secrets.token_hex(6).upper()
    idempotency_key = f"test-seed:{transaction_id}"
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO payment_transaction
                (txn_ref, event_id, user_id, amount, currency, payee_upi,
                 screenshot_path, reconciliation_txn_id, status, idempotency_key)
            VALUES ($1, $2::uuid, $3::uuid, $4, 'INR', $5, $6, $7, 'pending', $8)
            ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = now()
            """,
            txn_ref, event["id"], user_id, _TEST_AMOUNT, _TEST_PAYEE_UPI,
            screenshot_path, transaction_id, idempotency_key,
        )

    return {
        "local_txn_ref": txn_ref,
        "transaction_id": transaction_id,
        "utr_no": _TEST_UTR,
        "amount": _TEST_AMOUNT,
        "payee_upi": _TEST_PAYEE_UPI,
        "channel_id": channel_id,
        "screenshot_url": f"/api/payments/uploads/{screenshot_path}",
        "hint": (
            "POST to the reconciliation service's own /parseEmail "
            f"({settings.reconciliation_service_base_url}/parseEmail) with body "
            f'{{"source_type": "EMAIL", "channel_id": "{channel_id}", '
            f'"transaction_id": "{transaction_id}", "utr_no": "{_TEST_UTR}"}} '
            "to test the mailbox-search reconciliation flow against this seeded transaction."
        ),
    }


# ── POST /test/seed-registration ─────────────────────────────────────────────

@router.post("/seed-registration",
             summary="Seed a pending registration (+ test event/collector) for the real "
                      "checkout UI — upload the bundled test screenshot at /registrations "
                      "to test the auto-confirm flow end to end")
async def seed_registration(
    body: SeedRegistrationBody,
    claims: dict = Depends(require_role("admin")),
):
    caller = await get_by_sub(claims.get("sub", ""))
    if not caller:
        raise HTTPException(status_code=404, detail="Calling user not found")
    caller_id = caller["id"]

    target_user_id = body.user_id or caller_id
    target_user = await get_by_id(target_user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="user_id not found")

    pool = await get_pool()
    async with pool.acquire() as conn:
        # Direct reads/writes against event_svc here (rather than the internal API)
        # are test-tooling only — this whole router is gated behind
        # PAYMENT_SERVICE_ENV=testing (never mounted in production, see app/main.py) —
        # and require the operator to have granted this role access to event_svc for
        # local testing (see DB_ISOLATION_PLAN.md's rollback-window note). Not worth a
        # dedicated internal write endpoint just for seeding test data.
        event = await conn.fetchrow("SELECT id::text, title FROM event WHERE title = $1", _TEST_EVENT_TITLE)
        if not event:
            event = await conn.fetchrow(
                """
                INSERT INTO event
                    (society_id, organizer_id, title, description, start_time, end_time,
                     venue, status, ticket_price, price_currency, is_free)
                VALUES
                    ($1::uuid, $2::uuid, $3,
                     'Auto-created by /test/seed-registration for reconciliation testing',
                     now() + interval '7 days', now() + interval '7 days' + interval '2 hours',
                     'Test Venue', 'published', $4, 'INR', false)
                RETURNING id::text, title
                """,
                settings.society_id, caller_id, _TEST_EVENT_TITLE, _TEST_AMOUNT,
            )

        committee_members = await get_by_role("committee_member")
        collector_id = committee_members[0]["id"] if committee_members else caller_id

        await conn.execute(
            """
            INSERT INTO committee_registry (event_id, member_id, upi_id, assigned_by)
            VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
            ON CONFLICT (event_id) DO UPDATE SET upi_id = EXCLUDED.upi_id
            """,
            event["id"], collector_id, _TEST_PAYEE_UPI, caller_id,
        )

        # Mirrors POST /registrations (registration-service): status must be
        # 'pending_payment' (not the schema comment's generic 'pending') and a
        # 'payment' row with status='pending_screenshot' must exist, since the
        # booking UI's "Awaiting Payment Upload" bucket / Upload button key off
        # payment.status, not registration.status — a registration with no
        # payment row is invisible on /registrations regardless of its own status.
        registration = await conn.fetchrow(
            """
            INSERT INTO registration (event_id, user_id, ticket_count, total_amount, display_currency, status)
            VALUES ($1::uuid, $2::uuid, 1, $3, 'INR', 'pending_payment')
            RETURNING id::text
            """,
            event["id"], target_user_id, _TEST_AMOUNT,
        )

        await conn.execute(
            """
            INSERT INTO payment
                (registration_id, gateway_name, payment_method, original_amount, original_currency,
                 settled_amount, settled_currency, status)
            VALUES ($1::uuid, 'manual', 'manual_upi', $2, 'INR', $2, 'INR', 'pending_screenshot')
            """,
            registration["id"], _TEST_AMOUNT,
        )

    return {
        "event_id": event["id"],
        "event_title": event["title"],
        "registration_id": registration["id"],
        "user_id": target_user_id,
        "user_name": target_user["name"],
        "amount": _TEST_AMOUNT,
        "payee_upi": _TEST_PAYEE_UPI,
        "test_screenshot_path": str(_TEST_SCREENSHOT),
        "hint": (
            f"Log in as '{target_user['name']}' at https://gm-global-techies-town.club/registrations — "
            "the seeded registration now shows under 'Awaiting Payment Upload'. Click 'Upload Payment', "
            f"then upload {_TEST_SCREENSHOT.name} (the amount ₹{_TEST_AMOUNT:g} and payee UPI match it exactly). "
            "When asked to confirm the transaction date/time, set it to 27 Jun 2026 7:23 PM so the "
            "search window covers it (the frontend widens search_days automatically based on that field)."
        ),
    }
