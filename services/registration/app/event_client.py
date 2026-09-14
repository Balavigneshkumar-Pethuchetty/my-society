"""Internal-API client for event-service (see DB_ISOLATION_PLAN.md).

`event`/`event_category`/`announcement`/`event_permission` now live in
event-service's own `event_svc` Postgres schema, so registration-service can
no longer JOIN into them directly — these calls replace those JOINs.
"""
from datetime import datetime
from decimal import Decimal
from typing import Iterable, Optional

import httpx

from app.config import settings

_HEADERS = {"X-Internal-Key": settings.internal_api_key}
_BASE = settings.event_service_internal_url
_DT_FIELDS = ("start_time", "end_time", "cancel_freeze_at")
_DECIMAL_FIELDS = ("ticket_price",)


def _parse_event(e: dict) -> dict:
    """asyncpg gives real datetimes for these fields; httpx's .json() only gives
    back the ISO strings FastAPI serialized them as — reparse so callers can keep
    comparing/formatting them exactly as before."""
    for field in _DT_FIELDS:
        if e.get(field):
            e[field] = datetime.fromisoformat(e[field])
    for field in _DECIMAL_FIELDS:
        if e.get(field) is not None:
            e[field] = Decimal(str(e[field]))
    return e


async def get_event(event_id: str) -> Optional[dict]:
    async with httpx.AsyncClient(timeout=5) as client:
        resp = await client.get(f"{_BASE}/events/{event_id}", headers=_HEADERS)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return _parse_event(resp.json())


async def get_events(event_ids: Iterable[str]) -> dict[str, dict]:
    """Batch fetch — {event_id: event_dict}. Ids not found are silently omitted."""
    ids = sorted({str(i) for i in event_ids if i})
    if not ids:
        return {}
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{_BASE}/events", params={"ids": ",".join(ids)}, headers=_HEADERS)
    resp.raise_for_status()
    return {e["id"]: _parse_event(e) for e in resp.json()}


async def get_managers(event_id: str) -> dict:
    """{organizer_id, manager_user_ids} — organizer + active event_permission holders."""
    async with httpx.AsyncClient(timeout=5) as client:
        resp = await client.get(f"{_BASE}/events/{event_id}/managers", headers=_HEADERS)
    resp.raise_for_status()
    return resp.json()
