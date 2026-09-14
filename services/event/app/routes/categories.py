from fastapi import APIRouter, Depends, HTTPException
from app.auth import get_current_claims, require_role
from app.cache import cache_delete, cache_get_json, cache_set_json
from app.config import settings
from app.database import get_pool
from app.models import CategoryOut, CategoryCreate

router = APIRouter()

_SOCIETY = settings.society_id
_CACHE_KEY = "cat:list"


@router.get("", response_model=list[CategoryOut], summary="List all event categories")
async def list_categories():
    cached = await cache_get_json(_CACHE_KEY)
    if cached is not None:
        return cached

    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id::text, name, icon, color_hex FROM event_category "
            "WHERE society_id = $1 ORDER BY name",
            _SOCIETY,
        )
    result = [dict(r) for r in rows]
    await cache_set_json(_CACHE_KEY, result)
    return result


@router.post("", response_model=CategoryOut, status_code=201,
             summary="Create a category (admin/committee only)")
async def create_category(
    body: CategoryCreate,
    claims: dict = Depends(require_role("admin", "committee_member")),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "INSERT INTO event_category (society_id, name, icon, color_hex) "
            "VALUES ($1, $2, $3, $4) RETURNING id::text, name, icon, color_hex",
            _SOCIETY, body.name, body.icon, body.color_hex,
        )
    await cache_delete(_CACHE_KEY)
    return dict(row)


@router.put("/{category_id}", response_model=CategoryOut,
            summary="Update a category (admin/committee only)")
async def update_category(
    category_id: str,
    body: CategoryCreate,
    claims: dict = Depends(require_role("admin", "committee_member")),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE event_category SET name=$1, icon=$2, color_hex=$3 "
            "WHERE id=$4::uuid AND society_id=$5::uuid "
            "RETURNING id::text, name, icon, color_hex",
            body.name, body.icon, body.color_hex, category_id, _SOCIETY,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Category not found")
    await cache_delete(_CACHE_KEY)
    return dict(row)


@router.delete("/{category_id}", status_code=204,
               summary="Delete a category (admin only)")
async def delete_category(
    category_id: str,
    claims: dict = Depends(require_role("admin")),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM event_category WHERE id=$1::uuid AND society_id=$2::uuid",
            category_id, _SOCIETY,
        )
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Category not found")
    await cache_delete(_CACHE_KEY)
