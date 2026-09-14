"""Internal-API client for ticket-service (see DB_ISOLATION_PLAN.md, step 2).

`ticket` now lives in ticket-service's own `ticket_svc` Postgres schema, so
registration-service can no longer INSERT/UPDATE/JOIN into it directly — these
calls replace the complimentary-ticket issue/cancel writes and the comp-ticket
list/detail LEFT JOIN.
"""
from typing import Iterable, Optional

import httpx

from app.config import settings

_HEADERS = {"X-Internal-Key": settings.internal_api_key}
_BASE = settings.ticket_service_internal_url


async def issue_ticket(reg_id: str, user_id: str, event_id: str, qr_token: Optional[str] = None) -> dict:
    async with httpx.AsyncClient(timeout=5) as client:
        resp = await client.post(
            _BASE,
            json={"reg_id": reg_id, "user_id": user_id, "event_id": event_id, "qr_token": qr_token},
            headers=_HEADERS,
        )
    resp.raise_for_status()
    return resp.json()


async def cancel_ticket_by_reg(reg_id: str) -> None:
    async with httpx.AsyncClient(timeout=5) as client:
        resp = await client.post(f"{_BASE}/cancel-by-reg/{reg_id}", headers=_HEADERS)
    resp.raise_for_status()


async def get_tickets_by_reg_ids(reg_ids: Iterable[str]) -> dict[str, dict]:
    """Batch fetch — {reg_id: {id, status, qr_token}}. reg_ids with no ticket
    (e.g. walk-in log entries, or None) are silently omitted."""
    ids = sorted({str(i) for i in reg_ids if i})
    if not ids:
        return {}
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{_BASE}/by-reg-ids", params={"ids": ",".join(ids)}, headers=_HEADERS)
    resp.raise_for_status()
    return {t["reg_id"]: t for t in resp.json()}
