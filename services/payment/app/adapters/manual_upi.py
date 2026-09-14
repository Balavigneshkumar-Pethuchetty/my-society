import secrets
from urllib.parse import quote_plus

from fastapi import HTTPException

from app.adapters.base import PaymentProcessor
from app.database import get_pool
from app.event_client import get_event
from shared.user_client import get_by_id


class ManualUpiAdapter(PaymentProcessor):
    """Manual UPI adapter: builds a UPI-intent URI, creates PENDING records,
    and verifies by matching a UTR entered by the operator (FR-06) or auto-matched
    from the inbox (FR-05)."""

    async def initiate_payment(self, order: dict) -> dict:
        event_id       = order["event_id"]
        registration_id = order.get("registration_id")
        user_id        = order["user_id"]
        payer_upi      = order["payer_upi"]
        idempotency_key = order.get("idempotency_key", secrets.token_hex(16))

        pool = await get_pool()
        async with pool.acquire() as conn:
            # Resolve collector from committee_registry
            collector = await conn.fetchrow(
                """SELECT cr.upi_id, cr.member_id::text
                   FROM committee_registry cr
                   WHERE cr.event_id = $1::uuid""",
                event_id,
            )
            if not collector:
                raise HTTPException(
                    status_code=400,
                    detail="No collector assigned for this event. Contact an admin.",
                )
            event = await get_event(event_id)
            member = await get_by_id(collector["member_id"])

            # If registration supplied, use its total_amount
            if registration_id:
                reg = await conn.fetchrow(
                    "SELECT total_amount FROM registration_svc.registration WHERE id = $1::uuid",
                    registration_id,
                )
                amount = float(reg["total_amount"]) if reg else float(event["ticket_price"] or 0)
            else:
                amount = float(event["ticket_price"] or 0)

            payee_upi  = collector["upi_id"]
            upi_name   = (member or {}).get("name")
            event_title = event["title"]
            currency   = event.get("price_currency", "INR")

            # Idempotency: return existing pending txn if key matches (skip cancelled)
            existing = await conn.fetchrow(
                "SELECT id::text, txn_ref, status FROM payment_transaction WHERE idempotency_key = $1",
                idempotency_key,
            )
            if existing and existing["status"] == "pending":
                upi_intent_uri = _build_upi_uri(payee_upi, upi_name, amount, event_title, existing["txn_ref"])
                return {"txn_ref": existing["txn_ref"], "payee_upi": payee_upi, "amount": amount,
                        "upi_intent_uri": upi_intent_uri, "status": "pending"}

            if existing and existing["status"] == "cancelled":
                # A prior screenshot for this same registration was rejected — reopen
                # this SAME row for the resident's retry instead of inserting a second
                # row, which would violate the idempotency_key UNIQUE constraint.
                await conn.execute(
                    "UPDATE payment_transaction SET status='pending', screenshot_path=NULL, "
                    "parsed_amount=NULL, parsed_upi_ref=NULL, parsed_rrn=NULL, parsed_bank=NULL, "
                    "parsed_timestamp=NULL, updated_at=now() WHERE id=$1::uuid",
                    existing["id"],
                )
                await conn.execute(
                    """INSERT INTO payment_audit_log (txn_id, from_status, to_status, updated_by, note)
                       VALUES ($1::uuid, 'cancelled', 'pending', $2, 'Resident resubmitted after rejection')""",
                    existing["id"], user_id,
                )
                upi_intent_uri = _build_upi_uri(payee_upi, upi_name, amount, event_title, existing["txn_ref"])
                return {"txn_ref": existing["txn_ref"], "payee_upi": payee_upi, "amount": amount,
                        "upi_intent_uri": upi_intent_uri, "status": "pending"}

            txn_ref = "TXN" + secrets.token_hex(8).upper()

            txn_id = await conn.fetchval(
                """INSERT INTO payment_transaction
                   (txn_ref, event_id, registration_id, user_id, amount, currency,
                    payee_upi, payer_upi, idempotency_key)
                   VALUES ($1, $2::uuid, $3, $4::uuid, $5, $6, $7, $8, $9)
                   RETURNING id::text""",
                txn_ref, event_id,
                registration_id if registration_id else None,
                user_id, amount, currency, payee_upi, payer_upi, idempotency_key,
            )

            await conn.execute(
                """INSERT INTO payment_audit_log (txn_id, from_status, to_status, updated_by, note)
                   VALUES ($1::uuid, NULL, 'pending', $2, 'Payment initiated')""",
                txn_id, user_id,
            )

        upi_intent_uri = _build_upi_uri(payee_upi, upi_name, amount, event_title, txn_ref)
        return {
            "txn_ref": txn_ref, "payee_upi": payee_upi,
            "amount": amount, "upi_intent_uri": upi_intent_uri, "status": "pending",
        }

    async def verify_payment(self, txn_ref: str, utr: str) -> dict:
        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT id::text, status, registration_id::text FROM payment_transaction WHERE txn_ref = $1",
                txn_ref,
            )
            if not row:
                raise HTTPException(status_code=404, detail="Transaction not found")
            if row["status"] == "verified":
                return {"status": "verified", "utr": utr}
            if row["status"] not in ("pending",):
                raise HTTPException(status_code=400, detail=f"Cannot verify transaction in status: {row['status']}")

            # Idempotency: block if UTR already used on another txn
            clash = await conn.fetchval(
                "SELECT id FROM payment_transaction WHERE payment_utr = $1 AND txn_ref != $2",
                utr, txn_ref,
            )
            if clash:
                raise HTTPException(status_code=409, detail="UTR already used on another transaction")

            await conn.execute(
                "UPDATE payment_transaction SET status='verified', payment_utr=$1, updated_at=now() WHERE txn_ref=$2",
                utr, txn_ref,
            )
            await conn.execute(
                """INSERT INTO payment_audit_log (txn_id, from_status, to_status, updated_by, note)
                   VALUES ($1::uuid, 'pending', 'verified', 'admin_user', $2)""",
                row["id"], f"Manual UTR entry: {utr}",
            )
            if row["registration_id"]:
                await conn.execute(
                    "UPDATE registration_svc.registration SET status='confirmed' WHERE id=$1::uuid",
                    row["registration_id"],
                )
        return {"status": "verified", "utr": utr}

    async def process_refund(self, txn_ref: str, refund_utr: str, refund_screenshot_path: str | None = None) -> dict:
        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT id::text, status FROM payment_transaction WHERE txn_ref = $1", txn_ref
            )
            if not row:
                raise HTTPException(status_code=404, detail="Transaction not found")
            if row["status"] not in ("refund_requested",):
                raise HTTPException(status_code=400, detail=f"Cannot refund transaction in status: {row['status']}")

            await conn.execute(
                "UPDATE payment_transaction SET status='refunded', refund_utr=$1, "
                "refund_screenshot_path=COALESCE($2, refund_screenshot_path), updated_at=now() WHERE txn_ref=$3",
                refund_utr, refund_screenshot_path, txn_ref,
            )
            await conn.execute(
                """INSERT INTO payment_audit_log (txn_id, from_status, to_status, updated_by, note)
                   VALUES ($1::uuid, 'refund_requested', 'refunded', 'committee_member', $2)""",
                row["id"], f"Refund UTR: {refund_utr}",
            )
        return {"status": "refunded", "refund_utr": refund_utr}


def _build_upi_uri(upi_id: str, name: str, amount: float, note: str, txn_ref: str) -> str:
    return (
        f"upi://pay?pa={quote_plus(upi_id)}&pn={quote_plus(name)}"
        f"&am={amount:.2f}&cu=INR"
        f"&tn={quote_plus(note[:50])}&tr={txn_ref}"
    )
