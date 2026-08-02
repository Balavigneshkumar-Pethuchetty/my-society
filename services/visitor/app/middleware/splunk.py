import logging
import time
import traceback

from jose import jwt as jose_jwt
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.splunk_logger import _HEC_TOKEN, log_app_error, log_security, log_web_access

logger = logging.getLogger(__name__)

_SKIP_PATHS  = {"/health", "/docs", "/redoc", "/openapi.json"}
_MAX_BODY    = 4096
_KNOWN_ROLES = {"admin", "committee_member", "resident", "security_guard", "sponsor"}


def _extract_user(request: Request) -> dict:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return {"user": "anonymous"}
    try:
        claims = jose_jwt.get_unverified_claims(auth[7:])
        roles  = claims.get("realm_access", {}).get("roles", [])
        role   = next((r for r in roles if r in _KNOWN_ROLES), "unknown")
        return {
            "user_id":  claims.get("sub"),
            "username": claims.get("preferred_username"),
            "email":    claims.get("email"),
            "role":     role,
        }
    except Exception as exc:
        logger.debug("Could not decode JWT for logging: %s", exc)
        return {"user": "unresolvable"}


async def _read_body(response: Response) -> tuple[bytes, Response]:
    chunks: list[bytes] = []
    async for chunk in response.body_iterator:
        chunks.append(chunk)
    body = b"".join(chunks)
    return body, Response(
        content=body,
        status_code=response.status_code,
        headers=dict(response.headers),
        media_type=response.media_type,
    )


class SplunkLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path
        if path in _SKIP_PATHS or path.startswith("/docs/"):
            return await call_next(request)
        if not _HEC_TOKEN:
            return await call_next(request)

        start     = time.perf_counter()
        client_ip = request.client.host if request.client else "unknown"

        try:
            response: Response = await call_next(request)
        except Exception as exc:
            duration_ms = round((time.perf_counter() - start) * 1000)
            await log_app_error({
                "level": "ERROR", "method": request.method, "path": path,
                "status_code": 500, "duration_ms": duration_ms,
                "client_ip": client_ip, "error": str(exc),
                "traceback": traceback.format_exc(),
                **_extract_user(request),
            })
            raise

        status      = response.status_code
        duration_ms = round((time.perf_counter() - start) * 1000)
        base_event  = {
            "method": request.method, "path": path,
            "query": str(request.url.query) or None,
            "status_code": status, "duration_ms": duration_ms,
            "client_ip": client_ip,
            "user_agent": request.headers.get("user-agent", ""),
            **_extract_user(request),
        }

        if status in (401, 403):
            await log_security({**base_event, "level": "SECURITY"})
            return response

        if status >= 400:
            raw, response = await _read_body(response)
            body_text = raw[:_MAX_BODY].decode("utf-8", errors="replace")
            await log_app_error({**base_event, "level": "ERROR" if status >= 500 else "WARN", "response_body": body_text})
            return response

        raw, response = await _read_body(response)
        await log_web_access({**base_event, "level": "INFO", "response_bytes": len(raw)})
        return response
