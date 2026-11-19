"""Low-cardinality, payload-free observability for durable IM callback intake."""

from __future__ import annotations

import logging
from enum import StrEnum
from typing import TYPE_CHECKING, Protocol

from configs import dify_config
from core.human_input_v2.entities import IMProvider

if TYPE_CHECKING:
    from opentelemetry.metrics import Counter

logger = logging.getLogger(__name__)


class IMInboxMetricKind(StrEnum):
    """Stable event dimensions emitted during callback intake."""

    ACCEPTANCE = "acceptance"
    DUPLICATE = "duplicate"
    ACCEPTANCE_FAILURE = "acceptance_failure"
    DISPATCH_FAILURE = "dispatch_failure"


class IMInboxMetrics(Protocol):
    """Metrics port that cannot receive record payloads or credentials."""

    def record(
        self,
        kind: IMInboxMetricKind,
        *,
        provider: IMProvider | None,
        outcome: str | None = None,
    ) -> None:
        """Increment one low-cardinality intake metric."""


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


class OpenTelemetryIMInboxMetrics:
    """OpenTelemetry adapter with stable, low-cardinality dimensions."""

    _events: Counter | None

    def __init__(self) -> None:
        self._events = None
        if not dify_config.ENABLE_OTEL:
            return
        try:
            from opentelemetry.metrics import get_meter

            meter = get_meter("im_message_inbox", version=dify_config.project.version)
            self._events = meter.create_counter(
                "im_message_inbox_events_total",
                description="Durable IM callback intake events.",
                unit="{event}",
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
