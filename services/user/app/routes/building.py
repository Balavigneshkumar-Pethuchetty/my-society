from uuid import UUID
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from asyncpg import Pool

from app.database import get_pool
from app.auth import get_current_claims, require_role
from app import crypto
from app.models import (
    HierarchyLevel,
    HierarchyConfigRequest,
    StructureNodeCreate,
    ImportRowsRequest,
    UserStructureNodeRequest,
    UserUnitRequest,
    UnitRequestCreate,
    UnitRequestReview,
    UnitRequestResponse,
)

router = APIRouter()


# ── Hierarchy config ──────────────────────────────────────────────────────────

@router.get("/hierarchy", summary="Get hierarchy level names")
async def get_hierarchy(
    _: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT level_index, level_name, is_billable "
            "FROM building_hierarchy_config ORDER BY level_index"
        )
    return [dict(r) for r in rows]


@router.put(
    "/hierarchy",
    summary="Replace hierarchy config (admin only) — cascades: deletes all nodes",
    dependencies=[Depends(require_role("admin"))],
)
async def set_hierarchy(body: HierarchyConfigRequest, pool: Pool = Depends(get_pool)):
    async with pool.acquire() as conn:
        async with conn.transaction():
            # Cascade deletes all structure_nodes (FK ON DELETE CASCADE)
            await conn.execute("DELETE FROM building_hierarchy_config")
            for lv in body.levels:
                await conn.execute(
                    "INSERT INTO building_hierarchy_config (level_index, level_name, is_billable) "
                    "VALUES ($1, $2, $3)",
                    lv.level_index, lv.level_name, lv.is_billable,
                )
    return {"ok": True}


# ── Structure nodes ───────────────────────────────────────────────────────────

@router.get("/nodes", summary="List all structure nodes (flat)")
async def get_nodes(
    _: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT n.id, n.name, n.level_index, h.level_name, n.parent_id, n.created_at
            FROM structure_nodes n
            JOIN building_hierarchy_config h ON h.level_index = n.level_index
            ORDER BY n.level_index, n.name
            """
        )
    return [dict(r) for r in rows]


@router.post(
    "/nodes",
    summary="Create a single structure node (admin only)",
    dependencies=[Depends(require_role("admin"))],
)
async def create_node(body: StructureNodeCreate, pool: Pool = Depends(get_pool)):
    async with pool.acquire() as conn:
        level = await conn.fetchrow(
            "SELECT level_name FROM building_hierarchy_config WHERE level_index = $1",
            body.level_index,
        )
        if not level:
            raise HTTPException(status_code=400, detail=f"Level index {body.level_index} not configured")

        if body.parent_id:
            parent = await conn.fetchrow(
                "SELECT id FROM structure_nodes WHERE id = $1", body.parent_id
            )
            if not parent:
                raise HTTPException(status_code=404, detail="Parent node not found")

        row = await conn.fetchrow(
            """
            INSERT INTO structure_nodes (name, level_index, parent_id)
            VALUES ($1, $2, $3)
            RETURNING id, name, level_index, parent_id, created_at
            """,
            body.name, body.level_index, body.parent_id,
        )
    return {**dict(row), "level_name": level["level_name"]}


@router.delete(
    "/nodes/{node_id}",
    status_code=204,
    summary="Delete a node and all its descendants (admin only)",
    dependencies=[Depends(require_role("admin"))],
)
async def delete_node(node_id: UUID, pool: Pool = Depends(get_pool)):
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM structure_nodes WHERE id = $1", node_id
        )
        if result == "DELETE 0":
            raise HTTPException(status_code=404, detail="Node not found")


@router.post(
    "/nodes/import-rows",
    summary="Bulk import nodes from parsed CSV/Excel rows (admin only)",
    dependencies=[Depends(require_role("admin"))],
)
async def import_rows(body: ImportRowsRequest, pool: Pool = Depends(get_pool)):
    async with pool.acquire() as conn:
        level_rows = await conn.fetch(
            "SELECT level_index FROM building_hierarchy_config ORDER BY level_index"
        )
        if not level_rows:
            raise HTTPException(status_code=400, detail="No hierarchy configured. Set up levels first.")

        level_indices = [r["level_index"] for r in level_rows]
        added = 0

        async with conn.transaction():
            for row in body.rows:
                parent_id: Optional[UUID] = None

                for col_i, cell in enumerate(row):
                    if col_i >= len(level_indices):
                        break
                    cell = cell.strip() if cell else ""
                    if not cell:
                        break

                    level_idx = level_indices[col_i]

                    if parent_id is None:
                        existing = await conn.fetchrow(
                            "SELECT id FROM structure_nodes "
                            "WHERE name = $1 AND level_index = $2 AND parent_id IS NULL",
                            cell, level_idx,
                        )
                    else:
                        existing = await conn.fetchrow(
                            "SELECT id FROM structure_nodes "
                            "WHERE name = $1 AND level_index = $2 AND parent_id = $3",
                            cell, level_idx, parent_id,
                        )

                    if existing:
                        parent_id = existing["id"]
                    else:
                        new_row = await conn.fetchrow(
                            "INSERT INTO structure_nodes (name, level_index, parent_id) "
                            "VALUES ($1, $2, $3) RETURNING id",
                            cell, level_idx, parent_id,
                        )
                        parent_id = new_row["id"]
                        added += 1

    return {"added": added}


# ── User structure-node assignment ────────────────────────────────────────────

@router.patch(
    "/users/{user_id}/structure-node",
    summary="Assign or clear a user's unit (admin or committee_member)",
    dependencies=[Depends(require_role("admin", "committee_member"))],
)
async def assign_structure_node(
    user_id: UUID,
    body: UserStructureNodeRequest,
    pool: Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        user = await conn.fetchrow("SELECT id FROM users WHERE id = $1", user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        if body.structure_node_id:
            node = await conn.fetchrow(
                "SELECT id FROM structure_nodes WHERE id = $1", body.structure_node_id
            )
            if not node:
                raise HTTPException(status_code=404, detail="Structure node not found")

        await conn.execute(
            "UPDATE users SET structure_node_id = $1 WHERE id = $2",
            body.structure_node_id, user_id,
        )
    return {"ok": True}


# ── Admin: manage a user's units (multi-flat) ─────────────────────────────────

@router.get(
    "/users/{user_id}/units",
    summary="List a user's current flat/unit assignments (admin or committee_member)",
    dependencies=[Depends(require_role("admin", "committee_member"))],
)
async def list_user_units(user_id: UUID, pool: Pool = Depends(get_pool)):
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT node_id, added_at FROM user_units WHERE user_id = $1 ORDER BY added_at",
            user_id,
        )
    return [{"node_id": str(r["node_id"]), "added_at": r["added_at"]} for r in rows]


@router.post(
    "/users/{user_id}/units",
    status_code=201,
    summary="Add a flat/unit for a user (admin or committee_member)",
    dependencies=[Depends(require_role("admin", "committee_member"))],
)
async def add_user_unit(user_id: UUID, body: UserUnitRequest, pool: Pool = Depends(get_pool)):
    async with pool.acquire() as conn:
        user = await conn.fetchrow("SELECT id FROM users WHERE id = $1", user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        node = await conn.fetchrow("SELECT id FROM structure_nodes WHERE id = $1", body.node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Structure node not found")
        await conn.execute(
            "INSERT INTO user_units (user_id, node_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            user_id, body.node_id,
        )
    return {"ok": True}


@router.delete(
    "/users/{user_id}/units/{node_id}",
    status_code=204,
    summary="Remove a flat/unit from a user (admin or committee_member)",
    dependencies=[Depends(require_role("admin", "committee_member"))],
)
async def remove_user_unit(user_id: UUID, node_id: UUID, pool: Pool = Depends(get_pool)):
    async with pool.acquire() as conn:
        deleted = await conn.execute(
            "DELETE FROM user_units WHERE user_id = $1 AND node_id = $2",
            user_id, node_id,
        )
        if deleted == "DELETE 0":
            raise HTTPException(status_code=404, detail="Unit not linked to this user")


# ── Unit assignment requests ──────────────────────────────────────────────────

async def _build_request_response(conn, row: dict) -> UnitRequestResponse:
    reviewer = None
    if row["reviewed_by"]:
        r = await conn.fetchrow("SELECT name FROM users WHERE id = $1", row["reviewed_by"])
        reviewer = r["name"] if r else None
    return UnitRequestResponse(
        id=row["id"],
        user_id=row["user_id"],
        user_name=row["user_name"],
        user_username=row.get("user_username"),
        # Centralized decrypt point — every caller below reads users.email
        # directly (not via users.py's _row_to_user), so it arrives here
        # still as ciphertext.
        user_email=crypto.decrypt(row.get("user_email")),
        node_id=row["node_id"],
        notes=row["notes"],
        type=row.get("type", "add"),
        status=row["status"],
        reviewed_by=row["reviewed_by"],
        reviewed_by_name=reviewer,
        reviewed_at=row["reviewed_at"],
        created_at=row["created_at"],
    )


@router.post(
    "/unit-requests",
    response_model=UnitRequestResponse,
    summary="Submit a unit assignment request (any authenticated resident)",
)
async def create_unit_request(
    body: UnitRequestCreate,
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    keycloak_sub = claims.get("sub")

    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT id, name, email FROM users WHERE keycloak_sub = $1", keycloak_sub
        )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        node = await conn.fetchrow(
            "SELECT id FROM structure_nodes WHERE id = $1", body.node_id
        )
        if not node:
            raise HTTPException(status_code=404, detail="Structure node not found")

        existing = await conn.fetchrow(
            "SELECT id FROM unit_assignment_requests "
            "WHERE user_id = $1 AND node_id = $2 AND type = $3 AND status = 'pending'",
            user["id"], body.node_id, body.type,
        )
        if existing:
            raise HTTPException(
                status_code=409,
                detail=f"You already have a pending {body.type} request for this unit.",
            )

        row = await conn.fetchrow(
            """
            INSERT INTO unit_assignment_requests (user_id, node_id, notes, type)
            VALUES ($1, $2, $3, $4)
            RETURNING id, user_id, node_id, notes, type, status, reviewed_by, reviewed_at, created_at
            """,
            user["id"], body.node_id, body.notes, body.type,
        )
        result = dict(row)
        result["user_name"] = user["name"]
        result["user_username"] = user.get("username")
        result["user_email"] = user["email"]
        return await _build_request_response(conn, result)


@router.get(
    "/unit-requests",
    response_model=list[UnitRequestResponse],
    summary="List unit requests — admin/committee: all; residents: own only",
)
async def list_unit_requests(
    status: Optional[str] = None,
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    realm_roles: list[str] = claims.get("realm_access", {}).get("roles", [])
    keycloak_sub = claims.get("sub")

    async with pool.acquire() as conn:
        # DB role is the fallback when JWT realm_access is sparse or stale
        if not ("admin" in realm_roles or "committee_member" in realm_roles):
            db_row = await conn.fetchrow(
                "SELECT role FROM users WHERE keycloak_sub = $1", keycloak_sub
            )
            db_role = db_row["role"] if db_row else None
        else:
            db_role = None
        is_privileged = (
            "admin" in realm_roles or "committee_member" in realm_roles
            or db_role in ("admin", "committee_member")
        )

        if is_privileged:
            query = """
                SELECT r.id, r.user_id, u.name AS user_name, u.username AS user_username, u.email AS user_email,
                       r.node_id, r.notes, r.type, r.status, r.reviewed_by, r.reviewed_at, r.created_at
                FROM unit_assignment_requests r
                JOIN users u ON u.id = r.user_id
            """
            params: list = []
            if status:
                query += " WHERE r.status = $1"
                params.append(status)
            query += " ORDER BY r.created_at DESC"
            rows = await conn.fetch(query, *params)
        else:
            user = await conn.fetchrow(
                "SELECT id, name, email FROM users WHERE keycloak_sub = $1", keycloak_sub
            )
            if not user:
                return []
            query = """
                SELECT r.id, r.user_id, u.name AS user_name, u.username AS user_username, u.email AS user_email,
                       r.node_id, r.notes, r.type, r.status, r.reviewed_by, r.reviewed_at, r.created_at
                FROM unit_assignment_requests r
                JOIN users u ON u.id = r.user_id
                WHERE r.user_id = $1
            """
            params = [user["id"]]
            if status:
                query += " AND r.status = $2"
                params.append(status)
            query += " ORDER BY r.created_at DESC"
            rows = await conn.fetch(query, *params)

        results = []
        for row in rows:
            d = dict(row)
            results.append(await _build_request_response(conn, d))
    return results


@router.patch(
    "/unit-requests/{request_id}",
    response_model=UnitRequestResponse,
    summary="Approve or reject a unit request (admin or committee_member)",
    dependencies=[Depends(require_role("admin", "committee_member"))],
)
async def review_unit_request(
    request_id: UUID,
    body: UnitRequestReview,
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    keycloak_sub = claims.get("sub")
    async with pool.acquire() as conn:
        reviewer = await conn.fetchrow(
            "SELECT id FROM users WHERE keycloak_sub = $1", keycloak_sub
        )
        if not reviewer:
            raise HTTPException(status_code=404, detail="Reviewer not found")

        req = await conn.fetchrow(
            "SELECT * FROM unit_assignment_requests WHERE id = $1", request_id
        )
        if not req:
            raise HTTPException(status_code=404, detail="Request not found")
        if req["status"] != "pending":
            raise HTTPException(status_code=409, detail="Request has already been reviewed")

        async with conn.transaction():
            row = await conn.fetchrow(
                """
                UPDATE unit_assignment_requests
                SET status = $1, reviewed_by = $2, reviewed_at = NOW()
                WHERE id = $3
                RETURNING id, user_id, node_id, notes, type, status, reviewed_by, reviewed_at, created_at
                """,
                body.status, reviewer["id"], request_id,
            )

            if body.status == "approved":
                if row["type"] == "remove":
                    await conn.execute(
                        "DELETE FROM user_units WHERE user_id = $1 AND node_id = $2",
                        row["user_id"], row["node_id"],
                    )
                else:
                    await conn.execute(
                        "INSERT INTO user_units (user_id, node_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                        row["user_id"], row["node_id"],
                    )

        user = await conn.fetchrow(
            "SELECT name, username, email FROM users WHERE id = $1", row["user_id"]
        )
        result = dict(row)
        result["user_name"] = user["name"] if user else "Unknown"
        result["user_username"] = user["username"] if user else None
        result["user_email"] = user["email"] if user else None
        return await _build_request_response(conn, result)
