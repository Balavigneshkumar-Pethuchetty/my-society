"""
Internal endpoints — only reachable by other containers on society_net.
Protected by X-Internal-Key header; never proxied through nginx.

The by-role/notifications endpoints below exist for visitor-service (services/visitor),
which owns its own database and therefore cannot SQL-join into `users`/`notification`
the way same-DB services do — it resolves/broadcasts to residents and staff purely
through this internal API.
"""
from typing import Optional
from uuid import UUID
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException

from app.database import get_pool
from app.auth import require_internal_key
from app.models import UserResponse
from app.routes.users import _USER_COLS, _row_to_user, _fetch_user_apartments

router = APIRouter(dependencies=[Depends(require_internal_key)])


async def _fetch_unit_label(conn, user_id) -> Optional[str]:
    """COALESCE precedence: (1) user_units → structure_nodes — same join
    ticket-service's same-DB roster query uses (services/ticket/app/routes/
    tickets.py's _ROSTER_QUERY), duplicated here since visitor-service can't
    do that join itself (separate DB); (2) legacy user_apartments → apartment;
    (3) the users.structure_node_id column directly — many accounts predate
    the user_units migration and only ever had this column set, never a
    user_units row, so without this fallback their flat/unit silently never
    resolves anywhere that calls this endpoint."""
    return await conn.fetchval(
        """
        SELECT COALESCE(
            (SELECT sn.name FROM user_units uu JOIN structure_nodes sn ON sn.id = uu.node_id
             WHERE uu.user_id = $1 LIMIT 1),
            (SELECT a.block || ' – ' || a.unit_number FROM user_apartments ua
             JOIN apartment a ON a.id = ua.apartment_id WHERE ua.user_id = $1 LIMIT 1),
            (SELECT sn.name FROM users u JOIN structure_nodes sn ON sn.id = u.structure_node_id
             WHERE u.id = $1)
        )
        """,
        user_id,
    )


@router.get(
    "/by-sub/{keycloak_sub}",
    response_model=UserResponse,
    summary="Resolve keycloak_sub → user row",
)
async def get_by_sub(
    keycloak_sub: str,
    pool=Depends(get_pool),
):
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"SELECT {_USER_COLS} FROM users u WHERE u.keycloak_sub = $1",
            keycloak_sub,
        )
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        apartments = await _fetch_user_apartments(conn, row["id"])
        unit_label = await _fetch_unit_label(conn, row["id"])
    user = _row_to_user(row, apartments)
    user.unit_label = unit_label
    return user


@router.get(
    "/{user_id}",
    response_model=UserResponse,
    summary="Get user by internal UUID",
)
async def get_by_id(
    user_id: UUID,
    pool=Depends(get_pool),
):
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"SELECT {_USER_COLS} FROM users u WHERE u.id = $1",
            user_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        apartments = await _fetch_user_apartments(conn, user_id)
        unit_label = await _fetch_unit_label(conn, user_id)
    user = _row_to_user(row, apartments)
    user.unit_label = unit_label
    return user


@router.get(
    "/by-role/{role}",
    response_model=list[UserResponse],
    summary="List active users with a given role (for broadcast notifications)",
)
async def list_by_role(
    role: str,
    pool=Depends(get_pool),
):
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"SELECT {_USER_COLS} FROM users u WHERE u.role = $1 AND u.is_active = TRUE",
            role,
        )
        users = []
        for row in rows:
            user = _row_to_user(row, await _fetch_user_apartments(conn, row["id"]))
            user.unit_label = await _fetch_unit_label(conn, row["id"])
            users.append(user)
        return users


class InternalNotificationBody(BaseModel):
    type: str
    title: str
    message: str
    related_id: Optional[str] = None


@router.post(
    "/{user_id}/notifications",
    status_code=204,
    summary="Write an in-app bell notification on behalf of another service",
)
async def create_notification(
    user_id: UUID,
    body: InternalNotificationBody,
    pool=Depends(get_pool),
):
    async with pool.acquire() as conn:
        exists = await conn.fetchval("SELECT 1 FROM users WHERE id = $1", user_id)
        if not exists:
            raise HTTPException(status_code=404, detail="User not found")
        await conn.execute(
            "INSERT INTO notification (user_id, type, title, message, related_id) "
            "VALUES ($1, $2, $3, $4, $5)",
            user_id, body.type, body.title, body.message,
            UUID(body.related_id) if body.related_id else None,
        )
