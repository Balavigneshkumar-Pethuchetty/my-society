"""Internal endpoints — only reachable by other containers on society_net.
Protected by X-Internal-Key header; never proxied through nginx.

Exists so that registration-service (complimentary-ticket issue/cancel) and
user-service (account-deletion activity export), which used to read/write
`ticket` directly, can keep working now that `ticket` lives in ticket-service's
own `ticket_svc` Postgres schema (see DB_ISOLATION_PLAN.md, step 2) instead of
`public`.
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query

from app.database import get_pool
from app.auth import require_internal_key
from app.models import TicketActivityInternal, TicketInternal, TicketIssueBody, TicketIssueOut

router = APIRouter(dependencies=[Depends(require_internal_key)])


@router.get("/by-reg-ids", response_model=list[TicketInternal],
            summary="Batch ticket lookup by registration id (comp-ticket list/detail)")
async def get_by_reg_ids(ids: str = Query(..., description="Comma-separated registration ids"), pool=Depends(get_pool)):
    id_list = [i for i in ids.split(",") if i]
    if not id_list:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id::text, reg_id::text, status, qr_token FROM ticket WHERE reg_id = ANY($1::uuid[])",
            id_list,
        )
    return [dict(r) for r in rows]


@router.get("/by-user/{user_id}", response_model=list[TicketActivityInternal],
            summary="A user's ticket history (account-deletion activity export)")
async def get_by_user(user_id: str, pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT event_id::text, status, issued_at, scanned_at "
            "FROM ticket WHERE user_id = $1::uuid ORDER BY issued_at DESC",
            user_id,
        )
    return [dict(r) for r in rows]


@router.post("", response_model=TicketIssueOut, summary="Issue a ticket (complimentary-ticket flow)")
async def issue_ticket(body: TicketIssueBody, pool=Depends(get_pool)):
    qr_token = body.qr_token or str(uuid.uuid4())
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO ticket (reg_id, user_id, event_id, qr_token) "
            "VALUES ($1::uuid, $2::uuid, $3::uuid, $4) "
            "ON CONFLICT (reg_id) DO NOTHING",
            body.reg_id, body.user_id, body.event_id, qr_token,
        )
        row = await conn.fetchrow(
            "SELECT id::text, qr_token FROM ticket WHERE reg_id = $1::uuid", body.reg_id,
        )
    if not row:
        raise HTTPException(status_code=500, detail="Ticket issuance failed")
    return dict(row)


@router.post("/cancel-by-reg/{reg_id}", status_code=204, summary="Cancel the ticket for a registration, if any")
async def cancel_by_reg(reg_id: str, pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE ticket SET status = 'cancelled' WHERE reg_id = $1::uuid", reg_id,
        )
