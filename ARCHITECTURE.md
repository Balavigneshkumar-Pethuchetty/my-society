# Society Events — Architecture

This document describes what is actually built and wired up today. For dev commands, DB
migration conventions, the module-federation routing convention, and the Cloudflare tunnel,
see [CLAUDE.md](CLAUDE.md) — this file focuses on **what each service/page actually does**.

## Overview

**6 backend microservices** (all Python/FastAPI) + **1 shell + 6 micro-frontends**, behind a
single nginx gateway. The first five backend services share one PostgreSQL database
(`society_events`) — see CLAUDE.md's "single-tenant, shared-database" note for why
cross-service direct table writes are the norm here, not a bug. `visitor-service` is the
exception: it has its **own** dedicated Postgres container and schema, and never touches
`society_events`.

| Service | Port | Nginx prefix | Database |
|---|---|---|---|
| user-service | 3001 | `/api/users/` | `society_events` (shared) |
| event-service | 3002 | `/api/events/` | `society_events` (shared) |
| registration-service | 3005 | `/api/registrations/` (includes `/complimentary/*`) | `society_events` (shared) |
| ticket-service | 3006 | `/api/tickets/` | `society_events` (shared) |
| payment-service | 3007 | `/api/payments/` | `society_events` (shared) |
| visitor-service | 3008 | `/api/visitors/` | `visitor` (own container) |

## Backend services

### user-service (3001)

Identity, roles, building/unit structure, notifications.

- **Users**: Keycloak-JWT sync/upsert on first login, own-profile get/update, apartment/unit self-assignment, admin listing with role/active filters, approve/reject pending registrations, role change, activate/deactivate/revoke (with Keycloak realm-role sync), permanent delete. All admin mutations are written to an `admin_actions` audit table.
- **Building structure**: configurable hierarchy level names, structure-node tree CRUD, unit-assignment request workflow (resident requests a flat, admin approves/rejects).
- **Notifications**: list (with unread filter), mark one/all read — drives the bell icon.
- **Auth-adjacent**: `POST /users/forgot-password` delegates to Keycloak's Admin API to send the reset email (no SMTP of its own here).
- **Internal-only** (`X-Internal-Key` header): resolve Keycloak `sub` → user, or internal UUID → user, for other services.

### event-service (3002)

Event lifecycle + content. Does **not** own registrations, tickets, or payments.

- **Events**: paginated/filterable listing, detail, create (starts as `draft`), update, publish, cancel, complete, delete (draft only). `cancel_freeze_at` (self-cancel deadline) is validated to always be before `start_time`.
- **Categories**: CRUD.
- **Announcements**: per-event, reverse-chronological.
- **Ticket types**: per-event named ticket tiers (price, free/paid, capacity, sort order, active flag).

Registrations, tickets, and payments are entirely owned by other services — `event-service` mounts only the `events` and `categories` routers.

### registration-service (3005)

Owns the booking lifecycle end to end: cart → registration → payment review → complimentary tickets → cancellation.

- **Cart**: one saved cart per user (`PUT`/`GET`/`DELETE /registrations/cart`), cleared on successful registration.
- **Registration**: create (free events auto-confirm; paid events start `pending_payment`), list own, get one, cancel. A user may hold **multiple** registrations for the same event (no uniqueness constraint — e.g. buying an extra ticket for a guest is allowed). Cancelling a **confirmed** registration is blocked for residents unless the event's `cancel_freeze_at` is unset (always allowed until start) or still in the future; cancelling also cancels the linked `ticket` row and, if a `payment_transaction` was `verified`, flips it to `refund_requested` for the admin refund queue. Cancellation optionally accepts a `refund_upi_id` (the frontend prompts for it) — stored on the transaction, falling back to `payer_upi` from the original payment when omitted.
- **Manual payment (legacy flow)**: UPI QR generation with the amount pre-filled, screenshot upload (`pending_review`), admin `PATCH /registrations/{id}/review` (approve/reject).
- **Complimentary tickets** (`/complimentary/*`, i.e. `/api/registrations/complimentary/*`): admin/committee issue a **real** registration + ticket (QR-scannable, shows up in the normal gate-scan flow) to a named guest on behalf of an organizer/committee member/sponsor, or log an anonymous walk-in headcount (no ticket). Guests without an account get a lightweight placeholder `users` row (`role='guest'`, no `keycloak_sub`, can never log in). Revoke is a soft-cancel (keeps the row for audit, cancels the linked registration+ticket). Named tickets with an email on file can be emailed (QR embedded inline) via Gmail SMTP — see `app/email.py`.

### ticket-service (3006)

Ticket issuance, QR display, gate entry.

- **Lazy issuance**: `GET /tickets/my` scans for the caller's `confirmed` registrations with no ticket yet and issues one on the spot (idempotent). This is how paid/free resident checkouts get a ticket — there's no explicit "issue" call from the checkout flow itself.
- **QR**: `GET /tickets/{id}/qr` is a **public**, unauthenticated SVG endpoint (safe because the QR only contains an opaque token) — used both by residents' "Show Ticket" dialog and by the admin Complimentary Tickets page.
- **Gate entry**: `POST /tickets/scan` (by QR token) or `POST /tickets/{id}/enter` (by ticket ID) mark a ticket `used`, set `scanned_at`/`scanned_by`, and flip the linked registration to `attended`. Idempotent — re-scanning an already-used ticket returns `already_scanned: true` instead of erroring.
- **Roster**: `GET /tickets/event/{event_id}` — full attendee list for an event (security/admin/committee).
- Admin-only `DELETE /tickets/{id}` cancels a ticket directly (can't cancel an already-`used` one) — separate from, and lower-level than, registration-service's cancel flow.

### payment-service (3007)

UPI payment reconciliation and refunds — **not** a Razorpay/card gateway; there is no such integration anywhere in this codebase.

- **Transactions** (`/payments`): `initiate` (builds a local UPI intent/QR), `{txn_ref}/screenshot` (attach the resident's proof screenshot; best-effort AI field extraction to *prefill* the review form — not verification), `{txn_ref}/confirm-details` (resident submits the reviewed details; this is what notifies the organizer), get/list/`my`, manual `verify`/`approve`/`reject` (admin/committee), `refund-request` (flag a verified transaction for refund).
- **Refund queue** (`/refunds`): list transactions in `refund_requested` status; admin/committee log the refund UTR + transfer screenshot (`{txn_ref}/complete`) to close it out. `GET /refunds/{txn_ref}/qr` generates a scannable `upi://pay` QR (pre-filled payee UPI ID, amount, reference) so the admin can pay from their own UPI app instead of hand-copying details. `{txn_ref}/extract-screenshot` is a read-only AI prefill of the refund UTR from the transfer screenshot.
- **Reconciliation** (`/reconciliation`, `/recon-settings`): this service has its **own** IMAP-polling + Ollama-LLM screenshot-parsing implementation (`app/reconciliation/`, `aioimaplib` dependency) and its own settings UI (IMAP host/creds, Ollama host/model, test-connection endpoints). Surfaced in `ReconciliationConsole.tsx`.
- **Committee registry** (`/registry`): assigns a committee member + UPI ID as the payment collector for a given event, plus that event's own IMAP mailbox config for auto-reconciliation. Configured per-event from the **Event Payment Settings** tab inside the Edit Event / Event Details dialogs (there is no standalone collector-registry admin page any more).
- **Audit** (`/audit`): reconciliation status-change log.

**AI-assisted verification is currently disabled** (manual-only payment flow). The endpoints that cross-checked a screenshot against a bank email and auto-completed a payment/refund on a `CONFIRMED` verdict — `POST /payments/verify-screenshot`, `/payments/auto-confirm`, `/payments/parse-screenshot`, `/refunds/{txn_ref}/verify-screenshot` — are commented out in `services/payment/app/routes/{payments,refunds}.py` with `DISABLED (manual-only payment flow)` markers and re-enable notes. The resident checkout (`frontend/mfe-payment/src/PaymentApp.tsx`) calls only **this** repo's payment-service (`/api/payments/payments/initiate` → `/screenshot` → `/confirm-details`); it does **not** call the external `pay.gm-global-techies-town.club` domain or any SSE stream. (The **separate, standalone** sibling project `~/payment_reconcilation_service` still exists and does similar IMAP+LLM work — see CLAUDE.md — but this repo's checkout no longer talks to it.)

### visitor-service (3008)

Visitor / guest gate passes — **isolated from the events system**: its own `visitor-postgres` container, own schema (`services/visitor/db/init/01_schema.sql`), own uploads volume. Shares only Keycloak (same JWTs/roles) and nginx.

- **Passes** (`/passes`): resident creates a pass for an expected visitor (single or group), lists their household's passes, edits/extends/deletes a still-pending pass, gets a raw QR PNG or a full composited shareable pass image, and triggers phone verification (security confirms the code) for the visitor.
- **Gate** (`/gate`): security previews a pass by QR token (no state change), then `POST /gate/scan` admits or exits the group — **partial admission is allowed** (some of a group in now, the rest later) and entry is **not capped** at the declared group size. Walk-ins with no pass are logged via `/gate/anonymous` (+ vehicle-number correction, exit). `/gate/today` is the live activity feed; `/gate/photos` stores a captured visitor photo.
- **Ledger & settings** (`/ledger`, `/settings`): filtered visitor history with Excel/PDF export and a photo viewer; notification-rule settings. `/ledger/aadhaar-status` is a **stub** — Aadhaar verification is not implemented, only scaffolded for a future integration.

## Frontend

`frontend/shell` (host, port 3000) + 6 independently-buildable module-federation remotes: `mfe-events` (4001), `mfe-booking` (4002), `mfe-payment` (4003), `mfe-admin` (4004), `mfe-tickets` (4005), `mfe-visitors` (4006). See CLAUDE.md for the federation/routing convention (URL path → `page`/`id` props → remote dispatcher).

Resident-facing apps (`mfe-events`, `mfe-booking`, `mfe-payment`, `mfe-tickets`) are all real and backend-wired. `mfe-visitors` (three dashboards — resident, security, admin) is real and backed by `visitor-service`.

### mfe-admin — reality check

`mfe-admin` exposes three route trees (`ManageRoutes` at `/manage/*`, `AdminRoutes` at `/admin/*`, `SponsorApp` at `/sponsor`) and bundles the admin pages below. As of 2026-08-29 every page here is backend-wired; the one remaining mock is a **single tab** ("Resident Payment Refunds" inside `SponsorshipRefunds.tsx`, noted below). Still worth confirming against the code before building on a page:

| Page | Status |
|---|---|
| `ManageEvents.tsx` | Real — ticket-type CRUD for an event lives inline here, in the `TicketTypesTab` shown inside the Edit Event dialog. |
| `ComplimentaryTickets.tsx` | Real |
| `EventDetails.tsx` | Real — Purchases/Attendance/Complimentary (registration-service, ticket-service), Finance & Expenses / Vendors / Revenue (payment-service's `funds.py`, added below), and an **Event Payment Settings** tab (collector UPI ID + per-event IMAP mailbox via `/registry/{eventId}/settings`). Also has Download Excel/PDF and Copy Share Link on the Finance tab. |
| `ReconciliationConsole.tsx` | Real |
| `RefundTasks.tsx` | Real |
| `PaymentApprovals.tsx` | Real |
| `UserApproval.tsx` | Real |
| `LeaveRequests.tsx` | Real — leave-society request review (user-service `/leave-requests`). |
| `CategoryManagement.tsx` | Real — event-category CRUD (event-service `/categories`). |
| `BuildingStructure.tsx` | Real |
| `UnitManagement.tsx` | Real |
| `SponsorDashboard.tsx` | Real — a sponsor's own view of their sponsorships + refund requests (`payment-service`'s `sponsors.py`). |
| `SponsorManagement.tsx` | Real — sponsor directory CRUD + link sponsor to event. |
| `SponsorshipRefunds.tsx` | Real for the "Sponsorship Refunds" tab (approve/reject/mark-processed). The "Resident Payment Refunds" tab alongside it is still a non-functional placeholder tab — that flow lives at `/pay-refunds` (`RefundTasks.tsx`) instead. |

`payment-service` owns two new route groups beyond payments/refunds/reconciliation/registry:
- **`funds.py`** (`/api/payments/funds/*`): per-event expenses (`event_expense`), the shared vendor directory + per-event assignment (`vendor`/`event_vendor`), revenue distribution pools (`vendor_revenue_distribution`/`distribution_entry`), a finance summary wrapping the `v_event_finance` view, and Excel/PDF export — both an authenticated download and a public, unauthenticated, token-based share link (`fund_export_link` table, same pattern as `ticket-service`'s public QR endpoint).
- **`sponsors.py`** (`/api/payments/sponsors/*`): sponsor directory CRUD, per-event sponsorships (`event_sponsorship`), and the sponsorship refund workflow (`sponsorship_refund`, pending→approved/rejected→processed).

### Event-organizer isolation model (event-service + payment-service)

Per-event management and fund/sponsorship data is scoped to **an event's organizer + explicitly-approved members only — absolute isolation, no admin/committee_member bypass**:

- `event_permission` table (event_id, user_id, granted_by, granted_at, revoked_at) is the delegation mechanism. `GET/POST /events/{id}/permissions` (list/grant) and `DELETE /events/{id}/permissions/{user_id}` (revoke) are organizer-only — approved members don't get to grant further access. Surfaced as a "Manage Access" dialog in both `ManageEvents.tsx` and `mfe-events`' `MyEvents`.
- `require_event_access()` (identical dependency duplicated in `event-service` and `payment-service`'s `auth.py`, since payment-service reads `event`/`event_permission` directly from its own DB connection — this repo's established cross-service direct-table-read pattern) replaces the old `require_role_or_organizer("admin","committee_member")` bypass on: all of `events.py`'s management routes (update/publish/cancel/complete/delete/announcements/ticket-types) and every per-event route in `funds.py`/`sponsors.py` (expenses, vendors, revenue-distribution, export, share-link, sponsorship create/update, refund approve/reject/process).
- **Deliberately left at admin/committee_member** (not per-event data, out of scope): the sponsor *directory* CRUD, `GET /sponsors/{id}/sponsorships` (a sponsor's own cross-event view), `GET /sponsors/refunds` (global queue), and pre-existing cross-event operational consoles (`PaymentApprovals.tsx`, `RefundTasks.tsx`, `ReconciliationConsole.tsx`).
- **Backfill**: migration `021_event_permission_backfill.sql` granted every admin/committee_member `event_permission` on every event that existed before this shipped, so existing access wasn't suddenly revoked. Events created after that migration are isolated from creation — visible only to their organizer until explicitly shared.
- **Deletion**: `DELETE /events/{id}` now also allows `completed` (previously draft-only), for the organizer/an approved member. Pre-launch decision (no production data yet): deletion **fully cascades** — registrations, tickets, payment records, expenses, sponsorships, everything tied to the event is removed together (migration `022_event_delete_cascade_payments.sql` changed `payment_transaction.event_id`'s FK from RESTRICT to CASCADE, which was the last thing blocking it).
- `mfe-events`' `MyEvents` also has a per-event "Funds" view (finance summary, expense log, export/share-link) so an organizer has somewhere to see their own event's money without needing `/manage` access.
