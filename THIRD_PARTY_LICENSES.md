# Third-Party Software Inventory & Licenses

**Project:** Society Events — GM Global Techies Town  
**Last updated:** 2026-08-29  
**Purpose:** Software audit reference — lists every third-party dependency, its version,
licence, and any usage restrictions.

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ OSS | Open Source Software — source code publicly available |
| ⚠️ Proprietary | Closed-source; free tier used — review limits before scaling |
| 🔒 Service | Third-party hosted service; subject to provider ToS |

---

## 1. Infrastructure / Runtime (Docker images)

| Component | Version | Licence | Status | Notes |
|-----------|---------|---------|--------|-------|
| **Python** | 3.12-slim | PSF Licence (MIT-compatible) | ✅ OSS | Base image for User Service and Event Service |
| **PostgreSQL** | 16-alpine | PostgreSQL Licence (MIT-style) | ✅ OSS | Primary database; owns all application tables |
| **Redis** | 7-alpine | BSD 3-Clause | ✅ OSS | Provisioned in `docker-compose.yml` (`make shell-redis`); **not currently connected to by any service** — no application code opens a Redis client. Reserved for future session cache / rate limiting. |
| **nginx** | 1.27-alpine | BSD 2-Clause | ✅ OSS | API Gateway — routing, rate limiting, security headers |
| **Keycloak** | 25.0 | Apache 2.0 | ✅ OSS | Identity & Access Management; OIDC/OAuth2 provider |
| **pgAdmin 4** | 8 | PostgreSQL Licence | ✅ OSS | Database GUI; restricted to local network via nginx |
| **Fluent Bit** | 3.1 | Apache 2.0 | ✅ OSS | Log shipper — forwards nginx access logs to Splunk |
| **Splunk** | 9.3.1 | **Proprietary** | ⚠️ Proprietary | See Section 7 — free tier limited to 500 MB/day |
| **cloudflared** | latest | Apache 2.0 | ✅ OSS | Cloudflare Tunnel client (open-source agent) |

---

## 2. Backend — Python Services (User Service & Event Service)

| Package | Version | Licence | Usage |
|---------|---------|---------|-------|
| **FastAPI** | 0.115.6 | MIT | REST API framework for both services |
| **uvicorn** | 0.34.0 | BSD 3-Clause | ASGI server running FastAPI |
| **asyncpg** | 0.30.0 | Apache 2.0 | Async PostgreSQL driver |
| **pydantic** | 2.10.4 | MIT | Request/response data validation and serialisation |
| **pydantic-settings** | 2.7.1 | MIT | Environment variable configuration management |
| **python-jose** | 3.3.0 | MIT | JWT decoding and validation against Keycloak JWKS |
| **httpx** | 0.28.1 | BSD 3-Clause | Async HTTP client — Keycloak Admin API calls, Splunk HEC |

All Python packages are available on [PyPI](https://pypi.org) and are ✅ Open Source.

---

## 3. Frontend — Shell App & All MFEs

### Runtime dependencies (shipped to the browser)

| Package | Version | Licence | Usage |
|---------|---------|---------|-------|
| **React** | 18.3.1 | MIT | UI component framework |
| **React DOM** | 18.3.1 | MIT | DOM renderer for React |
| **React Router DOM** | 6.24.1 | MIT | Client-side routing in Shell App |
| **Material UI (MUI)** | 5.16.7 | MIT | Component library — all UI elements |
| **MUI Icons Material** | 5.16.7 | MIT | Icon set used throughout the app |
| **@emotion/react** | 11.13.0 | MIT | CSS-in-JS runtime (MUI dependency) |
| **@emotion/styled** | 11.13.0 | MIT | Styled components (MUI dependency) |
| **keycloak-js** | 25.0.6 | Apache 2.0 | Keycloak JavaScript adapter — OIDC login/logout/token refresh |
| **Leaflet** | 1.9.4 | BSD 2-Clause | Interactive map with draggable venue pin (admin portal) |
| **react-leaflet** | 4.2.1 | BSD 2-Clause | React bindings for Leaflet |

### Build / dev-only dependencies (not shipped to users)

| Package | Version | Licence | Usage |
|---------|---------|---------|-------|
| **Vite** | 5.3.3 | MIT | Build tool and dev server |
| **@vitejs/plugin-react** | 4.3.1 | MIT | Vite plugin for React / Fast Refresh |
| **@originjs/vite-plugin-federation** | 1.3.5 | MIT | Module Federation — shell host + 4 MFE remotes |
| **TypeScript** | 5.5.3 | Apache 2.0 | Static type checking |
| **@types/react** | 18.3.3 | MIT | TypeScript type definitions for React |
| **@types/react-dom** | 18.3.0 | MIT | TypeScript type definitions for React DOM |
| **@types/leaflet** | 1.9.21 | MIT | TypeScript type definitions for Leaflet |

All frontend packages are available on [npm](https://npmjs.com) and are ✅ Open Source.

---

## 4. Mapping & Geocoding Services

| Service | Provider | Licence / ToS | Status | Notes |
|---------|----------|---------------|--------|-------|
| **OpenStreetMap tiles** | OpenStreetMap Foundation | ODbL 1.0 | ✅ OSS | Tile server used inside the Leaflet interactive map. Attribution displayed automatically. |
| **Nominatim geocoding** | OpenStreetMap Foundation | ODbL 1.0 | ✅ OSS | Address → coordinates lookup when organiser sets venue location. Rate limit: 1 req/s per IP on the public instance. For high volume, self-host or use a commercial provider. |
| **Google Maps** (deep link) | Google LLC | Google ToS | 🔒 Service | Used only as a navigation link (`google.com/maps?q=lat,lng`). No API key used; no Maps JavaScript API calls. |
| **Apple Maps** (deep link) | Apple Inc. | Apple ToS | 🔒 Service | Navigation deep link only (`maps.apple.com/?q=lat,lng`). |
| **Bing Maps** (deep link) | Microsoft | Microsoft ToS | 🔒 Service | Navigation deep link only. |

---

## 5. Authentication & Identity Services

| Service | Provider | Licence / ToS | Status | Notes |
|---------|----------|---------------|--------|-------|
| **Keycloak** | Red Hat / Community | Apache 2.0 | ✅ OSS | Self-hosted on `society_net`. Full control over user data. |
| **Google OAuth 2.0** | Google LLC | Google API ToS | 🔒 Service | Social login ("Sign in with Google"). OAuth 2.0 / OIDC broker configured inside Keycloak. No user data stored on Google beyond the initial authentication. |

---

## 6. Infrastructure Services

| Service | Provider | Licence / ToS | Status | Notes |
|---------|----------|---------------|--------|-------|
| **Cloudflare Tunnel** | Cloudflare Inc. | Cloudflare ToS | 🔒 Service | Exposes the local nginx to the public domain without opening inbound ports. Tunnel agent (`cloudflared`) is Apache 2.0 open source; the Cloudflare network itself is proprietary. Free tier used. |
| **Gmail SMTP** | Google LLC | Google ToS | 🔒 Service | Outbound email for Keycloak — password resets and account notifications. Uses an App Password (not the account password). |

---

## 7. ⚠️ Splunk — Proprietary Software Notice

**Product:** Splunk Enterprise (Docker image `splunk/splunk:9.3.1`)  
**Licence:** Proprietary — [Splunk General Terms](https://www.splunk.com/en_us/legal/splunk-general-terms.html)  
**Edition in use:** Developer / Free Tier  

### Free Tier Limits

| Limit | Value |
|-------|-------|
| Daily indexing volume | **500 MB / day** |
| Users | Unlimited |
| Search & alerting | Full feature set |
| Licence enforcement | Splunk stops indexing (does not crash) when limit is reached |

### How Splunk is used in this project

- **`society_web_access` index** — successful API request logs (90-day retention)
- **`society_app_errors` index** — 4xx/5xx responses and unhandled exceptions (30-day retention)
- **`society_security` index** — auth events, 401/403 responses (365-day retention)
- **`society_metrics` index** — host CPU and memory stats every 60 s

### Resilience design

Splunk is **optional** — all logging calls are fire-and-forget (`asyncio.create_task`).
If Splunk is down or over the daily limit, all application features continue to work normally.
Splunk is in its own Docker Compose profile (`--profile monitoring`) and is not started by default.

### Open Source Alternatives

If a fully open-source observability stack is required:

| Alternative | Replaces | Licence |
|-------------|---------|---------|
| **Grafana Loki** | Log aggregation & search | AGPL 3.0 |
| **Grafana** | Dashboards & alerting | AGPL 3.0 |
| **Prometheus** | Metrics collection | Apache 2.0 |
| **OpenTelemetry Collector** | Log/metric shipping (replaces Fluent Bit) | Apache 2.0 |

---

## 8. Licence Compatibility Summary

All open-source components use permissive licences (MIT, BSD, Apache 2.0, PostgreSQL).
There are **no copyleft (GPL/AGPL) licences** in the runtime stack, so the application
code is not subject to any "share-alike" obligation.

| Licence | Components | Obligations |
|---------|-----------|-------------|
| MIT | React, FastAPI, pydantic, MUI, Vite, TypeScript, and most npm/PyPI packages | Attribution only |
| BSD 2/3-Clause | Leaflet, react-leaflet, nginx, uvicorn, asyncpg | Attribution only |
| Apache 2.0 | Keycloak, Fluent Bit, cloudflared, asyncpg, TypeScript, keycloak-js | Attribution + NOTICE file if redistributing |
| PostgreSQL Licence | PostgreSQL, pgAdmin | Attribution only (MIT-equivalent) |
| PSF Licence | Python | Attribution only (MIT-compatible) |
| ODbL 1.0 | OpenStreetMap data / Nominatim | Attribution required; derivative databases must be shared under ODbL |
| **Proprietary** | **Splunk 9.3.1** | **Subject to Splunk General Terms; 500 MB/day free limit** |

---

## 9. How to Update This File

Run the following after adding any new dependency:

```bash
# Python dependencies
pip show <package> | grep -E "Name|Version|License|Home-page"

# Node dependencies
npm info <package> | grep -E "license|version"

# Docker image
docker inspect <image> | grep -i license
```

Then add a row to the appropriate section above and update the "Last updated" date.
