"""Internal-API client for ticket-service (see DB_ISOLATION_PLAN.md, step 2).

`ticket` now lives in ticket-service's own `ticket_svc` Postgres schema, so
user-service can no longer read it directly — this replaces the account-
deletion activity-export endpoint's old `FROM ticket WHERE user_id = $1`.
"""
import httpx

from app.config import settings

_HEADERS = {"X-Internal-Key": settings.internal_api_key}
_BASE = settings.ticket_service_internal_url


async def get_ticket_activity(user_id: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=5) as client:
        resp = await client.get(f"{_BASE}/by-user/{user_id}", headers=_HEADERS)
    resp.raise_for_status()
    return resp.json()
