"""The producer-side entry point of the trace pipeline."""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol, runtime_checkable
from uuid import uuid4

from dify_trace_sdk.events import TraceCorrelation, TraceEvent, TracePayload

logger = logging.getLogger(__name__)


@runtime_checkable
class TraceEmitter(Protocol):
    def emit(self, event: TraceEvent) -> None:
        """Hand one event to the trace pipeline without blocking on delivery."""
        ...


@dataclass(frozen=True)
class TraceScope:
    """Who emitted events belong to, plus the caller's correlation.

    A scope exists only when someone consumes the events, so producers check
    for ``None`` instead of asking whether tracing is enabled.
    """

    emitter: TraceEmitter
    tenant_id: str
    app_id: str | None
    user_id: str | None
    correlation: TraceCorrelation

    def emit(self, payload: TracePayload) -> None:
        """Report a finished operation. Call after its records are committed; never raises."""
        try:
            self.emitter.emit(
                TraceEvent(
                    event_id=uuid4().hex,
                    tenant_id=self.tenant_id,
                    app_id=self.app_id,
                    user_id=self.user_id,
                    occurred_at=datetime.now(UTC),
                    correlation=self.correlation,
                    payload=payload,
                )
            )
        except Exception:
            logger.warning("Trace event dropped: kind=%s app_id=%s", payload.kind, self.app_id, exc_info=True)
