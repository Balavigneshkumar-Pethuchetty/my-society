"""Internal-API client for event-service (see DB_ISOLATION_PLAN.md).

`event`/`announcement`/`event_permission` now live in event-service's own
`event_svc` Postgres schema, so user-service can no longer JOIN into them
directly — these calls replace those queries.
"""
from datetime import datetime
from decimal import Decimal
from typing import Iterable

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


async def get_events(event_ids: Iterable[str]) -> dict[str, dict]:
    """Batch fetch — {event_id: event_dict}. Ids not found are silently omitted."""
    ids = sorted({str(i) for i in event_ids if i})
    if not ids:
        return {}
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{_BASE}/events", params={"ids": ",".join(ids)}, headers=_HEADERS)
    resp.raise_for_status()
    return {e["id"]: _parse_event(e) for e in resp.json()}


async def get_authorship_summary(user_id: str) -> dict:
    """{organized_event_titles, announcement_count, event_permission_granted_count}."""
    async with httpx.AsyncClient(timeout=5) as client:
        resp = await client.get(f"{_BASE}/events/authorship-summary/{user_id}", headers=_HEADERS)
    resp.raise_for_status()
    return resp.json()
