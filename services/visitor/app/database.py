import asyncio
import asyncpg
from app.config import settings

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            settings.database_url,
            min_size=2,
            max_size=10,
            command_timeout=30,
        )
    return _pool


async def wait_for_db(retries: int = 10, delay: float = 3.0) -> None:
    for attempt in range(1, retries + 1):
        try:
            await get_pool()
            return
        except Exception as exc:
            if attempt == retries:
                raise
            print(f"[db] waiting for postgres (attempt {attempt}/{retries}): {exc}")
            await asyncio.sleep(delay)


async def close_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
