import asyncio
from datetime import datetime, timedelta
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_oauth2_redirect_html
from fastapi.openapi.utils import get_openapi
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from jose import jwt
import httpx

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

# JWT Configuration
JWT_SECRET = "your-secret-key-change-in-production"
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24
KEYCLOAK_CLIENT_ID = "society-frontend"


class LoginRequest(BaseModel):
    """Login request model."""
    username: str
    password: str


class TokenResponse(BaseModel):
    """Token response model."""
    access_token: str
    token_type: str = "bearer"


def create_access_token(username: str, expires_delta: timedelta = None) -> str:
    """Create JWT token."""
    if expires_delta is None:
        expires_delta = timedelta(hours=JWT_EXPIRATION_HOURS)
    expire = datetime.utcnow() + expires_delta
    payload = {
        "sub": username,
        "exp": expire,
        "iat": datetime.utcnow()
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return token


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


@app.get("/openapi.json", include_in_schema=False)
async def get_openapi_schema():
    """Return OpenAPI schema without authentication."""
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


@app.get("/docs", include_in_schema=False)
async def swagger_ui() -> HTMLResponse:
    return themed_swagger_ui_html(
        openapi_url="./openapi.json",
        title="User Service",
        oauth2_redirect_url=_OAUTH2_REDIRECT,
        init_oauth={
            "clientId": "society-frontend",
            "scopes": "openid profile email roles",
        },
    )


@app.post("/login", response_model=TokenResponse, tags=["Authentication"], include_in_schema=False)
async def login(credentials: LoginRequest):
    """Login with Keycloak credentials from auth-service."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            token_response = await client.post(
                f"{settings.keycloak_url}/realms/society-events/protocol/openid-connect/token",
                data={
                    "grant_type": "password",
                    "client_id": KEYCLOAK_CLIENT_ID,
                    "username": credentials.username,
                    "password": credentials.password,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"}
            )
            if token_response.status_code == 200:
                access_token = create_access_token(credentials.username)
                return {
                    "access_token": access_token,
                    "token_type": "bearer"
                }
            elif token_response.status_code == 401:
                raise HTTPException(status_code=401, detail="Invalid username or password")
            else:
                raise HTTPException(status_code=503, detail="Authentication service unavailable")
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail="Authentication service unavailable")


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


@app.get("/society", tags=["ops"], summary="Society identity config (public)")
async def get_society():
    return SocietyConfig(
        name=settings.society_name,
        shortName=settings.society_short_name,
        city=settings.society_city,
    )


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
