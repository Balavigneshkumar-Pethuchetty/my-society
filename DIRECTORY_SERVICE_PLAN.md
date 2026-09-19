# Directory Service Plan

Status: **planned, not yet implemented**. Companion service to COMMUNICATION_SERVICE_PLAN.md — enables residents and staff to discover who to contact by flat number or role, without exposing phone numbers or emails.

---

## Goal

Residents and staff can view a **directory of all flats, residents, security, committee members, and admins** — showing only:
- **Flat number** (e.g., "4B")
- **Alias name** (if available; see PII_PRIVACY_PLAN.md §2)
- **Role** (resident, security_guard, committee_member, admin)

This allows anyone to find "who lives in 4B" or "all security guards" and then reach out via the communication service (chat/call), **without revealing phone numbers, emails, or any other PII**. Only approved, active users can access the directory.

---

## What the directory is NOT

- **Not a real-name directory** — all names are aliases (PII_PRIVACY_PLAN.md §2 requirement)
- **Not a phone-book** — phone numbers and emails are never shown
- **Not a public listing** — only accessible to logged-in, approved residents/staff
- **Not a reverse lookup API for PII** — no endpoint like "GET /directory/flat/4B/phone" that could leak data
- **Not a skill-based search** — roles are only the coarse categories (admin, committee, security, resident), not fine-grained skills

---

## Service shape (small, read-only adapter)

Following this repo's per-service pattern:

- **`services/directory/`** — a small, read-only FastAPI adapter service. No writes to `society_events` DB; it only queries existing tables (users, apartments/flats, roles).
- **`docker-compose.yml` + `.env`/`.env.test`** — standalone build/redeploy, no dedicated Postgres (reads from shared `society_events`).
- **Endpoints** — HTTP read-only, served at `/api/directory/` behind nginx.

### Service dependencies
**Depends on**:
- `user-service` — for user list, alias names, roles (via API, not direct DB query)
- `building-structure-service` or core schema — for flat/unit hierarchy (via API or direct read-only query; see decision below)

**Does NOT depend on**: communication-service, event-service, registration-service, ticket-service, payment-service, visitor-service.

### Storage decision — NO persistence, only temporary caching
**The directory service does NOT store any user data.** It reads from user-service and building-structure-service APIs and caches results in memory.

- **Adapter storage**: Only in-memory cache (5–15 min TTL) of user list + flat list
- **No DB writes**: The adapter never writes to `society_events` or any other database
- **Cache invalidation**: When user-service notifies of approval/removal/alias change, adapter clears cache entries (webhook-driven)
- **No message queues or logs**: Search queries are not logged for audit; only Splunk-level logging (aggregated, no PII details)

**Data source options** (for cache population):

**Option A (Recommended): Query building-structure-service API**
- Same pattern as users API isolation (shipped 2026-08-30, see [[project_users_api_isolation]])
- Loose coupling, consistent with other services
- Slightly higher latency (HTTP call) but cacheable and acceptable for directory reads

**Option B: Direct read-only query to `society_events.apartments` / `society_events.buildings` / etc.**
- Shared DB read-only role (per-service schema isolation, shipped 2026-09-14, see [[project_db_isolation_plan]])
- Lower latency (no HTTP hop)
- Fine if building-structure API isn't ready yet; migrate to Option A later

**Default: Option A** (API-based), but Option B is viable short-term fallback.

---

## API Endpoints

| Endpoint | Method | Query Params | Returns | Role Required |
|---|---|---|---|---|
| `/directory/users` | GET | `role`, `search`, `limit`, `offset` | List users with flat, role, alias | `resident`/`admin`/`committee_member`/`security_guard` |
| `/directory/users/{user_id}` | GET | — | Single user: flat, role, alias, last_active | same |
| `/directory/flats` | GET | `building_id`, `limit`, `offset` | List flats with resident count | same |
| `/directory/flats/{flat_id}` | GET | — | Single flat: address, occupants (alias + role), unit type | same |
| `/directory/roles` | GET | — | Count of users per role (admin, committee, security, resident) | same |
| `/directory/roles/{role}` | GET | `limit`, `offset` | List all users with a specific role | same |
| `/directory/search` | GET | `q` (flat#, alias, role) | Unified search across flats and users | same |

### Response schema examples

**GET `/directory/users` (list view, minimal)**
```json
{
  "users": [
    {
      "user_id": "uuid",
      "alias_name": "Alice",
      "flat": "4B",
      "role": "resident",
      "last_active": "2026-09-15T14:32:00Z"
    },
    {
      "user_id": "uuid",
      "alias_name": "Bob",
      "flat": "5A",
      "role": "security_guard",
      "last_active": "2026-09-15T10:15:00Z"
    }
  ],
  "total": 147,
  "offset": 0,
  "limit": 20
}
```

**GET `/directory/flats/{flat_id}` (detail view)**
```json
{
  "flat_id": "uuid",
  "building": "Tower A",
  "unit_number": "4B",
  "unit_type": "2BHK",
  "residents": [
    {
      "user_id": "uuid",
      "alias_name": "Alice",
      "role": "resident"
    }
  ],
  "occupant_count": 1
}
```

**GET `/directory/search?q=4B`**
```json
{
  "flats": [
    {
      "flat_id": "uuid",
      "building": "Tower A",
      "unit_number": "4B",
      "residents": [{"alias_name": "Alice", "role": "resident"}]
    }
  ],
  "users": [],
  "roles": []
}
```

---

## Access control

**Who can see the directory:**
- Any logged-in, approved resident (must have approval role in JWT + `users.is_active = true`)
- Admin/committee/security staff (same approval requirements)

**What they see:**
- All residents and staff in the society (no filtering by role or flat assignment — flat number and role are already public information among society members)
- Only non-PII fields: alias, flat, role, last_active timestamp
- No phone, email, Aadhaar, family contacts, blood group — none of it

**Implementation:**
- JWT validation at the adapter: require approval role + `is_active` check via user-service API (same as communication service)
- Every query is pre-filtered to only approved, active users in the `society_id` (single-tenant constraint, same as every other service)
- No direct API endpoint for "given a phone number, find the user" — reverse lookups are forbidden

---

## Real-time updates & caching

**Not real-time, but acceptable latency:**
- Directory is read-heavy, write-light (updates only when a user is approved, changes alias, or is removed)
- Cache user list + flat list in memory for 5–15 minutes, TTL configurable per env
- On approval/removal/alias-change, invalidate cache (user-service calls the adapter's cache-invalidation webhook)
- Search is live (no caching of search results, only the underlying lists are cached)

**Why not real-time?**
- Real-time would require WebSocket or Server-Sent Events (SSE) from the adapter, complexity not needed for v1
- Acceptable UX: "you added Alice to your group 30 seconds ago, the directory might still show her as offline for a few more seconds" is fine
- Fallback: user can do a manual refresh if they see stale data

---

## Integration with communication service

**Workflow** (happy path):
1. User opens `/directory/` in the shell or communication frontend
2. User searches for "4B" or "security" → sees matching flats/users + alias/role
3. User clicks "Message" or "Call" button next to a result
4. Opens a DM room in Element Web (1:1 with that user) or creates a group invite
5. Never revealed the target's phone number or email at any point

**Implementation touch points:**
- Shell adds `/directory` route (or `/chat/directory` if embedded in communication MFE later)
- Communication service's MFE (phase 2) embeds the directory as a discover-users component
- Directory adapter doesn't need to call communication-service; they're loosely coupled
- Both services respect the same approval gate (Keycloak JWT + `is_active`)

---

## Security & PII considerations

**What stays hidden:**
- Phone numbers, emails, Aadhaar numbers, family contacts, blood group — none ever returned
- Account creation dates, login history, failed login attempts — not exposed
- Fine-grained role/permission details (which gates can security scan, etc.) — only coarse role shown

**What's okay to expose (already public among society members):**
- Flat number and building — who lives where is not a secret in a society
- Role (resident, security, committee, admin) — staff identities are not secret
- Alias name — that's the whole point of the alias (PII_PRIVACY_PLAN.md §2)
- Last active timestamp — "Bob was last seen 2 hours ago" is not PII

**Abuse vectors & mitigations:**
- **Scraping/export**: No bulk export endpoint; paginated results only (limit 20–50 per request)
- **Enumeration attacks**: No "list all user IDs by incrementing" — only search by flat/alias/role
- **Reverse lookup**: No "given email, find the user" endpoint — no email queries allowed
- **Logging**: Log all directory queries (who searched for what) for audit purposes; feed to Splunk

---

## Implementation steps

### Core Infrastructure
- [ ] Scaffold `services/directory/` (Dockerfile, `docker-compose.yml` + `.env`/`.env.test`, `app/` skeleton)
- [ ] Add `directory` service to root `docker-compose.yml`
- [ ] Implement JWT validation + role + `is_active` check (same as communication service adapter)

### User Listing API
- [ ] `GET /directory/users` — list all approved, active users with flat, alias, role
- [ ] Implement pagination (limit/offset)
- [ ] Implement caching layer (5–15 min TTL) with invalidation hook from user-service
- [ ] Add optional `role` filter (filter by admin, committee, security, resident)
- [ ] Add optional `search` param for alias substring match

### Flat/Building Listing API
- [ ] Decide: Option A (building-structure API calls) vs. Option B (direct DB read)
- [ ] `GET /directory/flats` — list all flats with occupant summary
- [ ] `GET /directory/flats/{flat_id}` — detail view with residents (alias + role only)
- [ ] Add caching (same 5–15 min TTL)

### Search & Role-based Listing
- [ ] `GET /directory/roles` — count summary (e.g., "42 residents, 5 security, 3 committee, 2 admin")
- [ ] `GET /directory/roles/{role}` — list all users with a specific role
- [ ] `GET /directory/search?q=` — unified search across flats (by #), users (by alias), roles
- [ ] Implement case-insensitive, partial matching

### Deployment & Operations
- [ ] Nginx routing: `/api/directory/` → adapter
- [ ] Add `Makefile` targets: `restart-directory`, `logs-directory`
- [ ] Add cache-invalidation webhook handler: user-service → directory (on approval, alias change, removal)
- [ ] Logging: audit all directory queries (who searched for what) → Splunk
- [ ] Rate-limiting (optional, phase 2): prevent search spam

### Frontend Integration
- [ ] Create a simple UI component for directory search (flat #, alias, role search)
- [ ] Add "Message" or "Call" action buttons next to results (deep-link to communication service or Element Web)
- [ ] Integrate into shell nav or communication MFE (phase 1: standalone page; phase 2: embedded modal)

### Documentation
- [ ] Update `ARCHITECTURE.md` with the directory service endpoint table
- [ ] Document API responses and query examples
- [ ] Document the Keycloak approval role requirement

---

## Known gaps & future phases

**Phase 1 gaps (acceptable for launch):**
- No real-time online status (just "last_active" timestamp)
- No user avatar/profile photos
- No "subscribe to updates" (WebSocket/SSE)
- No bulk export or API key access (admin convenience feature for external integrations)

**Phase 2 features (defer unless high demand):**
- Real-time online status via Element Web / communication service integration
- User avatars (display a small avatar next to alias, sourced from Matrix profile or uploaded)
- Advanced search filters (by occupancy type, date joined, etc.)
- Directory API for external systems (behind a separate API key, low priority)

---

## Prerequisites from other plans

- **PII_PRIVACY_PLAN.md §2 (alias names)** — directory's entire identity value depends on aliases; must ship first.
- **[[project_building_structure]]** — flat/building hierarchy; must be in place before flat listing works.
- **[[project_user_approval]]** — approval mechanism; directory is only for approved users.

---

## Why this service is worth it

1. **Bridges the gap**: Residents can find each other without needing to know phone numbers or full names.
2. **Supports communication**: Makes the communication service (chat/call) discoverable and useful.
3. **Resident autonomy**: Residents can proactively reach out to security or committee without knowing their ID in advance.
4. **Privacy-first**: Alias + role + flat number is the absolute minimum needed for meaningful community interaction, nothing more.
5. **Reusable**: Other future services (event invitations, group notifications, etc.) can rely on the directory to answer "who's the resident in 4B?" without reinventing the lookup.

---

## Open items for later

- Rotation strategy for any long-lived API keys (if phase-2 admin/external API is built).
- Decision: does the directory also list past/historical residents (those who left the society)? For now, only active users.
- Geographic/map view of the building with flat overlays (nice-to-have, phase 3).
