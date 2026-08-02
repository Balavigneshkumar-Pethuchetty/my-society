"""Shared row-loading helpers used by routes/passes.py, routes/gate.py, and
routes/ledger.py — kept in one place since all three need to assemble the
same PassOut (with joined log/photos/phone-verification) or PhotoOut shapes."""
from app.models import PassOut, PhoneVerificationOut, PhotoOut, VisitorLogOut

_PASS_COLS = """
    id, resident_user_id, resident_name, resident_flat, resident_phone,
    visitor_name, purpose, valid_from, valid_to, contact, aadhaar, email, address,
    qr_token, status, created_at, visitor_count, additional_visitor_names,
    vehicle_number, visitor_category, entered_count, exited_count
"""


def row_to_pass(row) -> PassOut:
    d = dict(row)
    return PassOut(
        id=str(d["id"]),
        resident_user_id=str(d["resident_user_id"]),
        resident_name=d["resident_name"],
        resident_flat=d.get("resident_flat"),
        resident_phone=d.get("resident_phone"),
        visitor_name=d["visitor_name"],
        purpose=d["purpose"],
        valid_from=d["valid_from"],
        valid_to=d["valid_to"],
        contact=d.get("contact"),
        aadhaar=d.get("aadhaar"),
        email=d.get("email"),
        address=d.get("address"),
        qr_token=d["qr_token"],
        status=d["status"],
        created_at=d["created_at"],
        visitor_count=d.get("visitor_count", 1),
        additional_visitor_names=d.get("additional_visitor_names"),
        vehicle_number=d.get("vehicle_number"),
        visitor_category=d.get("visitor_category", "other"),
        entered_count=d.get("entered_count", 0),
        exited_count=d.get("exited_count", 0),
    )


def compute_pass_status(visitor_count: int, entered_count: int, exited_count: int) -> str:
    """Derives status purely from the three running counters, used both after
    a gate scan and after an edit that changes visitor_count (e.g. raising the
    count on an already-'entered' pass to let more people in demotes it back
    to 'partially_entered'). Deliberately headcount-only, not identity-aware —
    see the group-pass design notes for why (Option A, not per-person tracking)."""
    if entered_count > 0 and exited_count >= entered_count:
        return "exited"
    if exited_count > 0:
        return "partially_exited"
    if entered_count > 0 and entered_count >= visitor_count:
        return "entered"
    if entered_count > 0:
        return "partially_entered"
    return "pending"


async def fetch_log(conn, pass_id) -> VisitorLogOut | None:
    row = await conn.fetchrow(
        "SELECT entry_time, entry_security_name, exit_time, exit_security_name "
        "FROM visitor_log WHERE visitor_pass_id = $1",
        pass_id,
    )
    if not row:
        return None
    return VisitorLogOut(**dict(row))


async def fetch_photos(conn, pass_id=None, anonymous_id=None) -> list[PhotoOut]:
    if pass_id is not None:
        rows = await conn.fetch(
            "SELECT id, security_id, security_name, file_path, captured_at "
            "FROM visitor_photo WHERE visitor_pass_id = $1 ORDER BY captured_at",
            pass_id,
        )
    else:
        rows = await conn.fetch(
            "SELECT id, security_id, security_name, file_path, captured_at "
            "FROM visitor_photo WHERE anonymous_visitor_id = $1 ORDER BY captured_at",
            anonymous_id,
        )
    return [
        PhotoOut(
            id=str(r["id"]), security_id=str(r["security_id"]), security_name=r["security_name"],
            file_path=r["file_path"], captured_at=r["captured_at"],
        )
        for r in rows
    ]


async def fetch_phone_verification(conn, pass_id) -> PhoneVerificationOut | None:
    row = await conn.fetchrow(
        "SELECT id, phone_number, verification_status, requested_at, verified_at "
        "FROM phone_verification WHERE visitor_pass_id = $1 ORDER BY requested_at DESC LIMIT 1",
        pass_id,
    )
    if not row:
        return None
    return PhoneVerificationOut(
        id=str(row["id"]), phone_number=row["phone_number"], verification_status=row["verification_status"],
        requested_at=row["requested_at"], verified_at=row["verified_at"],
    )


async def load_full_pass(conn, pass_id) -> PassOut | None:
    row = await conn.fetchrow(f"SELECT {_PASS_COLS} FROM visitor_pass WHERE id = $1::uuid", pass_id)
    if not row:
        return None
    out = row_to_pass(row)
    out.log = await fetch_log(conn, row["id"])
    out.photos = await fetch_photos(conn, pass_id=row["id"])
    out.phone_verification = await fetch_phone_verification(conn, row["id"])
    return out
