import asyncio
import logging
import os
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_HEC_URL   = os.getenv("SPLUNK_HEC_URL",   "http://splunk:8088/services/collector/event")
_HEC_TOKEN = os.getenv("SPLUNK_HEC_TOKEN", "")
_HOST      = "society_visitor_service"
_SOURCE    = "visitor-service"


async def _ship(payload: dict) -> None:
    if not _HEC_TOKEN:
        return
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.post(
                _HEC_URL,
                json=payload,
                headers={"Authorization": f"Splunk {_HEC_TOKEN}"},
            )
            if resp.status_code not in (200, 204):
                logger.debug("Splunk HEC returned HTTP %s", resp.status_code)
    except Exception as exc:
        logger.debug("Splunk HEC unreachable: %s", exc)


def _payload(event: dict[str, Any], index: str, sourcetype: str = "fastapi") -> dict:
    return {
        "time":       time.time(),
        "index":      index,
        "sourcetype": sourcetype,
        "source":     _SOURCE,
        "host":       _HOST,
        "event":      event,
    }


async def log_app_error(event: dict[str, Any]) -> None:
    if not _HEC_TOKEN:
        return
    asyncio.create_task(_ship(_payload(event, "society_app_errors")))


async def log_web_access(event: dict[str, Any]) -> None:
    if not _HEC_TOKEN:
        return
    asyncio.create_task(_ship(_payload(event, "society_web_access")))


async def log_security(event: dict[str, Any]) -> None:
    if not _HEC_TOKEN:
        return
    asyncio.create_task(_ship(_payload(event, "society_security")))
