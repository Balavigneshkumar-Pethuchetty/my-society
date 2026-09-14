from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_oauth2_redirect_html
from fastapi.openapi.utils import get_openapi
from fastapi.responses import HTMLResponse

from app.config import settings
from app.database import wait_for_db, close_pool, get_pool
from app.routes import cart, complimentary, registrations
from app.middleware.splunk import SplunkLoggingMiddleware
from shared.swagger_theme import themed_swagger_ui_html

_OPENAPI_URL     = "openapi.json"
_OAUTH2_REDIRECT = "/docs/oauth2-redirect"


@asynccontextmanager
async def lifespan(app: FastAPI):
    await wait_for_db()
    yield
    await close_pool()


app = FastAPI(
    title="Registration Service",
    description="Owns the booking lifecycle: registration, manual payment verification, QR tickets, and gate entry.",
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
        title="Registration Service",
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
    schema["servers"] = [{"url": "/api/registrations", "description": "via nginx"}]
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

app.include_router(cart.router,          prefix="/registrations", tags=["cart"])
app.include_router(registrations.router, prefix="/registrations", tags=["registrations"])
app.include_router(complimentary.router, prefix="/complimentary", tags=["complimentary"])


@app.get("/payment-config", tags=["ops"],
         summary="Society payment details (UPI / bank transfer)")
async def payment_config():
    return {
        "upi_id":      settings.society_upi_id,
        "upi_name":    settings.society_upi_name,
        "bank_name":   settings.society_bank_name,
        "account":     settings.society_bank_account,
        "ifsc":        settings.society_bank_ifsc,
        "beneficiary": settings.society_bank_beneficiary,
    }


@app.get("/health", tags=["ops"], summary="Liveness + DB ping")
async def health():
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.fetchval("SELECT 1")
    return {"status": "ok", "service": "registration-service"}
