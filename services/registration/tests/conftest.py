"""Env vars and sys.path must be set up before `app.*`/`shared.*` are imported —
see services/shared/testing.py for why (real ENV=test Postgres, no mocking) and
MAINTAINABILITY_PLAN.md step 6 for the overall test-suite design."""
import os
import sys
import pathlib
import tempfile

import pytest
import pytest_asyncio
import httpx

_HERE = pathlib.Path(__file__).resolve()
_SERVICE_DIR = _HERE.parents[1]        # services/registration
_SERVICES_DIR = _SERVICE_DIR.parent    # services/
sys.path.insert(0, str(_SERVICES_DIR))
sys.path.insert(0, str(_SERVICE_DIR))

os.environ.setdefault("DB_HOST", "localhost")
os.environ.setdefault("DB_PORT", os.environ["TEST_POSTGRES_PORT"])
os.environ.setdefault("DB_USER", os.environ["TEST_POSTGRES_USER"])
os.environ.setdefault("DB_PASSWORD", os.environ["TEST_POSTGRES_PASSWORD"])
os.environ.setdefault("DB_NAME", os.environ.get("TEST_POSTGRES_DB", "society_events"))
os.environ.setdefault("INTERNAL_API_KEY", "test_internal_api_key_min_32_chars_xxxx")
os.environ.setdefault("UPLOADS_DIR", tempfile.mkdtemp(prefix="registration-test-uploads-"))

from shared.testing import fake_claims, truncate  # noqa: E402
from shared.auth_core import get_current_claims  # noqa: E402
from shared import db as shared_db  # noqa: E402
from app.main import app  # noqa: E402

SOCIETY_ID = "11100000-0000-0000-0000-000000000001"  # seeded by services/shared/test_seed.sql


@pytest_asyncio.fixture
async def db():
    """See services/payment/tests/conftest.py's `db` fixture for why this resets the
    module-level pool singleton every test (asyncpg pools can't cross event loops, and
    pytest-asyncio gives each test its own loop by default)."""
    shared_db._pool = None
    pool = await shared_db.get_pool()
    yield pool
    await shared_db.close_pool()


@pytest_asyncio.fixture(autouse=True)
async def _cleanup(db):
    yield
    await truncate(db, "complimentary_ticket", "ticket", "registration", "event", "users")


@pytest_asyncio.fixture
async def anon_client():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture
async def make_client():
    clients: list[httpx.AsyncClient] = []

    async def _make(sub: str = "test-user-sub", roles: list[str] | None = None, **extra) -> httpx.AsyncClient:
        app.dependency_overrides[get_current_claims] = lambda: fake_claims(sub=sub, roles=roles, **extra)
        c = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        clients.append(c)
        return c

    yield _make
    app.dependency_overrides.pop(get_current_claims, None)
    for c in clients:
        await c.aclose()
