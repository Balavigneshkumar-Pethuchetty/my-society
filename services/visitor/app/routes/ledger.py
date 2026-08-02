import io
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response as FastAPIResponse
from openpyxl import Workbook
from reportlab.lib import colors
from reportlab.lib.pagesizes import landscape, letter
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle

from app.auth import require_role
from app.database import get_pool
from app.models import LedgerRow, PhotoOut, VisitorSettingsOut, VisitorSettingsUpdateRequest
from app.queries import fetch_photos

router = APIRouter()

_ADMIN_ROLES = ("admin", "committee_member")

_LEDGER_QUERY = """
    SELECT 'pass' AS kind, vp.id, vp.visitor_name, vp.purpose, vp.resident_name, vp.resident_flat,
           vp.status, vp.created_at, vp.aadhaar IS NOT NULL AS aadhaar_provided,
           vl.entry_time, vl.exit_time,
           vp.visitor_count, vp.entered_count, vp.exited_count,
           EXISTS(SELECT 1 FROM visitor_photo WHERE visitor_pass_id = vp.id) AS has_photo
    FROM visitor_pass vp
    LEFT JOIN visitor_log vl ON vl.visitor_pass_id = vp.id
    WHERE ($1::timestamptz IS NULL OR vp.created_at >= $1)
      AND ($2::timestamptz IS NULL OR vp.created_at <= $2)
      AND ($3::uuid IS NULL OR vp.resident_user_id = $3)
      AND ($4::text IS NULL OR vp.purpose ILIKE '%' || $4 || '%')
      AND ($5::text IS NULL OR vp.status = $5)

    UNION ALL

    SELECT 'anonymous' AS kind, av.id, COALESCE(av.visitor_name, av.purpose) AS visitor_name, av.purpose,
           av.linked_resident_name AS resident_name, av.linked_resident_flat AS resident_flat,
           CASE WHEN av.exit_time IS NOT NULL THEN 'exited' ELSE 'entered' END AS status,
           av.created_at, av.aadhaar IS NOT NULL AS aadhaar_provided,
           av.entry_time, av.exit_time,
           1 AS visitor_count, 1 AS entered_count, (av.exit_time IS NOT NULL)::int AS exited_count,
           EXISTS(SELECT 1 FROM visitor_photo WHERE anonymous_visitor_id = av.id) AS has_photo
    FROM anonymous_visitor av
    WHERE ($1::timestamptz IS NULL OR av.created_at >= $1)
      AND ($2::timestamptz IS NULL OR av.created_at <= $2)
      AND ($4::text IS NULL OR av.purpose ILIKE '%' || $4 || '%')

    ORDER BY created_at DESC
    LIMIT 500
"""


async def _query_ledger(from_date, to_date, resident_id, purpose, status) -> list[LedgerRow]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(_LEDGER_QUERY, from_date, to_date, resident_id, purpose, status)
    return [
        LedgerRow(
            kind=r["kind"], id=str(r["id"]), visitor_name=r["visitor_name"], purpose=r["purpose"],
            resident_name=r["resident_name"], resident_flat=r["resident_flat"], status=r["status"],
            entry_time=r["entry_time"], exit_time=r["exit_time"], created_at=r["created_at"],
            has_photo=r["has_photo"], aadhaar_provided=r["aadhaar_provided"],
            visitor_count=r["visitor_count"], entered_count=r["entered_count"], exited_count=r["exited_count"],
        )
        for r in rows
    ]


# ── GET /ledger ───────────────────────────────────────────────────────────────

@router.get("/ledger", response_model=list[LedgerRow], summary="Filtered visitor ledger")
async def get_ledger(
    from_date: datetime | None = None,
    to_date: datetime | None = None,
    resident_user_id: str | None = None,
    purpose: str | None = None,
    status: str | None = None,
    claims: dict = Depends(require_role(*_ADMIN_ROLES)),
):
    return await _query_ledger(from_date, to_date, resident_user_id, purpose, status)


def _rows_for_export(rows: list[LedgerRow]) -> list[list]:
    header = ["Type", "Visitor", "Purpose", "Resident", "Flat", "Status", "Entry", "Exit", "Created", "Photo", "Aadhaar Provided"]
    body = [
        [
            r.kind, r.visitor_name, r.purpose, r.resident_name or "", r.resident_flat or "", r.status,
            r.entry_time.strftime("%Y-%m-%d %H:%M") if r.entry_time else "",
            r.exit_time.strftime("%Y-%m-%d %H:%M") if r.exit_time else "",
            r.created_at.strftime("%Y-%m-%d %H:%M"),
            "Yes" if r.has_photo else "No", "Yes" if r.aadhaar_provided else "No",
        ]
        for r in rows
    ]
    return [header] + body


@router.get("/ledger/export.xlsx", summary="Export the filtered ledger as an Excel file")
async def export_xlsx(
    from_date: datetime | None = None, to_date: datetime | None = None,
    resident_user_id: str | None = None, purpose: str | None = None, status: str | None = None,
    claims: dict = Depends(require_role(*_ADMIN_ROLES)),
):
    rows = await _query_ledger(from_date, to_date, resident_user_id, purpose, status)
    wb = Workbook()
    ws = wb.active
    ws.title = "Visitor Ledger"
    for row in _rows_for_export(rows):
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return FastAPIResponse(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=visitor-ledger.xlsx"},
    )


@router.get("/ledger/export.pdf", summary="Export the filtered ledger as a PDF file")
async def export_pdf(
    from_date: datetime | None = None, to_date: datetime | None = None,
    resident_user_id: str | None = None, purpose: str | None = None, status: str | None = None,
    claims: dict = Depends(require_role(*_ADMIN_ROLES)),
):
    rows = await _query_ledger(from_date, to_date, resident_user_id, purpose, status)
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(letter))
    table = Table(_rows_for_export(rows))
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e3a5f")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
    ]))
    doc.build([table])
    return FastAPIResponse(
        content=buf.getvalue(), media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=visitor-ledger.pdf"},
    )


# ── GET /ledger/photos — privileged view-any ─────────────────────────────────

@router.get("/ledger/photos", response_model=list[PhotoOut], summary="View photos for any pass or anonymous visitor")
async def ledger_photos(
    pass_id: str | None = None, anonymous_id: str | None = None,
    claims: dict = Depends(require_role(*_ADMIN_ROLES)),
):
    if bool(pass_id) == bool(anonymous_id):
        raise HTTPException(status_code=400, detail="Provide exactly one of pass_id or anonymous_id")
    pool = await get_pool()
    async with pool.acquire() as conn:
        return await fetch_photos(conn, pass_id=pass_id, anonymous_id=anonymous_id)


# ── GET /ledger/aadhaar-status — future-integration placeholder ─────────────

@router.get("/ledger/aadhaar-status", summary="Aadhaar verification status (not implemented — future integration)")
async def aadhaar_status(claims: dict = Depends(require_role(*_ADMIN_ROLES))):
    return {"implemented": False}


# ── GET/PUT /settings ─────────────────────────────────────────────────────────

@router.get("/settings", response_model=VisitorSettingsOut, summary="Get notification rule settings")
async def get_settings(claims: dict = Depends(require_role(*_ADMIN_ROLES))):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT overdue_threshold_minutes, daily_summary_enabled, summary_interval, summary_hour_utc "
            "FROM visitor_settings WHERE id = 1"
        )
    return VisitorSettingsOut(**dict(row))


@router.put("/settings", response_model=VisitorSettingsOut, summary="Update notification rule settings")
async def update_settings(body: VisitorSettingsUpdateRequest, claims: dict = Depends(require_role(*_ADMIN_ROLES))):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    pool = await get_pool()
    async with pool.acquire() as conn:
        set_clause = ", ".join(f"{k} = ${i + 1}" for i, k in enumerate(updates))
        await conn.execute(
            f"UPDATE visitor_settings SET {set_clause}, updated_at = NOW() WHERE id = 1",
            *updates.values(),
        )
        row = await conn.fetchrow(
            "SELECT overdue_threshold_minutes, daily_summary_enabled, summary_interval, summary_hour_utc "
            "FROM visitor_settings WHERE id = 1"
        )
    return VisitorSettingsOut(**dict(row))