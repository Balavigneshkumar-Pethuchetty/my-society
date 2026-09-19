import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_oauth2_redirect_html
from fastapi.openapi.utils import get_openapi
from fastapi.responses import HTMLResponse

from app.config import settings
from app.database import wait_for_db, close_pool, get_pool
from app.models import SocietyConfig
from app.routes import users, internal, notifications, logs, building, leave_requests
from app.middleware.splunk import SplunkLoggingMiddleware
from app.metrics_collector import collect_metrics
from shared.swagger_theme import themed_swagger_ui_html

# All nginx-prefixed paths (browser-visible via http://host/api/users/...)
_OPENAPI_URL   = "openapi.json"
_OAUTH2_REDIRECT = "/docs/oauth2-redirect"


@asynccontextmanager
async def lifespan(app: FastAPI):
    await wait_for_db()
    metrics_task = asyncio.create_task(collect_metrics())
    yield
    metrics_task.cancel()
    await close_pool()


app = FastAPI(
    title="User Service",
    description="Resolves Keycloak sub → internal user, profile CRUD, apartment assignment.",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None,          # served manually below so we control every URL
    redoc_url=None,
    openapi_url="/openapi.json",
    # Registers the oauth2-redirect HTML handler at this path (no root_path prepending)
    swagger_ui_oauth2_redirect_url=_OAUTH2_REDIRECT,
)


@app.get(_OAUTH2_REDIRECT, include_in_schema=False)
async def oauth2_redirect() -> HTMLResponse:
    return get_swagger_ui_oauth2_redirect_html()


@app.get("/docs", include_in_schema=False)
async def swagger_ui() -> HTMLResponse:
    return themed_swagger_ui_html(
        openapi_url=_OPENAPI_URL,           # Swagger UI fetches spec via nginx prefix
        title="User Service",
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
    schema["servers"] = [{"url": "/api/users", "description": "via nginx"}]
    app.openapi_schema = schema
    return app.openapi_schema


app.openapi = _build_openapi

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tightened at the nginx / API-gateway layer
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(SplunkLoggingMiddleware)

app.include_router(users.router,         prefix="/users",          tags=["users"])
app.include_router(notifications.router, prefix="/notifications",   tags=["notifications"])
app.include_router(internal.router,      prefix="/internal/users",  tags=["internal"])
app.include_router(building.router,      prefix="/building",        tags=["building"])
app.include_router(leave_requests.router, prefix="/leave-requests", tags=["leave-requests"])
app.include_router(logs.router,          tags=["ops"])


@app.get("/health", tags=["ops"], summary="Liveness + DB ping")
async def health():
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.fetchval("SELECT 1")
    return {"status": "ok", "service": "user-service"}
