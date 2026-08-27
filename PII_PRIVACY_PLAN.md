# PII Privacy Plan

Status: **planned, not yet implemented**. Tracks three related privacy efforts agreed in discussion before any is built.

---

## 1. Encrypt sensitive PII at rest

**Goal:** a Postgres superuser / pgAdmin session with full `SELECT` on the tables must not be able to read plaintext phone numbers, emails, or Aadhaar numbers. Only the application (holding the key) can.

### Fields in scope
| Table | Column | Notes |
|---|---|---|
| `users` | `email` | VARCHAR(255), UNIQUE, looked up on login |
| `users` | `phone` | VARCHAR(20), UNIQUE, looked up on login/OTP |
| `visitor_pass` (services/visitor) | `aadhaar` | TEXT, write-once, never queried by value |
| `visitor_pass` | `resident_phone` | TEXT — the resident's own number, cached on the pass |
| `anonymous_visitor` (services/visitor) | `aadhaar` | TEXT |
| `anonymous_visitor` | `linked_resident_phone` | TEXT — the resident this walk-in is visiting |

**Guest PII (family members / visitors, captured at pass creation — added per resident privacy request 2026-08-23):**

| Table | Column | Notes |
|---|---|---|
| `visitor_pass` | `visitor_name` | TEXT, guest's name |
| `visitor_pass` | `contact` | TEXT, guest's phone number |
| `visitor_pass` | `email` | TEXT, guest's email (optional) |
| `visitor_pass` | `address` | TEXT, guest's home address (optional) |
| `visitor_pass` | `additional_visitor_names` | TEXT, free-text names of extra guests on a group pass — not structured per-person, encrypt as one blob |
| `visitor_pass` | `vehicle_number` | TEXT, guest's vehicle plate (optional) — arguably operational rather than PII; see note below |
| `anonymous_visitor` | `visitor_name`, `contact`, `email`, `address` | TEXT, same guest identity fields, populated for walk-in guests with no pre-created pass |
| `anonymous_visitor` | `vehicle_number` | TEXT |
| `phone_verification` (services/visitor) | `phone_number` | TEXT NOT NULL, guest's phone number used for OTP verification on a pass |
| `visitor_photo` (services/visitor) | `file_path` | TEXT NOT NULL — not a DB-column-encryption case; see "Guest photos" below |

Note on `vehicle_number`: leaving it plaintext (like flat number in §3) unless a concrete misuse scenario is identified — flag before implementing if security/gate staff need to search by plate, since that would need the same blind-index treatment as phone/email.

### Ruled out
- **`pgcrypto` (`pgp_sym_encrypt`/`pgp_sym_decrypt`)** — the key would have to be passed as a SQL literal, which lands in Postgres query logs / `pg_stat_statements`. A pgAdmin session using the same DB credentials as the app could decrypt directly. **Does not satisfy the threat model.**

### Approach: application-level encryption
- Randomized **AES-256-GCM** for fields never searched by value (Aadhaar). Encrypt before `INSERT`, decrypt after `SELECT`, entirely in application code.
- For **`phone`/`email`** (UNIQUE + searched via `WHERE phone = $1`): add a **blind-index** column — `phone_hash` / `email_hash`, deterministic HMAC-SHA256 with a *separate* key. Move the `UNIQUE` constraint to the hash column. Application queries the hash column instead of sending plaintext into a SQL `WHERE` clause (plaintext must never transit through Postgres, even transiently — protects against query-log exposure too).
- Key lives only in each service's env/secret — **never** in Postgres (not a config table, not a function body, not a query literal).
- Because this is a shared-DB architecture where multiple services query `users` directly (registration-service, ticket-service, etc. — see CLAUDE.md), the encrypt/decrypt helper must be duplicated into every service that touches these columns, the same way `auth.py` already is per-service.
- Notification sending (SMS/Telegram/email) is unaffected: the owning service still decrypts in-memory right before calling the notification webhook. Nothing is ever written back in plaintext.

### Guests have no account — default to randomized encryption, not blind-index
Unlike `users.phone`/`users.email`, guests never log in and there is no `UNIQUE` constraint on `visitor_pass.contact`/`email`/`address`/`visitor_name` or `anonymous_visitor`'s equivalents — nothing in the current routes (`passes.py`, `gate.py`) does a `WHERE contact = $1` / `WHERE email = $1` lookup against these columns to find a guest by value. So the default for all guest identity fields is **randomized AES-256-GCM, no blind index** — the simpler case, same as Aadhaar in §1.
- **Confirm before implementing**: if there's a "has this person visited before" / repeat-guest lookup feature (existing or planned) that searches by guest phone or Aadhaar, that column needs the blind-index treatment instead — check for it, don't assume it doesn't exist just because this scan didn't find one.
- `phone_verification.phone_number` is looked up by `otp_request_id`/pass id during OTP confirm, not by phone value — no blind index needed there either; encrypt at rest only.
- `additional_visitor_names` (group-pass free text) is encrypted as a single opaque blob like any other TEXT PII field — it isn't decomposed into individual guest records today, so per-guest partial access isn't possible (all-or-nothing decrypt), which is an accepted limitation of the current schema, not something this effort needs to fix.

### Guest photos (`visitor_photo.file_path`)
This is different from the other rows in the table: `file_path` itself is just a pointer, not the sensitive data — the actual guest photo bytes live on disk (or an object store) at that path, outside Postgres entirely. Column-level AES-GCM on `file_path` would encrypt the pointer but leave the image file itself readable to anyone with filesystem/volume access, which doesn't satisfy this plan's threat model (a superuser-equivalent with access to the host/volume, not just `psql`).
- **Approach**: encrypt the image bytes with AES-256-GCM in the application before writing to disk (reuse the same shared crypto utility as §1), store only ciphertext at `file_path`; decrypt in-memory on read (e.g. when a security guard or admin views the photo for gate verification).
- Key can be the same per-service key used for other `services/visitor` PII, or a separate one — decide during implementation; either way it must live in `services/visitor`'s env/secret, never alongside the file on disk.
- Flag if `visitor_photo` storage is ever moved to an external object store (S3-compatible, etc.) before implementing this — the encrypt-before-write point stays the same, but the "at rest" boundary being defended against changes.

### Implementation steps (not started)
- [ ] Write shared crypto utility (AES-256-GCM encrypt/decrypt + HMAC blind-index helper), copied per service like `auth.py`
- [ ] New numbered migration: widen `users.phone` to TEXT, add `phone_hash`/`email_hash`, move UNIQUE index to hash columns, mirror in `db/init/01_schema.sql`
- [ ] Same migration pattern for `visitor_pass`/`anonymous_visitor` Aadhaar + phone columns (services/visitor's own migrations dir)
- [ ] New migration: encrypt guest fields — `visitor_pass.visitor_name`/`contact`/`email`/`address`/`additional_visitor_names`, `anonymous_visitor.visitor_name`/`contact`/`email`/`address`, `phone_verification.phone_number` — mirror in `db/init/01_schema.sql` (services/visitor's copy)
- [ ] Confirm no existing/planned repeat-guest lookup searches by guest phone/Aadhaar before finalizing "no blind index" default for guest fields (see note above)
- [ ] Backfill script: encrypt existing plaintext rows in place, populate hash columns
- [ ] Update every call site currently doing `WHERE phone =` / `WHERE email =` across services to query the hash column instead
- [ ] Update every call site that builds a notification payload to decrypt right after `SELECT`
- [ ] `services/visitor`: encrypt-before-write / decrypt-on-read for `visitor_photo` image bytes at `file_path` (app-level, not a DB column)
- [ ] Update `passes.py::create_pass`, `gate.py::create_anonymous`, `gate.py::upload_photo`, and phone-verify handlers in `services/visitor` to encrypt guest fields on write and decrypt on the relevant read paths (gate scan display, admin/committee pass views)
- [ ] Key management: dedicated secret per environment, not committed, not reused from the JWT signing key

---

## 2. Alias name — hide real name from non-self viewers

**Goal:** Admin, Committee member, Security, and co-residents see an **alias**, not the resident's real/legal name. Only the resident's own "my profile"-style views show their real name.

### Decisions made
- **Alias replaces the real name** for those roles (not shown alongside it).
- **No-alias fallback:** existing users get a **one-time backfill** — system generates a placeholder alias (e.g. `"Resident — {unit_label}"`) during migration. New signups **require** setting an alias going forward — there is never a real-name fallback gap.
- **Approval-flow exemption:** the pending-approval screen (admin/committee reviewing a new signup) keeps showing the **real name**, to verify identity against actual residents. Every other view uses the alias. *(Extended below in §3 to also cover phone/email/flat number for that same one-time review.)*

### Blast radius (confirmed via codebase scan — ~20+ endpoints across 5 services)

| Service | Endpoint(s) | Exposed to | Action |
|---|---|---|---|
| user-service | `GET /users/directory` (flat-holder directory) | admin/committee/security | switch to alias |
| user-service | `GET /users` list (active users) | admin/committee | switch to alias |
| user-service | `GET /users/{id}` | self (keep real) / admin/committee (switch to alias) | split by caller |
| user-service | `GET /users?active=false` (pending approval) | admin/committee | **keep real name** (approval exemption) |
| user-service internal | `by-unit-of/{user_id}` (household expansion) | co-residents | switch to alias |
| visitor-service | gate scan/lookup/today/anonymous | admin/committee/security | switch to alias |
| visitor-service | ledger endpoints | admin/committee | switch to alias |
| visitor-service | `GET /passes/my` household view | co-residents | switch to alias |
| visitor-service | name copied into new `visitor_pass` rows at creation | (denormalized snapshot) | copy alias instead of real name going forward — **historical passes are not rewritten** |
| ticket-service | event roster, gate entry/scan | admin/committee/security | switch to alias |
| ticket-service | privileged ticket lookup (`get_ticket` for non-owner) | admin/committee/security | switch to alias |
| registration-service | registration list/get | admin/committee/security | switch to alias |
| registration-service | complimentary-ticket audit (`invited_by`/`created_by`) | admin/committee | switch to alias |
| event-service | `organizer_name` on public event listing | **public, unauthenticated** | switch to alias — broader leak than originally scoped, fixing anyway |
| event-service | announcement `author_name` | **public, unauthenticated** | switch to alias — same |
| event-service | permissions list (`user_name`/`granted_by_name`) | organizer (co-resident) | switch to alias |
| event-service | registrations list `user_name` | admin/committee | switch to alias |
| payment-service | refunds, sponsors, funds, fund exports | admin/committee(/sponsor) | switch to alias |
| payment-service | collector-name registry | **any authenticated user, no role check** | switch to alias — broader leak, fixing anyway |
| payment-service | magic-link quick-review | **no auth check at all** | switch to alias — broader leak, fixing anyway |

**Left untouched (self-only, already correct):** `/users/me`-style own profile, `/tickets/my`, `/payments/my`, `/registrations/my`, a resident's own pass-creation echo.

### Mechanism
- Add `users.alias_name TEXT` (nullable, becomes required for new signups after backfill).
- Shared `display_name(user)` helper, duplicated per service like `auth.py`, returns the alias.
- Every "switch to alias" row above changes its `SELECT`/response field from `name` to the helper's output. Nothing removed, no signature changes — purely additive at the schema level.

### Implementation steps (not started)
- [ ] Migration: add `users.alias_name`, mirror in `db/init/01_schema.sql`
- [ ] Backfill script: generate placeholder alias per existing user from unit/building-structure data
- [ ] Enforce `alias_name` required at signup for new users
- [ ] Shared `display_name(user)` helper per service
- [ ] Update each endpoint in the table above (per service) to use it, respecting the approval-flow and self-view exemptions
- [ ] Update visitor-pass creation to copy `alias_name` instead of `name` going forward
- [ ] Resident-facing profile settings UI to set/change alias

---

---

## 3. Registration flow: flat number capture + first-approval PII exposure + trust notification

**Goal:** after a user registers in the auth service and verifies phone + email, they also declare their flat number before submitting for admin approval. The admin sees decrypted PII exactly once — at that first approval review — and the registrant is told this explicitly, so they trust that their data isn't sitting exposed to admins/pgAdmin in the meantime.

### Registration sequence (updated)
1. User registers in ~auth-service (Keycloak), account created, `users` row created with `is_active=FALSE` (existing flow — see [[project_user_approval]]).
2. User verifies phone (OTP) and email (existing flow — see [[project_mobile_otp]]).
3. **New:** user selects their **flat number** from the building-structure unit list (reuses the existing unit-assignment mechanism from [[project_building_structure]] — no new "flat number" data model needed, this just moves unit selection earlier, into registration, instead of being admin-assigned post-approval as it may be today. Confirm current assignment point before implementing — if units are today only assigned *by* the admin during/after approval, this changes who initiates it, not just when).
4. Registration submitted, status stays pending (`is_active=FALSE`).
5. **New:** registrant receives a notification (email/SMS/Telegram via the existing notification channels — see [[project_refund_notifications]] / [[project_mobile_otp]] for the wiring) confirming: *"Your personal information (name, phone, email, flat number) is encrypted. It is not visible to anyone — including society admins — until an admin reviews and approves your account for the first time."*
6. Admin/committee opens the pending-approval screen: this is the **one moment** phone, email, and flat number (alongside the real name, per §2) are decrypted and shown in plaintext, so the admin can verify this is a legitimate resident of that flat.
7. Once approved, `is_active=TRUE`. From then on, every other admin/committee/security/co-resident-facing view uses the **alias** (§2) and does **not** re-expose raw phone/email (only the flat-holder directory continues showing phone to security for emergency calls — an ongoing, separately role-gated exception per its existing purpose, decrypted on-demand by the app just like today, not a raw DB read).

### Flat number: encrypted or not?
Flat number is **not** added to the AES/blind-index scope in §1. Reasoning: it's operational data already threaded through building-structure/unit-assignment, the alias-fallback placeholder in §2 already depends on reading it in the clear (`"Resident — {unit_label}"`), and directories/rosters need it broadly. Treating it as PII for *access-control* purposes (only shown to the roles in §2's table, alias used instead of name alongside it) is enough — it does not need ciphertext-at-rest the way phone/email/Aadhaar do. Flag if this assumption is wrong before implementing.

### Implementation steps (not started)
- [ ] Add flat-number selection step to the registration UI, after phone/email verification, before final submit
- [ ] Confirm/adjust whichever service currently handles unit assignment (user-service, per [[project_building_structure]]) to accept it at registration time instead of/in addition to admin-assigned
- [ ] Wire a "registration submitted" notification (reuse existing SMS/Telegram/email channel) with the encryption/trust message above
- [ ] Confirm the pending-approval endpoint (`GET /users?active=false` / single pending-user view) returns decrypted name **and** phone/email/flat number together for that review — extends the §2 approval exemption
- [ ] Confirm no other pending-state endpoint (before approval) leaks decrypted phone/email to admin/committee outside that one review screen

---

---

## 4. Member-to-member communication (self-hosted Matrix / Synapse)

**Goal:** security can voice/video/text-call the concerned resident to verify a visitor; admin/committee/event organizer can create a purpose-scoped group (e.g. festival organizing) and close it later; admin/committee/organizer can 1:1 text/voice/video a resident — all **without either party seeing the other's phone/email**, and **history survives a member leaving the society**. Self-hosted in Docker, maintained by us, **loosely coupled** to `auth-service`/`user-service` rather than sharing their DB.

### Software chosen
**Matrix homeserver (Synapse) + Element Web**, self-hosted. Chosen over Rocket.Chat/Jitsi/Nextcloud Talk (see prior discussion) specifically because Matrix's event model natively supports permanent, alias-keyed, tamper-evident history that survives account deactivation — which the other options don't give you out of the box to the same degree.

### Decoupling mechanism: delegate identity to Keycloak, don't duplicate it
- Synapse supports **OIDC delegation** (`oidc_providers` config) — point it at the existing `society-events` Keycloak realm. Synapse never stores a password, never touches `users` table, never needs a DB-level relationship with user-service. This is the loose-coupling boundary.
- Keycloak's JWT already carries a `sub` claim — an opaque UUID, no PII. Synapse's `user_mapping_provider.localpart_template` derives the **permanent Matrix ID** from `sub` (e.g. `@<sub>:yourdomain.com`). This ID is what's permanently recorded in every room-creation event, membership event, and message `sender` field — forever, and it was never derived from anything sensitive.
- The mutable **alias name** (§2/§3) is layered on top as the Matrix **profile displayname**, set/updated via the Synapse admin API whenever the resident's alias changes. Changing the alias never changes the underlying permanent ID or breaks historical event references.

### Why this satisfies "history survives departure"
- Synapse's account deactivation has two modes. Plain deactivation (`erase: false`, the default) locks the account (no login, tokens revoked) but leaves every room event — who created a group, who was a member and when, every message — fully intact. **This is the one to use.**
- The stronger `erase: true` mode additionally scrubs 3rd-party IDs and hides message content from anyone who joins a room *after* the erasure — deliberately **not** the default for us, since it works against the "retain full history" goal. Reserve it only for an explicit resident data-erasure request, as a separate deliberate action, not the standard offboarding path.
- Because the sender was always the alias-based ID (never real PII), there's nothing identity-wise to redact either way — the audit trail stays queryable via the admin API indefinitely.

### Hosting shape (Docker Compose)
- `synapse` (official `matrixdotorg/synapse`) + its **own dedicated Postgres** — deliberately not the shared `society_events` DB, consistent with the loose-coupling goal (and with the precedent already set by services/visitor having its own DB).
- `element-web` (official `vectorim/element-web`) — the chat client, served behind the existing nginx.
- `coturn` — TURN/STUN, required for calls to connect across real-world NATs.
- **Federation must be explicitly disabled** (`federation_domain_whitelist: []`) — Synapse federates with the public Matrix network by default, which must not happen for a private single-society deployment.
- Group video conferencing (Element Call/LiveKit) needs its own SFU + auth-bridge stack as of the 2025 architecture change — **deferred to a phase 2**; phase 1 ships text + native 1:1 calls only.

### The one integration touchpoint needed (not a DB dependency)
A thin adapter (new small service, or a hook inside user-service's existing approval flow) that:
1. On admin approval — **proactively** provisions the Matrix account via the Admin API (`POST /_synapse/admin/v1/register`, HMAC-signed with a shared secret) and sets its `displayname` to the current alias. *(Corrected from an earlier version of this plan that relied on OIDC JIT-provisioning at first Element login — that leaves a gap: a resident who's approved but has never opened Element has no Matrix account yet, so security can't reach them. Must exist proactively at approval time.)*
2. On alias change (§2/§3) — pushes the updated displayname to Synapse via the admin API.
3. On user removal — calls Synapse's deactivate endpoint with `erase: false`.
4. Nightly, **bidirectionally** — reconciles the adapter's mapping table against `users.is_active`: deactivates any Matrix account whose removal webhook was missed, **and** provisions any approved resident who's missing a Matrix account (covers the case where the approval-time register call itself failed, not just the removal path). Self-heals within 24h instead of leaving either kind of drift live indefinitely.

### Open item to verify before implementing
Confirm whether the existing approval flow ([[project_user_approval]] — "admin approves via Keycloak Admin API + DB update") is what actually **enables** the Keycloak account, or whether the account is already fully login-capable the moment someone registers. If the latter, a not-yet-approved resident could SSO into Matrix before an admin ever reviews them — needs to be closed (e.g. gate Synapse login on a role/claim only granted at approval), not left implicit.

### Notifications & group lifecycle UX
- **Security→resident call**: Matrix push alone is not reliable enough for a time-critical gate-verification call (documented iOS/Android VoIP-push gaps in the Matrix ecosystem). The adapter fires a **parallel SMS/Telegram nudge** (reusing the existing OTP/refund notification channel) the instant it sends the call-invite — that channel, not Matrix's own push, is the primary alert; Matrix push is a bonus on top. Residents wanting reliable mobile call alerting should use the official **Element X** app rather than relying on Element Web in a browser tab.
- **Added to a group**: standard Matrix room invite (native notification), plus the same kind of one-off SMS/Telegram/in-app nudge when the group is created.
- **Leaving a group**: fully native (`POST /rooms/{roomId}/leave`, built into every client) — no adapter work needed. History up to that point is preserved for everyone who was already in the room, per the retention design above.
- **Re-adding someone who left**: same invite mechanism used to create the group originally — nothing special needed. What they see of the time they were away depends on the room's `history_visibility` setting (default `shared` = visible from invite onward, not retroactively) — a client-side visibility nuance, separate from the admin-API audit trail which stays fully queryable regardless.
- **Closing a group**: Matrix has no native "group"/"close" concept (same gap as Jitsi rooms) — the adapter tracks `{internal_group_id, matrix_room_id, status, created_by}` itself, and "closing" means raising `m.room.power_levels.events_default` so only admins can post, while the room and full history stay intact and queryable.

### Known gaps & mitigations (self-review before implementing)

**Functional**
- Alias display-name collisions between two residents — enforce a case-insensitive `UNIQUE` constraint on `alias_name`, same as email/phone today.
- In-app call latency vs. a real phone ring (tap link → app opens → room loads → join can take tens of seconds) — not fixable in software; document an SOP: security tries the in-app call first, falls back to phoning the resident's real number directly after a defined timeout (e.g. 30–45s).

**Security**
- **Message content readable in Synapse's DB undermines the whole point of this effort** unless E2EE is explicitly turned on — set `initial_state: [{"type": "m.room.encryption", "content": {"algorithm": "m.megolm.v1.aes-sha2"}}]` on every `createRoom` call. Metadata (who created/joined what, when) stays visible to the admin API either way, satisfying the audit requirement without leaving content exposed.
- **Native Synapse registration must be disabled** (`enable_registration: false`, `password_config.enabled: false`) — otherwise the Client-Server API being internet-reachable means anyone could register directly against the homeserver, bypassing Keycloak/approval entirely.
- **Admin API is a concentration-of-power risk** (can deactivate/impersonate any user) — keep it off the public ingress (internal Docker network only, nginx proxies just `/_matrix/client`, `/_matrix/media`, `/.well-known/matrix/*`), store its token as a proper secret (never committed, same rule as the PII encryption keys in §1), log every admin-API call the adapter makes.
- **coturn open-relay risk** — use Synapse's documented `turn_shared_secret` integration for short-lived, time-boxed TURN credentials, not a static shared username/password.
- **Ongoing patch responsibility** — pin exact image versions (no floating `:latest`), subscribe to Synapse's security advisories, roll upgrades through the existing `.env.test` staging stack before production.

**Reliability**
- coturn is a single point of failure for calls needing relay — add a Docker healthcheck, feed its logs to the existing `~/splunk-service`.
- No redundancy in a single Compose stack — `restart: unless-stopped` on every container, scheduled `pg_dump` backups of Synapse's dedicated Postgres (a host failure otherwise loses the exact history this whole effort was built to preserve).
- Don't expose a "start group video call" control in the UI until the Element Call/LiveKit stack (phase 2) actually exists — native Matrix calling degrades fast past 1:1.
- If the whole self-hosted stack is down, the SMS/Telegram nudge (and, as last resort, a real phone call) is the only path that still works — worth a periodic drill to confirm it still does.

### Why these mitigations actually work (failure-mode tracing)

Each fix below is traced as *failure mode → mechanism that closes it*, not just restated — kept here so the reasoning survives, not just the conclusion.

**Functional**
- **JIT-provisioning fix**: the failure was account creation depending on a voluntary action (opening Element) that might never happen before it's urgently needed. Moving creation to the approval event (which the resident doesn't control) makes existence deterministic instead of probabilistic. Residual gap: if the register call itself fails at approval time, you're back to a missing account — closed by making the reconciliation job bidirectional (above), not a one-off fix.
- **Reconciliation job**: works because it doesn't trust the original event delivery at all — it independently re-derives truth from both systems' current state and diffs them, so it's immune to *how* drift happened. Converts an unbounded exposure window into a bounded one (~24h worst case, tunable by shortening the interval), not a zero one.
- **Alias uniqueness**: prevents the collision from ever existing (write-time constraint) rather than detecting it after the fact — closes the confusion/impersonation vector at the one layer humans actually use to make trust decisions (the display name, not the underlying Matrix ID).
- **Call-latency SOP**: doesn't fix the underlying push-reliability problem (that's inherent to the ecosystem, not fixable from our side) — it bounds the damage by capping how long security waits on the unreliable channel before an already-proven-reliable one (a real phone call) takes over. Graceful degradation, not a fix to the primary path.

**Security**
- **E2EE**: works because Megolm keys live only on participant devices, never uploaded to Synapse in usable form — so full, unrestricted DB access yields undecipherable ciphertext for message bodies. A cryptographic guarantee, not a policy restriction, same trust model as the phone/email encryption in §1. New tradeoff it introduces: message recovery now depends on each user having key backup configured — device loss without backup can make history genuinely unreadable even to legitimate participants, a risk that didn't exist before E2EE.
- **Disabling native registration**: the Client-Server API has to stay internet-reachable for Element to work, so this doesn't hide the port — it removes the account-creation capability at the application layer, closing the direct-registration path that would otherwise bypass Keycloak/approval entirely.
- **Admin API isolation**: three independent layers covering what the others miss — network isolation makes a stolen token useless to an *external* attacker (no route to the port at all); secret hygiene reduces the odds of the token leaking in the first place; logging doesn't prevent misuse but makes it detectable after the fact if the first two layers both fail. None alone closes the risk; together they make it progressively less likely and, worst case, noticeable.
- **coturn ephemeral credentials**: a static credential, once extracted from any client, works forever for anyone. `turn_shared_secret` mints a fresh, time-boxed credential per session via HMAC — there's no single long-lived secret to extract and reuse.
- **Patch cadence**: doesn't prevent a vulnerability existing — shrinks the window between disclosure and patch landing by making upgrades scheduled and deliberate instead of dependent on someone remembering.

**Reliability**
- **coturn healthcheck + Splunk**: converts detection from reactive (residents complain calls won't connect, possibly after hours of silent degradation) to proactive (active probing on a schedule, caught before they notice).
- **Restart policy + backups**: cover two different failure classes, which is why both are needed — restart policy fixes downtime after a transient crash; backups fix permanent data loss from a destroyed disk/host, which restart policy does nothing for. Losing the backup means losing the exact thing (history that outlives departure) this whole effort exists to preserve.
- **No group-call UI until phase 2**: scope control, not a technical fix — if the affordance isn't reachable, nobody can trigger the broken-mesh-call experience that would otherwise poison trust in the rest of the system.
- **SMS/Telegram + real-phone fallback**: the mechanism is failure independence — the fallback shares no infrastructure with the Matrix stack (existing auth-service pipeline / plain telephony), so whatever takes Matrix down can't take the fallback down with it. The periodic drill exists to catch that independence quietly eroding over time (e.g. someone later routing the "fallback" through something that itself depends on the Matrix stack).

### Implementation steps (not started)
- [ ] Stand up `synapse` + dedicated Postgres + `element-web` + `coturn` in a new Docker Compose stack, federation disabled, native registration disabled
- [ ] Configure `oidc_providers` against the existing Keycloak realm; `localpart_template` derived from `sub`
- [ ] Verify/close the pre-approval login gap above
- [ ] Build the thin adapter (proactive provisioning at approval, alias-change sync, removal → deactivate erase:false, nightly reconciliation)
- [ ] Enable E2EE by default on every room the adapter creates
- [ ] Lock down the Admin API to the internal Docker network only; secret-managed token; call logging
- [ ] Configure `turn_shared_secret` for coturn (time-boxed credentials, not static)
- [ ] Wire the SMS/Telegram parallel-notification hook for calls and group-adds
- [ ] Nginx routing for Element Web only (`/_matrix/client`, `/_matrix/media`, `/.well-known/matrix/*`), consistent with existing MFE serving pattern
- [ ] Container restart policies + healthchecks + Postgres backup schedule
- [ ] Phase 2 (deferred): Element Call/LiveKit stack for group video conferencing

---

## Open items for later
- Rotation strategy for the encryption key (envelope encryption / KEK+DEK) — not required for v1, noted for future hardening.
- Whether historical `visitor_pass` rows should ever be retroactively re-labelled with alias (currently: no, out of scope).
