import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from app.auth import get_current_claims
from app.database import get_pool
from app.event_client import get_event
from app.models import CartIn, CartOut
from shared.user_client import get_by_sub

router = APIRouter()


async def _get_user_id(sub: str) -> str:
    user = await get_by_sub(sub)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user["id"]


# ── GET /cart ─────────────────────────────────────────────────────────────────

@router.get("/cart", response_model=CartOut, summary="Get the current user's saved cart")
async def get_cart(claims: dict = Depends(get_current_claims)):
    user_id = await _get_user_id(claims.get("sub", ""))
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id::text, event_id::text, event_title, event_venue, event_start, "
            "       currency, tickets, created_at, updated_at "
            "FROM cart WHERE user_id = $1::uuid",
            user_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="No active cart")
    return CartOut(
        id=row["id"],
        event_id=row["event_id"],
        event_title=row["event_title"],
        event_venue=row["event_venue"],
        event_start=row["event_start"],
        currency=row["currency"],
        tickets=json.loads(row["tickets"]) if isinstance(row["tickets"], str) else row["tickets"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


# ── PUT /cart ─────────────────────────────────────────────────────────────────

@router.put("/cart", response_model=CartOut, summary="Save or replace the cart")
async def upsert_cart(body: CartIn, claims: dict = Depends(get_current_claims)):
    user_id = await _get_user_id(claims.get("sub", ""))
    pool = await get_pool()
    async with pool.acquire() as conn:
        event = await get_event(body.event_id)
        if not event or event["status"] != "published":
            raise HTTPException(status_code=404, detail="Event not found or not published")

        tickets_json = json.dumps([t.model_dump() for t in body.tickets])
        row = await conn.fetchrow(
            """
            INSERT INTO cart (user_id, event_id, event_title, event_venue, event_start, currency, tickets)
            VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb)
            ON CONFLICT (user_id) DO UPDATE SET
                event_id    = EXCLUDED.event_id,
                event_title = EXCLUDED.event_title,
                event_venue = EXCLUDED.event_venue,
                event_start = EXCLUDED.event_start,
                currency    = EXCLUDED.currency,
                tickets     = EXCLUDED.tickets,
                updated_at  = NOW()
            RETURNING id::text, event_id::text, event_title, event_venue,
                      event_start, currency, tickets, created_at, updated_at
            """,
            user_id, body.event_id, body.event_title, body.event_venue,
            body.event_start, body.currency, tickets_json,
        )
    return CartOut(
        id=row["id"],
        event_id=row["event_id"],
        event_title=row["event_title"],
        event_venue=row["event_venue"],
        event_start=row["event_start"],
        currency=row["currency"],
        tickets=json.loads(row["tickets"]) if isinstance(row["tickets"], str) else row["tickets"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


# ── DELETE /cart ──────────────────────────────────────────────────────────────

@router.delete("/cart", status_code=204, summary="Clear the cart")
async def delete_cart(claims: dict = Depends(get_current_claims)):
    user_id = await _get_user_id(claims.get("sub", ""))
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM cart WHERE user_id = $1::uuid", user_id)
    return Response(status_code=204)
