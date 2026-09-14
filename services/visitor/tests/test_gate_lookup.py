"""GET /gate/lookup/{token} — chosen as visitor-service's first test target because it's
the one meaningful route that touches only this service's own database: most of
passes.py/gate.py also call out to user-service's internal API to resolve resident/
security identity (app/user_client.py), which is out of scope for a service-level test
without a live user-service. This still exercises require_role() imported from
services/shared/auth_core.py — visitor-service has no local auth.py additions at all."""
import uuid

import pytest

pytestmark = pytest.mark.asyncio


async def _seed_pass(db, *, qr_token: str, status="pending") -> str:
    row = await db.fetchrow(
        """INSERT INTO visitor_pass
               (resident_user_id, resident_name, visitor_name, purpose,
                valid_from, valid_to, qr_token, status)
           VALUES ($1::uuid, 'Resident', 'A Visitor', 'Delivery',
                   now(), now() + interval '4 hours', $2, $3)
           RETURNING id::text""",
        str(uuid.uuid4()), qr_token, status,
    )
    return row["id"]


async def test_lookup_requires_auth(anon_client):
    resp = await anon_client.get("/gate/lookup/some-token")
    assert resp.status_code == 401


async def test_lookup_requires_security_role(make_client):
    client = await make_client(roles=["resident"])
    resp = await client.get("/gate/lookup/some-token")
    assert resp.status_code == 403


async def test_lookup_unknown_token_is_404(make_client):
    client = await make_client(roles=["security_guard"])
    resp = await client.get("/gate/lookup/does-not-exist")
    assert resp.status_code == 404


async def test_lookup_returns_the_matching_pass(db, make_client):
    token = f"tok-{uuid.uuid4()}"
    pass_id = await _seed_pass(db, qr_token=token)

    client = await make_client(roles=["security_guard"])
    resp = await client.get(f"/gate/lookup/{token}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == pass_id
    assert body["visitor_name"] == "A Visitor"
    assert body["status"] == "pending"


async def test_lookup_works_for_admin_and_committee_member_too(db, make_client):
    token = f"tok-{uuid.uuid4()}"
    await _seed_pass(db, qr_token=token)

    for role in ("admin", "committee_member"):
        client = await make_client(roles=[role])
        resp = await client.get(f"/gate/lookup/{token}")
        assert resp.status_code == 200, f"role={role}"
