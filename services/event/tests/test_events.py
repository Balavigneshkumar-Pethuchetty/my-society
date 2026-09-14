"""Event CRUD + the require_event_access/require_role_or_organizer authorization
primitives unified into services/shared/auth_core.py in step 5 — these tests exercise
that shared code through event-service, the service it was extracted from."""
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


async def test_create_event_requires_auth(anon_client):
    resp = await anon_client.post("/events", json={
        "title": "T", "venue": "V",
        "start_time": "2027-01-01T10:00:00Z", "end_time": "2027-01-01T12:00:00Z",
    })
    assert resp.status_code == 401


async def test_create_event_rejects_roles_outside_allowlist(make_client):
    client = await make_client(roles=["security_guard"])
    resp = await client.post("/events", json={
        "title": "T", "venue": "V",
        "start_time": "2027-01-01T10:00:00Z", "end_time": "2027-01-01T12:00:00Z",
    })
    assert resp.status_code == 403


async def test_create_event_as_resident_sets_organizer_and_draft_status(db, make_client):
    resident_id, resident_sub = await _seed_user(db, role="resident", name="Organizer")
    client = await make_client(sub=resident_sub, roles=["resident"])

    resp = await client.post("/events", json={
        "title": "Diwali Mela", "venue": "Clubhouse",
        "start_time": "2027-01-01T10:00:00Z", "end_time": "2027-01-01T12:00:00Z",
    })
    assert resp.status_code == 201
    event_id = resp.json()["id"]
    assert resp.json()["status"] == "draft"

    row = await db.fetchrow("SELECT organizer_id::text, status FROM event WHERE id = $1::uuid", event_id)
    assert row["organizer_id"] == resident_id
    assert row["status"] == "draft"


async def test_update_event_requires_organizer_or_grant(db, make_client):
    organizer_id, organizer_sub = await _seed_user(db, role="resident", name="Organizer")
    _stranger_id, stranger_sub = await _seed_user(db, role="resident", name="Stranger")
    event_id = await _seed_event(db, organizer_id)

    stranger_client = await make_client(sub=stranger_sub, roles=["resident"])
    resp = await stranger_client.put(f"/events/{event_id}", json={"title": "Hijacked"})
    assert resp.status_code == 403

    organizer_client = await make_client(sub=organizer_sub, roles=["resident"])
    resp = await organizer_client.put(f"/events/{event_id}", json={"title": "Updated Title"})
    assert resp.status_code == 200

    row = await db.fetchrow("SELECT title FROM event WHERE id = $1::uuid", event_id)
    assert row["title"] == "Updated Title"


async def test_update_event_has_no_admin_bypass(db, make_client):
    """require_event_access() is documented as absolute per-event isolation — organizer or
    an explicit event_permission grant only, no admin/committee_member bypass (see
    services/shared/auth_core.py). Regression guard against that isolation quietly
    growing a role-based bypass later."""
    organizer_id, _ = await _seed_user(db, role="resident", name="Organizer")
    _admin_id, admin_sub = await _seed_user(db, role="admin", name="Admin")
    event_id = await _seed_event(db, organizer_id)

    admin_client = await make_client(sub=admin_sub, roles=["admin"])
    resp = await admin_client.put(f"/events/{event_id}", json={"title": "Admin Edit"})
    assert resp.status_code == 403
