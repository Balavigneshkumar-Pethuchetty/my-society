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
import logging

from app import crypto
from app.database import get_pool

logger = logging.getLogger(__name__)


async def _backfill_users(conn) -> tuple[int, int]:
    rows = await conn.fetch(
        "SELECT id, phone, email, phone_hash, email_hash FROM user_svc.users "
        "WHERE (phone IS NOT NULL AND phone_hash IS NULL) "
        "OR (email IS NOT NULL AND email_hash IS NULL)"
    )
    counts = {"phone": 0, "email": 0}
    for r in rows:
        for col in ("phone", "email"):
            # Only touch a column whose own hash is missing — the other one may
            # already hold ciphertext and must not be encrypted a second time.
            if r[col] is None or r[f"{col}_hash"] is not None:
                continue
            h = crypto.blind_index(r[col])
            other = await conn.fetchval(
                f"SELECT id FROM user_svc.users WHERE {col}_hash = $1 AND id <> $2", h, r["id"]
            )
            if other:
                # Plaintext rows escaped the unique index; encrypting would
                # collide with an existing account. Leave it for an admin.
                logger.warning(f"PII backfill: users.{col} of {r['id']} duplicates user {other} — skipped")
                continue
            await conn.execute(
                f"UPDATE user_svc.users SET {col} = $1, {col}_hash = $2 WHERE id = $3",
                crypto.encrypt(r[col]), h, r["id"],
            )
            counts[col] += 1
    return counts["phone"], counts["email"]


def _already_ciphertext(value: str) -> bool:
    # Must be decrypt_strict: crypto.decrypt() swallows failures and returns
    # the input, which would make every plaintext value look "already done".
    try:
        crypto.decrypt_strict(value)
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


async def backfill(quiet_if_nothing: bool = False) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        phone_count, email_count = await _backfill_users(conn)
        admin_actions_count = await _backfill_snapshot_column(conn, "user_svc.admin_actions", "target_user_email")
        leave_request_count = await _backfill_snapshot_column(conn, "user_svc.leave_request", "user_email")

    if quiet_if_nothing and not (phone_count or email_count or admin_actions_count or leave_request_count):
        return
    print(
        f"Backfill complete — users.phone: {phone_count} encrypted, "
        f"users.email: {email_count} encrypted, "
        f"admin_actions.target_user_email: {admin_actions_count} encrypted, "
        f"leave_request.user_email: {leave_request_count} encrypted."
    )


if __name__ == "__main__":
    asyncio.run(backfill())
