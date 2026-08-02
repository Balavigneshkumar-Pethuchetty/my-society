"""
Resolves resident/security identity from user-service's internal API.
Visitor-service has no local `users` table (separate database, see CLAUDE.md /
services/visitor/db) — this is the only source of truth for names/flats/phones.

Small in-process TTL cache keyed by user_id so a gate scan doesn't do a fresh
HTTP round trip to user-service on every request (same cache shape as
app/auth.py's JWKS cache).
"""
import time
from typing import Optional

import httpx

from app.config import settings

_CACHE_TTL = 60.0
_cache: dict[str, tuple[float, dict]] = {}

_HEADERS = {"X-Internal-Key": settings.internal_api_key}


def _flat_label(user: dict) -> Optional[str]:
    # user-service's internal endpoints resolve this server-side (structure-node name,
    # falling back to the legacy block/unit format) since visitor-service has no local
    # DB to join user_units/user_apartments itself — see internal.py's _fetch_unit_label.
    if user.get("unit_label"):
        return user["unit_label"]
    apartments = user.get("apartments") or []
    if apartments:
        a = apartments[0]
        return f"{a['block']} – {a['unit_number']}"
    return None


async def get_by_id(user_id: str) -> Optional[dict]:
    cached = _cache.get(user_id)
    now = time.monotonic()
    if cached and now - cached[0] < _CACHE_TTL:
        return cached[1]
    async with httpx.AsyncClient(timeout=5) as client:
        resp = await client.get(f"{settings.user_service_internal_url}/{user_id}", headers=_HEADERS)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    user = resp.json()
    user["flat_label"] = _flat_label(user)
    _cache[user_id] = (now, user)
    return user


async def get_by_sub(keycloak_sub: str) -> Optional[dict]:
    async with httpx.AsyncClient(timeout=5) as client:
        resp = await client.get(f"{settings.user_service_internal_url}/by-sub/{keycloak_sub}", headers=_HEADERS)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    user = resp.json()
    user["flat_label"] = _flat_label(user)
    _cache[user["id"]] = (time.monotonic(), user)
    return user


async def list_by_role(role: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{settings.user_service_internal_url}/by-role/{role}", headers=_HEADERS)
    resp.raise_for_status()
    return resp.json()


async def list_unitmates(user_id: str) -> list[dict]:
    """Every user sharing a unit/apartment with user_id, including themselves —
    used so a resident's pass list can include passes their household members
    created, not just their own. Not cached like get_by_id/get_by_sub since
    it's only called once per /passes/my request, not per gate scan."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{settings.user_service_internal_url}/by-unit-of/{user_id}", headers=_HEADERS)
    resp.raise_for_status()
    return resp.json()
