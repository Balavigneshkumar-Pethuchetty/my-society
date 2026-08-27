from __future__ import annotations
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from asyncpg import Pool

from app.config import settings
from app.database import get_pool
from app.auth import get_current_claims, require_role
from app.models import (
    LeaveRequestCreate,
    LeaveRequestReview,
    LeaveRequestResponse,
    LeaveRequestListResponse,
)
from app.notifications import notify_admins, send_channels
from app.routes.users import _keycloak_delete_user

router = APIRouter()


# ── helpers ───────────────────────────────────────────────────────────────────

async def _get_db_user(conn, claims: dict) -> dict:
    sub = claims.get("sub")
    row = await conn.fetchrow(
        "SELECT id, name, email, keycloak_sub FROM users WHERE keycloak_sub = $1", sub
    )
    if not row:
        raise HTTPException(status_code=404, detail="User not found — call /users/sync first")
    return row


async def _leave_blockers(conn, user_id: UUID) -> tuple[bool, list[str]]:
    """Human-readable reasons the user cannot yet finalize account deletion.
    Pending payments are self-resolvable (cancel the ticket); the rest need
    an admin to reassign ownership first — there's no safe FK cascade for them."""
    blockers: list[str] = []

    pending_payments = await conn.fetch(
        """
        SELECT DISTINCT e.title
        FROM payment_transaction pt JOIN event e ON e.id = pt.event_id
        WHERE pt.user_id = $1 AND pt.status IN ('pending', 'verified', 'refund_requested')
        """,
        user_id,
    )
    has_pending_payment = len(pending_payments) > 0
    for r in pending_payments:
        blockers.append(f'Pending payment for event "{r["title"]}" — cancel your ticket first.')

    organizer_events = await conn.fetch("SELECT title FROM event WHERE organizer_id = $1", user_id)
    for r in organizer_events:
        blockers.append(f'You are the organizer of event "{r["title"]}" — ask an admin to reassign it first.')

    collector_events = await conn.fetch(
        """
        SELECT DISTINCT e.title FROM committee_registry cr JOIN event e ON e.id = cr.event_id
        WHERE cr.member_id = $1 OR cr.assigned_by = $1
        """,
        user_id,
    )
    for r in collector_events:
        blockers.append(f'You are the payment collector for event "{r["title"]}" — ask an admin to reassign it first.')

    if await conn.fetchval("SELECT COUNT(*) FROM announcement WHERE author_id = $1", user_id):
        blockers.append("You have authored event announcements — ask an admin to reassign authorship first.")

    if await conn.fetchval("SELECT COUNT(*) FROM sponsorship_refund WHERE requested_by = $1", user_id):
        blockers.append("You have open sponsorship refund requests — ask an admin to resolve them first.")

    if await conn.fetchval("SELECT COUNT(*) FROM event_permission WHERE granted_by = $1", user_id):
        blockers.append("You have granted event permissions to other organizers — ask an admin to reassign these first.")

    return has_pending_payment, blockers


async def _to_response(conn, row: dict) -> LeaveRequestResponse:
    has_pending_payment, blockers = (False, [])
    if row["status"] in ("pending", "approved") and row["user_id"]:
        has_pending_payment, blockers = await _leave_blockers(conn, row["user_id"])
    return LeaveRequestResponse(
        **dict(row),
        has_pending_payment=has_pending_payment,
        blockers=blockers,
    )


async def _notify(
    conn, user_id: UUID, type_: str, title: str, message: str, related_id: Optional[UUID] = None
) -> None:
    await conn.execute(
        "INSERT INTO notification (user_id, type, title, message, related_id) VALUES ($1, $2, $3, $4, $5)",
        user_id, type_, title, message, related_id,
    )


_REQUEST_COLS = (
    "id, user_id, user_name, user_email, reason, status, requested_at, "
    "reviewed_by, reviewed_by_name, reviewed_at, review_note, completed_at"
)


# ── self-service endpoints ───────────────────────────────────────────────────

@router.post("", response_model=LeaveRequestResponse, summary="Submit a leave-society request (self)")
async def create_leave_request(
    body: LeaveRequestCreate,
    background_tasks: BackgroundTasks,
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        user = await _get_db_user(conn, claims)

        existing = await conn.fetchrow(
            "SELECT id FROM leave_request WHERE user_id = $1 AND status IN ('pending', 'approved')",
            user["id"],
        )
        if existing:
            raise HTTPException(status_code=409, detail="You already have an open leave request")

        row = await conn.fetchrow(
            f"""
            INSERT INTO leave_request (user_id, user_name, user_email, reason)
            VALUES ($1, $2, $3, $4)
            RETURNING {_REQUEST_COLS}
            """,
            user["id"], user["name"], user["email"], body.reason,
        )

        link = f"{settings.app_public_url}/admin/leave-requests?request_id={row['id']}"
        message = f'{user["name"]} has requested to leave the society. Review: {link}'
        recipients = await notify_admins(
            conn, "leave_request_submitted", "New Leave Request", message,
            related_id=row["id"], exclude_user_id=user["id"],
        )

        response = await _to_response(conn, dict(row))

    background_tasks.add_task(send_channels, recipients, message)
    return response


@router.get("/me", response_model=Optional[LeaveRequestResponse], summary="Get your own latest leave request")
async def get_my_leave_request(
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        user = await _get_db_user(conn, claims)
        row = await conn.fetchrow(
            f"SELECT {_REQUEST_COLS} FROM leave_request WHERE user_id = $1 "
            "ORDER BY requested_at DESC LIMIT 1",
            user["id"],
        )
        if not row:
            return None
        return await _to_response(conn, dict(row))


@router.get(
    "/{request_id}/activity-export",
    summary="Download your own activity history as JSON (self, or admin reviewing the request)",
)
async def export_activity(
    request_id: UUID,
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    realm_roles: list[str] = claims.get("realm_access", {}).get("roles", [])
    async with pool.acquire() as conn:
        req = await conn.fetchrow("SELECT user_id FROM leave_request WHERE id = $1", request_id)
        if not req:
            raise HTTPException(status_code=404, detail="Leave request not found")

        if "admin" not in realm_roles:
            user = await _get_db_user(conn, claims)
            if req["user_id"] != user["id"]:
                raise HTTPException(status_code=403, detail="Not your leave request")

        user_id = req["user_id"]
        if not user_id:
            raise HTTPException(status_code=404, detail="User no longer exists")

        profile = await conn.fetchrow(
            "SELECT name, email, phone, role, created_at FROM users WHERE id = $1", user_id
        )
        apartments = await conn.fetch(
            "SELECT a.block, a.unit_number, a.type FROM user_apartments ua "
            "JOIN apartment a ON a.id = ua.apartment_id WHERE ua.user_id = $1",
            user_id,
        )
        registrations = await conn.fetch(
            "SELECT e.title AS event_title, r.status, r.ticket_count, r.total_amount, r.registered_at "
            "FROM registration r JOIN event e ON e.id = r.event_id "
            "WHERE r.user_id = $1 ORDER BY r.registered_at DESC",
            user_id,
        )
        tickets = await conn.fetch(
            "SELECT e.title AS event_title, t.status, t.issued_at, t.scanned_at "
            "FROM ticket t JOIN event e ON e.id = t.event_id "
            "WHERE t.user_id = $1 ORDER BY t.issued_at DESC",
            user_id,
        )
        payments = await conn.fetch(
            "SELECT e.title AS event_title, pt.amount, pt.currency, pt.status, pt.created_at "
            "FROM payment_transaction pt JOIN event e ON e.id = pt.event_id "
            "WHERE pt.user_id = $1 ORDER BY pt.created_at DESC",
            user_id,
        )
        notifications = await conn.fetch(
            "SELECT type, title, message, created_at FROM notification "
            "WHERE user_id = $1 ORDER BY created_at DESC",
            user_id,
        )

    return {
        "profile": dict(profile) if profile else None,
        "apartments": [dict(r) for r in apartments],
        "registrations": [dict(r) for r in registrations],
        "tickets": [dict(r) for r in tickets],
        "payments": [dict(r) for r in payments],
        "notifications": [dict(r) for r in notifications],
    }


@router.post(
    "/{request_id}/confirm",
    summary="Irreversibly finalize account deletion (self, only once approved)",
)
async def confirm_leave(
    request_id: UUID,
    background_tasks: BackgroundTasks,
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        user = await _get_db_user(conn, claims)

        req = await conn.fetchrow(
            "SELECT id, user_id, status FROM leave_request WHERE id = $1", request_id
        )
        if not req:
            raise HTTPException(status_code=404, detail="Leave request not found")
        if req["user_id"] != user["id"]:
            raise HTTPException(status_code=403, detail="Not your leave request")
        if req["status"] != "approved":
            raise HTTPException(status_code=409, detail="Leave request is not approved")

        _, blockers = await _leave_blockers(conn, user["id"])
        if blockers:
            raise HTTPException(status_code=409, detail="; ".join(blockers))

        async with conn.transaction():
            # Any still-open admin action-item notification pointing at this user's
            # registrations/payment_transactions (cancellation/refund/verification
            # requests) can never be resolved once those rows are gone below — clear
            # them now instead of leaving permanently-orphaned cards in the popup.
            await conn.execute(
                "DELETE FROM notification WHERE type = 'cancellation_requested' "
                "AND related_id IN (SELECT id FROM registration WHERE user_id = $1)",
                user["id"],
            )
            await conn.execute(
                "DELETE FROM notification WHERE type IN ('refund_requested', 'payment_verification_requested') "
                "AND related_id IN (SELECT id FROM payment_transaction WHERE user_id = $1)",
                user["id"],
            )
            await conn.execute(
                "DELETE FROM refund WHERE payment_id IN "
                "(SELECT id FROM payment WHERE registration_id IN "
                "(SELECT id FROM registration WHERE user_id = $1))",
                user["id"],
            )
            await conn.execute(
                "DELETE FROM payment WHERE registration_id IN "
                "(SELECT id FROM registration WHERE user_id = $1)",
                user["id"],
            )
            await conn.execute("DELETE FROM payment_transaction WHERE user_id = $1", user["id"])
            await conn.execute("DELETE FROM registration WHERE user_id = $1", user["id"])

            await conn.execute(
                "UPDATE leave_request SET status = 'completed', completed_at = NOW() WHERE id = $1",
                request_id,
            )
            await conn.execute("DELETE FROM users WHERE id = $1", user["id"])

        # user["id"] no longer exists in `users` at this point — capture the name/email
        # above (already done) rather than re-querying, and don't try to exclude self
        # from the admin list (a departing admin's own row is already gone).
        link = f"{settings.app_public_url}/admin/leave-requests?request_id={request_id}"
        message = (
            f'{user["name"]} has left the society. Their account and all associated data '
            f"have been deleted. Details: {link}"
        )
        recipients = await notify_admins(
            conn, "leave_request_completed", "Member Left the Society", message,
            related_id=request_id,
        )

    if user["keycloak_sub"]:
        try:
            await _keycloak_delete_user(user["keycloak_sub"])
        except Exception:
            pass

    background_tasks.add_task(send_channels, recipients, message)
    return {"status": "completed"}


# ── admin endpoints ───────────────────────────────────────────────────────────

@router.get(
    "",
    response_model=LeaveRequestListResponse,
    summary="List leave requests (admin only)",
    dependencies=[Depends(require_role("admin"))],
)
async def list_leave_requests(
    status: Optional[str] = Query(default=None),
    pool: Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        query = f"SELECT {_REQUEST_COLS} FROM leave_request"
        params: list = []
        if status:
            query += " WHERE status = $1"
            params.append(status)
        query += " ORDER BY requested_at DESC"
        rows = await conn.fetch(query, *params)
        items = [await _to_response(conn, dict(r)) for r in rows]
    return LeaveRequestListResponse(total=len(items), items=items)


@router.post(
    "/{request_id}/approve",
    response_model=LeaveRequestResponse,
    summary="Approve a pending leave request (admin only)",
    dependencies=[Depends(require_role("admin"))],
)
async def approve_leave_request(
    request_id: UUID,
    background_tasks: BackgroundTasks,
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        admin = await _get_db_user(conn, claims)
        req = await conn.fetchrow("SELECT * FROM leave_request WHERE id = $1", request_id)
        if not req:
            raise HTTPException(status_code=404, detail="Leave request not found")
        if req["status"] != "pending":
            raise HTTPException(status_code=409, detail="Leave request has already been reviewed")

        row = await conn.fetchrow(
            f"""
            UPDATE leave_request
            SET status = 'approved', reviewed_by = $1, reviewed_by_name = $2, reviewed_at = NOW()
            WHERE id = $3
            RETURNING {_REQUEST_COLS}
            """,
            admin["id"], admin["name"], request_id,
        )
        await conn.execute(
            "DELETE FROM notification WHERE type = 'leave_request_submitted' AND related_id = $1",
            request_id,
        )
        message = (
            "Your request to leave the society has been approved. "
            "Visit your Profile page to review and finalize."
        )
        recipients: list[dict] = []
        if row["user_id"]:
            await _notify(conn, row["user_id"], "leave_request_approved", "Leave Request Approved", message)
            user = await conn.fetchrow("SELECT phone, email FROM users WHERE id = $1", row["user_id"])
            if user:
                recipients = [{"phone": user["phone"], "email": user["email"], "title": "Leave Request Approved"}]

        response = await _to_response(conn, dict(row))

    background_tasks.add_task(send_channels, recipients, message)
    return response


@router.post(
    "/{request_id}/reject",
    response_model=LeaveRequestResponse,
    summary="Reject a pending leave request (admin only)",
    dependencies=[Depends(require_role("admin"))],
)
async def reject_leave_request(
    request_id: UUID,
    body: LeaveRequestReview,
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        admin = await _get_db_user(conn, claims)
        req = await conn.fetchrow("SELECT * FROM leave_request WHERE id = $1", request_id)
        if not req:
            raise HTTPException(status_code=404, detail="Leave request not found")
        if req["status"] != "pending":
            raise HTTPException(status_code=409, detail="Leave request has already been reviewed")

        row = await conn.fetchrow(
            f"""
            UPDATE leave_request
            SET status = 'rejected', reviewed_by = $1, reviewed_by_name = $2,
                reviewed_at = NOW(), review_note = $3
            WHERE id = $4
            RETURNING {_REQUEST_COLS}
            """,
            admin["id"], admin["name"], body.note, request_id,
        )
        await conn.execute(
            "DELETE FROM notification WHERE type = 'leave_request_submitted' AND related_id = $1",
            request_id,
        )
        if row["user_id"]:
            await _notify(
                conn, row["user_id"], "leave_request_rejected", "Leave Request Rejected",
                body.note or "Your request to leave the society was rejected.",
            )
        return await _to_response(conn, dict(row))


@router.post(
    "/{request_id}/revoke",
    response_model=LeaveRequestResponse,
    summary="Revoke a leave request due to a pending event payment (admin only)",
    dependencies=[Depends(require_role("admin"))],
)
async def revoke_leave_request(
    request_id: UUID,
    body: LeaveRequestReview,
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        admin = await _get_db_user(conn, claims)
        req = await conn.fetchrow("SELECT * FROM leave_request WHERE id = $1", request_id)
        if not req:
            raise HTTPException(status_code=404, detail="Leave request not found")
        if req["status"] not in ("pending", "approved"):
            raise HTTPException(status_code=409, detail="Leave request is not open")
        if not req["user_id"]:
            raise HTTPException(status_code=404, detail="User no longer exists")

        has_pending_payment, _ = await _leave_blockers(conn, req["user_id"])
        if not has_pending_payment:
            raise HTTPException(
                status_code=400,
                detail="This user has no pending event payment to justify revoking",
            )

        note = body.note or "You have a pending event payment. Cancel your ticket, then submit a new request."
        row = await conn.fetchrow(
            f"""
            UPDATE leave_request
            SET status = 'revoked', reviewed_by = $1, reviewed_by_name = $2,
                reviewed_at = NOW(), review_note = $3
            WHERE id = $4
            RETURNING {_REQUEST_COLS}
            """,
            admin["id"], admin["name"], note, request_id,
        )
        await conn.execute(
            "DELETE FROM notification WHERE type = 'leave_request_submitted' AND related_id = $1",
            request_id,
        )
        await _notify(conn, row["user_id"], "leave_request_revoked", "Leave Request Revoked", note)
        return await _to_response(conn, dict(row))
