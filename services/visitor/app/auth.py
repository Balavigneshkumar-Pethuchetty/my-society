import time
import httpx
from fastapi import HTTPException, Security
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from app.config import settings

_oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=(
        f"{settings.keycloak_public_url}/realms/{settings.keycloak_realm}"
        "/protocol/openid-connect/token"
    ),
)

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


def require_role(*roles: str):
    async def _check(claims: dict = Security(get_current_claims)) -> dict:
        realm_roles: list[str] = claims.get("realm_access", {}).get("roles", [])
        if not any(r in realm_roles for r in roles):
            raise HTTPException(status_code=403, detail=f"Requires one of roles: {list(roles)}")
        return claims
    return _check
