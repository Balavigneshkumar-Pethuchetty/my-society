from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response as FastAPIResponse

from app.auth import get_current_claims, require_role
from app.database import get_pool
from app.models import (
    PassCreateRequest, PassExtendRequest, PassOut, PassUpdateRequest, PhoneVerifyConfirmRequest, PhotoOut,
)
from app.notify_client import broadcast_to_role, notify_all, request_otp, verify_otp
from app.pass_image import generate_pass_image, generate_qr_png
from app.queries import compute_pass_status, fetch_photos, load_full_pass, row_to_pass
from app.user_client import get_by_sub, list_unitmates

router = APIRouter()

_PRIVILEGED_ROLES = ("admin", "committee_member")
_SECURITY_ROLES = ("admin", "committee_member", "security_guard")


async def _resolve_caller(claims: dict) -> dict:
    user = await get_by_sub(claims.get("sub", ""))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def _is_privileged(claims: dict) -> bool:
    roles = claims.get("realm_access", {}).get("roles", [])
    return any(r in roles for r in _PRIVILEGED_ROLES)


def _is_security(claims: dict) -> bool:
    return "security_guard" in claims.get("realm_access", {}).get("roles", [])


# ── POST /passes ─────────────────────────────────────────────────────────────

@router.post("", response_model=PassOut, summary="Create a visitor pass")
async def create_pass(
    body: PassCreateRequest,
    claims: dict = Depends(get_current_claims),
):
    if body.valid_to <= body.valid_from:
        raise HTTPException(status_code=400, detail="valid_to must be after valid_from")

    resident = await _resolve_caller(claims)
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO visitor_pass (
                resident_user_id, resident_name, resident_flat, resident_phone,
                visitor_name, purpose, valid_from, valid_to, contact, aadhaar, email, address,
                visitor_count, additional_visitor_names, vehicle_number, visitor_category
            ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            RETURNING id, resident_user_id, resident_name, resident_flat, resident_phone,
                      visitor_name, purpose, valid_from, valid_to, contact, aadhaar, email, address,
                      qr_token, status, created_at, visitor_count, additional_visitor_names,
                      vehicle_number, visitor_category, entered_count, exited_count
            """,
            resident["id"], resident["name"], resident.get("flat_label"), resident.get("phone"),
            body.visitor_name, body.purpose, body.valid_from, body.valid_to,
            body.contact, body.aadhaar, body.email, body.address,
            body.visitor_count, body.additional_visitor_names, body.vehicle_number, body.visitor_category,
        )

    group_note = f" for a group of {body.visitor_count}" if body.visitor_count > 1 else ""
    await broadcast_to_role(
        "security_guard", "visitor_pass_created", "New visitor pass created",
        f"{resident['name']} created a pass for {body.visitor_name} ({body.purpose}){group_note}.",
        str(row["id"]),
    )
    out = row_to_pass(row)
    out.photos = []
    return out


# ── GET /passes/my ────────────────────────────────────────────────────────────

@router.get("/my", response_model=list[PassOut], summary="List visitor passes for the caller's household")
async def list_my_passes(claims: dict = Depends(get_current_claims)):
    resident = await _resolve_caller(claims)
    unitmates = await list_unitmates(resident["id"])
    household_ids = {u["id"] for u in unitmates} | {resident["id"]}
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id FROM visitor_pass WHERE resident_user_id = ANY($1::uuid[]) ORDER BY created_at DESC",
            [UUID(uid) for uid in household_ids],
        )
        passes = [await load_full_pass(conn, str(r["id"])) for r in rows]
        for p in passes:
            p.is_own_pass = p.resident_user_id == resident["id"]
        return passes


# ── GET /passes/{id} ──────────────────────────────────────────────────────────

@router.get("/{pass_id}", response_model=PassOut, summary="Get a single visitor pass")
async def get_pass(pass_id: str, claims: dict = Depends(get_current_claims)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        out = await load_full_pass(conn, pass_id)
        if not out:
            raise HTTPException(status_code=404, detail="Pass not found")
        if not _is_privileged(claims):
            resident = await _resolve_caller(claims)
            if out.resident_user_id != resident["id"]:
                raise HTTPException(status_code=403, detail="Not your visitor pass")
    return out


# ── PATCH /passes/{id} ────────────────────────────────────────────────────────

_NON_EDITABLE_STATUSES = ("cancelled", "expired", "exited")


@router.patch("/{pass_id}", response_model=PassOut, summary="Edit a visitor pass's details")
async def update_pass(pass_id: str, body: PassUpdateRequest, claims: dict = Depends(get_current_claims)):
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    if "visitor_name" in updates and not (updates["visitor_name"] or "").strip():
        raise HTTPException(status_code=400, detail="visitor_name cannot be cleared")
    if "purpose" in updates and not (updates["purpose"] or "").strip():
        raise HTTPException(status_code=400, detail="purpose cannot be cleared")

    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT resident_user_id, resident_phone, visitor_name, status, "
            "visitor_count, entered_count, exited_count FROM visitor_pass WHERE id = $1::uuid",
            pass_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Pass not found")
        if not _is_privileged(claims):
            # Security guards at the gate may correct/add the vehicle number
            # on any pass (e.g. a guest arrives by car and it wasn't noted
            # upfront) but nothing else — they don't own the pass and
            # shouldn't be able to edit resident-provided guest details.
            if _is_security(claims):
                if set(updates) - {"vehicle_number"}:
                    raise HTTPException(status_code=403, detail="Security guards can only update the vehicle number")
            else:
                resident = await _resolve_caller(claims)
                if str(row["resident_user_id"]) != resident["id"]:
                    raise HTTPException(status_code=403, detail="Not your visitor pass")
        if row["status"] in _NON_EDITABLE_STATUSES:
            raise HTTPException(status_code=400, detail=f"Cannot edit a pass that is {row['status']}")

        # Raising visitor_count on an already-'entered'/'partially_exited' pass is
        # the supported way to let more people in on the same QR — re-derive status
        # from the new count vs. the running entered/exited totals rather than
        # leaving it stuck at a stale 'entered'. Lowering below what's already
        # entered isn't allowed — that would understate real headcount, not correct it.
        if "visitor_count" in updates:
            if updates["visitor_count"] < row["entered_count"]:
                raise HTTPException(
                    status_code=400,
                    detail=f"visitor_count can't be less than the {row['entered_count']} already entered",
                )
            updates["status"] = compute_pass_status(updates["visitor_count"], row["entered_count"], row["exited_count"])

        set_clause = ", ".join(f"{k} = ${i + 1}" for i, k in enumerate(updates))
        await conn.execute(
            f"UPDATE visitor_pass SET {set_clause}, updated_at = NOW() WHERE id = ${len(updates) + 1}::uuid",
            *updates.values(), pass_id,
        )
        out = await load_full_pass(conn, pass_id)

    message = f"Visitor pass details were updated for {out.visitor_name}."
    if "visitor_count" in updates:
        message = f"Visitor pass for {out.visitor_name} now expects {out.visitor_count} people (was {row['visitor_count']})."
    await notify_all(str(row["resident_user_id"]), row["resident_phone"], "visitor_pass_updated", "Visitor pass updated", message, pass_id)
    await broadcast_to_role("security_guard", "visitor_pass_updated", "Visitor pass updated", message, pass_id)
    return out


# ── DELETE /passes/{id} ───────────────────────────────────────────────────────

@router.delete("/{pass_id}", status_code=204, summary="Delete a pending visitor pass")
async def delete_pass(pass_id: str, claims: dict = Depends(get_current_claims)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT resident_user_id, visitor_name, status FROM visitor_pass WHERE id = $1::uuid", pass_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="Pass not found")
        if not _is_privileged(claims):
            resident = await _resolve_caller(claims)
            if str(row["resident_user_id"]) != resident["id"]:
                raise HTTPException(status_code=403, detail="Not your visitor pass")
        if row["status"] != "pending":
            raise HTTPException(status_code=400, detail="Only a pending visitor pass can be deleted")

        await conn.execute("DELETE FROM visitor_pass WHERE id = $1::uuid", pass_id)

    await broadcast_to_role(
        "security_guard", "visitor_pass_deleted", "Visitor pass deleted",
        f"The visitor pass for {row['visitor_name']} was deleted before arrival.",
        pass_id,
    )


# ── GET /passes/{id}/qr ────────────────────────────────────────────────────────

@router.get("/{pass_id}/qr", summary="Raw QR PNG for a visitor pass")
async def get_pass_qr(pass_id: str):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT qr_token, status FROM visitor_pass WHERE id = $1::uuid", pass_id)
    if not row:
        raise HTTPException(status_code=404, detail="Pass not found")
    if row["status"] in ("cancelled", "expired"):
        raise HTTPException(status_code=400, detail=f"Pass is {row['status']}")
    return FastAPIResponse(content=generate_qr_png(row["qr_token"]), media_type="image/png")


# ── GET /passes/{id}/pass-image.png ───────────────────────────────────────────

@router.get("/{pass_id}/pass-image.png", summary="Full composited shareable pass image")
async def get_pass_image(pass_id: str):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT resident_name, resident_flat, visitor_name, purpose, valid_from, valid_to,
                   contact, aadhaar, email, address, qr_token, visitor_count, additional_visitor_names,
                   visitor_category
            FROM visitor_pass WHERE id = $1::uuid
            """,
            pass_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Pass not found")
    return FastAPIResponse(content=generate_pass_image(dict(row)), media_type="image/png")


# ── PATCH /passes/{id}/extend ─────────────────────────────────────────────────

@router.patch("/{pass_id}/extend", response_model=PassOut, summary="Extend a visitor pass's validity")
async def extend_pass(
    pass_id: str,
    body: PassExtendRequest,
    claims: dict = Depends(get_current_claims),
):
    resident = await _resolve_caller(claims)
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT resident_user_id, visitor_name, valid_from, status FROM visitor_pass WHERE id = $1::uuid",
            pass_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Pass not found")
        if str(row["resident_user_id"]) != resident["id"]:
            raise HTTPException(status_code=403, detail="Not your visitor pass")
        if row["status"] in ("cancelled", "expired", "exited"):
            raise HTTPException(status_code=400, detail=f"Cannot extend a pass that is {row['status']}")
        if body.valid_to <= row["valid_from"]:
            raise HTTPException(status_code=400, detail="valid_to must be after valid_from")

        await conn.execute(
            "UPDATE visitor_pass SET valid_to = $1, updated_at = NOW() WHERE id = $2::uuid",
            body.valid_to, pass_id,
        )
        out = await load_full_pass(conn, pass_id)

    message = f"Validity extended for {row['visitor_name']}'s visitor pass, now valid until {body.valid_to:%d %b %Y %I:%M %p}."
    await notify_all(resident["id"], resident.get("phone"), "visitor_pass_extended", "Visitor pass extended", message, pass_id)
    await broadcast_to_role("security_guard", "visitor_pass_extended", "Visitor pass extended", message, pass_id)
    return out


# ── GET /passes/{id}/photos ───────────────────────────────────────────────────

@router.get("/{pass_id}/photos", response_model=list[PhotoOut], summary="List photos for a pass (own pass, or privileged view-any)")
async def list_pass_photos(pass_id: str, claims: dict = Depends(get_current_claims)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT resident_user_id FROM visitor_pass WHERE id = $1::uuid", pass_id)
        if not row:
            raise HTTPException(status_code=404, detail="Pass not found")
        if not _is_privileged(claims):
            resident = await _resolve_caller(claims)
            if str(row["resident_user_id"]) != resident["id"]:
                raise HTTPException(status_code=403, detail="Not your visitor pass")
        return await fetch_photos(conn, pass_id=pass_id)


# ── POST /passes/{id}/phone-verify/request ───────────────────────────────────

@router.post("/{pass_id}/phone-verify/request", summary="Trigger phone verification for the visitor")
async def phone_verify_request(pass_id: str, claims: dict = Depends(get_current_claims)):
    resident = await _resolve_caller(claims)
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT resident_user_id, contact FROM visitor_pass WHERE id = $1::uuid", pass_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="Pass not found")
        if str(row["resident_user_id"]) != resident["id"]:
            raise HTTPException(status_code=403, detail="Not your visitor pass")
        if not row["contact"]:
            raise HTTPException(status_code=400, detail="No contact number on this pass")

        resp = await request_otp(row["contact"])
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail="Could not send verification code")
        data = resp.json()

        await conn.execute(
            """
            INSERT INTO phone_verification (visitor_pass_id, phone_number, otp_request_id, requested_by_user_id)
            VALUES ($1::uuid, $2, $3, $4::uuid)
            """,
            pass_id, row["contact"], data.get("request_id"), resident["id"],
        )
    return {"ok": data.get("ok", False), "sent_via": data.get("sent_via")}


# ── POST /passes/{id}/phone-verify/confirm ───────────────────────────────────

@router.post("/{pass_id}/phone-verify/confirm", summary="Security confirms the visitor's phone verification code")
async def phone_verify_confirm(
    pass_id: str, body: PhoneVerifyConfirmRequest, claims: dict = Depends(require_role(*_SECURITY_ROLES)),
):
    security = await get_by_sub(claims.get("sub", ""))
    if not security:
        raise HTTPException(status_code=404, detail="User not found")

    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, otp_request_id FROM phone_verification "
            "WHERE visitor_pass_id = $1::uuid ORDER BY requested_at DESC LIMIT 1",
            pass_id,
        )
        if not row or not row["otp_request_id"]:
            raise HTTPException(status_code=404, detail="No pending phone verification for this pass")

        resp = await verify_otp(row["otp_request_id"], body.code)
        data = resp.json() if resp.status_code == 200 else {}
        verified = bool(data.get("verified"))

        await conn.execute(
            "UPDATE phone_verification SET verification_status = $1::varchar, verified_by_security_id = $2::uuid, "
            "verified_at = CASE WHEN $1::varchar = 'verified' THEN NOW() ELSE verified_at END WHERE id = $3",
            "verified" if verified else "failed", security["id"], row["id"],
        )
    return {"verified": verified, "status": data.get("status")}
