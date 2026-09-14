"""Test-only helpers shared by every service's pytest suite (see
MAINTAINABILITY_PLAN.md step 6). Never copied into a Docker image — only
services/db.py, auth_core.py, and swagger_theme.py are (see each service's
Dockerfile) — this module is imported straight from services/shared/ by each
service's tests/conftest.py in a local/CI Python environment, not a container.

Auth in tests goes through FastAPI's dependency_overrides on get_current_claims
(see each service's tests/conftest.py), not a real Keycloak — fake_claims()
builds the claims dict a real JWT would have decoded to.

The DB in tests is a real Postgres (the ENV=test stack's `postgres` service —
see `make test` / `make test-db-up` in the Makefile), not mocked — each
service's app.config.settings resolves to it via DB_HOST/DB_PORT/etc. env vars
set in conftest.py before app.main is imported, so shared.db.get_pool() just
works unmodified. truncate() resets tables between tests.
"""
import asyncpg


def fake_claims(sub: str = "test-user-sub", roles: list[str] | None = None, **extra) -> dict:
    """A stand-in for what jose.jwt.decode() would return for a real Keycloak token."""
    return {"sub": sub, "realm_access": {"roles": roles or []}, **extra}


async def truncate(pool: asyncpg.Pool, *tables: str) -> None:
    """Resets the given tables between tests. Doesn't touch `society`/`currency` —
    those are seeded once (db/init/02_seed.sql) and treated as static reference data
    that test fixtures rely on (e.g. the hardcoded SOCIETY_ID) rather than recreate."""
    async with pool.acquire() as conn:
        await conn.execute(f"TRUNCATE TABLE {', '.join(tables)} RESTART IDENTITY CASCADE")
