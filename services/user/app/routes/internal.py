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
    "/by-ids",
    response_model=list[UserResponse],
    summary="Batch get users by a list of internal UUIDs",
)
async def get_by_ids(
    ids: str,
    pool=Depends(get_pool),
):
    """Registered ahead of GET /{user_id} — both are single path segments, and
    FastAPI/Starlette resolve routes in registration order, so this must come
    first or every /by-ids request would 422 trying to parse "by-ids" as a UUID."""
    id_list = [i for i in ids.split(",") if i]
    if not id_list:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"SELECT {_USER_COLS} FROM users u WHERE u.id = ANY($1::uuid[])",
            id_list,
        )
        users = []
        for row in rows:
            user = _row_to_user(row, await _fetch_user_apartments(conn, row["id"]))
            user.unit_label = await _fetch_unit_label(conn, row["id"])
            users.append(user)
        return users


@router.get(
    "/by-email/{email}",
    response_model=UserResponse,
    summary="Resolve email → user row",
)
async def get_by_email(
    email: str,
    pool=Depends(get_pool),
):
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"SELECT {_USER_COLS} FROM users u WHERE u.email = $1",
            email,
        )
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        apartments = await _fetch_user_apartments(conn, row["id"])
        unit_label = await _fetch_unit_label(conn, row["id"])
    user = _row_to_user(row, apartments)
    user.unit_label = unit_label
    return user


@router.get(
    "/broadcast-targets",
    response_model=list[UserResponse],
    summary="All active, non-guest users (for broadcast notifications)",
)
async def broadcast_targets(
    pool=Depends(get_pool),
):
    """Registered ahead of GET /{user_id} for the same routing reason as /by-ids."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"SELECT {_USER_COLS} FROM users u WHERE u.is_active = TRUE AND u.role != 'guest'",
        )
        users = []
        for row in rows:
            user = _row_to_user(row, await _fetch_user_apartments(conn, row["id"]))
            user.unit_label = await _fetch_unit_label(conn, row["id"])
            users.append(user)
        return users


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
    "/by-unit-of/{user_id}",
    response_model=list[UserResponse],
    summary="List every user sharing any unit/apartment with the given user (including themselves)",
)
async def list_unitmates(
    user_id: UUID,
    pool=Depends(get_pool),
):
    """Used by visitor-service so a resident's 'my visitor passes' view can
    include passes created by any other household member on the same
    unit/apartment, not just their own — residents otherwise have no local
    concept of "household", only individual accounts. Matches sharing via
    any of the three unit-link mechanisms _fetch_unit_label reads from
    (user_units, legacy user_apartments, or the users.structure_node_id
    fallback column), OR'd together rather than COALESCE-precedence since we
    want anyone linked by any mechanism, not just the first that resolves."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT {_USER_COLS} FROM users u WHERE u.id IN (
                SELECT user_id FROM user_units WHERE node_id IN (
                    SELECT node_id FROM user_units WHERE user_id = $1
                )
                UNION
                SELECT user_id FROM user_apartments WHERE apartment_id IN (
                    SELECT apartment_id FROM user_apartments WHERE user_id = $1
                )
                UNION
                SELECT id FROM users WHERE structure_node_id IS NOT NULL AND structure_node_id = (
                    SELECT structure_node_id FROM users WHERE id = $1
                )
                UNION
                SELECT $1
            )
            """,
            user_id,
        )
        users = []
        for row in rows:
            user = _row_to_user(row, await _fetch_user_apartments(conn, row["id"]))
            user.unit_label = await _fetch_unit_label(conn, row["id"])
            users.append(user)
        return users


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
    event_id: Optional[str] = None


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
            "INSERT INTO notification (user_id, event_id, type, title, message, related_id) "
            "VALUES ($1, $2, $3, $4, $5, $6)",
            user_id, UUID(body.event_id) if body.event_id else None,
            body.type, body.title, body.message,
            UUID(body.related_id) if body.related_id else None,
        )


class GuestCreateBody(BaseModel):
    name: str


@router.post(
    "/guest",
    summary="Create a lightweight guest placeholder account (no keycloak_sub, can never log in)",
)
async def create_guest(
    body: GuestCreateBody,
    pool=Depends(get_pool),
):
    async with pool.acquire() as conn:
        guest_id = await conn.fetchval(
            "INSERT INTO users (name, role, is_active) VALUES ($1, 'guest', FALSE) RETURNING id::text",
            body.name,
        )
    return {"id": guest_id}
