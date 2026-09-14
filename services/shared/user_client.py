"""Internal-API client for user-service, shared by every service that needs
user data but shouldn't query the `users` table directly (registration, ticket,
payment, event-service). visitor-service predates this file and keeps its own
near-identical copy at services/visitor/app/user_client.py — not unified here
to avoid touching a service that already works.

Settings are read lazily inside each function, not at module import time: this
file is copied into every service's build (see each Dockerfile's `COPY
services/shared/ shared/`), including services that never call it (user-service
itself, visitor-service), so it must not fail at import time for a service whose
config has no `user_service_internal_url` setting.

Small in-process TTL cache keyed by user_id, same shape as
services/visitor/app/user_client.py's — a role/profile change can take up to
60s to be reflected in a caller that already has that user cached.
"""
import time
from typing import Iterable, Optional

import httpx

_CACHE_TTL = 60.0
_cache: dict[str, tuple[float, dict]] = {}


def _headers() -> dict:
    from app.config import settings
    return {"X-Internal-Key": settings.internal_api_key}


def _base() -> str:
    from app.config import settings
    return settings.user_service_internal_url


async def get_by_id(user_id: str) -> Optional[dict]:
    cached = _cache.get(user_id)
    now = time.monotonic()
    if cached and now - cached[0] < _CACHE_TTL:
        return cached[1]
    async with httpx.AsyncClient(timeout=5) as client:
        resp = await client.get(f"{_base()}/{user_id}", headers=_headers())
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    user = resp.json()
    _cache[user_id] = (now, user)
    return user


async def get_by_sub(keycloak_sub: str) -> Optional[dict]:
    async with httpx.AsyncClient(timeout=5) as client:
        resp = await client.get(f"{_base()}/by-sub/{keycloak_sub}", headers=_headers())
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    user = resp.json()
    _cache[user["id"]] = (time.monotonic(), user)
    return user


async def get_by_ids(user_ids: Iterable[str]) -> dict[str, dict]:
    """Batch fetch — {user_id: user_dict}. Ids not found are silently omitted.
    Also seeds the cache get_by_id reads from, so a later single lookup for one
    of these ids within the TTL window is free."""
    ids = sorted({str(i) for i in user_ids if i})
    if not ids:
        return {}
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{_base()}/by-ids", params={"ids": ",".join(ids)}, headers=_headers())
    resp.raise_for_status()
    now = time.monotonic()
    result = {}
    for user in resp.json():
        result[user["id"]] = user
        _cache[user["id"]] = (now, user)
    return result


async def get_by_email(email: str) -> Optional[dict]:
    async with httpx.AsyncClient(timeout=5) as client:
        resp = await client.get(f"{_base()}/by-email/{email}", headers=_headers())
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    user = resp.json()
    _cache[user["id"]] = (time.monotonic(), user)
    return user


async def get_by_role(role: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{_base()}/by-role/{role}", headers=_headers())
    resp.raise_for_status()
    return resp.json()


async def get_broadcast_targets() -> list[dict]:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{_base()}/broadcast-targets", headers=_headers())
    resp.raise_for_status()
    return resp.json()


async def create_guest(name: str) -> str:
    async with httpx.AsyncClient(timeout=5) as client:
        resp = await client.post(f"{_base()}/guest", json={"name": name}, headers=_headers())
    resp.raise_for_status()
    return resp.json()["id"]


async def post_notification(
    user_id: str, type_: str, title: str, message: str,
    related_id: Optional[str] = None, event_id: Optional[str] = None,
) -> None:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{_base()}/{user_id}/notifications",
            json={
                "type": type_, "title": title, "message": message,
                "related_id": related_id, "event_id": event_id,
            },
            headers=_headers(),
        )
    resp.raise_for_status()
