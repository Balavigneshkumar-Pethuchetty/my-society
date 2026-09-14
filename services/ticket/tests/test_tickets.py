"""Lazy ticket issuance — one of the two highest-blast-radius areas named in
MAINTAINABILITY_PLAN.md step 6. _ensure_tickets_issued (services/ticket/app/routes/
tickets.py) is the only place a `ticket` row gets created for a paid/free resident
checkout; a silent regression here means a confirmed registration never gets a QR."""
import uuid

import pytest

from conftest import SOCIETY_ID

pytestmark = pytest.mark.asyncio


async def _seed_user(db, *, role="resident", name="Test User"):
    sub = f"sub-{uuid.uuid4()}"
    row = await db.fetchrow(
        "INSERT INTO users (name, email, role, keycloak_sub) VALUES ($1, $2, $3, $4) RETURNING id::text",
        name, f"{sub}@example.test", role, sub,
    )
    return row["id"], sub


async def _seed_event(db, organizer_id: str) -> str:
    row = await db.fetchrow(
        """INSERT INTO event (society_id, organizer_id, title, start_time, end_time, venue, status)
           VALUES ($1::uuid, $2::uuid, 'Test Event', now() + interval '1 day',
                   now() + interval '2 day', 'Clubhouse', 'published')
           RETURNING id::text""",
        SOCIETY_ID, organizer_id,
    )
    return row["id"]


async def _seed_registration(db, event_id: str, user_id: str, *, status="confirmed") -> str:
    row = await db.fetchrow(
        """INSERT INTO registration (event_id, user_id, ticket_count, total_amount, status)
           VALUES ($1::uuid, $2::uuid, 1, 100.00, $3) RETURNING id::text""",
        event_id, user_id, status,
    )
    return row["id"]


async def test_my_tickets_requires_auth(anon_client):
    resp = await anon_client.get("/tickets/my")
    assert resp.status_code == 401


async def test_confirmed_registration_lazily_issues_a_ticket(db, make_client):
    organizer_id, _ = await _seed_user(db, role="admin", name="Organizer")
    resident_id, resident_sub = await _seed_user(db, role="resident", name="Resident")
    event_id = await _seed_event(db, organizer_id)
    registration_id = await _seed_registration(db, event_id, resident_id, status="confirmed")

    before = await db.fetchval("SELECT count(*) FROM ticket WHERE reg_id = $1::uuid", registration_id)
    assert before == 0

    client = await make_client(sub=resident_sub, roles=["resident"])
    resp = await client.get("/tickets/my")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["reg_id"] == registration_id
    assert body[0]["event_id"] == event_id
    assert body[0]["status"] == "active"

    after = await db.fetchval("SELECT count(*) FROM ticket WHERE reg_id = $1::uuid", registration_id)
    assert after == 1


async def test_lazy_issuance_is_not_repeated_on_second_call(db, make_client):
    organizer_id, _ = await _seed_user(db, role="admin", name="Organizer")
    resident_id, resident_sub = await _seed_user(db, role="resident", name="Resident")
    event_id = await _seed_event(db, organizer_id)
    registration_id = await _seed_registration(db, event_id, resident_id, status="confirmed")

    client = await make_client(sub=resident_sub, roles=["resident"])
    await client.get("/tickets/my")
    resp = await client.get("/tickets/my")
    assert resp.status_code == 200
    assert len(resp.json()) == 1

    count = await db.fetchval("SELECT count(*) FROM ticket WHERE reg_id = $1::uuid", registration_id)
    assert count == 1


async def test_pending_registration_gets_no_ticket(db, make_client):
    organizer_id, _ = await _seed_user(db, role="admin", name="Organizer")
    resident_id, resident_sub = await _seed_user(db, role="resident", name="Resident")
    event_id = await _seed_event(db, organizer_id)
    await _seed_registration(db, event_id, resident_id, status="pending")

    client = await make_client(sub=resident_sub, roles=["resident"])
    resp = await client.get("/tickets/my")
    assert resp.status_code == 200
    assert resp.json() == []
