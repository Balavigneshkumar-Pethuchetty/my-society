import asyncio
import redis.asyncio as redis
from app.config import settings

_redis: "redis.Redis | None" = None


async def get_redis() -> "redis.Redis":
    global _redis
    if _redis is None:
        _redis = redis.Redis(
            host=settings.redis_host,
            port=settings.redis_port,
            password=settings.redis_password or None,
            decode_responses=True,
        )
    return _redis


async def wait_for_redis(retries: int = 10, delay: float = 3.0) -> None:
    """Retry Redis connection on startup — gives the redis container time to become ready."""
    for attempt in range(1, retries + 1):
        try:
            r = await get_redis()
            await r.ping()
            return
        except Exception as exc:
            if attempt == retries:
                raise
            print(f"[redis] waiting for redis (attempt {attempt}/{retries}): {exc}")
            await asyncio.sleep(delay)


async def close_redis() -> None:
    global _redis
    if _redis:
        await _redis.aclose()
        _redis = None
