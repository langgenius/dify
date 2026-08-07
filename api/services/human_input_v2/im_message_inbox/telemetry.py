"""Low-cardinality, payload-free observability for durable IM intake."""

from __future__ import annotations

import logging
from enum import StrEnum
from typing import TYPE_CHECKING, Protocol

from configs import dify_config
from core.human_input_v2.entities import IMProvider

if TYPE_CHECKING:
    from opentelemetry.metrics import Counter, Histogram

logger = logging.getLogger(__name__)


class IMInboxMetricKind(StrEnum):
    """Stable event dimensions emitted by inbox components."""

    ACCEPTANCE = "acceptance"
    DUPLICATE = "duplicate"
    ACCEPTANCE_FAILURE = "acceptance_failure"
    DISPATCH_FAILURE = "dispatch_failure"
    CLAIM = "claim"
    LEASE_RECLAIM = "lease_reclaim"
    RETRY = "retry"
    TERMINAL = "terminal"
    LOST_LEASE = "lost_lease"


class IMInboxMetrics(Protocol):
    """Metrics port that cannot receive record payloads or credentials."""

    def record(
        self,
        kind: IMInboxMetricKind,
        *,
        provider: IMProvider | None,
        outcome: str | None = None,
    ) -> None:
        """Increment one low-cardinality lifecycle metric."""

    def record_backlog(self, *, status: str, count: int, oldest_age_seconds: float | None) -> None:
        """Record one payload-free backlog snapshot."""


class NoopIMInboxMetrics:
    """Explicit metrics dependency for deployments that disable telemetry."""

    def record(
        self,
        kind: IMInboxMetricKind,
        *,
        provider: IMProvider | None,
        outcome: str | None = None,
    ) -> None:
        return None

    def record_backlog(self, *, status: str, count: int, oldest_age_seconds: float | None) -> None:
        return None


class OpenTelemetryIMInboxMetrics:
    """OpenTelemetry adapter with stable, low-cardinality dimensions."""

    _events: Counter | None
    _backlog_count: Histogram | None
    _oldest_pending_age: Histogram | None

    def __init__(self) -> None:
        self._events = None
        self._backlog_count = None
        self._oldest_pending_age = None
        if not dify_config.ENABLE_OTEL:
            return
        try:
            from opentelemetry.metrics import get_meter

            meter = get_meter("im_message_inbox", version=dify_config.project.version)
            self._events = meter.create_counter(
                "im_message_inbox_events_total",
                description="Durable IM inbox lifecycle events.",
                unit="{event}",
            )
            self._backlog_count = meter.create_histogram(
                "im_message_inbox_backlog_records",
                description="IM inbox records by current processing status.",
                unit="{record}",
            )
            self._oldest_pending_age = meter.create_histogram(
                "im_message_inbox_oldest_pending_age_seconds",
                description="Age of the oldest pending IM inbox record.",
                unit="s",
            )
        except Exception:
            logger.exception("Failed to initialize IM inbox metrics")

    def record(
        self,
        kind: IMInboxMetricKind,
        *,
        provider: IMProvider | None,
        outcome: str | None = None,
    ) -> None:
        if self._events is None:
            return
        attributes = {"kind": kind.value, "provider": provider.value if provider is not None else "unknown"}
        if outcome is not None:
            attributes["outcome"] = outcome
        self._events.add(1, attributes)

    def record_backlog(self, *, status: str, count: int, oldest_age_seconds: float | None) -> None:
        if self._backlog_count is not None:
            self._backlog_count.record(count, {"status": status})
        if status == "pending" and oldest_age_seconds is not None and self._oldest_pending_age is not None:
            self._oldest_pending_age.record(oldest_age_seconds)
