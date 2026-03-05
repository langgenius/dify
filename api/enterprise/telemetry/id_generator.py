"""Custom OTEL ID Generator for correlation-based trace/span ID derivation.

Uses contextvars for thread-safe correlation_id -> trace_id mapping.
When a span_id_source is set, the span_id is derived deterministically
from that value, enabling any span to reference another as parent
without depending on span creation order.
"""

import random
import uuid
from contextvars import ContextVar
from typing import cast

from opentelemetry.sdk.trace.id_generator import IdGenerator

_correlation_id_context: ContextVar[str | None] = ContextVar("correlation_id", default=None)
_span_id_source_context: ContextVar[str | None] = ContextVar("span_id_source", default=None)


def set_correlation_id(correlation_id: str | None) -> None:
    _correlation_id_context.set(correlation_id)


def get_correlation_id() -> str | None:
    return _correlation_id_context.get()


def set_span_id_source(source_id: str | None) -> None:
    """Set the source for deterministic span_id generation.

    When set, ``generate_span_id()`` derives the span_id from this value
    (lower 64 bits of the UUID).  Pass the ``workflow_run_id`` for workflow
    root spans or ``node_execution_id`` for node spans.
    """
    _span_id_source_context.set(source_id)


def compute_deterministic_span_id(source_id: str) -> int:
    """Derive a deterministic span_id from any UUID string.

    Uses the lower 64 bits of the UUID, guaranteeing non-zero output
    (OTEL requires span_id != 0).
    """
    span_id = cast(int, uuid.UUID(source_id).int) & ((1 << 64) - 1)
    return span_id if span_id != 0 else 1


class CorrelationIdGenerator(IdGenerator):
    """ID generator that derives trace_id and optionally span_id from context.

    - trace_id: always derived from correlation_id (groups all spans in one trace)
    - span_id: derived from span_id_source when set (enables deterministic
      parent-child linking), otherwise random
    """

    def generate_trace_id(self) -> int:
        correlation_id = _correlation_id_context.get()
        if correlation_id:
            try:
                return cast(int, uuid.UUID(correlation_id).int)
            except (ValueError, AttributeError):
                pass
        return random.getrandbits(128)

    def generate_span_id(self) -> int:
        source = _span_id_source_context.get()
        if source:
            try:
                return compute_deterministic_span_id(source)
            except (ValueError, AttributeError):
                pass

        span_id = random.getrandbits(64)
        while span_id == 0:
            span_id = random.getrandbits(64)
        return span_id
