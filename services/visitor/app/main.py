import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_oauth2_redirect_html
from fastapi.openapi.utils import get_openapi
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from app.background import sweep_overdue, send_summaries
from app.config import settings
from app.database import wait_for_db, close_pool, get_pool
from app.routes import gate, ledger, passes
from app.middleware.splunk import SplunkLoggingMiddleware
from app.swagger_theme import themed_swagger_ui_html

_OPENAPI_URL     = "openapi.json"
_OAUTH2_REDIRECT = "/docs/oauth2-redirect"

_background_tasks: list[asyncio.Task] = []


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(os.path.join(settings.uploads_dir, "visitors"), exist_ok=True)
    await wait_for_db()
    _background_tasks.append(asyncio.create_task(sweep_overdue()))
    _background_tasks.append(asyncio.create_task(send_summaries()))
    yield
    for task in _background_tasks:
        task.cancel()
    await close_pool()


app = FastAPI(
    title="Visitor Service",
    description="Owns visitor pass creation, gate entry/exit tracking, anonymous visitor logging, "
                "photo capture, phone verification, and the admin visitor ledger.",
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
        title="Visitor Service",
        oauth2_redirect_url=_OAUTH2_REDIRECT,
        init_oauth={
            "clientId": "society-frontend",
            "scopes": "openid profile email roles",
        },
    )


def _build_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
    )
    schema["servers"] = [{"url": "/api/visitors", "description": "via nginx"}]
    app.openapi_schema = schema
    return app.openapi_schema


app.openapi = _build_openapi

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(SplunkLoggingMiddleware)

app.include_router(passes.router, prefix="/passes", tags=["passes"])
app.include_router(gate.router, prefix="/gate", tags=["gate"])
app.include_router(ledger.router, tags=["ledger", "settings"])

os.makedirs(settings.uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.uploads_dir), name="uploads")


@app.get("/health", tags=["ops"], summary="Liveness + DB ping")
async def health():
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.fetchval("SELECT 1")
    return {"status": "ok", "service": "visitor-service"}
