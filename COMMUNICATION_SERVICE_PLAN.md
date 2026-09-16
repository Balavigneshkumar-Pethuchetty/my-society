# Communication Service Plan

Status: **planned, not yet implemented**. Split out from `PII_PRIVACY_PLAN.md` §4/§5a into its own file because it's a standalone service, not just a PII-encryption concern — this tracks its architecture, deployment, and rollout independently so it can be picked up and implemented on its own schedule.

**Relationship to PII_PRIVACY_PLAN.md**: that plan's §1–3/5 (encrypting phone/email/Aadhaar at rest, alias names, time-boxed PII-sharing grants) are a hard prerequisite for this service to be worth building — there's no point hiding phone numbers behind a chat app if the alias/encryption work isn't done first. See [[project_...]]-style cross-references throughout.

---

## Goal

Security can voice/video/text-call the concerned resident to verify a visitor; admin/committee/event organizer can create a purpose-scoped group (e.g. festival organizing) and close it later; admin/committee/organizer can 1:1 text/voice/video/voice-message/video-message a resident — all **without either party seeing the other's phone number or email**, with **alias name + flat number** as the only identity shown, **history survives a member leaving the society**, and it's a **separate, independently deployable service** — self-hosted in Docker, maintained by us, **loosely coupled** to `auth-service`/`user-service` rather than sharing their DB.

Open scope question to resolve before implementing (not yet decided): is this admin/committee/security/organizer ↔ resident only, or also resident ↔ resident (e.g. one neighbor reaching another without knowing their number)? The architecture below supports either; it changes only the adapter's room-creation authorization logic.

---

## Software chosen

**Matrix homeserver (Synapse) + Element Web**, self-hosted, open source. Chosen over Rocket.Chat/Jitsi/Nextcloud Talk specifically because Matrix's event model natively supports permanent, alias-keyed, tamper-evident history that survives account deactivation — which the other options don't give you out of the box to the same degree. All of it — homeserver, client, TURN server — is open source; nothing here is a SaaS dependency.

**Feature coverage**: text, native 1:1 voice/video calls, and voice/video messages are all the same underlying mechanism — E2EE media events (`msgtype: m.audio` / `m.video`) inside a Megolm-encrypted room. There is no separate voice-message or video-message subsystem to build; it's a client capability (confirm Element Web/Element X supports recording+sending them) plus a Synapse config bump (`max_upload_size`) for longer clips.

---

## Decoupling mechanism: delegate identity to Keycloak, don't duplicate it

- Synapse supports **OIDC delegation** (`oidc_providers` config) — point it at the existing `society-events` Keycloak realm. Synapse never stores a password, never touches the `users` table, never needs a DB-level relationship with user-service. This is the loose-coupling boundary.
- Keycloak's JWT already carries a `sub` claim — an opaque UUID, no PII. Synapse's `user_mapping_provider.localpart_template` derives the **permanent Matrix ID** from `sub` (e.g. `@<sub>:yourdomain.com`). This ID is what's permanently recorded in every room-creation event, membership event, and message `sender` field — forever, and it was never derived from anything sensitive.
- The mutable **alias name** (PII_PRIVACY_PLAN.md §2/§3) is layered on top as the Matrix **profile displayname**, set/updated via the Synapse admin API whenever the resident's alias changes. Changing the alias never changes the underlying permanent ID or breaks historical event references.
- **Flat number**: not part of the current PII plan's Matrix wiring — needs to be added so security/admins immediately see e.g. "Alice — 4B" in a DM header without a separate directory lookup. Push `flat_number` into the Matrix profile as a custom field (or into the room's initial state at creation), synced by the same adapter that syncs the alias. Flat number is not PII per PII_PRIVACY_PLAN.md §3 (access-controlled, not encrypted), so no additional crypto work is needed to expose it here — only the sync step.

---

## Why this satisfies "history survives departure"

- Synapse's account deactivation has two modes. Plain deactivation (`erase: false`, the default) locks the account (no login, tokens revoked) but leaves every room event — who created a group, who was a member and when, every message — fully intact. **This is the one to use.**
- The stronger `erase: true` mode additionally scrubs 3rd-party IDs and hides message content from anyone who joins a room *after* the erasure — deliberately **not** the default for us, since it works against the "retain full history" goal. Reserve it only for an explicit resident data-erasure request, as a separate deliberate action, not the standard offboarding path.
- Because the sender was always the alias-based ID (never real PII), there's nothing identity-wise to redact either way — the audit trail stays queryable via the admin API indefinitely.

---

## Service shape (own directory, own deployment — matches this repo's per-service pattern)

Following the convention in `CLAUDE.md` ("Per-service compose files"), this is **not** folded into an existing service — it's new:

- **`services/communication/`** — a new small FastAPI adapter service (the *only* code we write and own here), structured like every other service (own `Dockerfile`, own `docker-compose.yml` + `.env`/`.env.test` + `.env.example`, own `app/` with `routes/`, `config.py`, reusing the `notifications.py` pattern already used by `services/user`).
- **`synapse`** (official `matrixdotorg/synapse` image) + its **own dedicated Postgres** — deliberately not the shared `society_events` DB, consistent with the loose-coupling goal and the precedent already set by `services/visitor` having its own DB. Third-party software we don't maintain the schema of; isolating it means a Synapse upgrade/migration can never touch our data.
- **`element-web`** (official `vectorim/element-web` image) — the chat client, served behind the existing nginx at a new path (e.g. `/chat/`). Served as a standalone third-party SPA, **not** a `@originjs/vite-plugin-federation` remote like `mfe-admin`/`mfe-booking`/etc. — Element Web isn't built to be federated. A thin `mfe-communication` wrapper (just enough React to embed/deep-link into Element Web from the shell's nav) is a possible **phase 2**, not needed for launch.
- **`coturn`** — TURN/STUN, required for calls to connect across real-world NATs.

**The adapter's own storage** (the `{internal_group_id, matrix_room_id, status, created_by}` mapping table — see below): default recommendation is a **dedicated schema + role in the shared `society_events` Postgres**, consistent with the now-standard per-service-schema pattern (shipped 2026-09-14, see memory: DB Isolation Plan) — the adapter's own data is small (a mapping table, not a bounded domain the way visitor-service's is), so a whole extra Postgres container isn't obviously worth it. Flag as a decision to confirm at implementation time, not settled here.

### New deployment surface
- Root `docker-compose.yml`: add `communication`, `synapse`, `synapse-postgres`, `element-web`, `coturn` services.
- `services/communication/docker-compose.yml` + `.env`/`.env.test` — standalone build/redeploy, same pattern as every other service (assumes the shared platform is already up via `make up`).
- `Makefile`: `restart-communication`, `logs-communication` targets (matching `restart-user-service` etc.).
- `nginx.conf`: route `/_matrix/client`, `/_matrix/media`, `/.well-known/matrix/*` → Synapse; `/chat/` → Element Web; keep the Synapse **Admin API off the public ingress entirely** (internal Docker network only).
- `ARCHITECTURE.md`: add a row for `communication-service` to the per-service endpoint table once built.

| Component | Port (internal) | Nginx prefix | Notes |
|---|---|---|---|
| `communication` (adapter) | TBD, e.g. 3009 | none (internal only — called by user-service's approval hook, not by the frontend directly) | FastAPI, own DB schema/role |
| `synapse` | 8008 (Matrix default) | `/_matrix/*`, `/.well-known/matrix/*` | Admin API (`/_synapse/admin/*`) must **not** be proxied publicly |
| `element-web` | 80 (static) | `/chat/` | third-party SPA, no build step of ours |
| `coturn` | 3478/5349 + relay range | n/a (UDP/TCP, not HTTP) | needs its own port range opened, not just nginx |

---

## The one integration touchpoint (adapter responsibilities — not a DB dependency on user-service)

A thin adapter (`services/communication`) hooked into user-service's existing approval flow:

1. **On admin approval** — **proactively** provisions the Matrix account via the Admin API (`POST /_synapse/admin/v1/register`, HMAC-signed with a shared secret) and sets its `displayname` to the current alias (and pushes `flat_number`, per the identity section above). *Must be proactive, not lazy*: a resident who's approved but has never opened Element still needs to be reachable — if provisioning waited for first login, security couldn't reach them.
2. **On alias or flat-number change** — pushes the updated profile fields to Synapse via the admin API.
3. **On user removal** — calls Synapse's deactivate endpoint with `erase: false`.
4. **Nightly, bidirectionally** — reconciles the adapter's mapping table against `users.is_active` (via user-service's API, not a raw DB query — consistent with the shipped Users-API-isolation pattern): deactivates any Matrix account whose removal webhook was missed, **and** provisions any approved resident who's missing a Matrix account (covers the case where the approval-time register call itself failed, not just the removal path). Self-heals within 24h instead of leaving either kind of drift live indefinitely.

### Open item to verify before implementing
Confirm whether the existing approval flow (user-service, [[project_user_approval]] — "admin approves via Keycloak Admin API + DB update") is what actually **enables** the Keycloak account, or whether the account is already fully login-capable the moment someone registers. If the latter, a not-yet-approved resident could SSO into Matrix before an admin ever reviews them — needs to be closed (e.g. gate Synapse login on a role/claim only granted at approval), not left implicit.

---

## Emergency PII sharing — integration point with PII_PRIVACY_PLAN.md §5

This service intentionally does **not** carry blood group / Aadhaar / family-contact sharing itself. When a resident wants to share that during an emergency call, the flow is: they trigger the "share emergency info" action inside the E2EE room → that calls PII_PRIVACY_PLAN.md §5c's reveal-grant endpoint (`POST /users/me/pii-shares`) → the resulting **link** (not the raw values) gets posted into the E2EE chat as a normal message. This keeps Synapse's own database from ever holding blood-group/Aadhaar plaintext, and keeps the expiry/audit-log guarantees in one place (user-service) instead of duplicating them here. Matrix has no reliable native message-expiry (ephemeral messages are still a draft spec), so relying on chat-message deletion instead of the reveal-grant's server-enforced expiry would be weaker, not stronger.

---

## Notifications & group lifecycle UX

- **Security→resident call**: Matrix push alone is not reliable enough for a time-critical gate-verification call (documented iOS/Android VoIP-push gaps in the Matrix ecosystem). The adapter fires a **parallel SMS/Telegram nudge** (reusing `services/user/app/notifications.py`'s existing `send_channels`/auth-service `/api/sms/send` + `/api/telegram/send` pattern) the instant it sends the call-invite — that channel, not Matrix's own push, is the primary alert; Matrix push is a bonus on top. Residents wanting reliable mobile call alerting should use the official **Element X** app rather than relying on Element Web in a browser tab.
- **Added to a group**: standard Matrix room invite (native notification), plus the same kind of one-off SMS/Telegram/in-app nudge when the group is created.
- **Leaving a group**: fully native (`POST /rooms/{roomId}/leave`, built into every client) — no adapter work needed. History up to that point is preserved for everyone who was already in the room.
- **Re-adding someone who left**: same invite mechanism used to create the group originally. What they see of the time they were away depends on the room's `history_visibility` setting (default `shared` = visible from invite onward, not retroactively).
- **Closing a group**: Matrix has no native "group"/"close" concept — the adapter tracks `{internal_group_id, matrix_room_id, status, created_by}` itself, and "closing" means raising `m.room.power_levels.events_default` so only admins can post, while the room and full history stay intact and queryable.

---

## Known gaps & mitigations

**Functional**
- Alias display-name collisions between two residents — enforce a case-insensitive `UNIQUE` constraint on `alias_name` (already required by PII_PRIVACY_PLAN.md §2 regardless of this service).
- In-app call latency vs. a real phone ring (tap link → app opens → room loads → join can take tens of seconds) — not fixable in software; document an SOP: security tries the in-app call first, falls back to phoning the resident's real number directly after a defined timeout (e.g. 30–45s). *(That fallback number lookup itself must go through a role-gated, decrypt-on-demand path — not a raw DB read — per PII_PRIVACY_PLAN.md §1.)*

**Security**
- **Message content readable in Synapse's DB undermines the whole point** unless E2EE is explicitly turned on — set `initial_state: [{"type": "m.room.encryption", "content": {"algorithm": "m.megolm.v1.aes-sha2"}}]` on every `createRoom` call. Metadata (who created/joined what, when) stays visible to the admin API either way, satisfying the audit requirement without leaving content exposed.
- **Native Synapse registration must be disabled** (`enable_registration: false`, `password_config.enabled: false`) — otherwise the Client-Server API being internet-reachable means anyone could register directly against the homeserver, bypassing Keycloak/approval entirely.
- **Admin API is a concentration-of-power risk** (can deactivate/impersonate any user) — keep it off the public ingress (internal Docker network only; nginx proxies just `/_matrix/client`, `/_matrix/media`, `/.well-known/matrix/*`), store its token as a proper secret (never committed, same rule as PII encryption keys), log every admin-API call the adapter makes.
- **Federation must be explicitly disabled** (`federation_domain_whitelist: []`) — Synapse federates with the public Matrix network by default, which must not happen for a private single-society deployment.
- **coturn open-relay risk** — use Synapse's documented `turn_shared_secret` integration for short-lived, time-boxed TURN credentials, not a static shared username/password.
- **Ongoing patch responsibility** — pin exact image versions (no floating `:latest`), subscribe to Synapse's security advisories, roll upgrades through the existing `.env.test` staging stack before production.

**Reliability**
- coturn is a single point of failure for calls needing relay — add a Docker healthcheck, feed its logs to `~/splunk-service`.
- No redundancy in a single Compose stack — `restart: unless-stopped` on every container, scheduled `pg_dump` backups of Synapse's dedicated Postgres (a host failure otherwise loses the exact history this whole effort was built to preserve).
- Don't expose a "start group video call" control in the UI until the Element Call/LiveKit stack (phase 2) actually exists — native Matrix calling degrades fast past 1:1.
- If the whole self-hosted stack is down, the SMS/Telegram nudge (and, as last resort, a real phone call) is the only path that still works — worth a periodic drill to confirm it still does.

### Why these mitigations actually work (failure-mode tracing)

**Functional**
- **Proactive provisioning**: the failure was account creation depending on a voluntary action (opening Element) that might never happen before it's urgently needed. Moving creation to the approval event (which the resident doesn't control) makes existence deterministic instead of probabilistic. Residual gap: if the register call itself fails at approval time, you're back to a missing account — closed by making the reconciliation job bidirectional, not a one-off fix.
- **Reconciliation job**: works because it doesn't trust the original event delivery at all — it independently re-derives truth from both systems' current state and diffs them, so it's immune to *how* drift happened. Converts an unbounded exposure window into a bounded one (~24h worst case, tunable by shortening the interval), not a zero one.
- **Alias uniqueness**: prevents the collision from ever existing (write-time constraint) rather than detecting it after the fact — closes the confusion/impersonation vector at the one layer humans actually use to make trust decisions (the display name, not the underlying Matrix ID).
- **Call-latency SOP**: doesn't fix the underlying push-reliability problem (that's inherent to the ecosystem, not fixable from our side) — it bounds the damage by capping how long security waits on the unreliable channel before an already-proven-reliable one (a real phone call) takes over. Graceful degradation, not a fix to the primary path.

**Security**
- **E2EE**: works because Megolm keys live only on participant devices, never uploaded to Synapse in usable form — so full, unrestricted DB access yields undecipherable ciphertext for message bodies. A cryptographic guarantee, not a policy restriction, same trust model as the phone/email encryption in PII_PRIVACY_PLAN.md §1. New tradeoff it introduces: message recovery now depends on each user having key backup configured — device loss without backup can make history genuinely unreadable even to legitimate participants, a risk that didn't exist before E2EE.
- **Disabling native registration**: the Client-Server API has to stay internet-reachable for Element to work, so this doesn't hide the port — it removes the account-creation capability at the application layer, closing the direct-registration path that would otherwise bypass Keycloak/approval entirely.
- **Admin API isolation**: three independent layers covering what the others miss — network isolation makes a stolen token useless to an *external* attacker (no route to the port at all); secret hygiene reduces the odds of the token leaking in the first place; logging doesn't prevent misuse but makes it detectable after the fact if the first two layers both fail. None alone closes the risk; together they make it progressively less likely and, worst case, noticeable.
- **coturn ephemeral credentials**: a static credential, once extracted from any client, works forever for anyone. `turn_shared_secret` mints a fresh, time-boxed credential per session via HMAC — there's no single long-lived secret to extract and reuse.
- **Patch cadence**: doesn't prevent a vulnerability existing — shrinks the window between disclosure and patch landing by making upgrades scheduled and deliberate instead of dependent on someone remembering.

**Reliability**
- **coturn healthcheck + Splunk**: converts detection from reactive (residents complain calls won't connect, possibly after hours of silent degradation) to proactive (active probing on a schedule, caught before they notice).
- **Restart policy + backups**: cover two different failure classes, which is why both are needed — restart policy fixes downtime after a transient crash; backups fix permanent data loss from a destroyed disk/host, which restart policy does nothing for. Losing the backup means losing the exact thing (history that outlives departure) this whole effort exists to preserve.
- **No group-call UI until phase 2**: scope control, not a technical fix — if the affordance isn't reachable, nobody can trigger the broken-mesh-call experience that would otherwise poison trust in the rest of the system.
- **SMS/Telegram + real-phone fallback**: the mechanism is failure independence — the fallback shares no infrastructure with the Matrix stack (existing auth-service pipeline / plain telephony), so whatever takes Matrix down can't take the fallback down with it. The periodic drill exists to catch that independence quietly eroding over time (e.g. someone later routing the "fallback" through something that itself depends on the Matrix stack).

---

## Prerequisites from PII_PRIVACY_PLAN.md (must ship first)

- **§2 (alias names)** — this service's entire privacy value proposition depends on `alias_name` existing and being enforced; building this before §2 ships would just relocate real-name exposure into a new system.
- **§1 (phone/email encryption)** — not a hard blocker for the chat service itself (Synapse never touches those columns), but the fallback-SOP phone lookup above and the emergency-share integration both assume §1's decrypt-on-demand path exists.
- **§5c (reveal-grant mechanism)** — required for the "share emergency info mid-call" flow; the chat service can ship without it (plain text/voice/video calling works fine on its own), but that one feature is blocked until §5c exists.

---

## Implementation steps (not started)

- [ ] Scaffold `services/communication/` (Dockerfile, `docker-compose.yml` + `.env`/`.env.test`/`.env.example`, `app/` skeleton) matching existing service conventions
- [ ] Add `synapse`, `synapse-postgres`, `element-web`, `coturn`, `communication` to the root `docker-compose.yml`
- [ ] Decide adapter's own storage: dedicated schema/role in shared `society_events` Postgres (default) vs. its own dedicated Postgres like `services/visitor`
- [ ] Stand up Synapse: federation disabled, native registration disabled, `oidc_providers` configured against the existing Keycloak realm, `localpart_template` derived from `sub`
- [ ] Verify/close the pre-approval login gap (open item above)
- [ ] Build the adapter: proactive provisioning at approval, alias + flat-number sync, removal → deactivate `erase:false`, nightly bidirectional reconciliation
- [ ] Enable E2EE by default on every room the adapter creates
- [ ] Lock down the Synapse Admin API to the internal Docker network only; secret-managed token; call logging
- [ ] Configure `turn_shared_secret` for coturn (time-boxed credentials, not static)
- [ ] Wire the SMS/Telegram parallel-notification hook for calls and group-adds (extend `services/user/app/notifications.py`'s pattern, or a local copy in `services/communication`)
- [ ] Nginx routing: `/_matrix/client`, `/_matrix/media`, `/.well-known/matrix/*` → Synapse; `/chat/` → Element Web; Admin API stays unrouted
- [ ] Container restart policies + healthchecks + Postgres backup schedule for Synapse's dedicated DB
- [ ] `Makefile` targets: `restart-communication`, `logs-communication`
- [ ] Confirm Element Web/Element X voice-message and video-message support; size `max_upload_size` in Synapse config
- [ ] Confirm resident-to-resident scope question (see Goal section) before finalizing the adapter's room-creation authorization logic
- [ ] Wire the "share emergency info" in-chat action to PII_PRIVACY_PLAN.md §5c's `POST /users/me/pii-shares` (posts a link into the room, never raw values)
- [ ] Update `ARCHITECTURE.md` with the new service's endpoint table
- [ ] Phase 2 (deferred): Element Call/LiveKit stack for group video conferencing; `mfe-communication` shell-embedded wrapper around Element Web

---

## Open items for later
- Rotation strategy for the Synapse Admin API token and `turn_shared_secret` — not required for v1.
- Whether a lightweight `mfe-communication` shell integration (deep-link/embed from shell nav into `/chat/`) ships alongside v1 or is deferred to phase 2 with group video.
