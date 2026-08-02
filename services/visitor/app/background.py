"""
Two periodic asyncio loops, started from app.main's lifespan (same
create_task-before-yield / cancel-after-yield pattern as
services/user/app/metrics_collector.py's collect_metrics()):

  sweep_overdue()   — every few minutes, notifies security about visitor
                       passes still 'pending' past valid_from + threshold.
  send_summaries()  — hourly check against visitor_settings' configured
                       hour/interval, sends admin/committee a visitor summary.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from app.database import get_pool
from app.notify_client import broadcast_to_role

logger = logging.getLogger(__name__)

_SWEEP_INTERVAL = 300  # seconds
_SUMMARY_CHECK_INTERVAL = 3600  # seconds


async def sweep_overdue() -> None:
    while True:
        try:
            await _run_overdue_sweep()
        except asyncio.CancelledError:
            return
        except Exception:
            logger.exception("sweep_overdue iteration failed")
        await asyncio.sleep(_SWEEP_INTERVAL)


async def _run_overdue_sweep() -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        threshold = await conn.fetchval("SELECT overdue_threshold_minutes FROM visitor_settings WHERE id = 1")
        threshold = threshold or 60
        rows = await conn.fetch(
            """
            SELECT id, visitor_name, resident_name, resident_flat, valid_from
            FROM visitor_pass
            WHERE status = 'pending'
              AND overdue_notified_at IS NULL
              AND valid_from + make_interval(mins => $1) < NOW()
            """,
            threshold,
        )
        for row in rows:
            await conn.execute(
                "UPDATE visitor_pass SET overdue_notified_at = NOW() WHERE id = $1", row["id"]
            )
        ids = [row["id"] for row in rows]

    for row in rows:
        await broadcast_to_role(
            "security_guard",
            "visitor_overdue",
            "Visitor overdue",
            f"{row['visitor_name']} (visiting {row['resident_name']}"
            + (f", {row['resident_flat']}" if row["resident_flat"] else "")
            + ") has not arrived yet.",
            str(row["id"]),
        )
    if ids:
        logger.info("sweep_overdue: notified security about %d overdue pass(es)", len(ids))


async def send_summaries() -> None:
    while True:
        try:
            await _maybe_send_summary()
        except asyncio.CancelledError:
            return
        except Exception:
            logger.exception("send_summaries iteration failed")
        await asyncio.sleep(_SUMMARY_CHECK_INTERVAL)


async def _maybe_send_summary() -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        settings_row = await conn.fetchrow(
            "SELECT daily_summary_enabled, summary_interval, summary_hour_utc, updated_at "
            "FROM visitor_settings WHERE id = 1"
        )
        if not settings_row or not settings_row["daily_summary_enabled"]:
            return

        now = datetime.now(timezone.utc)
        if now.hour != settings_row["summary_hour_utc"]:
            return

        last_sent = await conn.fetchval(
            "SELECT last_summary_sent_at FROM visitor_settings WHERE id = 1"
        )
        interval = timedelta(days=7) if settings_row["summary_interval"] == "weekly" else timedelta(days=1)
        since = last_sent or (now - interval)
        if last_sent and now - last_sent < interval:
            return

        passes_created = await conn.fetchval(
            "SELECT COUNT(*) FROM visitor_pass WHERE created_at >= $1", since
        )
        entries = await conn.fetchval(
            "SELECT COUNT(*) FROM visitor_log WHERE entry_time >= $1", since
        )
        anonymous = await conn.fetchval(
            "SELECT COUNT(*) FROM anonymous_visitor WHERE entry_time >= $1", since
        )
        overdue = await conn.fetchval(
            "SELECT COUNT(*) FROM visitor_pass WHERE overdue_notified_at >= $1", since
        )
        await conn.execute("UPDATE visitor_settings SET last_summary_sent_at = $1 WHERE id = 1", now)

    period = "week" if settings_row["summary_interval"] == "weekly" else "day"
    message = (
        f"Visitor summary (past {period}): {passes_created} pass(es) created, "
        f"{entries} entr{'y' if entries == 1 else 'ies'}, {anonymous} anonymous visitor(s), "
        f"{overdue} overdue alert(s)."
    )
    await broadcast_to_role("admin", "visitor_summary", "Visitor summary", message)
    await broadcast_to_role("committee_member", "visitor_summary", "Visitor summary", message)
