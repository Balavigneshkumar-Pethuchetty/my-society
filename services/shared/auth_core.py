"""JWT/JWKS validation and the cross-service authorization primitives, shared by every
backend service. Extracted from what were six independently-drifting copies of this file
(see MAINTAINABILITY_PLAN.md step 5) — this module carries only the pieces that were
genuinely identical across services. Two deliberate exceptions stay local to their service
instead of living here:
  - user-service's require_role() has an extra DB-fallback (checks the local `users.role`
    when the JWT is sparse/stale) that the other five services don't have — a real behavioral
    difference, not drift.
  - event-service's require_role_or_organizer() has no other caller — nothing to share.
"""
import time
import httpx
from fastapi import HTTPException, Security, Depends
from fastapi.security import OAuth2PasswordBearer, APIKeyHeader
from jose import jwt, JWTError
from app.config import settings
from .db import get_pool

_oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=(
        f"{settings.keycloak_public_url}/realms/{settings.keycloak_realm}"
        "/protocol/openid-connect/token"
    ),
)
_oauth2_optional = OAuth2PasswordBearer(
    tokenUrl=(
        f"{settings.keycloak_public_url}/realms/{settings.keycloak_realm}"
        "/protocol/openid-connect/token"
    ),
    auto_error=False,
)
_internal_key_header = APIKeyHeader(name="X-Internal-Key", auto_error=False)

_jwks_cache: dict = {"keys": [], "fetched_at": 0.0}
_JWKS_TTL = 300


async def _fetch_jwks() -> list[dict]:
    now = time.monotonic()
    if now - _jwks_cache["fetched_at"] < _JWKS_TTL and _jwks_cache["keys"]:
        return _jwks_cache["keys"]
    async with httpx.AsyncClient(timeout=5) as client:
        resp = await client.get(settings.jwks_uri)
        resp.raise_for_status()
    keys = resp.json()["keys"]
    _jwks_cache["keys"] = keys
    _jwks_cache["fetched_at"] = now
    return keys


async def get_current_claims(token: str = Security(_oauth2_scheme)) -> dict:
    try:
        keys = await _fetch_jwks()
        header = jwt.get_unverified_header(token)
        key = next((k for k in keys if k.get("kid") == header.get("kid")), None)
        if not key:
            raise HTTPException(status_code=401, detail="Unknown signing key")
        claims = jwt.decode(token, key, algorithms=["RS256"], options={"verify_aud": False})
    except JWTError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}") from exc
    return claims


async def get_optional_claims(token: str | None = Security(_oauth2_optional)) -> dict | None:
    """Returns claims if a valid token is provided, None otherwise (public endpoints)."""
    if not token:
        return None
    try:
        keys = await _fetch_jwks()
        header = jwt.get_unverified_header(token)
        key = next((k for k in keys if k.get("kid") == header.get("kid")), None)
        if not key:
            return None
        return jwt.decode(token, key, algorithms=["RS256"], options={"verify_aud": False})
    except JWTError:
        return None


def require_role(*roles: str):
    async def _check(claims: dict = Depends(get_current_claims)) -> dict:
        realm_roles: list[str] = claims.get("realm_access", {}).get("roles", [])
        if not any(r in realm_roles for r in roles):
            raise HTTPException(status_code=403, detail="Insufficient role")
        return claims
    return _check


async def _has_event_access(conn, keycloak_sub: str | None, event_id: str) -> bool:
    """Organizer-or-approved-member check, usable outside a FastAPI dependency (e.g. for
    read routes that need to hide draft events from everyone else, not just block writes,
    or for routes that resolve event_id indirectly before they can check access).
    False for an unauthenticated caller (keycloak_sub is None).

    Import is function-local, not module-level: this file is copied into every
    service's build, including ones (registration, ticket) that never call this
    function and whose config may not have a user_service_internal_url setting."""
    if not keycloak_sub:
        return False
    from .user_client import get_by_sub
    user = await get_by_sub(keycloak_sub)
    if not user:
        return False
    # Schema-qualified: event/event_permission live in event_svc (see
    # DB_ISOLATION_PLAN.md), and only event_role's search_path includes that
    # schema — payment-service (society_user) needs the explicit qualifier.
    return bool(await conn.fetchval(
        "SELECT 1 FROM event_svc.event e WHERE e.id = $1::uuid AND ("
        "  e.organizer_id = $2::uuid OR EXISTS ("
        "    SELECT 1 FROM event_svc.event_permission ep "
        "    WHERE ep.event_id = e.id AND ep.user_id = $2::uuid AND ep.revoked_at IS NULL"
        "  )"
        ")",
        event_id, user["id"],
    ))


def require_event_access():
    """Absolute per-event access check — no admin/committee_member bypass. Passes only if
    the caller is the event's organizer OR has an active (non-revoked) event_permission
    grant for it. This is the isolation model: an event's management/fund data is visible
    only to its organizer and whoever they've explicitly approved."""
    async def _check(event_id: str, claims: dict = Depends(get_current_claims)) -> dict:
        pool = await get_pool()
        async with pool.acquire() as conn:
            has_access = await _has_event_access(conn, claims.get("sub"), event_id)
        if not has_access:
            raise HTTPException(status_code=403, detail="You don't have access to this event")
        return claims
    return _check


def require_internal_key(key: str | None = Security(_internal_key_header)) -> None:
    if key != settings.internal_api_key:
        raise HTTPException(status_code=403, detail="Internal key required")
