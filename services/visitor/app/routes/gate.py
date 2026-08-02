import os
import uuid as uuid_lib
from datetime import datetime, timezone
from uuid import UUID

import aiofiles
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response as FastAPIResponse

from app.auth import get_current_claims, require_role
from app.config import settings
from app.database import get_pool
from app.models import (
    AnonymousCreateRequest, AnonymousOut, AnonymousUpdateRequest, GateTodayOut, PhotoOut, ScanBody, ScanOut,
)
from app.notify_client import notify_all
from app.queries import compute_pass_status, fetch_photos, load_full_pass
from app.user_client import get_by_id, get_by_sub, list_unitmates

router = APIRouter()

_SECURITY_ROLES = ("admin", "committee_member", "security_guard")
_PHOTO_TYPES = {"image/jpeg", "image/png", "image/webp"}
_PHOTO_MAX_BYTES = 5 * 1024 * 1024  # 5 MB


async def _resolve_security(claims: dict) -> dict:
    user = await get_by_sub(claims.get("sub", ""))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


_ANON_COLS = """
    id, purpose, visitor_name, notes, contact, aadhaar, email, address,
    entry_time, exit_time, entry_security_name, exit_security_name,
    linked_resident_name, linked_resident_flat, linked_resident_phone, vehicle_number
"""


def _anon_row_to_out(row, photos=None) -> AnonymousOut:
    d = dict(row)
    return AnonymousOut(
        id=str(d["id"]), purpose=d["purpose"], visitor_name=d.get("visitor_name"), notes=d.get("notes"),
        contact=d.get("contact"), aadhaar=d.get("aadhaar"), email=d.get("email"), address=d.get("address"),
        entry_time=d["entry_time"], exit_time=d.get("exit_time"),
        entry_security_name=d.get("entry_security_name"), exit_security_name=d.get("exit_security_name"),
        linked_resident_name=d.get("linked_resident_name"), linked_resident_flat=d.get("linked_resident_flat"),
        linked_resident_phone=d.get("linked_resident_phone"),
        vehicle_number=d.get("vehicle_number"),
        photos=photos or [],
    )


# ── GET /gate/lookup/{token} ──────────────────────────────────────────────────

@router.get("/lookup/{token}", summary="Preview a visitor pass by QR token without mutating state")
async def lookup_token(token: str, claims: dict = Depends(require_role(*_SECURITY_ROLES))):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT id FROM visitor_pass WHERE qr_token = $1", token)
        if not row:
            raise HTTPException(status_code=404, detail="QR code not found or invalid")
        return await load_full_pass(conn, str(row["id"]))


# ── POST /gate/scan ────────────────────────────────────────────────────────────
# Group-pass aware: one QR can represent more than one person (visitor_count).
# Each scan admits/exits the group in a batch — the whole remaining group by
# default, or a specific headcount via body.count. Entry admission is
# deliberately uncapped: if more people show up than the resident originally
# stated, security can still let them all in in one scan (or across several) —
# never blocked, only flagged via over_expected_count. Once the group is
# short of arriving to reduce the target below what's already entered, use
# PATCH /passes/{id} to raise visitor_count instead — that demotes status back
# to 'partially_entered' so the next scan resumes admitting people.

@router.post("/scan", response_model=ScanOut, summary="Scan a visitor pass QR at the gate (admits/exits the group, in full or in part)")
async def scan(body: ScanBody, claims: dict = Depends(require_role(*_SECURITY_ROLES))):
    security = await _resolve_security(claims)
    pool = await get_pool()
    now = datetime.now(timezone.utc)

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, visitor_name, resident_user_id, resident_name, resident_phone, status, "
            "visitor_count, entered_count, exited_count FROM visitor_pass WHERE qr_token = $1",
            body.token,
        )
        if not row:
            raise HTTPException(status_code=404, detail="QR code not found or invalid")

        if row["status"] in ("cancelled", "expired"):
            raise HTTPException(status_code=400, detail=f"Pass is {row['status']}")

        visitor_count, entered_count, exited_count = row["visitor_count"], row["entered_count"], row["exited_count"]

        if row["status"] == "exited":
            log = await conn.fetchrow(
                "SELECT entry_time, exit_time FROM visitor_log WHERE visitor_pass_id = $1", row["id"]
            )
            return ScanOut(
                pass_id=str(row["id"]), visitor_name=row["visitor_name"], status="exited",
                direction="exit", admitted_count=0,
                visitor_count=visitor_count, entered_count=entered_count, exited_count=exited_count,
                entry_time=log["entry_time"] if log else None, exit_time=log["exit_time"] if log else None,
                already_final=True,
                resident_name=row["resident_name"], resident_phone=row["resident_phone"],
            )

        if entered_count < visitor_count:
            direction = "entry"
            remaining = visitor_count - entered_count
            admitted = body.count if body.count is not None else remaining
            entered_count += admitted
        else:
            direction = "exit"
            remaining_inside = max(0, entered_count - exited_count)
            admitted = min(body.count, remaining_inside) if body.count is not None else remaining_inside
            exited_count += admitted

        new_status = compute_pass_status(visitor_count, entered_count, exited_count)

        await conn.execute(
            "UPDATE visitor_pass SET entered_count = $1, exited_count = $2, status = $3::varchar, updated_at = NOW() "
            "WHERE id = $4",
            entered_count, exited_count, new_status, row["id"],
        )

        if direction == "entry":
            await conn.execute(
                """
                INSERT INTO visitor_log (visitor_pass_id, entry_time, entry_security_id, entry_security_name)
                VALUES ($1, $2, $3::uuid, $4)
                ON CONFLICT (visitor_pass_id) DO NOTHING
                """,
                row["id"], now, security["id"], security["name"],
            )
        elif new_status == "exited":
            await conn.execute(
                "UPDATE visitor_log SET exit_time = $1, exit_security_id = $2::uuid, exit_security_name = $3 "
                "WHERE visitor_pass_id = $4",
                now, security["id"], security["name"], row["id"],
            )

        log = await conn.fetchrow(
            "SELECT entry_time, exit_time FROM visitor_log WHERE visitor_pass_id = $1", row["id"]
        )

    over_expected = entered_count > visitor_count
    is_group = visitor_count > 1
    if direction == "entry":
        message = (
            f"{admitted} of {row['visitor_name']}'s group have entered ({entered_count}/{visitor_count})."
            if is_group else f"{row['visitor_name']} has entered."
        )
        if over_expected:
            message += f" This is more than the {visitor_count} originally expected."
        event_type, title = "visitor_entry", "Visitor arrived"
    else:
        message = (
            f"{admitted} of {row['visitor_name']}'s group have exited ({exited_count}/{entered_count})."
            if is_group else f"{row['visitor_name']} has exited."
        )
        event_type, title = "visitor_exit", "Visitor left"

    await notify_all(str(row["resident_user_id"]), row["resident_phone"], event_type, title, message, str(row["id"]))

    return ScanOut(
        pass_id=str(row["id"]), visitor_name=row["visitor_name"], status=new_status,
        direction=direction, admitted_count=admitted,
        visitor_count=visitor_count, entered_count=entered_count, exited_count=exited_count,
        over_expected_count=over_expected,
        entry_time=log["entry_time"] if log else None, exit_time=log["exit_time"] if log else None,
        resident_name=row["resident_name"], resident_phone=row["resident_phone"],
    )


# ── GET /gate/anonymous/my ─────────────────────────────────────────────────────

@router.get(
    "/anonymous/my", response_model=list[AnonymousOut],
    summary="List walk-in visitors (no QR pass) linked to the caller's household",
)
async def list_my_anonymous_visitors(claims: dict = Depends(get_current_claims)):
    resident = await get_by_sub(claims.get("sub", ""))
    if not resident:
        raise HTTPException(status_code=404, detail="User not found")
    unitmates = await list_unitmates(resident["id"])
    household_ids = {u["id"] for u in unitmates} | {resident["id"]}

    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT {_ANON_COLS}
            FROM anonymous_visitor
            WHERE linked_resident_user_id = ANY($1::uuid[])
            ORDER BY entry_time DESC LIMIT 200
            """,
            [UUID(uid) for uid in household_ids],
        )
        return [_anon_row_to_out(r, await fetch_photos(conn, anonymous_id=r["id"])) for r in rows]


# ── POST /gate/anonymous ───────────────────────────────────────────────────────

@router.post("/anonymous", response_model=AnonymousOut, summary="Log a walk-in visitor with no QR pass")
async def create_anonymous(body: AnonymousCreateRequest, claims: dict = Depends(require_role(*_SECURITY_ROLES))):
    security = await _resolve_security(claims)
    linked_name = linked_flat = linked_phone = None
    if body.linked_resident_user_id:
        linked = await get_by_id(body.linked_resident_user_id)
        if linked:
            linked_name, linked_flat, linked_phone = linked["name"], linked.get("flat_label"), linked.get("phone")

    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"""
            INSERT INTO anonymous_visitor (
                purpose, visitor_name, notes, contact, aadhaar, email, address,
                entry_security_id, entry_security_name,
                linked_resident_user_id, linked_resident_name, linked_resident_flat, linked_resident_phone,
                vehicle_number
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::uuid, $9, $10::uuid, $11, $12, $13, $14)
            RETURNING {_ANON_COLS}
            """,
            body.purpose, body.visitor_name, body.notes, body.contact, body.aadhaar, body.email, body.address,
            security["id"], security["name"],
            body.linked_resident_user_id, linked_name, linked_flat, linked_phone, body.vehicle_number,
        )

    if body.linked_resident_user_id and linked_name:
        await notify_all(
            body.linked_resident_user_id, linked_phone,
            "anonymous_visitor_linked", "Visitor logged at gate",
            f"A visitor ({body.purpose}) was logged at the gate against your flat.",
            str(row["id"]),
        )
    return _anon_row_to_out(row)


# ── PATCH /gate/anonymous/{id} ─────────────────────────────────────────────────

@router.patch(
    "/anonymous/{anon_id}", response_model=AnonymousOut,
    summary="Correct/add the vehicle number on a walk-in visitor entry",
)
async def update_anonymous(
    anon_id: str, body: AnonymousUpdateRequest, claims: dict = Depends(require_role(*_SECURITY_ROLES)),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        exists = await conn.fetchval("SELECT 1 FROM anonymous_visitor WHERE id = $1::uuid", anon_id)
        if not exists:
            raise HTTPException(status_code=404, detail="Anonymous visitor entry not found")
        row = await conn.fetchrow(
            f"UPDATE anonymous_visitor SET vehicle_number = $1 WHERE id = $2::uuid RETURNING {_ANON_COLS}",
            body.vehicle_number, anon_id,
        )
        photos = await fetch_photos(conn, anonymous_id=anon_id)
    return _anon_row_to_out(row, photos)


# ── POST /gate/anonymous/{id}/exit ────────────────────────────────────────────

@router.post("/anonymous/{anon_id}/exit", response_model=AnonymousOut, summary="Record exit for an anonymous visitor")
async def exit_anonymous(anon_id: str, claims: dict = Depends(require_role(*_SECURITY_ROLES))):
    security = await _resolve_security(claims)
    pool = await get_pool()
    now = datetime.now(timezone.utc)
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT exit_time FROM anonymous_visitor WHERE id = $1::uuid", anon_id)
        if not row:
            raise HTTPException(status_code=404, detail="Anonymous visitor entry not found")
        if row["exit_time"]:
            raise HTTPException(status_code=400, detail="Exit already recorded")
        out_row = await conn.fetchrow(
            f"""
            UPDATE anonymous_visitor
            SET exit_time = $1, exit_security_id = $2::uuid, exit_security_name = $3
            WHERE id = $4::uuid
            RETURNING {_ANON_COLS}
            """,
            now, security["id"], security["name"], anon_id,
        )
        photos = await fetch_photos(conn, anonymous_id=anon_id)
    return _anon_row_to_out(out_row, photos)


# ── GET /gate/today ────────────────────────────────────────────────────────────

@router.get("/today", response_model=GateTodayOut, summary="Today's gate activity feed")
async def gate_today(claims: dict = Depends(require_role(*_SECURITY_ROLES))):
    pool = await get_pool()
    async with pool.acquire() as conn:
        pass_ids = await conn.fetch(
            """
            SELECT id FROM visitor_pass
            WHERE valid_from::date = CURRENT_DATE
               OR status IN ('pending', 'partially_entered', 'entered', 'partially_exited')
            ORDER BY created_at DESC LIMIT 100
            """
        )
        passes = [await load_full_pass(conn, str(r["id"])) for r in pass_ids]

        anon_rows = await conn.fetch(
            f"""
            SELECT {_ANON_COLS}
            FROM anonymous_visitor
            WHERE entry_time::date = CURRENT_DATE
            ORDER BY entry_time DESC LIMIT 100
            """
        )
        anonymous = [_anon_row_to_out(r, await fetch_photos(conn, anonymous_id=r["id"])) for r in anon_rows]

    return GateTodayOut(passes=passes, anonymous=anonymous)


# ── POST /photos ────────────────────────────────────────────────────────────

@router.post("/photos", response_model=PhotoOut, summary="Upload a captured visitor photo")
async def upload_photo(
    pass_id: str | None = None,
    anonymous_id: str | None = None,
    file: UploadFile = File(...),
    claims: dict = Depends(require_role(*_SECURITY_ROLES)),
):
    if bool(pass_id) == bool(anonymous_id):
        raise HTTPException(status_code=400, detail="Provide exactly one of pass_id or anonymous_id")
    if file.content_type not in _PHOTO_TYPES:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, or WebP images accepted")
    content = await file.read()
    if len(content) > _PHOTO_MAX_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 5 MB)")

    security = await get_by_sub(claims.get("sub", ""))
    if not security:
        raise HTTPException(status_code=404, detail="User not found")

    pool = await get_pool()
    async with pool.acquire() as conn:
        owner_col = "visitor_pass_id" if pass_id else "anonymous_visitor_id"
        owner_table = "visitor_pass" if pass_id else "anonymous_visitor"
        owner_id = pass_id or anonymous_id
        exists = await conn.fetchval(f"SELECT 1 FROM {owner_table} WHERE id = $1::uuid", owner_id)
        if not exists:
            raise HTTPException(status_code=404, detail="Pass or anonymous visitor entry not found")

        ext = (file.filename or "photo.jpg").rsplit(".", 1)[-1].lower()
        filename = f"{uuid_lib.uuid4()}.{ext}"
        save_dir = os.path.join(settings.uploads_dir, "visitors")
        os.makedirs(save_dir, exist_ok=True)
        async with aiofiles.open(os.path.join(save_dir, filename), "wb") as f:
            await f.write(content)

        row = await conn.fetchrow(
            f"""
            INSERT INTO visitor_photo (security_id, security_name, file_path, {owner_col})
            VALUES ($1::uuid, $2, $3, $4::uuid)
            RETURNING id, security_id, security_name, file_path, captured_at
            """,
            security["id"], security["name"], f"visitors/{filename}", owner_id,
        )
    return PhotoOut(
        id=str(row["id"]), security_id=str(row["security_id"]), security_name=row["security_name"],
        file_path=row["file_path"], captured_at=row["captured_at"],
    )
