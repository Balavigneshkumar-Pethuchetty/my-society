# Society Events — Local Development Stack

One `make up` gets you a fully seeded database, OAuth 2.0, a DB GUI, Redis —
everything you need on any machine, from first clone to working login in
under five minutes.

---

## Prerequisites

| Tool | Min version | Install |
|------|-------------|---------|
| Docker Desktop | 24+ | https://docs.docker.com/get-docker/ |
| Docker Compose | v2 (bundled) | included with Docker Desktop |
| GNU Make | any | `sudo apt install make` / Homebrew `make` |
| Python 3 | 3.10+ | https://python.org (used by a few setup scripts) |

> **WSL2 users (Windows):** Docker Desktop with WSL2 backend works. Open the
> project in Windows Terminal from inside the WSL2 distro, not from
> PowerShell/CMD.

---

## Quick start (any machine — owner or junior)

```bash
# 1. Clone / copy the project
git clone <repo-url> my-society
cd my-society

# 2. Create env file from the example
cp .env.example .env
#    Review .env and adjust passwords if running on a shared machine.
#    (The defaults work fine for local dev.)

# 3. Start the core stack
make up
#    First boot pulls images and builds containers — allow ~3 min.
#    Keycloak alone takes ~60 s to initialise its database.
make ps   # watch until all services show "healthy"
```

That's it — everything is live.

---

## Service URLs (default ENV=prod)

> All services are served through nginx on `NGINX_PORT` (default **8080**).
> Keycloak admin is accessible directly on `KEYCLOAK_PORT` (**8081**).

| Service | URL | Credentials |
|---------|-----|-------------|
| **App** | http://localhost:8080/ | —  |
| **Keycloak admin** | http://localhost:8081/admin/ | `KEYCLOAK_ADMIN_USER/PASSWORD` in `.env` |
| **pgAdmin** | http://localhost:8080/pgadmin/ | `PGADMIN_EMAIL/PASSWORD` in `.env` |
| **Splunk** | http://localhost:8080/splunk/ | `SPLUNK_PASSWORD` in `.env` |
| **User API docs** | http://localhost:8080/api/users/docs | — |
| **Event API docs** | http://localhost:8080/api/events/docs | — |

---

## Test accounts (Keycloak realm: `society-events`)

All passwords: **Test@1234**

| Name | Email | Role |
|------|-------|------|
| Rajesh Iyer | rajesh.iyer@pvh-blr.in | admin |
| Meera Krishnan | meera.krishnan@gmail.com | committee_member |
| Arjun Sharma | arjun.sharma@gmail.com | resident |
| Priya Nair | priya.nair@gmail.com | resident |
| Sanjay Mehta | sanjay.mehta@outlook.com | resident |
| Vikram Patel | vikram.patel@gmail.com | resident (NRI — USD payments) |

---

## All Make targets

```bash
# ── Core lifecycle ─────────────────────────────────────────
make up                  # start all services (builds if needed)
make down                # stop containers (data preserved in volumes)
make restart             # rebuild and restart all
make reset               # ⚠ wipe volumes + restart fresh
make ps                  # health status of all containers
make logs                # follow all logs
make validate-ports      # check for port conflicts in .env

# ── Individual service restarts ────────────────────────────
make restart-nginx           # rebuild nginx (picks up nginx.conf changes)
make restart-keycloak        # restart Keycloak (picks up theme/realm changes)
make restart-user-service    # rebuild user service
make restart-event-service   # rebuild event service

# ── Database ───────────────────────────────────────────────
make shell-db            # open psql in society_events
make shell-redis         # open redis-cli
make seed                # re-run seed SQL (idempotent)
make migrate             # run all db/migrations/*.sql (idempotent)

# ── Logs ───────────────────────────────────────────────────
make logs-nginx    make logs-kc    make logs-db
make logs-user     make logs-events

# ── Frontend dev (without Docker) ─────────────────────────
make frontend            # hot-reload shell app on http://localhost:3000
make frontend-install    # npm install only

# ── Monitoring (stage/prod) ────────────────────────────────
make monitoring-up ENV=stage
make monitoring-down ENV=stage
```

---

## Architecture overview

```
Browser
  └─► Nginx (port 8080)
        ├─► /                → frontend shell (React + MFEs)
        ├─► /realms/         → Keycloak (OIDC/OAuth2)
        ├─► /api/users/      → User Service (FastAPI, port 3001)
        └─► /api/events/     → Event Service (FastAPI, port 3002)

Keycloak (port 8081, direct) ──► PostgreSQL (port 5432)
```

---

## Directory layout

```
society-events/
├── Makefile                        ← all dev commands
├── docker-compose.yml              ← all services
├── .env.example                    ← template for .env
├── db/
│   ├── init/
│   │   ├── 00_create_keycloak_db.sh   ← creates keycloak DB on first boot
│   │   ├── 01_schema.sql              ← all DDL + indexes
│   │   └── 02_seed.sql                ← dummy users + society data
│   └── migrations/
│       └── 002_mobile_otp.sql         ← username col, nullable email, unique phone
├── services/
│   ├── user/                       ← User Service (FastAPI)
│   └── event/                      ← Event Service (FastAPI)
├── frontend/
│   └── shell/
│       └── src/
│           ├── contexts/
│           │   └── AuthContext.tsx  ← Keycloak SSO auth
│           └── pages/
│               └── Landing.tsx     ← sign-in buttons
├── keycloak/
│   └── realm.json
└── nginx/
    └── nginx.conf
```

---

## Keycloak OAuth 2.0 integration notes

The realm has two clients:

**`society-frontend`** (public, PKCE) — React shell and MFEs.

```js
const keycloak = new Keycloak({
  url: 'http://localhost:8080',   // nginx proxies /realms/ to Keycloak
  realm: 'society-events',
  clientId: 'society-frontend',
});
await keycloak.init({ onLoad: 'check-sso', pkceMethod: 'S256' });
```

**`society-api`** (confidential, service account) — backend inter-service calls. Validates tokens via:

```
http://keycloak:8081/realms/society-events/protocol/openid-connect/certs
```

---

## Environment variables reference

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `NGINX_PORT` | yes | `8080` | Host port for nginx (all browser traffic) |
| `KEYCLOAK_PORT` | yes | `8081` | Keycloak HTTP port (direct access only) |
| `POSTGRES_USER/PASSWORD` | yes | — | PostgreSQL credentials |
| `REDIS_PASSWORD` | yes | — | Redis auth password |
| `KEYCLOAK_ADMIN_USER/PASSWORD` | yes | — | Keycloak master realm admin |
| `KEYCLOAK_API_CLIENT_SECRET` | yes | — | `society-api` client secret |
| `GOOGLE_CLIENT_ID/SECRET` | no | — | Enables Google social login |
| `GMAIL_SMTP_USER/APP_PASSWORD` | no | — | Keycloak outbound email |

---

## Payment gateway — Razorpay test mode

1. Sign up free at https://dashboard.razorpay.com → Test mode
2. Copy your test `key_id` and `key_secret`
3. Add to `.env`:
   ```
   RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
   RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
   ```
4. Test card: `4111 1111 1111 1111`, any future date, CVV `123`
5. UPI test: `success@razorpay`

---

## Resetting the database

```bash
make reset    # ⚠ destroys all volumes, reinitialises schema + seed
```

To only re-seed without wiping volumes:

```bash
make seed     # idempotent — safe to run many times
```

To re-run schema migrations only:

```bash
make migrate  # runs all db/migrations/*.sql in order (each is idempotent)
```
