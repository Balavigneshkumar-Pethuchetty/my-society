from uuid import UUID
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from asyncpg import Pool

from app.database import get_pool
from app.auth import get_current_claims
from app.models import NotificationResponse, NotificationListResponse

router = APIRouter()


async def _get_user_id(claims: dict, conn) -> UUID:
    sub = claims.get("sub")
    row = await conn.fetchrow("SELECT id FROM users WHERE keycloak_sub = $1", sub)
    if not row:
        raise HTTPException(status_code=404, detail="User not found — call /users/sync first")
    return row["id"]


def _row_to_notif(row) -> NotificationResponse:
    return NotificationResponse(
        id=row["id"],
        event_id=row["event_id"],
        type=row["type"],
        title=row["title"],
        message=row["message"],
        is_read=row["is_read"],
        created_at=row["created_at"],
    )


# ── read-all must be before /{notification_id} to avoid UUID-match conflict ───

@router.patch("/read-all", status_code=204, summary="Mark all notifications as read")
async def mark_all_read(
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        user_id = await _get_user_id(claims, conn)
        await conn.execute(
            "UPDATE core.notification SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE",
            user_id,
        )


@router.get("", response_model=NotificationListResponse, summary="List notifications for current user")
async def list_notifications(
    unread: Optional[bool] = Query(None, description="true = only unread; false = only read; omit = all"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        user_id = await _get_user_id(claims, conn)

        conditions = ["user_id = $1"]
        params: list = [user_id]

        if unread is True:
            conditions.append("is_read = FALSE")
        elif unread is False:
            conditions.append("is_read = TRUE")

        where = " AND ".join(conditions)

        unread_count = await conn.fetchval(
            "SELECT COUNT(*) FROM core.notification WHERE user_id = $1 AND is_read = FALSE",
            user_id,
        )
        total = await conn.fetchval(
            f"SELECT COUNT(*) FROM core.notification WHERE {where}", *params
        )
        rows = await conn.fetch(
            f"""
            SELECT id, event_id, type, title, message, is_read, created_at
            FROM core.notification
            WHERE {where}
            ORDER BY created_at DESC
            LIMIT ${len(params) + 1} OFFSET ${len(params) + 2}
            """,
            *params, limit, offset,
        )

    return NotificationListResponse(
        unread_count=unread_count,
        total=total,
        items=[_row_to_notif(r) for r in rows],
    )


@router.patch("/{notification_id}/read", status_code=204, summary="Mark a single notification as read")
async def mark_read(
    notification_id: UUID,
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        user_id = await _get_user_id(claims, conn)
        row = await conn.fetchrow(
            "UPDATE core.notification SET is_read = TRUE WHERE id = $1 AND user_id = $2 RETURNING id",
            notification_id, user_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Notification not found")
