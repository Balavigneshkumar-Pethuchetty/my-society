"""Notification Service API."""
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
import jwt

from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks, Header, Security
from fastapi.responses import JSONResponse
from fastapi.security import APIKeyHeader, HTTPBearer, HTTPAuthorizationCredentials
from fastapi.openapi.utils import get_openapi
from pydantic import BaseModel

from app.config import settings
from app.models import (
    SendNotificationRequest,
    SendNotificationResponse,
    InAppNotificationRequest,
    InAppNotificationResponse,
    BulkNotificationRequest,
    BulkNotificationResponse,
)
from app.notifications import send_unified_notification
import httpx

logging.basicConfig(
    level=logging.INFO if not settings.debug else logging.DEBUG,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

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


# Bearer token for Swagger UI authentication
bearer_scheme = HTTPBearer(
    description="Bearer token from /login endpoint"
)


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


def verify_token(credentials: HTTPAuthorizationCredentials = Security(bearer_scheme)) -> str:
    """Verify JWT token."""
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=403, detail="Invalid token")
        return username
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=403, detail="Invalid token")


def verify_internal_api_key(x_api_key: str = Header(None), authorization: str = Header(None)) -> str:
    """Verify either API key or Bearer token."""
    # Try Bearer token first
    if authorization and authorization.startswith("Bearer "):
        token = authorization.replace("Bearer ", "")
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            username = payload.get("sub")
            if username:
                return username
        except jwt.InvalidTokenError:
            pass

    # Fall back to API key
    if x_api_key:
        if settings.internal_api_key and x_api_key == settings.internal_api_key:
            return "service"

    raise HTTPException(status_code=403, detail="Invalid credentials")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan context manager."""
    logger.info(f"Starting {settings.service_name}")
    yield
    logger.info(f"Shutting down {settings.service_name}")


app = FastAPI(
    title="Notification Service",
    description="Unified notification service with Novu and legacy fallback",
    version="1.0.0",
    root_path="/api/notifications",
    openapi_url="/openapi.json",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)


def custom_openapi():
    """Custom OpenAPI schema with OAuth2 and Bearer token security schemes."""
    if app.openapi_schema:
        return app.openapi_schema

    openapi_schema = get_openapi(
        title="Notification Service",
        version="1.0.0",
        description="Unified notification service with Novu and legacy fallback",
        routes=app.routes,
    )

    # Add OAuth2, Bearer token and API Key security schemes
    openapi_schema["components"]["securitySchemes"] = {
        "OAuth2PasswordBearer": {
            "type": "oauth2",
            "flows": {
                "password": {
                    "tokenUrl": "/login",
                    "scopes": {
                        "openid": "OpenID Connect",
                        "profile": "User profile",
                        "email": "User email",
                        "roles": "User roles"
                    }
                }
            },
            "description": "Login with Keycloak credentials from auth-service"
        },
        "BearerToken": {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
            "description": "Bearer token from /login endpoint"
        },
        "APIKey": {
            "type": "apiKey",
            "in": "header",
            "name": "X-Api-Key",
            "description": "Internal service API key (alternative to Bearer token)"
        }
    }

    # Apply security to all endpoints except /login and /health
    for path, path_item in openapi_schema["paths"].items():
        if path not in ["/login", "/health", "/api/notifications/login", "/api/notifications/health"]:
            for operation in path_item.values():
                if isinstance(operation, dict) and "security" not in operation:
                    operation["security"] = [
                        {"OAuth2PasswordBearer": ["openid", "profile", "email", "roles"]},
                        {"BearerToken": []},
                        {"APIKey": []}
                    ]

    app.openapi_schema = openapi_schema
    return app.openapi_schema


app.openapi = custom_openapi


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "ok",
        "service": settings.service_name,
        "environment": settings.environment,
    }


@app.post("/login", response_model=TokenResponse, tags=["Authentication"])
async def login(credentials: LoginRequest):
    """
    Login with Keycloak credentials from auth-service.

    Use your Keycloak account username and password. Valid credentials will return
    a Bearer token that can be used to authenticate API requests.

    **Note:** Your Keycloak user must exist in the society-events realm.
    """
    try:
        # Authenticate against Keycloak
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
                # Keycloak auth successful
                logger.info(f"User {credentials.username} authenticated successfully")
                # Create our own JWT token for API use
                access_token = create_access_token(credentials.username)
                return {
                    "access_token": access_token,
                    "token_type": "bearer"
                }
            elif token_response.status_code == 401:
                logger.warning(f"Keycloak auth failed for user: {credentials.username}")
                raise HTTPException(status_code=401, detail="Invalid username or password")
            else:
                logger.error(f"Keycloak error: {token_response.status_code} - {token_response.text}")
                raise HTTPException(status_code=503, detail="Authentication service unavailable")

    except httpx.RequestError as e:
        logger.error(f"Failed to connect to Keycloak at {settings.keycloak_url}: {e}")
        raise HTTPException(status_code=503, detail="Authentication service unavailable")


@app.post("/api/notifications/send", response_model=SendNotificationResponse)
async def send_notification(
    request: SendNotificationRequest,
    background_tasks: BackgroundTasks,
    api_key: str = Depends(verify_internal_api_key),
):
    """
    Send a unified notification via Novu with legacy fallback.

    This is the main endpoint for sending notifications from other services.
    It automatically handles routing based on configured strategy.
    """
    try:
        if settings.use_background_tasks:
            background_tasks.add_task(
                send_unified_notification,
                user_id=request.user_id,
                event_name=request.event_name,
                payload=request.payload,
                user_phone=request.user_phone,
                user_email=request.user_email,
                legacy_message=request.legacy_message,
                notify_sms=request.notify_sms,
                notify_email=request.notify_email,
                notify_telegram=request.notify_telegram,
                tags=request.tags,
            )
            return SendNotificationResponse(
                source="pending",
                success=True,
                id=f"{request.user_id}",
                message="Notification queued for delivery",
            )
        else:
            response = await send_unified_notification(
                user_id=request.user_id,
                event_name=request.event_name,
                payload=request.payload,
                user_phone=request.user_phone,
                user_email=request.user_email,
                legacy_message=request.legacy_message,
                notify_sms=request.notify_sms,
                notify_email=request.notify_email,
                notify_telegram=request.notify_telegram,
                tags=request.tags,
            )
            return response
    except Exception as e:
        logger.error(f"Error sending notification: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/notifications/bulk", response_model=BulkNotificationResponse)
async def send_bulk_notification(
    request: BulkNotificationRequest,
    background_tasks: BackgroundTasks,
    api_key: str = Depends(verify_internal_api_key),
):
    """Send notifications to multiple users."""
    results = []
    successful = 0
    failed = 0

    async def send_to_user(user_id: str):
        try:
            result = await send_unified_notification(
                user_id=user_id,
                event_name=request.event_name,
                payload=request.payload,
                legacy_message=request.legacy_message,
                notify_sms=request.notify_sms,
                notify_email=request.notify_email,
                notify_telegram=request.notify_telegram,
            )
            return result
        except Exception as e:
            logger.error(f"Error sending to {user_id}: {e}")
            return SendNotificationResponse(source="none", success=False, id=None)

    # Process all users
    for user_id in request.user_ids:
        result = await send_to_user(user_id)
        results.append(result)
        if result.success:
            successful += 1
        else:
            failed += 1

    return BulkNotificationResponse(
        total=len(request.user_ids), successful=successful, failed=failed, results=results
    )


@app.post("/api/notifications/in-app")
async def send_in_app_notification(
    request: InAppNotificationRequest,
    background_tasks: BackgroundTasks,
    api_key: str = Depends(verify_internal_api_key),
):
    """
    Record an in-app notification in user-service.

    This calls user-service's internal API to store the notification
    in the notifications table.
    """
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{settings.user_service_url}/api/users/internal/notifications",
                json={
                    "user_id": request.user_id,
                    "type": request.type_,
                    "title": request.title,
                    "message": request.message,
                    "related_id": request.related_id,
                    "event_id": request.event_id,
                },
                headers={"X-Api-Key": settings.internal_api_key},
            )

            if response.status_code < 300:
                return response.json()
            else:
                logger.error(
                    f"User service error: {response.status_code}",
                    extra={"response": response.text},
                )
                raise HTTPException(status_code=response.status_code, detail="Failed to save notification")
    except httpx.RequestError as e:
        logger.error(f"Failed to connect to user-service: {e}")
        raise HTTPException(status_code=503, detail="User service unavailable")


@app.get("/api/notifications/status/{notification_id}")
async def get_notification_status(
    notification_id: str,
    api_key: str = Depends(verify_internal_api_key),
):
    """
    Get the status of a sent notification.

    This queries Novu's API for delivery status if available.
    """
    if not settings.novu_api_key:
        raise HTTPException(status_code=501, detail="Novu not configured")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{settings.novu_backend_url}/v1/messages/notification/{notification_id}",
                headers={"Authorization": f"ApiKey {settings.novu_api_key}"},
            )

            if response.status_code < 300:
                return response.json()
            else:
                raise HTTPException(status_code=response.status_code, detail="Notification not found")
    except httpx.RequestError as e:
        logger.error(f"Failed to query Novu: {e}")
        raise HTTPException(status_code=503, detail="Novu service unavailable")


@app.get("/api/notifications/config")
async def get_config(
    api_key: str = Depends(verify_internal_api_key),
):
    """Get current notification service configuration."""
    return {
        "novu_enabled": bool(settings.novu_api_key),
        "novu_strategy": settings.novu_strategy,
        "email_enabled": bool(settings.gmail_smtp_user),
        "sms_telegram_enabled": bool(settings.auth_service_api_key),
        "background_tasks_enabled": settings.use_background_tasks,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=settings.service_port)
