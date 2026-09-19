import datetime
import hashlib
import secrets
import uuid as uuid_lib
from uuid import UUID
from typing import Optional
from urllib.parse import urlparse
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from asyncpg import Pool
import httpx

from app.database import get_pool
from app.auth import get_current_claims, require_role
from app.config import settings
from app import crypto
from app.object_storage import delete_object, upload_bytes
from app.notifications import notify_admins, send_channels
from app.otp_bridge import get_oidc_token_for_user
from app.models import (
    UserResponse,
    UserUpdateRequest,
    UserUnitRequest,
    ApartmentAssignRequest,
    RoleUpdateRequest,
    ApartmentResponse,
    UserListResponse,
    ResidentDirectoryEntry,
    ResidentDirectoryResponse,
    ForgotPasswordRequest,
    AdminStatsResponse,
    AdminBreakdown,
    AdminActionResponse,
    PhoneVerifyRequestBody,
    PhoneVerifyRequestResponse,
    PhoneVerifyConfirmRequest,
    PhoneVerifyConfirmResponse,
    TelegramLinkStatusResponse,
    PhoneLoginRequest,
    PhoneLoginRequestResponse,
    PhoneLoginVerifyRequest,
    PhoneLoginVerifyResponse,
    PhoneLoginRefreshRequest,
    PhoneLoginRefreshResponse,
    PhoneLoginLogoutRequest,
)

router = APIRouter()


# ── public: forgot password ───────────────────────────────────────────────────

@router.post("/forgot-password", status_code=204, summary="Send password reset email")
async def forgot_password(body: ForgotPasswordRequest, pool: Pool = Depends(get_pool)):
    email = body.email.strip().lower()

    # Check local DB for is_active / identity_provider guards. email is user
    # input here (not read back from a ciphertext column), so only the lookup
    # needs the blind index — nothing to decrypt.
    async with pool.acquire() as conn:
        db_user = await conn.fetchrow(
            "SELECT id, is_active, identity_provider FROM users WHERE email_hash = $1",
            crypto.blind_index(email),
        )

    # If found in local DB, apply guards; otherwise fall through to Keycloak lookup
    if db_user is not None:
        if not db_user["is_active"]:
            raise HTTPException(
                status_code=403,
                detail="Your account is pending approval or has been deactivated. "
                       "Please contact the administrator.",
            )
        if db_user["identity_provider"] != "keycloak":
            raise HTTPException(
                status_code=400,
                detail="This account uses a social login (Google/GitHub). "
                       "Password reset is not available — sign in via your provider.",
            )

    # Build X-Forwarded-* headers so Keycloak uses the public URL in email links.
    # KC_PROXY_HEADERS=xforwarded means Keycloak trusts these from any caller.
    _parsed = urlparse(settings.keycloak_public_url)
    _scheme = _parsed.scheme
    _port = _parsed.port or (443 if _scheme == "https" else 80)
    _fwd_host = f"{_parsed.hostname}:{_port}" if _port not in (80, 443) else _parsed.hostname
    _proxy_headers = {
        "X-Forwarded-Host":  _fwd_host,
        "X-Forwarded-Proto": _scheme,
        "X-Forwarded-Port":  str(_port),
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            token_resp = await client.post(
                f"{settings.keycloak_url}/realms/master/protocol/openid-connect/token",
                data={
                    "client_id": "admin-cli",
                    "grant_type": "password",
                    "username": settings.keycloak_admin_user,
                    "password": settings.keycloak_admin_password,
                },
                headers=_proxy_headers,
            )
            if token_resp.status_code != 200:
                raise HTTPException(status_code=502, detail="Auth service unavailable")
            admin_token = token_resp.json()["access_token"]
            headers = {"Authorization": f"Bearer {admin_token}", **_proxy_headers}
            realm = settings.keycloak_realm

            search_resp = await client.get(
                f"{settings.keycloak_url}/admin/realms/{realm}/users",
                params={"email": email, "exact": "true"},
                headers=headers,
            )
            kc_users = search_resp.json() if search_resp.status_code == 200 else []
            if not kc_users:
                raise HTTPException(
                    status_code=404,
                    detail="No account found with this email address. Please check and try again.",
                )

            kc_user = kc_users[0]
            if not kc_user.get("enabled", True):
                raise HTTPException(
                    status_code=403,
                    detail="Your account is pending approval or has been deactivated. "
                           "Please contact the administrator.",
                )

            reset_resp = await client.put(
                f"{settings.keycloak_url}/admin/realms/{realm}/users/{kc_user['id']}/execute-actions-email",
                params={"client_id": "society-frontend", "redirect_uri": f"{settings.app_public_url}/"},
                headers=headers,
                json=["UPDATE_PASSWORD"],
            )
            if reset_resp.status_code not in (200, 204):
                raise HTTPException(status_code=502, detail="Could not send reset email. Please try again later.")
    except HTTPException:
        raise
    except (httpx.ConnectError, httpx.TimeoutException):
        raise HTTPException(status_code=503, detail="Authentication service is temporarily unavailable. Please try again in a moment.")


# ── helpers ──────────────────────────────────────────────────────────────────

_USER_COLS = """
    u.id, u.username, u.name, u.email, u.phone, u.avatar_url,
    u.email_verified, u.phone_verified, u.role,
    u.keycloak_sub, u.identity_provider, u.is_active, u.created_at,
    u.structure_node_id, u.theme, u.locale, u.notify_sms, u.notify_email, u.notify_telegram
"""

_AVATAR_TYPES = {"image/jpeg", "image/png", "image/webp"}
_AVATAR_MAX_BYTES = 5 * 1024 * 1024  # 5 MB

_USER_JOIN = ""  # no apartment join — apartments fetched separately via user_apartments


async def _fetch_user_apartments(conn, user_id) -> list:
    from app.models import ApartmentBrief
    rows = await conn.fetch(
        """
        SELECT a.id, a.block, a.unit_number, a.type
        FROM user_apartments ua
        JOIN apartment a ON a.id = ua.apartment_id
        WHERE ua.user_id = $1
        ORDER BY ua.added_at
        """,
        user_id,
    )
    return [
        ApartmentBrief(id=r["id"], block=r["block"], unit_number=r["unit_number"], type=r["type"])
        for r in rows
    ]


async def _fetch_user_units(conn, user_id) -> list:
    rows = await conn.fetch(
        "SELECT node_id FROM user_units WHERE user_id = $1 ORDER BY added_at",
        user_id,
    )
    return [r["node_id"] for r in rows]


def _row_to_user(row, apartments: list, unit_node_ids: list = []) -> UserResponse:
    # Single centralized decrypt point — every endpoint that returns a
    # UserResponse (including internal.py's by-sub/by-ids/by-email, which
    # import this helper) goes through here, so email/phone come back to
    # callers as plaintext exactly like before encryption was added.
    return UserResponse(
        id=row["id"],
        apartments=apartments,
        username=row["username"],
        name=row["name"],
        email=crypto.decrypt(row["email"]),
        phone=crypto.decrypt(row["phone"]),
        avatar_url=row["avatar_url"],
        email_verified=row["email_verified"],
        phone_verified=row["phone_verified"],
        role=row["role"],
        keycloak_sub=row["keycloak_sub"],
        identity_provider=row["identity_provider"],
        is_active=row["is_active"],
        created_at=row["created_at"],
        structure_node_id=row["structure_node_id"],
        unit_node_ids=unit_node_ids,
        theme=row["theme"],
        locale=row["locale"],
        notify_sms=row["notify_sms"],
        notify_email=row["notify_email"],
        notify_telegram=row["notify_telegram"],
    )


# ── sync (upsert on first login) ─────────────────────────────────────────────

@router.post("/sync", response_model=UserResponse, summary="Upsert user from Keycloak JWT")
async def sync_user(
    background_tasks: BackgroundTasks,
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    """
    Called by the frontend immediately after a successful Keycloak login.
    Creates the local users row if it doesn't exist, or refreshes name/email.
    """
    sub = claims.get("sub")
    email = claims.get("email", "")
    first = claims.get("given_name", "")
    last = claims.get("family_name", "")
    name = f"{first} {last}".strip() or claims.get("preferred_username", email)
    email_verified = bool(claims.get("email_verified", False))

    if not sub:
        raise HTTPException(status_code=400, detail="Token missing 'sub' claim")

    email = email or None  # normalise empty string to NULL
    email_ciphertext = crypto.encrypt(email)
    email_hash = crypto.blind_index(email)

    async with pool.acquire() as conn:
        # Check if this email is already registered (by email_hash, the unique constraint).
        # If so, this is a new Keycloak user trying to use an existing email — link them
        # by keycloak_sub and update their name/verified status without touching email/phone.
        existing_by_email = await conn.fetchval(
            "SELECT id FROM users WHERE email_hash = $1",
            email_hash,
        )

        # Check if this keycloak_sub already exists (same user logging in again).
        existing_by_sub = await conn.fetchval(
            "SELECT id FROM users WHERE keycloak_sub = $1",
            sub,
        )

        if existing_by_sub:
            # Same Keycloak user logging in again — refresh name and email_verified only.
            upsert = await conn.fetchrow(
                """
                UPDATE users
                SET name = $1, email_verified = $2
                WHERE keycloak_sub = $3
                RETURNING id, false AS is_new
                """,
                name, email_verified, sub,
            )
        elif existing_by_email:
            # Different Keycloak user claiming an email already in the system.
            # Link them by keycloak_sub (assign this sub to the existing user).
            upsert = await conn.fetchrow(
                """
                UPDATE users
                SET keycloak_sub = $1, name = $2, email_verified = $3
                WHERE id = $4
                RETURNING id, false AS is_new
                """,
                sub, name, email_verified, existing_by_email,
            )
        else:
            # Brand new user — create the row.
            upsert = await conn.fetchrow(
                """
                INSERT INTO users (name, email, email_hash, keycloak_sub, role, is_active, identity_provider, email_verified)
                VALUES ($1, $2, $3, $4, 'resident', FALSE, 'keycloak', $5)
                RETURNING id, true AS is_new
                """,
                name, email_ciphertext, email_hash, sub, email_verified,
            )

        if upsert is None:
            raise HTTPException(status_code=500, detail="Sync upsert returned no row")

        user_id = upsert["id"]

        # Notify all active admins only on brand-new registration
        recipients: list[dict] = []
        message = f"{name} ({email}) has registered and is awaiting approval."
        if upsert["is_new"]:
            recipients = await notify_admins(
                conn, "new_registration", "New User Registration", message, related_id=user_id,
            )

        row = await conn.fetchrow(
            f"SELECT {_USER_COLS} FROM users u WHERE u.id = $1",
            user_id,
        )
        if row is None:
            raise HTTPException(status_code=500, detail="User not found after sync")
        apartments = await _fetch_user_apartments(conn, user_id)
        units = await _fetch_user_units(conn, user_id)

    if recipients:
        background_tasks.add_task(send_channels, recipients, message)
    return _row_to_user(row, apartments, units)


# ── /me endpoints ─────────────────────────────────────────────────────────────

@router.get("/me", response_model=UserResponse, summary="Get own profile")
async def get_me(
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    sub = claims.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Token missing 'sub' claim — add 'basic' scope to Keycloak client")
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"SELECT {_USER_COLS} FROM users u WHERE u.keycloak_sub = $1",
            sub,
        )
        if not row:
            raise HTTPException(status_code=404, detail="User not found — call /users/sync first")
        apartments = await _fetch_user_apartments(conn, row["id"])
        units = await _fetch_user_units(conn, row["id"])
    return _row_to_user(row, apartments, units)


@router.put("/me", response_model=UserResponse, summary="Update own profile")
async def update_me(
    body: UserUpdateRequest,
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    updates: dict = {}
    if body.name is not None:
        updates["name"] = body.name
    if body.username is not None:
        updates["username"] = body.username.strip() if body.username else None
    if "phone" in body.model_fields_set:
        # "" (or explicit null) clears the phone number entirely — frees it up for another
        # resident to register with — distinct from the field being omitted from the request
        # altogether, which leaves whatever's on file untouched. Stored as SQL NULL rather
        # than "" so the UNIQUE constraint doesn't collide the next time someone clears theirs.
        updates["phone"] = body.phone.strip() if body.phone and body.phone.strip() else None
    if body.theme is not None:
        updates["theme"] = body.theme
    if body.locale is not None:
        updates["locale"] = body.locale.strip()[:10] or "en"
    if body.notify_sms is not None:
        updates["notify_sms"] = body.notify_sms
    if body.notify_email is not None:
        updates["notify_email"] = body.notify_email
    if body.notify_telegram is not None:
        updates["notify_telegram"] = body.notify_telegram

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    async with pool.acquire() as conn:
        # Computed once from the plaintext value while it's still in hand —
        # everything below compares/stores the hash, never the plaintext itself.
        new_phone_hash = crypto.blind_index(updates["phone"]) if "phone" in updates else None

        if updates.get("username"):
            taken = await conn.fetchval(
                "SELECT 1 FROM users WHERE username = $1 AND keycloak_sub != $2",
                updates["username"], claims["sub"],
            )
            if taken:
                raise HTTPException(status_code=409, detail=f"Alias name '{updates['username']}' is already taken")

        if updates.get("phone"):
            taken = await conn.fetchval(
                "SELECT 1 FROM users WHERE phone_hash = $1 AND keycloak_sub != $2",
                new_phone_hash, claims["sub"],
            )
            if taken:
                raise HTTPException(status_code=409, detail="Phone number already registered to another user")

        # Verifying a number shouldn't carry over to a different one — but only reset
        # when the number actually changes, not on a same-value re-save (e.g. saving
        # name alone still resends the unchanged phone in the request body).
        if "phone" in updates:
            current = await conn.fetchrow(
                "SELECT phone_hash FROM users WHERE keycloak_sub = $1", claims["sub"]
            )
            if current and new_phone_hash != current["phone_hash"]:
                updates["phone_verified"] = False
            # Encrypt only now that the plaintext comparisons above are done —
            # the column write itself is always ciphertext + hash together.
            updates["phone"] = crypto.encrypt(updates["phone"])
            updates["phone_hash"] = new_phone_hash

        set_parts = [f"{col} = ${i + 2}" for i, col in enumerate(updates)]
        values = list(updates.values())

        row = await conn.fetchrow(
            f"""
            UPDATE users SET {', '.join(set_parts)}
            WHERE keycloak_sub = $1
            RETURNING id
            """,
            claims["sub"], *values,
        )
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        user_id = row["id"]
        row = await conn.fetchrow(
            f"SELECT {_USER_COLS} FROM users u WHERE u.id = $1",
            user_id,
        )
        apartments = await _fetch_user_apartments(conn, user_id)
        units = await _fetch_user_units(conn, user_id)
    return _row_to_user(row, apartments, units)


# ── check username availability ──────────────────────────────────────────────

@router.post("/me/check-username", summary="Check if alias name is available and get suggestions")
async def check_username(
    body: dict,
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    """
    Check if a proposed username is available. If taken, suggest alternatives
    by appending numbers (e.g., john → john1, john2, ...). Returns the first
    available variation found.
    """
    proposed = body.get("username", "").strip()
    if not proposed:
        raise HTTPException(status_code=400, detail="Username cannot be empty")

    async with pool.acquire() as conn:
        # Check if exact username is available
        taken = await conn.fetchval(
            "SELECT 1 FROM users WHERE username = $1 AND keycloak_sub != $2",
            proposed, claims["sub"],
        )
        if not taken:
            return {"available": True, "username": proposed, "suggestions": []}

        # Generate suggestions by appending numbers
        suggestions = []
        for i in range(1, 11):  # Try up to 10 suggestions
            candidate = f"{proposed}{i}"
            available = await conn.fetchval(
                "SELECT 1 FROM users WHERE username = $1",
                candidate,
            )
            if not available:
                suggestions.append(candidate)
                if len(suggestions) >= 3:  # Suggest top 3
                    break

    return {
        "available": False,
        "username": proposed,
        "suggestions": suggestions,
    }


@router.post("/me/avatar", response_model=UserResponse, summary="Upload own profile picture")
async def upload_my_avatar(
    file: UploadFile = File(...),
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    if file.content_type not in _AVATAR_TYPES:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, or WebP images accepted")
    content = await file.read()
    if len(content) > _AVATAR_MAX_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 5 MB)")

    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT id, avatar_url FROM users WHERE keycloak_sub = $1", claims["sub"]
        )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        user_id = user["id"]

        ext = (file.filename or "avatar.jpg").rsplit(".", 1)[-1].lower()
        filename = f"{uuid_lib.uuid4()}.{ext}"
        object_key = f"avatars/{filename}"
        await upload_bytes(object_key, content, file.content_type)

        old_avatar = user["avatar_url"]
        await conn.execute(
            "UPDATE users SET avatar_url = $1 WHERE id = $2",
            object_key, user_id,
        )

        row = await conn.fetchrow(f"SELECT {_USER_COLS} FROM users u WHERE u.id = $1", user_id)
        apartments = await _fetch_user_apartments(conn, user_id)
        units = await _fetch_user_units(conn, user_id)

    if old_avatar:
        try:
            await delete_object(old_avatar)
        except Exception:
            pass  # already gone, or never existed — not worth failing the request over

    return _row_to_user(row, apartments, units)


@router.delete("/me/avatar", response_model=UserResponse, summary="Remove own profile picture")
async def remove_my_avatar(
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT id, avatar_url FROM users WHERE keycloak_sub = $1", claims["sub"]
        )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        user_id = user["id"]
        old_avatar = user["avatar_url"]

        await conn.execute("UPDATE users SET avatar_url = NULL WHERE id = $1", user_id)

        row = await conn.fetchrow(f"SELECT {_USER_COLS} FROM users u WHERE u.id = $1", user_id)
        apartments = await _fetch_user_apartments(conn, user_id)
        units = await _fetch_user_units(conn, user_id)

    if old_avatar:
        try:
            await delete_object(old_avatar)
        except Exception:
            pass

    return _row_to_user(row, apartments, units)


# ── Email verification (delegates to Keycloak's own VERIFY_EMAIL action) ──────

@router.post("/me/verify-email/send", status_code=204, summary="Send Keycloak email-verification link")
async def send_email_verification(
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT keycloak_sub, email, email_verified FROM users WHERE keycloak_sub = $1",
            claims["sub"],
        )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user["email"]:
        raise HTTPException(status_code=400, detail="No email address on file")
    if user["email_verified"]:
        raise HTTPException(status_code=400, detail="Email already verified")

    # Same X-Forwarded-* dance as /forgot-password, so Keycloak's email link points
    # at the public app URL rather than the internal container hostname.
    _parsed = urlparse(settings.keycloak_public_url)
    _scheme = _parsed.scheme
    _port = _parsed.port or (443 if _scheme == "https" else 80)
    _fwd_host = f"{_parsed.hostname}:{_port}" if _port not in (80, 443) else _parsed.hostname
    _proxy_headers = {
        "X-Forwarded-Host":  _fwd_host,
        "X-Forwarded-Proto": _scheme,
        "X-Forwarded-Port":  str(_port),
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            token_resp = await client.post(
                f"{settings.keycloak_url}/realms/master/protocol/openid-connect/token",
                data={
                    "client_id": "admin-cli",
                    "grant_type": "password",
                    "username": settings.keycloak_admin_user,
                    "password": settings.keycloak_admin_password,
                },
                headers=_proxy_headers,
            )
            if token_resp.status_code != 200:
                raise HTTPException(status_code=502, detail="Auth service unavailable")
            admin_token = token_resp.json()["access_token"]
            headers = {"Authorization": f"Bearer {admin_token}", **_proxy_headers}

            resp = await client.put(
                f"{settings.keycloak_url}/admin/realms/{settings.keycloak_realm}"
                f"/users/{user['keycloak_sub']}/execute-actions-email",
                params={"client_id": "society-frontend", "redirect_uri": f"{settings.app_public_url}/"},
                headers=headers,
                json=["VERIFY_EMAIL"],
            )
            if resp.status_code not in (200, 204):
                raise HTTPException(status_code=502, detail="Could not send verification email. Please try again later.")
    except HTTPException:
        raise
    except (httpx.ConnectError, httpx.TimeoutException):
        raise HTTPException(status_code=503, detail="Authentication service is temporarily unavailable. Please try again in a moment.")


@router.post("/me/verify-email/check", response_model=UserResponse, summary="Re-check Keycloak email-verified status")
async def check_email_verification(
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    """
    Keycloak's VERIFY_EMAIL flow completes out-of-band (the user clicks a link
    in a new tab), so our local `email_verified` flag only refreshes on the
    next login/token-refresh. This lets the UI re-check immediately instead
    of waiting for that.
    """
    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT id, keycloak_sub FROM users WHERE keycloak_sub = $1", claims["sub"]
        )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                token_resp = await client.post(
                    f"{settings.keycloak_url}/realms/master/protocol/openid-connect/token",
                    data={
                        "client_id": "admin-cli",
                        "grant_type": "password",
                        "username": settings.keycloak_admin_user,
                        "password": settings.keycloak_admin_password,
                    },
                )
                if token_resp.status_code != 200:
                    raise HTTPException(status_code=502, detail="Auth service unavailable")
                admin_token = token_resp.json()["access_token"]
                kc_resp = await client.get(
                    f"{settings.keycloak_url}/admin/realms/{settings.keycloak_realm}/users/{user['keycloak_sub']}",
                    headers={"Authorization": f"Bearer {admin_token}"},
                )
                kc_resp.raise_for_status()
                verified = bool(kc_resp.json().get("emailVerified", False))
        except HTTPException:
            raise
        except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError):
            raise HTTPException(status_code=503, detail="Authentication service is temporarily unavailable. Please try again in a moment.")

        await conn.execute("UPDATE users SET email_verified = $1 WHERE id = $2", verified, user["id"])
        row = await conn.fetchrow(f"SELECT {_USER_COLS} FROM users u WHERE u.id = $1", user["id"])
        apartments = await _fetch_user_apartments(conn, user["id"])
        units = await _fetch_user_units(conn, user["id"])
    return _row_to_user(row, apartments, units)


# ── Phone verification (delegates OTP generation/storage to ~/auth-service) ───
# Reuses auth-service's turnkey OTP request/verify API rather than building our
# own Redis-backed generation/storage — see its backend/app/otp_service.py.

@router.get(
    "/telegram/link-status",
    response_model=TelegramLinkStatusResponse,
    summary="Check whether a phone number is linked to the Telegram OTP bot",
)
async def telegram_link_status(phone: str = Query(...)):
    """Unauthenticated by design, same trust level as /auth/phone-login/request
    (a phone number, not a secret) — proxies auth-service's own unauthenticated
    GET /api/telegram/link so the browser never needs auth-service's origin or
    its bot username directly."""
    if not settings.auth_service_api_key:
        raise HTTPException(status_code=503, detail="Telegram linking is not configured")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{settings.auth_service_url}/api/telegram/link",
                params={"phone": phone},
            )
    except (httpx.ConnectError, httpx.TimeoutException):
        raise HTTPException(status_code=503, detail="Verification service is temporarily unavailable. Please try again in a moment.")

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Could not check Telegram link status")

    data = resp.json()
    return TelegramLinkStatusResponse(linked=data.get("linked", False), deep_link=data.get("deep_link"))


@router.post(
    "/me/phone/verify/request",
    response_model=PhoneVerifyRequestResponse,
    summary="Request an OTP to verify own phone number",
)
async def request_phone_verification(
    body: PhoneVerifyRequestBody = PhoneVerifyRequestBody(),
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    if not settings.auth_service_api_key:
        raise HTTPException(status_code=503, detail="Phone verification is not configured")

    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT phone, phone_verified FROM users WHERE keycloak_sub = $1", claims["sub"]
        )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    phone = crypto.decrypt(user["phone"])
    if not phone:
        raise HTTPException(status_code=400, detail="No phone number on file")
    if user["phone_verified"]:
        raise HTTPException(status_code=400, detail="Phone already verified")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{settings.auth_service_url}/api/otp/request",
                json={"phone": phone, "channel": body.channel},
                headers={"X-API-Key": settings.auth_service_api_key},
            )
    except (httpx.ConnectError, httpx.TimeoutException):
        raise HTTPException(status_code=503, detail="Verification service is temporarily unavailable. Please try again in a moment.")

    if resp.status_code == 429:
        body = resp.json().get("detail", {})
        return PhoneVerifyRequestResponse(
            ok=False,
            error=(body.get("error") if isinstance(body, dict) else None) or "rate_limited",
            retry_after=body.get("retry_after") if isinstance(body, dict) else None,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Could not send verification code")

    data = resp.json()
    return PhoneVerifyRequestResponse(
        ok=data.get("ok", False),
        request_id=data.get("request_id"),
        expires_in=data.get("expires_in"),
        sent_via=data.get("sent_via"),
        error=data.get("error"),
    )


@router.post(
    "/me/phone/verify/confirm",
    response_model=PhoneVerifyConfirmResponse,
    summary="Confirm the OTP and mark own phone number verified",
)
async def confirm_phone_verification(
    body: PhoneVerifyConfirmRequest,
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    if not settings.auth_service_api_key:
        raise HTTPException(status_code=503, detail="Phone verification is not configured")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{settings.auth_service_url}/api/otp/verify",
                json={"request_id": body.request_id, "code": body.code},
                headers={"X-API-Key": settings.auth_service_api_key},
            )
    except (httpx.ConnectError, httpx.TimeoutException):
        raise HTTPException(status_code=503, detail="Verification service is temporarily unavailable. Please try again in a moment.")

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Could not verify code")

    data = resp.json()
    if not data.get("verified"):
        return PhoneVerifyConfirmResponse(
            verified=False,
            status=data.get("status", "unknown"),
            attempts_remaining=data.get("attempts_remaining"),
        )

    async with pool.acquire() as conn:
        user = await conn.fetchrow("SELECT id FROM users WHERE keycloak_sub = $1", claims["sub"])
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        await conn.execute("UPDATE users SET phone_verified = TRUE WHERE id = $1", user["id"])
        row = await conn.fetchrow(f"SELECT {_USER_COLS} FROM users u WHERE u.id = $1", user["id"])
        apartments = await _fetch_user_apartments(conn, user["id"])
        units = await _fetch_user_units(conn, user["id"])

    return PhoneVerifyConfirmResponse(
        verified=True,
        status="verified",
        user=_row_to_user(row, apartments, units),
    )


# ── Phone-number login (already-registered, already phone-verified users only) ─
# Same auth-service OTP request/verify calls as phone verification above, plus
# a Keycloak token exchange via the otp-bridge service account (app/otp_bridge.py)
# to mint a real access token — no password, no new Keycloak session type.
# Deliberately does not support anonymous signup: a phone with no matching
# phone_verified=TRUE account is rejected before any OTP is sent.

_OTP_LOGIN_SESSION_TTL_SECONDS = 24 * 60 * 60


async def _eligible_login_user(conn, phone: str):
    return await conn.fetchrow(
        """
        SELECT id, keycloak_sub FROM users
        WHERE phone_hash = $1 AND phone_verified = TRUE AND is_active = TRUE
              AND keycloak_sub IS NOT NULL
        """,
        crypto.blind_index(phone),
    )


@router.post(
    "/auth/phone-login/request",
    response_model=PhoneLoginRequestResponse,
    summary="Request an OTP to log in with an already-verified phone number",
)
async def request_phone_login(body: PhoneLoginRequest, pool: Pool = Depends(get_pool)):
    if not settings.auth_service_api_key:
        raise HTTPException(status_code=503, detail="Phone login is not configured")

    phone = body.phone.strip()
    async with pool.acquire() as conn:
        user = await _eligible_login_user(conn, phone)
    if not user:
        return PhoneLoginRequestResponse(ok=False, error="not_eligible")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{settings.auth_service_url}/api/otp/request",
                json={"phone": phone, "channel": body.channel},
                headers={"X-API-Key": settings.auth_service_api_key},
            )
    except (httpx.ConnectError, httpx.TimeoutException):
        raise HTTPException(status_code=503, detail="Login service is temporarily unavailable. Please try again in a moment.")

    if resp.status_code == 429:
        body_json = resp.json().get("detail", {})
        return PhoneLoginRequestResponse(
            ok=False,
            error=(body_json.get("error") if isinstance(body_json, dict) else None) or "rate_limited",
            retry_after=body_json.get("retry_after") if isinstance(body_json, dict) else None,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Could not send login code")

    data = resp.json()
    return PhoneLoginRequestResponse(
        ok=data.get("ok", False),
        request_id=data.get("request_id"),
        expires_in=data.get("expires_in"),
        sent_via=data.get("sent_via"),
        error=data.get("error"),
    )


@router.post(
    "/auth/phone-login/verify",
    response_model=PhoneLoginVerifyResponse,
    summary="Confirm the OTP and obtain a Keycloak session for the verified phone's account",
)
async def verify_phone_login(body: PhoneLoginVerifyRequest, pool: Pool = Depends(get_pool)):
    if not settings.auth_service_api_key:
        raise HTTPException(status_code=503, detail="Phone login is not configured")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{settings.auth_service_url}/api/otp/verify",
                json={"request_id": body.request_id, "code": body.code},
                headers={"X-API-Key": settings.auth_service_api_key},
            )
    except (httpx.ConnectError, httpx.TimeoutException):
        raise HTTPException(status_code=503, detail="Login service is temporarily unavailable. Please try again in a moment.")

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Could not verify code")

    data = resp.json()
    if not data.get("verified"):
        return PhoneLoginVerifyResponse(
            verified=False,
            status=data.get("status", "unknown"),
            attempts_remaining=data.get("attempts_remaining"),
        )

    # Trust only the phone auth-service reports for this request_id — never a
    # client-supplied one — so a verified code for phone A can't be replayed
    # to log in as the account for a different phone B.
    verified_phone = data.get("phone")
    async with pool.acquire() as conn:
        user = await _eligible_login_user(conn, verified_phone) if verified_phone else None
    if not user:
        raise HTTPException(status_code=403, detail="This phone number is not eligible for OTP login")

    try:
        oidc = await get_oidc_token_for_user(user["keycloak_sub"])
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    session_token = secrets.token_urlsafe(32)
    session_hash = hashlib.sha256(session_token.encode()).hexdigest()
    expires_at = datetime.datetime.utcnow() + datetime.timedelta(seconds=_OTP_LOGIN_SESSION_TTL_SECONDS)
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO otp_login_sessions (session_token_hash, keycloak_sub, phone, expires_at)
            VALUES ($1, $2, $3, $4)
            """,
            # Encrypted at rest same as users.phone — this table isn't looked
            # up by phone value (only by session_token_hash), so no blind
            # index needed here, just the ciphertext.
            session_hash, user["keycloak_sub"], crypto.encrypt(verified_phone), expires_at,
        )

    return PhoneLoginVerifyResponse(
        verified=True,
        status="verified",
        access_token=oidc["access_token"],
        expires_in=oidc.get("expires_in"),
        session_token=session_token,
        session_expires_in=_OTP_LOGIN_SESSION_TTL_SECONDS,
    )


@router.post(
    "/auth/phone-login/refresh",
    response_model=PhoneLoginRefreshResponse,
    summary="Silently mint a fresh access token for an active phone-login session",
)
async def refresh_phone_login(body: PhoneLoginRefreshRequest, pool: Pool = Depends(get_pool)):
    session_hash = hashlib.sha256(body.session_token.encode()).hexdigest()
    async with pool.acquire() as conn:
        session = await conn.fetchrow(
            "SELECT keycloak_sub FROM otp_login_sessions WHERE session_token_hash = $1 AND expires_at > now()",
            session_hash,
        )
    if not session:
        raise HTTPException(status_code=401, detail="Session expired or invalid. Please log in again.")

    try:
        oidc = await get_oidc_token_for_user(session["keycloak_sub"])
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return PhoneLoginRefreshResponse(access_token=oidc["access_token"], expires_in=oidc.get("expires_in"))


@router.post("/auth/phone-login/logout", status_code=204, summary="Revoke a phone-login session")
async def logout_phone_login(body: PhoneLoginLogoutRequest, pool: Pool = Depends(get_pool)):
    session_hash = hashlib.sha256(body.session_token.encode()).hexdigest()
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM otp_login_sessions WHERE session_token_hash = $1", session_hash)


@router.post("/me/apartments", response_model=UserResponse, summary="Add an apartment to own profile")
async def add_my_apartment(
    body: ApartmentAssignRequest,
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        apt = await conn.fetchrow(
            "SELECT id FROM apartment WHERE id = $1", body.apartment_id
        )
        if not apt:
            raise HTTPException(status_code=404, detail="Apartment not found")

        user = await conn.fetchrow(
            "SELECT id FROM users WHERE keycloak_sub = $1", claims["sub"]
        )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        user_id = user["id"]

        await conn.execute(
            """
            INSERT INTO user_apartments (user_id, apartment_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
            """,
            user_id, body.apartment_id,
        )

        row = await conn.fetchrow(f"SELECT {_USER_COLS} FROM users u WHERE u.id = $1", user_id)
        apartments = await _fetch_user_apartments(conn, user_id)
        units = await _fetch_user_units(conn, user_id)
    return _row_to_user(row, apartments, units)


@router.delete(
    "/me/apartments/{apartment_id}",
    response_model=UserResponse,
    summary="Remove an apartment from own profile",
)
async def remove_my_apartment(
    apartment_id: UUID,
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT id FROM users WHERE keycloak_sub = $1", claims["sub"]
        )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        user_id = user["id"]

        deleted = await conn.execute(
            "DELETE FROM user_apartments WHERE user_id = $1 AND apartment_id = $2",
            user_id, apartment_id,
        )
        if deleted == "DELETE 0":
            raise HTTPException(status_code=404, detail="Apartment not linked to this user")

        row = await conn.fetchrow(f"SELECT {_USER_COLS} FROM users u WHERE u.id = $1", user_id)
        apartments = await _fetch_user_apartments(conn, user_id)
        units = await _fetch_user_units(conn, user_id)
    return _row_to_user(row, apartments, units)


@router.get(
    "/apartments/list",
    response_model=list[dict],
    summary="List all available apartments in society",
)
async def list_apartments(
    _: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, block, unit_number, type FROM user_svc.apartment WHERE society_id = $1 ORDER BY block, unit_number",
            UUID(settings.society_id),
        )
    return [dict(r) for r in rows]


# ── self-service unit management ─────────────────────────────────────────────
# Privileged callers (admin / committee_member) mutate user_units directly.
# Non-privileged callers get a pending request created instead, keeping the
# many-to-many user_units model intact with proper approval gating.
# Role is resolved from JWT first; local DB role is used as fallback so that
# admins with stale / sparse JWTs are never mis-classified as residents.

def _is_privileged(claims: dict, db_role: Optional[str]) -> bool:
    realm_roles: list[str] = claims.get("realm_access", {}).get("roles", [])
    return any(r in realm_roles for r in ("admin", "committee_member")) or \
           db_role in ("admin", "committee_member")


@router.post("/me/units", response_model=UserResponse, summary="Add a flat/unit to own profile")
async def add_my_unit(
    body: UserUnitRequest,
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT id, role FROM users WHERE keycloak_sub = $1", claims["sub"]
        )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        node = await conn.fetchrow(
            "SELECT id FROM structure_nodes WHERE id = $1", body.node_id
        )
        if not node:
            raise HTTPException(status_code=404, detail="Structure node not found")
        user_id = user["id"]

        if _is_privileged(claims, user["role"]):
            await conn.execute(
                "INSERT INTO user_units (user_id, node_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                user_id, body.node_id,
            )
        else:
            # Non-privileged: submit a pending add request (idempotent)
            existing = await conn.fetchrow(
                "SELECT id FROM unit_assignment_requests "
                "WHERE user_id = $1 AND node_id = $2 AND type = 'add' AND status = 'pending'",
                user_id, body.node_id,
            )
            if not existing:
                await conn.execute(
                    "INSERT INTO unit_assignment_requests (user_id, node_id, type) VALUES ($1, $2, 'add')",
                    user_id, body.node_id,
                )

        row = await conn.fetchrow(f"SELECT {_USER_COLS} FROM users u WHERE u.id = $1", user_id)
        apts = await _fetch_user_apartments(conn, user_id)
        units = await _fetch_user_units(conn, user_id)
    return _row_to_user(row, apts, units)


@router.delete(
    "/me/units/{node_id}",
    response_model=UserResponse,
    summary="Remove a flat/unit from own profile",
)
async def remove_my_unit(
    node_id: UUID,
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT id, role FROM users WHERE keycloak_sub = $1", claims["sub"]
        )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        user_id = user["id"]

        if _is_privileged(claims, user["role"]):
            deleted = await conn.execute(
                "DELETE FROM user_units WHERE user_id = $1 AND node_id = $2",
                user_id, node_id,
            )
            if deleted == "DELETE 0":
                raise HTTPException(status_code=404, detail="Unit not linked to this user")
        else:
            # Non-privileged: submit a pending remove request (idempotent)
            existing = await conn.fetchrow(
                "SELECT id FROM unit_assignment_requests "
                "WHERE user_id = $1 AND node_id = $2 AND type = 'remove' AND status = 'pending'",
                user_id, node_id,
            )
            if not existing:
                await conn.execute(
                    "INSERT INTO unit_assignment_requests (user_id, node_id, type) VALUES ($1, $2, 'remove')",
                    user_id, node_id,
                )

        row = await conn.fetchrow(f"SELECT {_USER_COLS} FROM users u WHERE u.id = $1", user_id)
        apartments = await _fetch_user_apartments(conn, user_id)
        units = await _fetch_user_units(conn, user_id)
    return _row_to_user(row, apartments, units)


# ── admin / committee endpoints ───────────────────────────────────────────────

@router.get(
    "",
    response_model=UserListResponse,
    summary="List all users",
    dependencies=[Depends(require_role("admin", "committee_member"))],
)
async def list_users(
    role: Optional[str] = Query(None, description="Filter by role"),
    active: Optional[bool] = Query(None, description="Filter by is_active"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    pool: Pool = Depends(get_pool),
):
    # Guest placeholder rows (complimentary-ticket recipients with no real account,
    # role='guest', is_active=FALSE) exist only to satisfy FKs on registration/ticket —
    # they must never surface as pending user approvals. Hide them unless a caller
    # explicitly asks for role=guest.
    conditions = ["1=1"]
    params: list = []

    if role is not None:
        params.append(role)
        conditions.append(f"u.role = ${len(params)}")
    else:
        conditions.append("u.role != 'guest'")
    if active is not None:
        params.append(active)
        conditions.append(f"u.is_active = ${len(params)}")

    where = " AND ".join(conditions)

    async with pool.acquire() as conn:
        total = await conn.fetchval(
            f"SELECT COUNT(*) FROM users u WHERE {where}", *params
        )
        rows = await conn.fetch(
            f"""
            SELECT {_USER_COLS} FROM users u
            WHERE {where}
            ORDER BY u.created_at DESC
            LIMIT ${len(params) + 1} OFFSET ${len(params) + 2}
            """,
            *params, limit, offset,
        )
        user_ids = [r["id"] for r in rows]
        apt_rows = await conn.fetch(
            """
            SELECT ua.user_id, a.id, a.block, a.unit_number, a.type
            FROM user_apartments ua
            JOIN apartment a ON a.id = ua.apartment_id
            WHERE ua.user_id = ANY($1::uuid[])
            ORDER BY ua.added_at
            """,
            user_ids,
        ) if user_ids else []
        unit_rows = await conn.fetch(
            "SELECT user_id, node_id FROM user_units WHERE user_id = ANY($1::uuid[]) ORDER BY added_at",
            user_ids,
        ) if user_ids else []

    from collections import defaultdict
    from app.models import ApartmentBrief
    apts_by_user: dict = defaultdict(list)
    for r in apt_rows:
        apts_by_user[r["user_id"]].append(
            ApartmentBrief(id=r["id"], block=r["block"], unit_number=r["unit_number"], type=r["type"])
        )
    units_by_user: dict = defaultdict(list)
    for r in unit_rows:
        units_by_user[r["user_id"]].append(r["node_id"])
    return UserListResponse(
        total=total,
        items=[_row_to_user(r, apts_by_user[r["id"]], units_by_user[r["id"]]) for r in rows],
    )


# ── admin stats (must be before /{user_id} to avoid UUID match on "admin-stats") ──

@router.get(
    "/admin-stats",
    response_model=AdminStatsResponse,
    summary="Per-admin action statistics (admin / committee_member)",
    dependencies=[Depends(require_role("admin", "committee_member"))],
)
async def get_admin_stats(pool: Pool = Depends(get_pool)):
    async with pool.acquire() as conn:
        total_pending = await conn.fetchval(
            "SELECT COUNT(*) FROM users WHERE is_active = FALSE AND role != 'guest'"
        )
        counts = {r["action"]: r["cnt"] for r in await conn.fetch(
            "SELECT action, COUNT(*) AS cnt FROM admin_actions GROUP BY action"
        )}
        breakdown = await conn.fetch(
            """
            SELECT admin_id, admin_name,
                   COUNT(*) FILTER (WHERE action = 'approved') AS approved,
                   COUNT(*) FILTER (WHERE action = 'rejected') AS rejected,
                   COUNT(*) FILTER (WHERE action = 'removed')  AS removed,
                   COUNT(*) FILTER (WHERE action = 'revoked')  AS revoked
            FROM admin_actions
            GROUP BY admin_id, admin_name
            ORDER BY COUNT(*) DESC
            """
        )
        recent = await conn.fetch(
            """
            SELECT a.id, a.admin_name, a.target_user_name, a.target_user_email, a.action, a.role, a.performed_at,
                   u.username
            FROM admin_actions a
            LEFT JOIN users u ON a.target_user_id = u.id
            ORDER BY a.performed_at DESC LIMIT 20
            """
        )
    return AdminStatsResponse(
        total_pending=total_pending,
        total_approved=counts.get("approved", 0),
        total_rejected=counts.get("rejected", 0),
        total_removed=counts.get("removed", 0),
        total_revoked=counts.get("revoked", 0),
        by_admin=[AdminBreakdown(
            admin_id=r["admin_id"], admin_name=r["admin_name"],
            approved=r["approved"], rejected=r["rejected"],
            removed=r["removed"],  revoked=r["revoked"],
        ) for r in breakdown],
        recent_actions=[AdminActionResponse(
            id=r["id"], admin_name=r["admin_name"],
            target_user_name=r["target_user_name"], target_user_username=r["username"],
            target_user_email=crypto.decrypt(r["target_user_email"]),
            action=r["action"], role=r["role"], performed_at=r["performed_at"],
        ) for r in recent],
    )


# ── resident directory (must be before /{user_id} to avoid UUID match on "directory") ──
# Lets security call any resident directly in an emergency (fire, medical, etc.) —
# not just residents tied to a visitor pass that happens to be active right now.
# Deliberately a minimal field set (name/phone/unit only, no email/keycloak_sub/
# apartments) rather than reusing GET /users's full admin listing.

@router.get(
    "/directory",
    response_model=ResidentDirectoryResponse,
    summary="Flat-holder directory (name/unit/phone) — for security to call in an emergency",
    dependencies=[Depends(require_role("admin", "committee_member", "security_guard"))],
)
async def resident_directory(pool: Pool = Depends(get_pool)):
    async with pool.acquire() as conn:
        # Anyone with a flat on record — not just role='resident'. Admins,
        # committee members, etc. can be linked to a flat too and should be
        # just as reachable in an emergency; 'guest' is excluded since those
        # are placeholder rows for complimentary tickets, never real accounts.
        # A user can be linked to more than one flat (user_units/user_apartments
        # are both many-to-many) — aggregate every distinct label instead of
        # arbitrarily picking one. The join to `flats` (not LEFT JOIN) is what
        # excludes anyone with no flat on record at all.
        rows = await conn.fetch(
            """
            WITH flat_labels AS (
                SELECT uu.user_id, sn.name AS label
                FROM user_units uu JOIN structure_nodes sn ON sn.id = uu.node_id
                UNION
                SELECT ua.user_id, a.block || ' – ' || a.unit_number AS label
                FROM user_apartments ua JOIN apartment a ON a.id = ua.apartment_id
                UNION
                SELECT u.id, sn.name AS label
                FROM users u JOIN structure_nodes sn ON sn.id = u.structure_node_id
                WHERE u.structure_node_id IS NOT NULL
            ),
            flats AS (
                SELECT user_id, STRING_AGG(DISTINCT label, ', ' ORDER BY label) AS unit_label
                FROM flat_labels
                GROUP BY user_id
            )
            SELECT u.id, u.name, u.phone, flats.unit_label
            FROM users u
            JOIN flats ON flats.user_id = u.id
            WHERE u.is_active = TRUE AND u.role != 'guest'
            ORDER BY u.name
            LIMIT 500
            """
        )
    return ResidentDirectoryResponse(items=[
        ResidentDirectoryEntry(id=r["id"], name=r["name"], phone=crypto.decrypt(r["phone"]), unit_label=r["unit_label"])
        for r in rows
    ])


@router.get(
    "/{user_id}",
    response_model=UserResponse,
    summary="Get user by ID",
)
async def get_user(
    user_id: UUID,
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    realm_roles = claims.get("realm_access", {}).get("roles", [])
    is_privileged = any(r in realm_roles for r in ("admin", "committee_member"))

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"SELECT {_USER_COLS} FROM users u WHERE u.id = $1",
            user_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        # Residents can only see their own profile
        if not is_privileged and str(row["keycloak_sub"]) != claims.get("sub"):
            raise HTTPException(status_code=403, detail="Access denied")
        apartments = await _fetch_user_apartments(conn, user_id)
    return _row_to_user(row, apartments)


@router.patch(
    "/{user_id}/role",
    response_model=UserResponse,
    summary="Update user role (admin only)",
    dependencies=[Depends(require_role("admin"))],
)
async def update_role(
    user_id: UUID,
    body: RoleUpdateRequest,
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        user_info = await conn.fetchrow(
            "SELECT name, email, keycloak_sub, role FROM users WHERE id = $1", user_id
        )
        if not user_info:
            raise HTTPException(status_code=404, detail="User not found")
        old_role = user_info["role"]
        row = await conn.fetchrow(
            "UPDATE users SET role = $1 WHERE id = $2 RETURNING id",
            body.role, user_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        await _record_action(
            conn, claims, user_id,
            user_info["name"], user_info["email"],
            "role_changed", body.role,
        )
        row = await conn.fetchrow(
            f"SELECT {_USER_COLS} FROM users u WHERE u.id = $1",
            row["id"],
        )
        apartments = await _fetch_user_apartments(conn, user_id)

    # Sync role change to Keycloak so the user's next JWT reflects the new role
    if user_info["keycloak_sub"]:
        await _keycloak_update_role(user_info["keycloak_sub"], old_role, body.role)

    return _row_to_user(row, apartments)


@router.patch(
    "/{user_id}/active",
    response_model=UserResponse,
    summary="Activate or deactivate a user (admin only)",
    dependencies=[Depends(require_role("admin"))],
)
async def set_active(
    user_id: UUID,
    is_active: bool = Query(...),
    pool: Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE users SET is_active = $1 WHERE id = $2 RETURNING id",
            is_active, user_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        row = await conn.fetchrow(
            f"SELECT {_USER_COLS} FROM users u WHERE u.id = $1",
            row["id"],
        )
        apartments = await _fetch_user_apartments(conn, user_id)
    return _row_to_user(row, apartments)


# ── Keycloak admin helper ─────────────────────────────────────────────────────

async def _keycloak_assign_role(keycloak_sub: str, role_name: str) -> None:
    """Assign a realm role to a Keycloak user via the Admin REST API."""
    base = f"{settings.keycloak_url}/realms/master/protocol/openid-connect/token"

    async with httpx.AsyncClient(timeout=10) as client:
        # 1. Obtain admin token from the master realm
        resp = await client.post(base, data={
            "client_id": "admin-cli",
            "grant_type": "password",
            "username": settings.keycloak_admin_user,
            "password": settings.keycloak_admin_password,
        })
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Keycloak admin token failed: {resp.text}")
        admin_token = resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {admin_token}"}
        realm = settings.keycloak_realm

        # 2. Look up the realm role by name
        role_resp = await client.get(
            f"{settings.keycloak_url}/admin/realms/{realm}/roles/{role_name}",
            headers=headers,
        )
        if role_resp.status_code == 404:
            raise HTTPException(status_code=400, detail=f"Keycloak role '{role_name}' not found")
        role_resp.raise_for_status()
        role_rep = role_resp.json()

        # 3. Assign the role to the user (keycloak_sub == Keycloak user UUID)
        assign_resp = await client.post(
            f"{settings.keycloak_url}/admin/realms/{realm}/users/{keycloak_sub}/role-mappings/realm",
            headers=headers,
            json=[{"id": role_rep["id"], "name": role_rep["name"]}],
        )
        if assign_resp.status_code not in (200, 204):
            raise HTTPException(status_code=502, detail=f"Keycloak role assign failed: {assign_resp.text}")


_APP_ROLES = {"admin", "committee_member", "resident", "security_guard", "sponsor", "pending"}


async def _keycloak_update_role(keycloak_sub: str, old_role: str | None, new_role: str) -> None:
    """Remove the old app role and assign the new one in Keycloak."""
    base = f"{settings.keycloak_url}/realms/master/protocol/openid-connect/token"

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(base, data={
            "client_id": "admin-cli",
            "grant_type": "password",
            "username": settings.keycloak_admin_user,
            "password": settings.keycloak_admin_password,
        })
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Keycloak admin token failed: {resp.text}")
        admin_token = resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {admin_token}"}
        realm = settings.keycloak_realm
        mappings_url = f"{settings.keycloak_url}/admin/realms/{realm}/users/{keycloak_sub}/role-mappings/realm"

        # Remove the old role if it's one of our app roles
        if old_role and old_role in _APP_ROLES and old_role != new_role:
            old_resp = await client.get(
                f"{settings.keycloak_url}/admin/realms/{realm}/roles/{old_role}",
                headers=headers,
            )
            if old_resp.status_code == 200:
                old_rep = old_resp.json()
                await client.request(
                    "DELETE", mappings_url, headers=headers,
                    json=[{"id": old_rep["id"], "name": old_rep["name"]}],
                )

        # Assign the new role
        new_resp = await client.get(
            f"{settings.keycloak_url}/admin/realms/{realm}/roles/{new_role}",
            headers=headers,
        )
        if new_resp.status_code == 404:
            raise HTTPException(status_code=400, detail=f"Keycloak role '{new_role}' not found")
        new_resp.raise_for_status()
        new_rep = new_resp.json()
        assign = await client.post(
            mappings_url, headers=headers,
            json=[{"id": new_rep["id"], "name": new_rep["name"]}],
        )
        if assign.status_code not in (200, 204):
            raise HTTPException(status_code=502, detail=f"Keycloak role assign failed: {assign.text}")


# ── additional Keycloak helpers ──────────────────────────────────────────────

async def _keycloak_delete_user(keycloak_sub: str) -> None:
    """Delete a user from Keycloak entirely."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{settings.keycloak_url}/realms/master/protocol/openid-connect/token",
            data={"client_id": "admin-cli", "grant_type": "password",
                  "username": settings.keycloak_admin_user, "password": settings.keycloak_admin_password},
        )
        if resp.status_code != 200:
            return
        headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}
        await client.delete(
            f"{settings.keycloak_url}/admin/realms/{settings.keycloak_realm}/users/{keycloak_sub}",
            headers=headers,
        )


async def _keycloak_remove_all_realm_roles(keycloak_sub: str) -> None:
    """Strip all managed realm roles from a Keycloak user (revoke)."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{settings.keycloak_url}/realms/master/protocol/openid-connect/token",
            data={"client_id": "admin-cli", "grant_type": "password",
                  "username": settings.keycloak_admin_user, "password": settings.keycloak_admin_password},
        )
        if resp.status_code != 200:
            return
        headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}
        realm = settings.keycloak_realm
        roles_resp = await client.get(
            f"{settings.keycloak_url}/admin/realms/{realm}/users/{keycloak_sub}/role-mappings/realm",
            headers=headers,
        )
        if roles_resp.status_code != 200:
            return
        managed = [r for r in roles_resp.json()
                   if not r["name"].startswith("default-")
                   and r["name"] not in ("offline_access", "uma_authorization")]
        if managed:
            await client.delete(
                f"{settings.keycloak_url}/admin/realms/{realm}/users/{keycloak_sub}/role-mappings/realm",
                headers=headers, json=managed,
            )


async def _record_action(
    conn,
    claims: dict,
    target_user_id,
    target_name: str,
    target_email: str,
    action: str,
    role: Optional[str] = None,
) -> None:
    """Insert a row into admin_actions for persistent audit tracking."""
    sub = claims.get("sub")
    admin = await conn.fetchrow("SELECT id, name FROM users WHERE keycloak_sub = $1", sub)
    admin_id   = admin["id"]   if admin else None
    admin_name = admin["name"] if admin else claims.get("preferred_username", "Unknown Admin")
    await conn.execute(
        """
        INSERT INTO admin_actions
            (admin_id, admin_name, target_user_id, target_user_name, target_user_email, action, role)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        """,
        admin_id, admin_name, target_user_id, target_name, target_email, action, role,
    )


# ── approval endpoints ────────────────────────────────────────────────────────

@router.post(
    "/{user_id}/approve",
    response_model=UserResponse,
    summary="Approve a pending user (admin only)",
    dependencies=[Depends(require_role("admin"))],
)
async def approve_user(
    user_id: UUID,
    body: RoleUpdateRequest,
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, name, email, keycloak_sub FROM users WHERE id = $1",
            user_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        if not row["keycloak_sub"]:
            raise HTTPException(status_code=400, detail="User has no Keycloak sub — cannot assign role")

        await _keycloak_assign_role(row["keycloak_sub"], body.role)

        updated = await conn.fetchrow(
            "UPDATE users SET role = $1, is_active = TRUE WHERE id = $2 RETURNING id",
            body.role, user_id,
        )
        if not updated:
            raise HTTPException(status_code=500, detail="Update failed")

        await _record_action(conn, claims, user_id, row["name"], row["email"], "approved", body.role)
        await conn.execute(
            "DELETE FROM core.notification WHERE type = 'new_registration' AND related_id = $1", user_id
        )

        full = await conn.fetchrow(
            f"SELECT {_USER_COLS} FROM users u WHERE u.id = $1",
            updated["id"],
        )
        apartments = await _fetch_user_apartments(conn, updated["id"])
    return _row_to_user(full, apartments)


@router.delete(
    "/{user_id}/reject",
    status_code=204,
    summary="Reject and remove a pending user (admin only)",
    dependencies=[Depends(require_role("admin"))],
)
async def reject_user(
    user_id: UUID,
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        user_row = await conn.fetchrow(
            "SELECT id, name, email FROM users WHERE id = $1 AND is_active = FALSE",
            user_id,
        )
        if not user_row:
            raise HTTPException(status_code=404, detail="Pending user not found")
        await conn.execute(
            "DELETE FROM core.notification WHERE type = 'new_registration' AND related_id = $1", user_id
        )
        await conn.execute("DELETE FROM users WHERE id = $1", user_id)
        await _record_action(conn, claims, None, user_row["name"], user_row["email"], "rejected")


@router.delete(
    "/{user_id}",
    status_code=204,
    summary="Permanently remove an active user (admin only)",
    dependencies=[Depends(require_role("admin"))],
)
async def remove_user(
    user_id: UUID,
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, name, email, keycloak_sub FROM users WHERE id = $1",
            user_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        await conn.execute("DELETE FROM users WHERE id = $1", user_id)
        await _record_action(conn, claims, None, row["name"], row["email"], "removed")

    if row["keycloak_sub"]:
        try:
            await _keycloak_delete_user(row["keycloak_sub"])
        except Exception:
            pass


@router.patch(
    "/{user_id}/revoke",
    response_model=UserResponse,
    summary="Revoke access for an active user (admin only)",
    dependencies=[Depends(require_role("admin"))],
)
async def revoke_user(
    user_id: UUID,
    claims: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"SELECT {_USER_COLS} FROM users u {_USER_JOIN} WHERE u.id = $1",
            user_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        await conn.execute("UPDATE users SET is_active = FALSE WHERE id = $1", user_id)
        await _record_action(conn, claims, user_id, row["name"], row["email"], "revoked")
        full = await conn.fetchrow(
            f"SELECT {_USER_COLS} FROM users u WHERE u.id = $1", user_id,
        )
        apartments = await _fetch_user_apartments(conn, user_id)

    if row["keycloak_sub"]:
        try:
            await _keycloak_remove_all_realm_roles(row["keycloak_sub"])
        except Exception:
            pass

    return _row_to_user(full, apartments)


# ── apartments ────────────────────────────────────────────────────────────────

@router.get(
    "/apartments/list",
    response_model=list[ApartmentResponse],
    summary="List all apartments in the society",
)
async def list_apartments(
    _: dict = Depends(get_current_claims),
    pool: Pool = Depends(get_pool),
):
    from app.config import settings
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, society_id, block, unit_number, type FROM apartment "
            "WHERE society_id = $1 ORDER BY block, unit_number",
            UUID(settings.society_id),
        )
    return [ApartmentResponse(**dict(r)) for r in rows]
