"""Operation observations for the independent sandbox usage ledger.

These observations carry correlation only. Provider execution events, not RPC
elapsed time or lease duration, are the authority for metered sandbox usage.
The context is task-local and never becomes part of an Agenton snapshot.
"""

from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import UTC, datetime
import logging
from typing import Any, Protocol

logger = logging.getLogger(__name__)


class RuntimeUsageObserver(Protocol):
    async def observe_safely(self, event: dict[str, Any]) -> None:
        """Boundedly enqueue without suspension or changing resource outcomes.

        Network delivery belongs to a lifespan-owned worker. In particular this
        method must not introduce a cancellation point between a successful
        create/connect and returning the resource handle to its cleanup owner.
        """
        ...


@dataclass(frozen=True, slots=True)
class RuntimeUsageContext:
    purpose: str | None = None
    lease_id: str | None = None
    correlation: Mapping[str, str] = field(default_factory=dict)


_context: ContextVar[RuntimeUsageContext | None] = ContextVar("sandbox_usage_context", default=None)


def current_runtime_usage_context() -> RuntimeUsageContext:
    return _context.get() or RuntimeUsageContext()


@contextmanager
def runtime_usage_context(
    *,
    purpose: str | None = None,
    lease_id: str | None = None,
    correlation: Mapping[str, str] | None = None,
    context: RuntimeUsageContext | None = None,
) -> Iterator[None]:
    parent = context or current_runtime_usage_context()
    token = _context.set(
        RuntimeUsageContext(
            purpose=purpose or parent.purpose,
            lease_id=lease_id or parent.lease_id,
            correlation={**parent.correlation, **(correlation or {})},
        )
    )
    try:
        yield
    finally:
        _context.reset(token)


async def observe_runtime_operation(
    observer: RuntimeUsageObserver | None,
    *,
    operation_id: str,
    attempt: int,
    phase: str,
    operation: str,
    cleanup_stage: str,
    sandbox_id: str | None = None,
    allocation_id: str | None = None,
    outcome: str | None = None,
    changed: bool | None = None,
    error_type: str | None = None,
) -> None:
    if observer is None:
        return
    context = current_runtime_usage_context()
    event: dict[str, Any] = {
        "id": f"{operation_id}:{attempt}:{phase}",
        "source": "application",
        "type": f"operation_{phase}",
        "timestamp": datetime.now(UTC).isoformat(),
        "sandbox_id": sandbox_id,
        "allocation_id": allocation_id,
        "operation_id": operation_id,
        "lease_id": context.lease_id,
        "attempt": attempt,
        "purpose": context.purpose,
        "correlation": dict(context.correlation),
        "payload": {
            "operation": operation,
            "cleanup_stage": cleanup_stage,
            "outcome": outcome,
            "changed": changed,
            # Error messages may contain credentials or file contents. Only the
            # exception class is useful and safe for this accounting event.
            "error_type": error_type,
        },
    }
    try:
        await observer.observe_safely(event)
    except Exception as exc:
        logger.warning("sandbox usage observation unavailable: %s", type(exc).__name__)


__all__ = [
    "RuntimeUsageContext",
    "RuntimeUsageObserver",
    "current_runtime_usage_context",
    "observe_runtime_operation",
    "runtime_usage_context",
]
