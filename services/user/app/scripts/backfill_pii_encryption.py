"""One-off, manually-invoked backfill: encrypts existing plaintext phone/email
values in `users`, plus their denormalized ciphertext-copy snapshots in
`admin_actions.target_user_email` and `leave_request.user_email` — see
PII_PRIVACY_PLAN.md. Must run after db/migrations/038_encrypt_phone_email.sql,
in the same maintenance window, before user-service is restarted with the
updated code — see that migration file for why the order matters.

Idempotent and safe to re-run:
  - `users` rows are selected by `phone_hash`/`email_hash IS NULL` (the
    migration leaves these NULL until this script runs), so an
    already-migrated row is skipped outright.
  - `admin_actions`/`leave_request` have no hash column to check against, so
    each value is decrypt-attempted first — a successful decrypt (valid
    base64 that also passes AES-GCM's authentication tag) means it's already
    ciphertext and is left alone. A plaintext string passing both checks by
    chance is cryptographically negligible.

Usage:
    docker compose run --rm user-service python -m app.scripts.backfill_pii_encryption
"""
import asyncio

from app import crypto
from app.database import get_pool


async def _backfill_users(conn) -> tuple[int, int]:
    rows = await conn.fetch(
        "SELECT id, phone, email FROM users "
        "WHERE (phone IS NOT NULL AND phone_hash IS NULL) "
        "OR (email IS NOT NULL AND email_hash IS NULL)"
    )
    phone_count = email_count = 0
    for r in rows:
        updates: dict = {}
        if r["phone"] is not None:
            updates["phone"] = crypto.encrypt(r["phone"])
            updates["phone_hash"] = crypto.blind_index(r["phone"])
            phone_count += 1
        if r["email"] is not None:
            updates["email"] = crypto.encrypt(r["email"])
            updates["email_hash"] = crypto.blind_index(r["email"])
            email_count += 1
        set_parts = [f"{col} = ${i + 2}" for i, col in enumerate(updates)]
        await conn.execute(
            f"UPDATE users SET {', '.join(set_parts)} WHERE id = $1",
            r["id"], *updates.values(),
        )
    return phone_count, email_count


def _already_ciphertext(value: str) -> bool:
    try:
        crypto.decrypt(value)
        return True
    except Exception:
        return False


async def _backfill_snapshot_column(conn, table: str, column: str) -> int:
    rows = await conn.fetch(f"SELECT id, {column} FROM {table} WHERE {column} IS NOT NULL")
    migrated = 0
    for r in rows:
        value = r[column]
        if _already_ciphertext(value):
            continue
        await conn.execute(
            f"UPDATE {table} SET {column} = $1 WHERE id = $2",
            crypto.encrypt(value), r["id"],
        )
        migrated += 1
    return migrated


async def backfill() -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        phone_count, email_count = await _backfill_users(conn)
        admin_actions_count = await _backfill_snapshot_column(conn, "admin_actions", "target_user_email")
        leave_request_count = await _backfill_snapshot_column(conn, "leave_request", "user_email")

    print(
        f"Backfill complete — users.phone: {phone_count} encrypted, "
        f"users.email: {email_count} encrypted, "
        f"admin_actions.target_user_email: {admin_actions_count} encrypted, "
        f"leave_request.user_email: {leave_request_count} encrypted."
    )


if __name__ == "__main__":
    asyncio.run(backfill())
