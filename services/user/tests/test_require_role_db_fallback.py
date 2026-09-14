"""user-service's require_role() (services/user/app/auth.py) is the one service that kept
its own local copy instead of importing services/shared/auth_core.py's version — it falls
back to the local `users.role` column when the JWT's realm_access.roles is sparse or stale
(e.g. immediately after a Keycloak role assignment that hasn't round-tripped into a fresh
token yet). These tests exercise exactly that divergence via PUT /building/hierarchy
(require_role("admin")), the simplest admin-only route that doesn't also touch Keycloak."""
import uuid

import pytest

pytestmark = pytest.mark.asyncio

_BODY = {"levels": [{"level_index": 1, "level_name": "Tower", "is_billable": False}]}


async def _seed_user(db, *, role="resident", name="Test User"):
    sub = f"sub-{uuid.uuid4()}"
    await db.execute(
        "INSERT INTO users (name, email, role, keycloak_sub) VALUES ($1, $2, $3, $4)",
        name, f"{sub}@example.test", role, sub,
    )
    return sub


async def test_set_hierarchy_requires_auth(anon_client):
    resp = await anon_client.put("/building/hierarchy", json=_BODY)
    assert resp.status_code == 401


async def test_set_hierarchy_rejects_resident_with_no_admin_anywhere(db, make_client):
    sub = await _seed_user(db, role="resident")
    client = await make_client(sub=sub, roles=["resident"])
    resp = await client.put("/building/hierarchy", json=_BODY)
    assert resp.status_code == 403


async def test_set_hierarchy_passes_with_admin_role_in_jwt(db, make_client):
    sub = await _seed_user(db, role="admin")
    client = await make_client(sub=sub, roles=["admin"])
    resp = await client.put("/building/hierarchy", json=_BODY)
    assert resp.status_code == 200


async def test_set_hierarchy_falls_back_to_db_role_when_jwt_is_stale(db, make_client):
    """The JWT carries no roles at all (as if minted before a Keycloak admin-role grant
    round-tripped) — should still pass because users.role is 'admin' in the DB."""
    sub = await _seed_user(db, role="admin")
    client = await make_client(sub=sub, roles=[])
    resp = await client.put("/building/hierarchy", json=_BODY)
    assert resp.status_code == 200


async def test_db_fallback_does_not_grant_access_to_a_non_admin_db_role(db, make_client):
    """A resident in the DB with an empty JWT must still be rejected — the DB fallback
    checks the actual role value, it isn't a blanket bypass."""
    sub = await _seed_user(db, role="resident")
    client = await make_client(sub=sub, roles=[])
    resp = await client.put("/building/hierarchy", json=_BODY)
    assert resp.status_code == 403
