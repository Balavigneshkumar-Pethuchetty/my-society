"""Thin JSON cache helper over Redis. Every function fails open — a Redis outage
or error must never break a request, it should just behave as a cache miss."""
import json

from app.config import settings
from app.redis_client import get_redis


async def cache_get_json(key: str):
    try:
        r = await get_redis()
        raw = await r.get(key)
    except Exception as exc:
        print(f"[cache] get({key}) failed, treating as miss: {exc}")
        return None
    return json.loads(raw) if raw is not None else None


async def cache_set_json(key: str, value, ttl: int | None = None) -> None:
    try:
        r = await get_redis()
        # default=str covers Decimal/UUID/etc. that plain json.dumps can't serialize —
        # response_model validation on the way back out re-coerces the string to the
        # right type, so this doesn't change what the client ultimately sees.
        await r.set(key, json.dumps(value, default=str), ex=ttl or settings.cache_ttl_seconds)
    except Exception as exc:
        print(f"[cache] set({key}) failed, ignoring: {exc}")


async def cache_delete(*keys: str) -> None:
    if not keys:
        return
    try:
        r = await get_redis()
        await r.delete(*keys)
    except Exception as exc:
        print(f"[cache] delete({keys}) failed, ignoring: {exc}")


async def cache_delete_pattern(pattern: str) -> None:
    """Delete every key matching `pattern` (e.g. "ev:list:*") — used where the cache
    key space is param-derived and unbounded, so a single fixed key can't be targeted."""
    try:
        r = await get_redis()
        keys = [k async for k in r.scan_iter(match=pattern)]
        if keys:
            await r.delete(*keys)
    except Exception as exc:
        print(f"[cache] delete_pattern({pattern}) failed, ignoring: {exc}")
