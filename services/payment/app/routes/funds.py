"""Per-event fund tracking: expenses, vendors, and revenue distribution.

Every per-event route requires `require_event_access`/`_has_event_access` — organizer or
approved member of that specific event, no admin/committee_member bypass (absolute
isolation). The shared vendor *directory* (`/vendor-directory`) is deliberately left at the
existing admin/committee_member level — it isn't per-event data.
"""
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from app.auth import _has_event_access, get_current_claims, require_event_access, require_role
from app.config import settings
from app.database import get_pool
from app.event_client import get_event
from app.fund_export import build_pdf, build_xlsx, fetch_fund_export_data
from app.models import (
    DistributionEntryCreate, DistributionEntryOut,
    EventVendorCreate, EventVendorOut, EventVendorUpdate,
    ExpenseCreate, ExpenseOut, ExpenseUpdate,
    FinanceSummaryOut, FundShareLinkOut,
    RevenueDistributionCreate, RevenueDistributionOut,
    VendorCreate, VendorOut,
)
from shared.user_client import get_by_ids, get_by_sub

router = APIRouter()

_SOCIETY = settings.society_id
_SHARE_LINK_TTL_DAYS = 7

_EXPENSE_SELECT = (
    "SELECT ex.id::text, ex.event_id::text, ex.description, ex.amount, "
    "ex.currency_code, ex.category, ex.receipt_url, "
    "ex.created_by::text, ex.created_at "
    "FROM event_expense ex "
)

_EVENT_VENDOR_SELECT = (
    "SELECT ev.id::text, ev.event_id::text, ev.vendor_id::text, "
    "v.name AS vendor_name, v.category AS vendor_category, "
    "ev.stall_number, ev.fee_type, ev.fixed_fee, ev.revenue_share_pct, "
    "ev.actual_revenue, ev.status, ev.notes, ev.created_at "
    "FROM event_vendor ev JOIN vendor v ON v.id = ev.vendor_id "
)

_DIST_ENTRY_SELECT = (
    "SELECT de.id::text, de.distribution_id::text, de.recipient_type, "
    "de.recipient_user_id::text, de.recipient_sponsor_id::text, "
    "s.organization_name AS sponsor_org_name, "
    "de.share_percentage, de.amount, de.status, de.paid_at, de.notes "
    "FROM distribution_entry de "
    "LEFT JOIN sponsor s ON s.id = de.recipient_sponsor_id "
)


async def _hydrate_expense_rows(rows) -> list[dict]:
    """users now lives behind user-service's own API (see DB_ISOLATION_PLAN.md)
    — resolve the logger's name via a batch call instead of a JOIN."""
    users = await get_by_ids(r["created_by"] for r in rows)
    hydrated = []
    for r in rows:
        d = dict(r)
        d["created_by_name"] = users.get(d["created_by"], {}).get("name")
        hydrated.append(d)
    return hydrated


async def _hydrate_dist_entries(rows) -> list[dict]:
    """A distribution-entry recipient is either a user or a sponsor (never both);
    users now lives behind user-service's own API, sponsor stays a direct
    lookup (payment-service's own table)."""
    users = await get_by_ids(r["recipient_user_id"] for r in rows if r["recipient_user_id"])
    hydrated = []
    for r in rows:
        d = dict(r)
        sponsor_name = d.pop("sponsor_org_name")
        user_name = users.get(d["recipient_user_id"], {}).get("name") if d["recipient_user_id"] else None
        d["recipient_name"] = user_name or sponsor_name
        hydrated.append(d)
    return hydrated


async def _require_event(conn, event_id: str) -> None:
    event = await get_event(event_id)
    if not event or event["society_id"] != _SOCIETY:
        raise HTTPException(status_code=404, detail="Event not found")


# ── Finance summary ───────────────────────────────────────────────────────────

@router.get("/{event_id}/summary", response_model=FinanceSummaryOut,
            summary="Per-event income/expense/net-balance summary")
async def get_summary(
    event_id: str,
    claims: dict = Depends(require_event_access()),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT event_id::text, title, status, ticket_revenue, sponsorship_income, "
            "total_expenses, vendor_pool, net_balance, sponsor_count, complimentary_tickets "
            "FROM v_event_finance WHERE event_id = $1::uuid",
            event_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Event not found")
    return dict(row)


# ── Expenses ───────────────────────────────────────────────────────────────────

@router.get("/{event_id}/expenses", response_model=list[ExpenseOut],
            summary="List expenses for an event")
async def list_expenses(
    event_id: str,
    claims: dict = Depends(require_event_access()),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        await _require_event(conn, event_id)
        rows = await conn.fetch(
            _EXPENSE_SELECT + "WHERE ex.event_id = $1::uuid ORDER BY ex.created_at DESC",
            event_id,
        )
    return await _hydrate_expense_rows(rows)


@router.post("/{event_id}/expenses", response_model=ExpenseOut, status_code=201,
             summary="Log an expense for an event")
async def create_expense(
    event_id: str,
    body: ExpenseCreate,
    claims: dict = Depends(require_event_access()),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        await _require_event(conn, event_id)
        creator = await get_by_sub(claims.get("sub", ""))
        if not creator:
            raise HTTPException(status_code=404, detail="User record not found")
        row = await conn.fetchrow(
            "INSERT INTO event_expense (event_id, description, amount, currency_code, "
            "category, receipt_url, created_by) "
            "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::uuid) RETURNING id",
            event_id, body.description, body.amount, body.currency_code,
            body.category, body.receipt_url, creator["id"],
        )
        full = await conn.fetchrow(_EXPENSE_SELECT + "WHERE ex.id = $1::uuid", row["id"])
    return (await _hydrate_expense_rows([full]))[0]


@router.put("/expenses/{expense_id}", response_model=ExpenseOut,
            summary="Update an expense")
async def update_expense(
    expense_id: str,
    body: ExpenseUpdate,
    claims: dict = Depends(get_current_claims),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        existing = await conn.fetchval("SELECT event_id::text FROM event_expense WHERE id=$1::uuid", expense_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Expense not found")
        if not await _has_event_access(conn, claims.get("sub"), existing):
            raise HTTPException(status_code=403, detail="You don't have access to this event")

        updates: list[str] = []
        params: list = []
        idx = 1
        for field in ("description", "amount", "currency_code", "category", "receipt_url"):
            val = getattr(body, field)
            if val is not None:
                updates.append(f"{field} = ${idx}")
                params.append(val)
                idx += 1
        if not updates:
            raise HTTPException(status_code=422, detail="No fields to update")
        params.append(expense_id)
        await conn.execute(f"UPDATE event_expense SET {', '.join(updates)} WHERE id=${idx}::uuid", *params)
        full = await conn.fetchrow(_EXPENSE_SELECT + "WHERE ex.id = $1::uuid", expense_id)
    return (await _hydrate_expense_rows([full]))[0]


@router.delete("/expenses/{expense_id}", status_code=204, summary="Delete an expense")
async def delete_expense(
    expense_id: str,
    claims: dict = Depends(get_current_claims),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        existing = await conn.fetchval("SELECT event_id::text FROM event_expense WHERE id=$1::uuid", expense_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Expense not found")
        if not await _has_event_access(conn, claims.get("sub"), existing):
            raise HTTPException(status_code=403, detail="You don't have access to this event")
        await conn.execute("DELETE FROM event_expense WHERE id=$1::uuid", expense_id)


# ── Vendor directory (shared across events) ───────────────────────────────────

@router.get("/vendor-directory", response_model=list[VendorOut],
            summary="List the shared vendor directory")
async def list_vendor_directory(
    claims: dict = Depends(require_role("admin", "committee_member")),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id::text, name, category, contact_name, contact_email, contact_phone, "
            "is_active, created_at FROM vendor WHERE society_id = $1::uuid ORDER BY name",
            _SOCIETY,
        )
    return [dict(r) for r in rows]


@router.post("/vendor-directory", response_model=VendorOut, status_code=201,
             summary="Add a vendor to the shared directory")
async def create_vendor(
    body: VendorCreate,
    claims: dict = Depends(require_role("admin", "committee_member")),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "INSERT INTO vendor (society_id, name, category, contact_name, contact_email, contact_phone) "
            "VALUES ($1::uuid, $2, $3, $4, $5, $6) "
            "RETURNING id::text, name, category, contact_name, contact_email, contact_phone, is_active, created_at",
            _SOCIETY, body.name, body.category, body.contact_name, body.contact_email, body.contact_phone,
        )
    return dict(row)


# ── Per-event vendor assignment ───────────────────────────────────────────────

@router.get("/{event_id}/vendors", response_model=list[EventVendorOut],
            summary="List vendors invited/confirmed for an event")
async def list_event_vendors(
    event_id: str,
    claims: dict = Depends(require_event_access()),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        await _require_event(conn, event_id)
        rows = await conn.fetch(
            _EVENT_VENDOR_SELECT + "WHERE ev.event_id = $1::uuid ORDER BY ev.created_at DESC",
            event_id,
        )
    return [dict(r) for r in rows]


@router.post("/{event_id}/vendors", response_model=EventVendorOut, status_code=201,
             summary="Invite a vendor to an event")
async def add_event_vendor(
    event_id: str,
    body: EventVendorCreate,
    claims: dict = Depends(require_event_access()),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        await _require_event(conn, event_id)
        vendor_exists = await conn.fetchval("SELECT 1 FROM vendor WHERE id=$1::uuid", body.vendor_id)
        if not vendor_exists:
            raise HTTPException(status_code=404, detail="Vendor not found")
        try:
            row = await conn.fetchrow(
                "INSERT INTO event_vendor (event_id, vendor_id, stall_number, fee_type, "
                "fixed_fee, revenue_share_pct, notes) "
                "VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7) RETURNING id",
                event_id, body.vendor_id, body.stall_number, body.fee_type,
                body.fixed_fee, body.revenue_share_pct, body.notes,
            )
        except Exception as exc:
            if "unique" in str(exc).lower():
                raise HTTPException(status_code=409, detail="Vendor already invited to this event") from exc
            raise
        full = await conn.fetchrow(_EVENT_VENDOR_SELECT + "WHERE ev.id = $1::uuid", row["id"])
    return dict(full)


@router.put("/vendors/{event_vendor_id}", response_model=EventVendorOut,
            summary="Update a vendor's event assignment (stall, fees, status)")
async def update_event_vendor(
    event_vendor_id: str,
    body: EventVendorUpdate,
    claims: dict = Depends(get_current_claims),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        existing = await conn.fetchval("SELECT event_id::text FROM event_vendor WHERE id=$1::uuid", event_vendor_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Event-vendor assignment not found")
        if not await _has_event_access(conn, claims.get("sub"), existing):
            raise HTTPException(status_code=403, detail="You don't have access to this event")

        updates: list[str] = []
        params: list = []
        idx = 1
        for field in ("stall_number", "fee_type", "fixed_fee", "revenue_share_pct",
                      "actual_revenue", "status", "notes"):
            val = getattr(body, field)
            if val is not None:
                updates.append(f"{field} = ${idx}")
                params.append(val)
                idx += 1
        if not updates:
            raise HTTPException(status_code=422, detail="No fields to update")
        params.append(event_vendor_id)
        await conn.execute(f"UPDATE event_vendor SET {', '.join(updates)} WHERE id=${idx}::uuid", *params)
        full = await conn.fetchrow(_EVENT_VENDOR_SELECT + "WHERE ev.id = $1::uuid", event_vendor_id)
    return dict(full)


@router.delete("/vendors/{event_vendor_id}", status_code=204,
               summary="Remove a vendor from an event")
async def remove_event_vendor(
    event_vendor_id: str,
    claims: dict = Depends(get_current_claims),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        existing = await conn.fetchval("SELECT event_id::text FROM event_vendor WHERE id=$1::uuid", event_vendor_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Event-vendor assignment not found")
        if not await _has_event_access(conn, claims.get("sub"), existing):
            raise HTTPException(status_code=403, detail="You don't have access to this event")
        await conn.execute("DELETE FROM event_vendor WHERE id=$1::uuid", event_vendor_id)


# ── Revenue distribution ──────────────────────────────────────────────────────

async def _full_distribution(conn, distribution_id: str) -> dict:
    dist = await conn.fetchrow(
        "SELECT id::text, event_id::text, total_pool, currency_code, status, "
        "approved_by::text, approved_at, distributed_at, notes, created_at "
        "FROM vendor_revenue_distribution WHERE id = $1::uuid",
        distribution_id,
    )
    entries = await conn.fetch(
        _DIST_ENTRY_SELECT + "WHERE de.distribution_id = $1::uuid ORDER BY de.share_percentage DESC",
        distribution_id,
    )
    d = dict(dist)
    d["entries"] = await _hydrate_dist_entries(entries)
    return d


@router.get("/{event_id}/revenue-distribution", response_model=RevenueDistributionOut,
            summary="Get an event's revenue distribution pool + entries")
async def get_revenue_distribution(
    event_id: str,
    claims: dict = Depends(require_event_access()),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        await _require_event(conn, event_id)
        dist_id = await conn.fetchval(
            "SELECT id::text FROM vendor_revenue_distribution WHERE event_id = $1::uuid", event_id,
        )
        if not dist_id:
            raise HTTPException(status_code=404, detail="No revenue distribution set up for this event yet")
        result = await _full_distribution(conn, dist_id)
    return result


@router.post("/{event_id}/revenue-distribution", response_model=RevenueDistributionOut, status_code=201,
             summary="Create (or reset) the revenue distribution pool for an event")
async def create_revenue_distribution(
    event_id: str,
    body: RevenueDistributionCreate,
    claims: dict = Depends(require_event_access()),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        await _require_event(conn, event_id)
        row = await conn.fetchrow(
            "INSERT INTO vendor_revenue_distribution (event_id, total_pool, currency_code, notes) "
            "VALUES ($1::uuid, $2, $3, $4) "
            "ON CONFLICT (event_id) DO UPDATE SET total_pool = EXCLUDED.total_pool, "
            "currency_code = EXCLUDED.currency_code, notes = EXCLUDED.notes "
            "RETURNING id::text",
            event_id, body.total_pool, body.currency_code, body.notes,
        )
        result = await _full_distribution(conn, row["id"])
    return result


@router.post("/revenue-distribution/{distribution_id}/entries", response_model=DistributionEntryOut,
             status_code=201, summary="Add a payout line to a revenue distribution")
async def add_distribution_entry(
    distribution_id: str,
    body: DistributionEntryCreate,
    claims: dict = Depends(get_current_claims),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        dist_row = await conn.fetchrow(
            "SELECT status, event_id::text FROM vendor_revenue_distribution WHERE id = $1::uuid", distribution_id,
        )
        if dist_row is None:
            raise HTTPException(status_code=404, detail="Revenue distribution not found")
        if not await _has_event_access(conn, claims.get("sub"), dist_row["event_id"]):
            raise HTTPException(status_code=403, detail="You don't have access to this event")
        dist = dist_row["status"]
        if dist == "distributed":
            raise HTTPException(status_code=409, detail="Already distributed — cannot add more entries")
        row = await conn.fetchrow(
            "INSERT INTO distribution_entry (distribution_id, recipient_type, recipient_user_id, "
            "recipient_sponsor_id, share_percentage, amount, notes) "
            "VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6, $7) RETURNING id",
            distribution_id, body.recipient_type, body.recipient_user_id,
            body.recipient_sponsor_id, body.share_percentage, body.amount, body.notes,
        )
        full = await conn.fetchrow(_DIST_ENTRY_SELECT + "WHERE de.id = $1::uuid", row["id"])
    return (await _hydrate_dist_entries([full]))[0]


@router.patch("/revenue-distribution/{distribution_id}/approve", response_model=RevenueDistributionOut,
              summary="Approve a revenue distribution (locks entries for payout)")
async def approve_revenue_distribution(
    distribution_id: str,
    claims: dict = Depends(get_current_claims),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        dist_event_id = await conn.fetchval(
            "SELECT event_id::text FROM vendor_revenue_distribution WHERE id = $1::uuid", distribution_id,
        )
        if not dist_event_id:
            raise HTTPException(status_code=404, detail="Distribution not found")
        if not await _has_event_access(conn, claims.get("sub"), dist_event_id):
            raise HTTPException(status_code=403, detail="You don't have access to this event")
        approver = await get_by_sub(claims.get("sub", ""))
        if not approver:
            raise HTTPException(status_code=404, detail="User record not found")
        result = await conn.execute(
            "UPDATE vendor_revenue_distribution SET status='approved', approved_by=$1::uuid, approved_at=now() "
            "WHERE id=$2::uuid AND status='draft'",
            approver["id"], distribution_id,
        )
        if result == "UPDATE 0":
            raise HTTPException(status_code=409, detail="Distribution not found or not in draft state")
        result_full = await _full_distribution(conn, distribution_id)
    return result_full


@router.patch("/revenue-distribution/{distribution_id}/mark-distributed", response_model=RevenueDistributionOut,
              summary="Mark a revenue distribution as fully paid out")
async def mark_distributed(
    distribution_id: str,
    claims: dict = Depends(get_current_claims),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        dist_event_id = await conn.fetchval(
            "SELECT event_id::text FROM vendor_revenue_distribution WHERE id = $1::uuid", distribution_id,
        )
        if not dist_event_id:
            raise HTTPException(status_code=404, detail="Distribution not found")
        if not await _has_event_access(conn, claims.get("sub"), dist_event_id):
            raise HTTPException(status_code=403, detail="You don't have access to this event")
        result = await conn.execute(
            "UPDATE vendor_revenue_distribution SET status='distributed', distributed_at=now() "
            "WHERE id=$1::uuid AND status='approved'",
            distribution_id,
        )
        if result == "UPDATE 0":
            raise HTTPException(status_code=409, detail="Distribution not found or not yet approved")
        await conn.execute(
            "UPDATE distribution_entry SET status='paid', paid_at=now() "
            "WHERE distribution_id=$1::uuid AND status='pending'",
            distribution_id,
        )
        result_full = await _full_distribution(conn, distribution_id)
    return result_full


# ── Export (Excel / PDF) + shareable public link ──────────────────────────────

_XLSX_MEDIA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_PDF_MEDIA  = "application/pdf"


@router.get("/{event_id}/export.xlsx", summary="Download this event's fund data as an Excel file")
async def export_xlsx(
    event_id: str,
    claims: dict = Depends(require_event_access()),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        await _require_event(conn, event_id)
        data = await fetch_fund_export_data(conn, event_id)
    content = build_xlsx(data)
    return Response(content=content, media_type=_XLSX_MEDIA,
                     headers={"Content-Disposition": f'attachment; filename="fund-report-{event_id}.xlsx"'})


@router.get("/{event_id}/export.pdf", summary="Download this event's fund data as a PDF")
async def export_pdf(
    event_id: str,
    claims: dict = Depends(require_event_access()),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        await _require_event(conn, event_id)
        data = await fetch_fund_export_data(conn, event_id)
    content = build_pdf(data)
    return Response(content=content, media_type=_PDF_MEDIA,
                     headers={"Content-Disposition": f'attachment; filename="fund-report-{event_id}.pdf"'})


@router.post("/{event_id}/share-link", response_model=FundShareLinkOut,
             summary="Create a shareable, unauthenticated download link for this event's fund report")
async def create_share_link(
    event_id: str,
    claims: dict = Depends(require_event_access()),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        await _require_event(conn, event_id)
        creator = await get_by_sub(claims.get("sub", ""))
        if not creator:
            raise HTTPException(status_code=404, detail="User record not found")

        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(days=_SHARE_LINK_TTL_DAYS)
        await conn.execute(
            "INSERT INTO fund_export_link (event_id, token, created_by, expires_at) "
            "VALUES ($1::uuid, $2, $3::uuid, $4)",
            event_id, token, creator["id"], expires_at,
        )
    return FundShareLinkOut(token=token, path=f"/api/payments/funds/share/{token}", expires_at=expires_at)


@router.get("/share/{token}", summary="Public: download a fund report via a shared link (no auth)")
async def download_shared_export(
    token: str,
    format: str = Query("xlsx", pattern="^(xlsx|pdf)$"),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        link = await conn.fetchrow(
            "SELECT event_id::text, expires_at FROM fund_export_link WHERE token = $1", token,
        )
        if not link:
            raise HTTPException(status_code=404, detail="Link not found")
        if link["expires_at"] < datetime.now(timezone.utc):
            raise HTTPException(status_code=410, detail="This share link has expired")
        data = await fetch_fund_export_data(conn, link["event_id"])

    if format == "pdf":
        return Response(content=build_pdf(data), media_type=_PDF_MEDIA,
                         headers={"Content-Disposition": f'attachment; filename="fund-report-{link["event_id"]}.pdf"'})
    return Response(content=build_xlsx(data), media_type=_XLSX_MEDIA,
                     headers={"Content-Disposition": f'attachment; filename="fund-report-{link["event_id"]}.xlsx"'})
