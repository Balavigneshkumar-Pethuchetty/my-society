"""JWT/JWKS validation and require_internal_key live in services/shared/auth_core.py
(see MAINTAINABILITY_PLAN.md step 5). require_role() stays local: unlike the other five
services, it falls back to the local `users.role` column when the JWT is sparse or stale
(e.g. immediately after a Keycloak role assignment) — a deliberate behavioral difference,
not drift, so it isn't part of the shared base require_role()."""
from fastapi import Depends, HTTPException
from asyncpg import Pool
from shared.auth_core import get_current_claims, require_internal_key  # noqa: F401
from app.database import get_pool


def require_role(*roles: str):
    """Dependency factory — raises 403 if caller's role is not in roles.

    Checks JWT realm_access.roles first; falls back to the local DB role when
    the JWT is sparse or stale (e.g. immediately after Keycloak role assignment).
    """
    async def _check(
        claims: dict = Depends(get_current_claims),
        pool: Pool = Depends(get_pool),
    ) -> dict:
        realm_roles: list[str] = claims.get("realm_access", {}).get("roles", [])
        if any(r in realm_roles for r in roles):
            return claims
        # JWT didn't carry the role — check the local DB as fallback
        sub = claims.get("sub")
        if sub:
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    "SELECT role FROM users WHERE keycloak_sub = $1", sub
                )
            if row and row["role"] in roles:
                return claims
        raise HTTPException(status_code=403, detail="Insufficient role")
    return _check
