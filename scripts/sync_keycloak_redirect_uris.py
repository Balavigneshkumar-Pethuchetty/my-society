#!/usr/bin/env python3
"""
Registers this stack's local origin (http://localhost:$NGINX_PORT) with the
running Keycloak's "society-frontend" client, so sign-in (Google or plain
Keycloak login) works immediately after `make up` regardless of which port
the active env file uses.

Why this is needed: ~/auth-service/keycloak/realm.json is only imported by
Keycloak the first time the realm is created — editing it afterwards never
reaches an already-existing realm (Keycloak logs "Import skipped" on every
later boot). So adding a new NGINX_PORT to that file alone does NOT register
it on the live server; sign-in silently bounces back to the landing page
with no visible error (the token exchange fails client-side because the
redirect_uri/origin isn't in the client's Valid Redirect URIs / Web Origins).

This script closes that gap by talking to the live Keycloak Admin API
directly. Safe to run repeatedly — it only adds the current port's entries
if they're missing, and never removes anything. Never fails `make up`: any
error (Keycloak unreachable, bad credentials, etc.) is printed as a warning
and treated as non-fatal, since Keycloak is an external system managed in
~/auth-service, not part of this stack.

Run via:
    make sync-keycloak-redirect-uris [ENV=dev|test|stage|prod]
(also run automatically as part of `make up`)
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

CLIENT_ID = "society-frontend"


def _parse_dotenv(path: str) -> dict:
    """Parse an env file into a dict, without touching os.environ. Handles CRLF."""
    values: dict = {}
    try:
        with open(path, encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip().rstrip("\r\n").strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                if key:
                    values[key] = val
    except FileNotFoundError:
        pass
    return values


def _load_dotenv(path: str) -> None:
    """Parse an env file and populate os.environ (existing keys take precedence)."""
    for key, val in _parse_dotenv(path).items():
        if key not in os.environ:
            os.environ[key] = val


def _http(method: str, url: str, body=None, token: str | None = None, form: dict | None = None):
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
    elif body is not None:
        data = json.dumps(body).encode()
        headers = {"Content-Type": "application/json"}
    else:
        data = None
        headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            return exc.code, (json.loads(raw) if raw else None)
        except json.JSONDecodeError:
            return exc.code, raw.decode(errors="replace")


def main() -> int:
    env_file = sys.argv[1] if len(sys.argv) > 1 else ".env"

    # KEYCLOAK_PUBLIC_URL/NGINX_PORT are legitimately stack-specific (this env
    # file's own choice of local-mode vs public-mode Keycloak, and its own
    # port), so those come from the event-management env file as normal.
    _load_dotenv(env_file)

    # But Keycloak is one shared instance managed entirely in ~/auth-service
    # (see CLAUDE.md) — there is exactly one real admin login for it, set in
    # that project's own .env. This repo's own .env/.env.dev/.env.test/.env.stage
    # each carry a *copy* of KEYCLOAK_ADMIN_USER/PASSWORD that's easy to drift
    # out of sync with the actual instance (confirmed: .env.test's copy is
    # already wrong) — so always take the admin credentials from the
    # authoritative source instead of trusting the per-stack copy.
    auth_service_env = _parse_dotenv(os.path.expanduser("~/auth-service/.env"))
    if "KEYCLOAK_ADMIN_USER" in auth_service_env:
        os.environ["KEYCLOAK_ADMIN_USER"] = auth_service_env["KEYCLOAK_ADMIN_USER"]
    if "KEYCLOAK_ADMIN_PASSWORD" in auth_service_env:
        os.environ["KEYCLOAK_ADMIN_PASSWORD"] = auth_service_env["KEYCLOAK_ADMIN_PASSWORD"]

    keycloak_url   = os.environ.get("KEYCLOAK_PUBLIC_URL", "https://auth.gm-global-techies-town.club").rstrip("/")
    admin_user     = os.environ.get("KEYCLOAK_ADMIN_USER", "admin")
    admin_password = os.environ.get("KEYCLOAK_ADMIN_PASSWORD", "")
    realm          = os.environ.get("KEYCLOAK_REALM", "society-events")
    nginx_port     = os.environ.get("NGINX_PORT", "8080")

    origin       = f"http://localhost:{nginx_port}"
    redirect_uri = f"{origin}/*"

    try:
        status, body = _http(
            "POST", f"{keycloak_url}/realms/master/protocol/openid-connect/token",
            form={
                "client_id": "admin-cli",
                "grant_type": "password",
                "username": admin_user,
                "password": admin_password,
            },
        )
        if status != 200:
            print(f"  ⚠  Keycloak redirect-URI sync skipped — could not get admin token "
                  f"from {keycloak_url} (HTTP {status}). Sign-in on {origin} may fail "
                  f"until the '{CLIENT_ID}' client is updated manually.")
            return 0
        token = body["access_token"]

        status, clients = _http(
            "GET",
            f"{keycloak_url}/admin/realms/{realm}/clients?clientId={urllib.parse.quote(CLIENT_ID)}",
            token=token,
        )
        if status != 200 or not clients:
            print(f"  ⚠  Keycloak redirect-URI sync skipped — client '{CLIENT_ID}' "
                  f"not found in realm '{realm}' (HTTP {status}).")
            return 0
        client = clients[0]

        redirect_uris = list(client.get("redirectUris") or [])
        web_origins   = list(client.get("webOrigins") or [])
        changed = False

        if redirect_uri not in redirect_uris:
            redirect_uris.append(redirect_uri)
            changed = True
        if origin not in web_origins:
            web_origins.append(origin)
            changed = True

        if not changed:
            print(f"  ✓  Keycloak already accepts sign-in from {origin}")
            return 0

        status, resp_body = _http(
            "PUT", f"{keycloak_url}/admin/realms/{realm}/clients/{client['id']}",
            body={"redirectUris": redirect_uris, "webOrigins": web_origins},
            token=token,
        )
        if status not in (200, 204):
            print(f"  ⚠  Keycloak redirect-URI sync failed (HTTP {status}): {resp_body}")
            return 0

        print(f"  ✓  Registered {origin} with Keycloak ({redirect_uri} + CORS web origin)")
        return 0

    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        print(f"  ⚠  Keycloak redirect-URI sync skipped — {keycloak_url} unreachable ({exc}). "
              f"Sign-in on {origin} may fail until the '{CLIENT_ID}' client is updated manually.")
        return 0


if __name__ == "__main__":
    sys.exit(main())
