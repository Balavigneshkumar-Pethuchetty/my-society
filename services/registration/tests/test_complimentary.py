"""Complimentary ticket issuance — per CLAUDE.md, the one exception to lazy ticket
issuance: registration-service creates the registration + ticket rows directly and
immediately (not on the guest's first `GET /tickets/my`), because a guest invited this
way may not even have an account to trigger the lazy path themselves."""
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


async def _seed_event(db, organizer_id: str, *, status="published") -> str:
    row = await db.fetchrow(
        """INSERT INTO event (society_id, organizer_id, title, start_time, end_time, venue, status)
           VALUES ($1::uuid, $2::uuid, 'Test Event', now() + interval '1 day',
                   now() + interval '2 day', 'Clubhouse', $3)
           RETURNING id::text""",
        SOCIETY_ID, organizer_id, status,
    )
    return row["id"]


async def test_issue_complimentary_ticket_requires_auth(anon_client):
    resp = await anon_client.post("/complimentary/tickets", json={
        "event_id": str(uuid.uuid4()), "inviter_type": "walk_in", "guest_name": "Guest",
    })
    assert resp.status_code == 401


async def test_issue_complimentary_ticket_requires_admin_or_committee(make_client):
    client = await make_client(roles=["resident"])
    resp = await client.post("/complimentary/tickets", json={
        "event_id": str(uuid.uuid4()), "inviter_type": "walk_in", "guest_name": "Guest",
    })
    assert resp.status_code == 403


async def test_walk_in_ticket_creates_registration_ticket_and_guest_placeholder(db, make_client):
    organizer_id, _ = await _seed_user(db, role="admin", name="Organizer")
    _admin_id, admin_sub = await _seed_user(db, role="admin", name="Issuer")
    event_id = await _seed_event(db, organizer_id)

    client = await make_client(sub=admin_sub, roles=["admin"])
    resp = await client.post("/complimentary/tickets", json={
        "event_id": event_id, "inviter_type": "walk_in", "guest_name": "Walk-in Guest",
        "ticket_count": 2,
    })
    assert resp.status_code == 201
    body = resp.json()
    assert body["ticket_status"] is not None
    assert body["qr_token"]

    # ComplimentaryTicketOut doesn't surface registration_id directly — reach it via
    # the ticket_id the response does return.
    ticket = await db.fetchrow(
        "SELECT reg_id::text FROM ticket WHERE id = $1::uuid", body["ticket_id"]
    )
    assert ticket is not None

    reg = await db.fetchrow(
        "SELECT status, ticket_count FROM registration WHERE id = $1::uuid", ticket["reg_id"]
    )
    assert reg["status"] == "confirmed"
    assert reg["ticket_count"] == 2

    guest = await db.fetchrow(
        "SELECT role, is_active, keycloak_sub FROM users WHERE name = 'Walk-in Guest'"
    )
    assert guest["role"] == "guest"
    assert guest["is_active"] is False
    assert guest["keycloak_sub"] is None


async def test_complimentary_ticket_blocked_for_completed_event(db, make_client):
    organizer_id, _ = await _seed_user(db, role="admin", name="Organizer")
    _admin_id, admin_sub = await _seed_user(db, role="admin", name="Issuer")
    event_id = await _seed_event(db, organizer_id, status="completed")

    client = await make_client(sub=admin_sub, roles=["admin"])
    resp = await client.post("/complimentary/tickets", json={
        "event_id": event_id, "inviter_type": "walk_in", "guest_name": "Late Guest",
    })
    assert resp.status_code == 400
