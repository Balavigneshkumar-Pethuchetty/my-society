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
_SERVICE_DIR = _HERE.parents[1]        # services/payment
_SERVICES_DIR = _SERVICE_DIR.parent    # services/
sys.path.insert(0, str(_SERVICES_DIR))
sys.path.insert(0, str(_SERVICE_DIR))

os.environ.setdefault("DB_HOST", "localhost")
os.environ.setdefault("DB_PORT", os.environ["TEST_POSTGRES_PORT"])
os.environ.setdefault("DB_USER", os.environ["TEST_POSTGRES_USER"])
os.environ.setdefault("DB_PASSWORD", os.environ["TEST_POSTGRES_PASSWORD"])
os.environ.setdefault("DB_NAME", os.environ.get("TEST_POSTGRES_DB", "society_events"))
os.environ.setdefault("INTERNAL_API_KEY", "test_internal_api_key_min_32_chars_xxxx")
# A throwaway Fernet key — see app/crypto.py, generated with the command in its own
# comment. Not a real secret; only ever used against the disposable test DB.
os.environ.setdefault("PAYMENT_SECRET_KEY", "wjexbtxTRQvotuAzC8qusLTYxRp1Ie0LuSApBmIL1Fk=")
os.environ.setdefault("UPLOADS_DIR", tempfile.mkdtemp(prefix="payment-test-uploads-"))

from shared.testing import fake_claims, truncate  # noqa: E402
from shared.auth_core import get_current_claims  # noqa: E402
from shared import db as shared_db  # noqa: E402
from app.main import app  # noqa: E402

SOCIETY_ID = "11100000-0000-0000-0000-000000000001"  # seeded by db/init/02_seed.sql


@pytest_asyncio.fixture
async def db():
    """The real ENV=test Postgres pool — NOT the app's lifespan (which also starts the
    IMAP reconciliation loop we don't want running in tests); acquired directly so tests
    can seed rows the same way the app's own routes would query them.

    shared.db.get_pool() caches its pool in a module-level global, and an asyncpg pool
    can't be reused across event loops — pytest-asyncio gives each test its own loop by
    default, so the global is reset here at the start of every test. Any get_pool() call
    made later in the same test (including by the app itself, mid-request via make_client)
    then creates/reuses one pool scoped correctly to this test's loop."""
    shared_db._pool = None
    pool = await shared_db.get_pool()
    yield pool
    await shared_db.close_pool()


@pytest_asyncio.fixture(autouse=True)
async def _cleanup(db):
    yield
    # Order doesn't matter — CASCADE handles FK cleanup. society/currency are left alone
    # (seeded once, static reference data every test relies on existing).
    await truncate(db, "payment_audit_log", "payment_transaction", "registration", "event", "users")


@pytest_asyncio.fixture
async def anon_client():
    """No auth override — get_current_claims runs for real, so a missing/bad token 401s
    for real. Use this to verify a route is actually gated, not just that the harness works."""
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture
async def make_client():
    """make_client(sub=..., roles=[...]) -> an AsyncClient with those claims injected via
    FastAPI's dependency_overrides — no real Keycloak token needed."""
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
