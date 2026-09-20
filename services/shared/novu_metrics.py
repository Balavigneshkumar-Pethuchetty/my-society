"""
Novu Metrics Exporter - Prometheus metrics for Novu notification system.
Tracks: delivery rates, latency, error rates, channel usage, subscriber metrics.

Usage:
    from shared.novu_metrics import (
        notification_sent,
        notification_failed,
        notification_latency,
        get_metrics_registry
    )

    # Track successful notification
    notification_sent("novu", "refund_approved")

    # Track failure
    notification_failed("novu", "payment_verified", "timeout")

    # Get metrics in Prometheus format
    metrics = get_metrics_registry().generate_latest()
"""

from prometheus_client import (
    Counter, Histogram, Gauge, CollectorRegistry, generate_latest
)
from contextlib import contextmanager
from typing import Optional
import logging

logger = logging.getLogger(__name__)

# Create registry
REGISTRY = CollectorRegistry()

# ─────────────────────────────────────────────────────────────────
# Counters - Total counts
# ─────────────────────────────────────────────────────────────────

notifications_sent = Counter(
    "novu_notifications_sent_total",
    "Total notifications sent successfully",
    ["source", "event_name", "channel"],
    registry=REGISTRY
)

notifications_failed = Counter(
    "novu_notifications_failed_total",
    "Total notifications that failed to send",
    ["source", "event_name", "error_type"],
    registry=REGISTRY
)

notifications_fallback = Counter(
    "novu_notifications_fallback_total",
    "Total times fallback was triggered (Novu unavailable)",
    ["trigger_reason"],
    registry=REGISTRY
)

subscribers_created = Counter(
    "novu_subscribers_created_total",
    "Total subscribers created in Novu",
    registry=REGISTRY
)

subscribers_updated = Counter(
    "novu_subscribers_updated_total",
    "Total subscribers updated in Novu",
    registry=REGISTRY
)

# ─────────────────────────────────────────────────────────────────
# Histograms - Distribution of values (latency, etc)
# ─────────────────────────────────────────────────────────────────

notification_latency_seconds = Histogram(
    "novu_notification_latency_seconds",
    "Time to send notification (seconds)",
    ["source", "event_name"],
    buckets=(0.1, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0),
    registry=REGISTRY
)

novu_api_latency_seconds = Histogram(
    "novu_api_latency_seconds",
    "Novu API response latency (seconds)",
    ["endpoint"],
    buckets=(0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0),
    registry=REGISTRY
)

fallback_latency_seconds = Histogram(
    "novu_fallback_latency_seconds",
    "Legacy fallback notification latency (seconds)",
    ["channel"],
    buckets=(0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0),
    registry=REGISTRY
)

# ─────────────────────────────────────────────────────────────────
# Gauges - Current state values
# ─────────────────────────────────────────────────────────────────

novu_api_health = Gauge(
    "novu_api_health",
    "Novu API health status (1=healthy, 0=unhealthy)",
    registry=REGISTRY
)

mongodb_health = Gauge(
    "novu_mongodb_health",
    "MongoDB health status (1=healthy, 0=unhealthy)",
    registry=REGISTRY
)

redis_health = Gauge(
    "novu_redis_health",
    "Redis health status (1=healthy, 0=unhealthy)",
    registry=REGISTRY
)

fallback_system_health = Gauge(
    "novu_fallback_system_health",
    "Legacy fallback system health (1=healthy, 0=unhealthy)",
    ["system"],
    registry=REGISTRY
)

active_subscribers = Gauge(
    "novu_active_subscribers",
    "Current number of active subscribers in Novu",
    registry=REGISTRY
)

pending_notifications = Gauge(
    "novu_pending_notifications",
    "Number of pending notifications in queue",
    registry=REGISTRY
)

strategy_in_use = Gauge(
    "novu_strategy_in_use",
    "Current notification strategy (0=legacy_only, 1=novu_with_fallback, 2=novu_only)",
    registry=REGISTRY
)

# ─────────────────────────────────────────────────────────────────
# Metric recording functions
# ─────────────────────────────────────────────────────────────────

def record_notification_sent(
    source: str,
    event_name: str,
    channel: str = "multi",
    latency_seconds: Optional[float] = None
):
    """
    Record a successfully sent notification.

    Args:
        source: "novu" or "legacy"
        event_name: Notification event name (e.g., "refund_approved")
        channel: Channel used (sms, email, telegram, multi)
        latency_seconds: Time taken to send (optional)
    """
    notifications_sent.labels(
        source=source,
        event_name=event_name,
        channel=channel
    ).inc()

    if latency_seconds:
        notification_latency_seconds.labels(
            source=source,
            event_name=event_name
        ).observe(latency_seconds)

    logger.debug(f"Notification sent: {source} {event_name} ({latency_seconds}s)")


def record_notification_failed(
    source: str,
    event_name: str,
    error_type: str
):
    """
    Record a failed notification.

    Args:
        source: "novu" or "legacy"
        event_name: Notification event name
        error_type: Type of error (timeout, connection, validation, etc)
    """
    notifications_failed.labels(
        source=source,
        event_name=event_name,
        error_type=error_type
    ).inc()

    logger.warning(f"Notification failed: {source} {event_name} ({error_type})")


def record_fallback_triggered(reason: str):
    """
    Record when fallback was triggered.

    Args:
        reason: Why fallback was triggered (timeout, connection_error, api_error, etc)
    """
    notifications_fallback.labels(trigger_reason=reason).inc()
    logger.info(f"Fallback triggered: {reason}")


def record_api_call(endpoint: str, latency_seconds: float):
    """
    Record Novu API call latency.

    Args:
        endpoint: API endpoint called (e.g., "/v1/events/trigger")
        latency_seconds: Time taken for API call
    """
    novu_api_latency_seconds.labels(endpoint=endpoint).observe(latency_seconds)


def record_fallback_channel_latency(channel: str, latency_seconds: float):
    """
    Record legacy fallback channel latency.

    Args:
        channel: Channel used (sms, email, telegram)
        latency_seconds: Time taken to send via channel
    """
    fallback_latency_seconds.labels(channel=channel).observe(latency_seconds)


def set_health_status(component: str, healthy: bool):
    """
    Set health status for a component.

    Args:
        component: Component name (novu_api, mongodb, redis, etc)
        healthy: Whether component is healthy
    """
    status = 1 if healthy else 0

    if component == "novu_api":
        novu_api_health.set(status)
    elif component == "mongodb":
        mongodb_health.set(status)
    elif component == "redis":
        redis_health.set(status)
    elif component in ["auth_service", "gmail"]:
        fallback_system_health.labels(system=component).set(status)

    logger.debug(f"Health status: {component} = {status}")


def set_strategy(strategy_name: str):
    """
    Set current notification strategy.

    Args:
        strategy_name: "legacy_only", "novu_with_fallback", or "novu_only"
    """
    strategy_map = {
        "legacy_only": 0,
        "novu_with_fallback": 1,
        "novu_only": 2
    }
    strategy_in_use.set(strategy_map.get(strategy_name, 1))
    logger.info(f"Strategy set to: {strategy_name}")


def set_active_subscribers(count: int):
    """Update active subscriber count."""
    active_subscribers.set(count)


def set_pending_notifications(count: int):
    """Update pending notifications count."""
    pending_notifications.set(count)


@contextmanager
def track_latency(metric, **labels):
    """
    Context manager to track operation latency.

    Usage:
        with track_latency(novu_api_latency_seconds, endpoint="/v1/events/trigger") as timer:
            # do work
            pass
    """
    import time
    start = time.time()
    try:
        yield
    finally:
        duration = time.time() - start
        metric.labels(**labels).observe(duration)


def get_metrics_registry():
    """Get Prometheus metrics registry."""
    return REGISTRY


def get_metrics_text() -> str:
    """Get metrics in Prometheus text format."""
    return generate_latest(REGISTRY).decode('utf-8')
