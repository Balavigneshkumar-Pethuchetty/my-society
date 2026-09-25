from contextlib import asynccontextmanager
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_oauth2_redirect_html
from fastapi.openapi.utils import get_openapi
from fastapi.responses import HTMLResponse
from app.database import wait_for_db, close_pool, get_pool
from app.redis_client import wait_for_redis, close_redis
from app.routes import events, categories, internal
from app.middleware.splunk import SplunkLoggingMiddleware
from app.config import settings
from shared.swagger_theme import themed_swagger_ui_html
from shared.notification_queue import NotificationQueue
from shared.notification_client_v2 import GracefulNotificationClient
import redis.asyncio as aioredis

logger = logging.getLogger(__name__)

_OPENAPI_URL    = "openapi.json"
_OAUTH2_REDIRECT = "/docs/oauth2-redirect"

# Global notification instances
notification_queue: NotificationQueue = None
notification_client: GracefulNotificationClient = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global notification_queue, notification_client

    await wait_for_db()
    await wait_for_redis()

    # Initialize notification queue if enabled
    if settings.enable_notifications:
        try:
            if settings.notification_queue_type == "redis":
                redis_client = aioredis.from_url(
                    f"redis://{settings.redis_host}:{settings.redis_port}/0",
                    encoding="utf8",
                    decode_responses=True,
                )
                notification_queue = NotificationQueue(
                    use_redis=True,
                    redis_client=redis_client,
                )
                logger.info("Redis notification queue initialized")
            else:
                notification_queue = NotificationQueue(use_redis=False)
                logger.info("In-memory notification queue initialized")

            # Initialize graceful notification client
            notification_client = GracefulNotificationClient(
                notification_service_url=settings.notification_service_url,
                internal_api_key=settings.internal_api_key,
                enable_notifications=True,
                queue_handler=notification_queue,
            )
            logger.info("Graceful notification client initialized")
        except Exception as e:
            logger.warning(f"Failed to initialize notifications: {e}")

    yield

    await close_redis()
    await close_pool()


app = FastAPI(
    title="Event Service",
    description="Owns the full event lifecycle: categories, events, announcements.",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url="/openapi.json",
    swagger_ui_oauth2_redirect_url=_OAUTH2_REDIRECT,
)

# Store notification client in app state for access in routes
app.state.notification_client = notification_client
app.state.notification_queue = notification_queue


@app.get(_OAUTH2_REDIRECT, include_in_schema=False)
async def oauth2_redirect() -> HTMLResponse:
    return get_swagger_ui_oauth2_redirect_html()


@app.get("/docs", include_in_schema=False)
async def swagger_ui() -> HTMLResponse:
    return themed_swagger_ui_html(
        openapi_url=_OPENAPI_URL,
        title="Event Service",
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
    schema["servers"] = [{"url": "/api/events", "description": "via nginx"}]
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

app.include_router(events.router,     prefix="/events",     tags=["events"])
app.include_router(categories.router, prefix="/categories", tags=["categories"])
app.include_router(internal.router,             prefix="/internal/events",       tags=["internal"])
app.include_router(internal.ticket_types_router, prefix="/internal/ticket-types", tags=["internal"])


@app.get("/health", tags=["ops"], summary="Liveness + DB ping")
async def health():
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.fetchval("SELECT 1")
    return {"status": "ok", "service": "event-service"}
