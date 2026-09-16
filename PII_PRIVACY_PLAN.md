# PII Privacy Plan

Status: **implemented, not yet deployed** (code + migration written 2026-09-15; not yet applied to a running database or backfilled — see Deployment below). Scope: encrypt resident **phone number and email** at rest, while keeping multi-device login and OTP/email-based account recovery fully working. Doing both together rather than phone-only was a deliberate call: the crypto utility, key management, and migration mechanics are shared infrastructure either way, so the marginal cost of adding email was small. Everything broader that was explored earlier (alias names, Aadhaar handling, registration-flow rework, the emergency-communication service) is parked at the bottom — not deleted, just not part of the active plan right now.

---

## Goal

Protect `users.phone` and `users.email` so that a Postgres superuser / pgAdmin session with full `SELECT` on the table cannot read either in plaintext — only the application (holding a key that never touches Postgres) can. This must not break:

1. **Multi-device login** — a resident logging in from a new device must keep working exactly as today.
2. **Forgot-password / account recovery via OTP or email** — must keep working exactly as today.
3. **(Later, not now)** securely sharing a phone number between two residents, time-boxed. Noted as a future step; not designed in this pass.

## Why this is application-level encryption, not true E2EE

Real end-to-end encryption means only the resident's own device ever holds the decryption key — no server component could read the plaintext, ever. That's incompatible with requirement 1/2 here: sending an OTP SMS, or including the phone number in a recovery flow, requires *some* server-side component to read the plaintext number before it can hand it to the SMS/Telegram/email transport. If the key only lived on the resident's device, no service could ever send them that OTP in the first place.

So the actual design is **application-level encryption**: the app holds the key (in a secret/env var, never in Postgres, never as a SQL literal), decrypts in memory only at the moment it legitimately needs to (looking up an account by phone/email, sending an OTP, sending a notification, driving the forgot-password flow). This still fully satisfies the threat being defended against — a DB-level attacker (pgAdmin session, stolen Postgres credentials, a leaked backup) gets ciphertext, not a phone number or email address — it's just not literally end-to-end between two human devices.

## Where phone and email are actually read today (confirmed via codebase scan)

- **Phone-login / OTP recovery** (`PhoneLogin.tsx` → `POST /auth/phone-login/request`, `services/user/app/routes/users.py:718`): reads `users.phone` in `services/user`'s own Postgres via `_eligible_login_user()` (`users.py:702-710`, `WHERE phone = $1 AND phone_verified = TRUE AND keycloak_sub IS NOT NULL`), then forwards the plaintext number to `~/auth-service`'s `POST /api/otp/request`, which sends the OTP itself. On verify (`users.py:763-812`), `_eligible_login_user` is re-checked (line 793) before a Keycloak token is minted via RFC 8693 exchange (`services/user/app/otp_bridge.py`). Needs both `phone_hash` lookup and decrypt capability.
- **Forgot-password recovery** (`ForgotPassword.tsx` → `POST /forgot-password`, `users.py:51-138`) is **email-only**: guard-checks `users.email` locally (`users.py:57-59`, effectively `WHERE email = $1`), then drives Keycloak's own built-in reset flow (`execute-actions-email` with `UPDATE_PASSWORD` against the email Keycloak has on file). This is the email counterpart to phone's OTP-login path — needs `email_hash` lookup, and the plaintext email decrypted in memory before it's used to call Keycloak's admin API (which needs the real address to find/email the right Keycloak account).
- **Multi-device login** goes through Keycloak session/token issuance and doesn't read `users.phone`/`users.email` at all — unaffected by this change regardless of implementation details.
- **All other `users.phone`/`users.email` read/write call sites found in `services/user`** (the only service that queries this table directly — every other service calls its HTTP API instead, confirming the Users-API-isolation pattern already holds):
  - `notifications.py:34` — admin broadcast recipient list (`SELECT id, phone, email, ...`)
  - `routes/leave_requests.py:191` (`SELECT name, email, phone, ...`), `:388` (`SELECT phone, email ...`) — leave-request review/audit reads
  - `routes/users.py:144` (`_USER_COLS`, used broadly for profile/admin-listing responses — covers both columns), `:312` (profile update writes `phone`; confirm whether email is updatable the same way), `:330` (`WHERE phone=$1 AND keycloak_sub != $2` uniqueness check — confirm whether an equivalent email-uniqueness check exists nearby), `:341`, `:603`, `:680` (self-verify-own-number flow), `:1191` (resident emergency directory: `SELECT u.phone ...`)
  - Every one of these needs to move to `phone_hash`/`email_hash` for lookups/uniqueness, or add a decrypt-after-`SELECT` step where the plaintext value itself is returned/used.
- **Keycloak's own store**: no sync/webhook pushes phone/email to Keycloak from `services/user`, and no JWT claim carries phone — email is read from `users.email`, not the JWT. Whether Keycloak's internal user store independently duplicates phone/email as its own attribute is **unverified from this repo** — `~/auth-service`'s own `PII_PRIVACY_PLAN.md` flags the same open question from its side, and it matters more for email here since the forgot-password flow explicitly calls Keycloak's admin API by email. **Reconcile the two plans before implementing** rather than each guessing at the other side.

## Approach

- **AES-256-GCM**, application-level, for both `phone` and `email`. Encrypt before `INSERT`/`UPDATE`, decrypt after `SELECT`, entirely in application code — never in a Postgres function or query literal (`pgcrypto`'s `pgp_sym_encrypt` is ruled out for this reason: the key would have to pass through Postgres as a literal, which lands in query logs and defeats the threat model).
- Since both columns are `UNIQUE` and looked up by value (`WHERE phone = $1` for login/OTP, `WHERE email = $1` for forgot-password), add **blind-index** columns `phone_hash` / `email_hash` — deterministic HMAC-SHA256, each with its own key separate from the AES key(s). Move the `UNIQUE` constraints to the hash columns. All lookups query the hash column; plaintext values never transit through a SQL `WHERE` clause, so they never land in Postgres query logs either.
- Key(s) live only in `services/user`'s env/secret — never in Postgres, never committed, never reused from the JWT signing key. Using a shared AES key for both columns vs. one key per column is a minor decision to make during implementation; separate keys are marginally safer (a leaked key exposes one field, not both) at negligible extra complexity, since the key-management plumbing is already being built regardless.
- Multi-device login is unaffected by this change — it doesn't depend on how phone/email are stored, only on Keycloak session/token issuance, which this doesn't touch.
- OTP-login and forgot-password recovery are both unaffected functionally: each lookup becomes `WHERE <field>_hash = HMAC(input)` instead of `WHERE <field> = input`, and the plaintext value is decrypted in memory immediately before being handed to the SMS/Telegram send call or Keycloak's admin API — same behavior the resident sees, different storage underneath.

## What was actually built (2026-09-15)

Two more denormalized snapshot columns were found during implementation, beyond what the earlier codebase scan surfaced — `admin_actions.target_user_email` (audit log) and `leave_request.user_email` (leave-request snapshot) both copy `users.email` verbatim at write time, so they hold plaintext today and needed the same treatment.

- **`services/user/app/crypto.py`** (new) — `encrypt()`/`decrypt()` (AES-256-GCM, `cryptography`'s `AESGCM`) and `blind_index()` (HMAC-SHA256), both None-safe. Smoke-tested standalone: round-trip correctness, nonce randomness (two encryptions of the same value produce different ciphertext but decrypt identically), and tamper/garbage-input rejection.
- **`services/user/app/config.py`** — added required `pii_encryption_key` / `pii_hash_key` settings (no default — fails fast at startup like `db_password`/`internal_api_key`, not silently at first use).
- **`db/migrations/038_encrypt_phone_email.sql`** (new) + mirrored in `db/init/01_schema.sql` — widens `users.phone`/`users.email` to `TEXT`, adds `phone_hash`/`email_hash`, moves the `UNIQUE` constraints onto the hash columns (confirmed the real constraint name, `users_phone_unique`, against the running test DB rather than guessing), widens `admin_actions.target_user_email` and `leave_request.user_email` to `TEXT`, and clears `otp_login_sessions` (write-only, never read back by any query, 24h TTL — cheaper to invalidate than to add plaintext-vs-ciphertext detection for a column nothing reads).
- **`services/user/app/scripts/backfill_pii_encryption.py`** (new) — one-off, idempotent: `users` rows are selected by `phone_hash`/`email_hash IS NULL`; the two snapshot columns (no hash column of their own) use a decrypt-attempt-first check (a plaintext string passing both base64 decode *and* AES-GCM's authentication tag by chance is cryptographically negligible).
- **Code changes**, all verified by importing every touched module (`app.main` boots cleanly with all routers registered):
  - `routes/users.py`: `_row_to_user` (single centralized decrypt point — covers `get_me`/`sync`/`get_user`/avatar endpoints/apartment endpoints, and `internal.py`'s by-sub/by-ids/by-email for free since it imports this helper), `sync_user` (encrypt + hash on upsert), `update_me` (encrypt + hash on phone update, hash-based uniqueness/change-detection), `forgot_password` (hash-based guard lookup — email itself is request input, never decrypted), `request_phone_verification` (decrypt before handing to auth-service), `_eligible_login_user` (hash-based lookup, used by both phone-login request and verify), `verify_phone_login`'s `otp_login_sessions` insert (now encrypts), `resident_directory` (decrypt per row), `get_admin_stats`'s `recent_actions` (decrypt `target_user_email` — found via a full sweep of `admin_actions` reads, not in the original scan).
  - `routes/internal.py`: `get_by_email` → hash-based lookup.
  - `routes/leave_requests.py`: `_to_response` (centralized decrypt of the `user_email` snapshot — covers list/create/approve/reject/revoke), the detail-view `profile` query, and the approval-notification `recipients` build.
  - `routes/building.py`: `_build_request_response` (centralized decrypt of `user_email` — covers create/list/review unit-assignment requests).
  - `notifications.py`: `notify_admins` decrypts phone/email before returning recipients to `send_channels`.
  - `admin_actions`/`leave_request` INSERTs themselves needed **no code change** — they already copy `users.email` as read (now ciphertext), so the snapshot is ciphertext for free; only the *read/display* paths above needed decrypting.
- **Env/deployment wiring**: `PII_ENCRYPTION_KEY`/`PII_HASH_KEY` added to `services/user/requirements.txt` (`cryptography==50.0.1`, pinned explicitly though already pulled transitively), `.env.example` + `.env.test.example` (both root and `services/user/`), and both `docker-compose.yml` files (root and `services/user/`'s standalone one).

## Deployment (not yet done — this is what's left)

- [ ] Generate real `PII_ENCRYPTION_KEY`/`PII_HASH_KEY` values and set them in the real `.env`/`.env.test` (gitignored — not touched by this work) — generator command is in `.env.example`'s comment
- [ ] Reconcile with `~/auth-service`'s own `PII_PRIVACY_PLAN.md` on whether Keycloak's internal store duplicates phone/email as its own attributes — still unresolved, matters more for email given the forgot-password → Keycloak admin API dependency
- [ ] Apply `db/migrations/038_encrypt_phone_email.sql` to the target database
- [ ] Stop `user-service`, run `docker compose run --rm user-service python -m app.scripts.backfill_pii_encryption`, then restart with the updated code — **do not** split this across a window where old and new code both handle live traffic (see the migration file's deployment-order comment)
- [ ] Manual verification: log in from a second device with an existing account; run the OTP phone-login flow end to end; run the forgot-password/email-recovery flow end to end
- [ ] Manual verification: confirm a pgAdmin/`psql` session against `users` shows only ciphertext + hashes, never a readable phone number or email address

## Later (not now): secure phone-number sharing between residents

Deferred, not designed in this pass. When picked up, the shape most consistent with this design is a **time-boxed reveal grant**: the owning resident creates a short-lived, single-use (or view-capped) token scoped to one recipient; redeeming it decrypts `phone` in memory just for that request and logs the access (who/when) as a durable record; the token stops working after its expiry regardless of whether it was used. This reuses the same decrypt capability being built now — no new crypto, just an access-grant layer on top — but the grant/audit-log schema itself isn't designed yet.

---

## Parked ideas (explored earlier — not part of the active plan; revisit only if asked)

- **Alias names** replacing real names for admin/committee/security/co-resident-facing views (~20+ endpoints scanned across 5 services) — real product value independent of the encryption threat model, but out of scope for this pass.
- **Aadhaar handling via DigiLocker** consent-based verification instead of storing the raw number at all — recommended direction if/when Aadhaar handling for visitor passes is revisited; better than encrypting a number you don't need to hold in the first place.
- **Registration-flow rework** — flat-number capture at registration, one-time decrypted PII exposure at first admin approval, trust notification to the registrant.
- **Emergency-communication service** (self-hosted Matrix/Synapse, alias-keyed E2EE chat/voice/video/voice-message/video-message) — see [COMMUNICATION_SERVICE_PLAN.md](COMMUNICATION_SERVICE_PLAN.md), tracked independently, not currently prioritized.
- **Time-boxed emergency sharing of blood group/Aadhaar/family-member contacts with an audit trail** — same reveal-grant primitive as the phone-sharing idea above, just a larger field set; revisit together if either is picked back up.

## Open items for later
- Rotation strategy for the encryption key (envelope encryption / KEK+DEK) — not required for v1, noted for future hardening.
