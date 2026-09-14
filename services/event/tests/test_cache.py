"""Redis cache helper (services/event/app/cache.py) — hit/miss/invalidation, and that
a broken Redis connection fails open instead of breaking the request."""
import json
import uuid

import fakeredis.aioredis
import pytest
import pytest_asyncio

from conftest import SOCIETY_ID
from shared import redis_client as shared_redis
from shared.testing import truncate
from app import cache

pytestmark = pytest.mark.asyncio


async def _seed_user(db, *, role="resident", name="Test User"):
    sub = f"sub-{uuid.uuid4()}"
    row = await db.fetchrow(
        "INSERT INTO users (name, email, role, keycloak_sub) VALUES ($1, $2, $3, $4) RETURNING id::text",
        name, f"{sub}@example.test", role, sub,
    )
    return row["id"], sub


async def _seed_draft_event(db, organizer_id: str) -> str:
    row = await db.fetchrow(
        """INSERT INTO event (society_id, organizer_id, title, start_time, end_time, venue, status)
           VALUES ($1::uuid, $2::uuid, 'Secret Draft', now() + interval '1 day',
                   now() + interval '2 day', 'Clubhouse', 'draft')
           RETURNING id::text""",
        SOCIETY_ID, organizer_id,
    )
    return row["id"]


@pytest_asyncio.fixture(autouse=True)
async def fake_redis():
    shared_redis._redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    yield shared_redis._redis
    await shared_redis._redis.flushall()
    shared_redis._redis = None


async def test_cache_get_json_miss_returns_none():
    assert await cache.cache_get_json("nope") is None


async def test_cache_set_then_get_round_trips():
    await cache.cache_set_json("k", {"a": 1, "b": [1, 2, 3]})
    assert await cache.cache_get_json("k") == {"a": 1, "b": [1, 2, 3]}


async def test_cache_delete_removes_key():
    await cache.cache_set_json("k", {"a": 1})
    await cache.cache_delete("k")
    assert await cache.cache_get_json("k") is None


async def test_cache_delete_pattern_removes_matching_keys_only():
    await cache.cache_set_json("ev:list:a", {"x": 1})
    await cache.cache_set_json("ev:list:b", {"x": 2})
    await cache.cache_set_json("cat:list", {"x": 3})

    await cache.cache_delete_pattern("ev:list:*")

    assert await cache.cache_get_json("ev:list:a") is None
    assert await cache.cache_get_json("ev:list:b") is None
    assert await cache.cache_get_json("cat:list") == {"x": 3}


async def test_cache_get_fails_open_when_redis_unavailable(monkeypatch):
    async def _broken():
        raise ConnectionError("redis is down")

    monkeypatch.setattr(cache, "get_redis", _broken)
    assert await cache.cache_get_json("k") is None


async def test_cache_set_fails_open_when_redis_unavailable(monkeypatch):
    async def _broken():
        raise ConnectionError("redis is down")

    monkeypatch.setattr(cache, "get_redis", _broken)
    # Must not raise — a Redis outage on write should be a no-op, not a request failure.
    await cache.cache_set_json("k", {"a": 1})


async def test_event_listing_cache_excludes_drafts_and_stays_separate_from_draft_queries(db, anon_client):
    """The only cacheable branch of GET /events is `claims is None` with the default
    (published, not-mine) params — status gets force-set to 'published' on that branch
    for everyone, so an explicit `?status=draft` query (deliberately excluded from
    `cacheable`) must never read or write the same cache key as the default view."""
    organizer_id, _ = await _seed_user(db, role="resident", name="Organizer")
    await _seed_draft_event(db, organizer_id)

    # Anonymous default call — populates the cache; draft must not be visible.
    resp1 = await anon_client.get("/events")
    assert resp1.status_code == 200
    assert not any(e["title"] == "Secret Draft" for e in resp1.json()["events"])
    default_key = "ev:list:" + json.dumps(
        {"page": 1, "limit": 9, "search": None, "category_id": None, "is_free": None, "sort": "date_asc"},
        sort_keys=True,
    )
    assert await cache.cache_get_json(default_key) is not None

    # An explicit `?status=draft` query is a different (uncached) code path — it must
    # not disturb the default-view cache entry populated above.
    resp2 = await anon_client.get("/events", params={"status": "draft"})
    assert resp2.status_code == 200
    assert await cache.cache_get_json(default_key) is not None


async def test_event_listing_cache_invalidates_on_publish(db, anon_client, make_client):
    """A newly-published event must appear in the anonymous listing immediately, not
    only after the cache_ttl_seconds safety-net TTL expires."""
    resident_id, resident_sub = await _seed_user(db, role="resident", name="Organizer")
    client = await make_client(sub=resident_sub, roles=["resident"])

    # Populate the cache with the "nothing published yet" state.
    resp1 = await anon_client.get("/events")
    assert not any(e["title"] == "Freshly Published" for e in resp1.json()["events"])

    create_resp = await client.post("/events", json={
        "title": "Freshly Published", "venue": "Clubhouse",
        "start_time": "2027-01-01T10:00:00Z", "end_time": "2027-01-01T12:00:00Z",
    })
    assert create_resp.status_code == 201
    event_id = create_resp.json()["id"]

    publish_resp = await client.patch(f"/events/{event_id}/publish")
    assert publish_resp.status_code == 200

    # The publish must have invalidated the cache — an immediate anonymous re-read
    # must reflect it, not the stale pre-publish snapshot.
    resp2 = await anon_client.get("/events")
    assert any(e["title"] == "Freshly Published" for e in resp2.json()["events"])


async def test_categories_list_populates_and_invalidates_cache(db, make_client):
    client = await make_client(roles=["admin"])
    try:
        resp = await client.get("/categories")
        assert resp.status_code == 200
        assert await cache.cache_get_json("cat:list") is not None

        create_resp = await client.post("/categories", json={"name": "Sports", "icon": "⚽", "color_hex": "#00FF00"})
        assert create_resp.status_code == 201

        # The mutating endpoint must invalidate — a stale cached list would still show none.
        assert await cache.cache_get_json("cat:list") is None

        resp2 = await client.get("/categories")
        assert any(c["name"] == "Sports" for c in resp2.json())
    finally:
        await truncate(db, "event_category")
