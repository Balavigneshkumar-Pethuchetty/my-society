"""Cross-service JWT/JWKS validation and the base require_role/require_event_access
primitives live in services/shared/auth_core.py (see MAINTAINABILITY_PLAN.md step 5).
require_role_or_organizer stays here — it has no other caller across the six services,
so there's nothing to share."""
from fastapi import Depends, HTTPException
from shared.auth_core import (  # noqa: F401
    get_current_claims,
    get_optional_claims,
    require_role,
    require_event_access,
    require_internal_key,
    _has_event_access,
)
from shared.user_client import get_by_sub
from app.database import get_pool


def require_role_or_organizer(*roles: str):
    """Passes if the caller has one of `*roles` globally, OR is the organizer of the
    event_id path parameter on the route this is used as a dependency for. Lets a
    resident who created an event manage that one event without granting them (or
    changing) any existing admin/committee_member access."""
    async def _check(event_id: str, claims: dict = Depends(get_current_claims)) -> dict:
        realm_roles: list[str] = claims.get("realm_access", {}).get("roles", [])
        if any(r in realm_roles for r in roles):
            return claims
        user = await get_by_sub(claims.get("sub", ""))
        if not user:
            raise HTTPException(status_code=403, detail="Insufficient role")
        pool = await get_pool()
        async with pool.acquire() as conn:
            is_organizer = await conn.fetchval(
                "SELECT 1 FROM event e WHERE e.id = $1::uuid AND e.organizer_id = $2::uuid",
                event_id, user["id"],
            )
        if not is_organizer:
            raise HTTPException(status_code=403, detail="Insufficient role")
        return claims
    return _check
