"""Per-event advisory lock (services/payment/app/reconciliation/inbox.py) — the fix
for two payment-service replicas (or a manual scan racing the background loop) both
scanning the same event's mailbox concurrently. Stubs `_scan_once` itself rather than
mocking IMAP, since the lock's correctness doesn't depend on what's inside the
critical section."""
import asyncio

import pytest

from app.reconciliation import inbox

pytestmark = pytest.mark.asyncio


async def test_concurrent_scans_of_same_event_only_one_proceeds(db, monkeypatch):
    calls = []

    async def fake_scan_once(event_id, cfg, ai_cfg, conn):
        calls.append(event_id)
        await asyncio.sleep(0.2)
        return {"emails_processed": 1, "matched": 1, "unmatched": 0}

    monkeypatch.setattr(inbox, "_scan_once", fake_scan_once)

    results = await asyncio.gather(
        inbox._run_scan_locked("event-a", {}, {}),
        inbox._run_scan_locked("event-a", {}, {}),
    )

    assert len(calls) == 1, "both concurrent scans of the same event ran the critical section"
    skipped = [r for r in results if r.get("skipped")]
    proceeded = [r for r in results if not r.get("skipped")]
    assert len(skipped) == 1
    assert len(proceeded) == 1
    assert proceeded[0]["matched"] == 1


async def test_concurrent_scans_of_different_events_both_proceed(db, monkeypatch):
    calls = []

    async def fake_scan_once(event_id, cfg, ai_cfg, conn):
        calls.append(event_id)
        await asyncio.sleep(0.1)
        return {"emails_processed": 0, "matched": 0, "unmatched": 0}

    monkeypatch.setattr(inbox, "_scan_once", fake_scan_once)

    results = await asyncio.gather(
        inbox._run_scan_locked("event-a", {}, {}),
        inbox._run_scan_locked("event-b", {}, {}),
    )

    assert sorted(calls) == ["event-a", "event-b"], "different events should run in parallel, not serialize"
    assert not any(r.get("skipped") for r in results)


async def test_lock_releases_even_when_scan_raises(db, monkeypatch):
    async def failing_scan_once(event_id, cfg, ai_cfg, conn):
        raise RuntimeError("simulated IMAP failure mid-scan")

    monkeypatch.setattr(inbox, "_scan_once", failing_scan_once)

    with pytest.raises(RuntimeError):
        await inbox._run_scan_locked("event-c", {}, {})

    # If the lock leaked, this second call would see it still held and get skipped.
    async def ok_scan_once(event_id, cfg, ai_cfg, conn):
        return {"emails_processed": 0, "matched": 0, "unmatched": 0}

    monkeypatch.setattr(inbox, "_scan_once", ok_scan_once)
    result = await inbox._run_scan_locked("event-c", {}, {})
    assert not result.get("skipped"), "lock was not released after the scan raised"
