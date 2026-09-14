import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_oauth2_redirect_html
from fastapi.openapi.utils import get_openapi
from fastapi.responses import HTMLResponse

from app.config import settings
from app.database import close_pool, get_pool, wait_for_db
from app.middleware.splunk import SplunkLoggingMiddleware
from app.reconciliation import inbox as reconciliation_inbox
from app.routes import audit, funds, payments, quick_review, reconciliation, refunds, registry, settings as recon_settings, sponsors, testing
from shared.swagger_theme import themed_swagger_ui_html

_OPENAPI_URL     = "openapi.json"
_OAUTH2_REDIRECT = "/docs/oauth2-redirect"


@asynccontextmanager
async def lifespan(app: FastAPI):
    await wait_for_db()
    # Start IMAP reconciliation loop in the background — stored so it can be
    # cancelled cleanly on shutdown (mirrors visitor-service's main.py pattern).
    reconciliation_task = asyncio.create_task(reconciliation_inbox.reconciliation_loop())
    yield
    reconciliation_task.cancel()
    try:
        await reconciliation_task
    except asyncio.CancelledError:
        pass
    await close_pool()


app = FastAPI(
    title="Payment & Reconciliation Service",
    description="Pluggable payment platform: manual UPI, committee registry, inbox reconciliation, refund ledger.",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url="/openapi.json",
    swagger_ui_oauth2_redirect_url=_OAUTH2_REDIRECT,
)


@app.get(_OAUTH2_REDIRECT, include_in_schema=False)
async def oauth2_redirect() -> HTMLResponse:
    return get_swagger_ui_oauth2_redirect_html()


@app.get("/docs", include_in_schema=False)
async def swagger_ui() -> HTMLResponse:
    return themed_swagger_ui_html(
        openapi_url=_OPENAPI_URL,
        title="Payment & Reconciliation Service",
        oauth2_redirect_url=_OAUTH2_REDIRECT,
        init_oauth={"clientId": "society-frontend", "scopes": "openid profile email roles"},
    )


def _build_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(title=app.title, version=app.version,
                         description=app.description, routes=app.routes)
    schema["servers"] = [{"url": "/api/payments", "description": "via nginx"}]
    app.openapi_schema = schema
    return app.openapi_schema


app.openapi = _build_openapi

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.add_middleware(SplunkLoggingMiddleware)

app.include_router(payments.router,        prefix="/payments",        tags=["payments"])
app.include_router(refunds.router,         prefix="/refunds",         tags=["refunds"])
app.include_router(reconciliation.router,  prefix="/reconciliation",  tags=["reconciliation"])
app.include_router(registry.router,        prefix="/registry",        tags=["registry"])
app.include_router(audit.router,           prefix="/audit",           tags=["audit"])
app.include_router(recon_settings.router,  prefix="/recon-settings",  tags=["reconciliation-settings"])
app.include_router(funds.router,           prefix="/funds",           tags=["funds"])
app.include_router(sponsors.router,        prefix="/sponsors",        tags=["sponsors"])
app.include_router(quick_review.router,    prefix="/quick-review",    tags=["quick-review"])

if settings.is_testing:
    app.include_router(testing.router, prefix="/test", tags=["testing"])


@app.get("/health", tags=["ops"])
async def health():
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.fetchval("SELECT 1")
    return {"status": "ok", "service": "payment-service", "provider": settings.payment_provider}
