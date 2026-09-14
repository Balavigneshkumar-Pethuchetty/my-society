"""Payment confirmation flow — one of the two highest-blast-radius areas named in
MAINTAINABILITY_PLAN.md step 6 (a silent regression here means residents get charged
without a registration, or a registration confirms without payment)."""
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


async def _seed_registration(db, event_id: str, user_id: str, *, status="pending") -> str:
    row = await db.fetchrow(
        """INSERT INTO registration (event_id, user_id, ticket_count, total_amount, status)
           VALUES ($1::uuid, $2::uuid, 1, 100.00, $3) RETURNING id::text""",
        event_id, user_id, status,
    )
    return row["id"]


async def _seed_transaction(db, event_id: str, registration_id: str, user_id: str, *, status="pending") -> str:
    txn_ref = f"TXN{uuid.uuid4().hex[:12].upper()}"
    await db.execute(
        """INSERT INTO payment_transaction
               (txn_ref, event_id, registration_id, user_id, amount, status, idempotency_key)
           VALUES ($1, $2::uuid, $3::uuid, $4::uuid, 100.00, $5, $1)""",
        txn_ref, event_id, registration_id, user_id, status,
    )
    return txn_ref


async def test_list_transactions_requires_auth(anon_client):
    resp = await anon_client.get("/payments")
    assert resp.status_code == 401


async def test_list_transactions_requires_admin_role(make_client):
    client = await make_client(roles=["resident"])
    resp = await client.get("/payments")
    assert resp.status_code == 403


async def test_approve_confirms_registration_and_records_audit(db, make_client):
    async with db.acquire() as conn:
        organizer_id, _ = await _seed_user(conn, role="admin", name="Organizer")
        resident_id, resident_sub = await _seed_user(conn, role="resident", name="Resident")
        event_id = await _seed_event(conn, organizer_id)
        registration_id = await _seed_registration(conn, event_id, resident_id, status="pending")
        txn_ref = await _seed_transaction(conn, event_id, registration_id, resident_id, status="pending")

    admin_client = await make_client(sub="admin-sub", roles=["admin"])
    resp = await admin_client.post(f"/payments/{txn_ref}/approve", json={"notes": "looks good"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "verified"

    async with db.acquire() as conn:
        txn = await conn.fetchrow("SELECT status FROM payment_transaction WHERE txn_ref = $1", txn_ref)
        reg = await conn.fetchrow("SELECT status FROM registration WHERE id = $1::uuid", registration_id)
        audit = await conn.fetchrow(
            "SELECT to_status FROM payment_audit_log pal "
            "JOIN payment_transaction pt ON pt.id = pal.txn_id WHERE pt.txn_ref = $1",
            txn_ref,
        )
    assert txn["status"] == "verified"
    assert reg["status"] == "confirmed"
    assert audit["to_status"] == "verified"


async def test_approve_is_idempotent_on_already_verified(db, make_client):
    async with db.acquire() as conn:
        organizer_id, _ = await _seed_user(conn, role="admin", name="Organizer")
        resident_id, _ = await _seed_user(conn, role="resident", name="Resident")
        event_id = await _seed_event(conn, organizer_id)
        registration_id = await _seed_registration(conn, event_id, resident_id, status="confirmed")
        txn_ref = await _seed_transaction(conn, event_id, registration_id, resident_id, status="verified")

    admin_client = await make_client(sub="admin-sub", roles=["admin"])
    resp = await admin_client.post(f"/payments/{txn_ref}/approve", json={})
    assert resp.status_code == 200
    assert resp.json()["status"] == "verified"


async def test_get_transaction_is_owner_or_privileged_only(db, make_client):
    async with db.acquire() as conn:
        organizer_id, _ = await _seed_user(conn, role="admin", name="Organizer")
        resident_id, resident_sub = await _seed_user(conn, role="resident", name="Resident")
        other_id, other_sub = await _seed_user(conn, role="resident", name="Other Resident")
        event_id = await _seed_event(conn, organizer_id)
        registration_id = await _seed_registration(conn, event_id, resident_id, status="pending")
        txn_ref = await _seed_transaction(conn, event_id, registration_id, resident_id, status="pending")

    owner_client = await make_client(sub=resident_sub, roles=["resident"])
    resp = await owner_client.get(f"/payments/{txn_ref}")
    assert resp.status_code == 200

    other_client = await make_client(sub=other_sub, roles=["resident"])
    resp = await other_client.get(f"/payments/{txn_ref}")
    assert resp.status_code == 403
