"""Execution-local moderation facts for response presentation, independent of Graphon error strategies.

The execution owns a record until both its producer and response consumer finish.
Producers append only content-free outcome kinds. Only the response consumer
reads and aggregates them. Approval never enters the record or skips later checks.
"""

from collections.abc import Generator
from contextlib import contextmanager
from contextvars import ContextVar
from enum import StrEnum
from queue import Empty, SimpleQueue

from services.moderation_invocation_errors import (
    ModerationUnavailableInvocationError,
    PlatformModerationRejectedInvocationError,
)
from services.moderation_service import ModerationPhase


class _Outcome(StrEnum):
    INPUT_REJECTED = "input_rejected"
    OUTPUT_REJECTED = "output_rejected"
    UNAVAILABLE = "unavailable"


class ModerationRecord:
    """Collect presentation facts for one tenant execution, without retaining text, exceptions, or traceback frames."""

    def __init__(self, tenant_id: str) -> None:
        """Require admitted tenant ownership; allocate no provider, persistence, or execution-control resources."""
        if not tenant_id:
            raise ValueError("Moderation requires a tenant scope.")
        self._tenant_id = tenant_id
        self._pending: SimpleQueue[_Outcome] = SimpleQueue()
        self._observed: list[_Outcome] = []

    @contextmanager
    def activate(self) -> Generator[None]:
        """Bind this execution in its producer context and restore any parent binding on every exit."""
        token = _current_record.set(self)
        try:
            yield
        finally:
            _current_record.reset(token)

    def read(self) -> PlatformModerationRejectedInvocationError | ModerationUnavailableInvocationError | None:
        """Return a safe presentation result on the single response consumer, never the workflow's terminal cause.

        Any platform rejection takes precedence over unavailability. The first
        observed rejected phase selects the app preset. Reads are repeatable;
        handled failures and successful retries never erase moderation facts.
        """
        pending = True
        while pending:
            try:
                outcome = self._pending.get_nowait()
            except Empty:
                pending = False
            else:
                if outcome not in self._observed:
                    self._observed.append(outcome)
        for outcome in self._observed:
            if outcome == _Outcome.INPUT_REJECTED:
                return PlatformModerationRejectedInvocationError("input", "")
            if outcome == _Outcome.OUTPUT_REJECTED:
                return PlatformModerationRejectedInvocationError("output", "")
        return ModerationUnavailableInvocationError() if _Outcome.UNAVAILABLE in self._observed else None


_current_record: ContextVar[ModerationRecord | None] = ContextVar("moderation_record", default=None)


def record_moderation_failure(tenant_id: str, *, phase: ModerationPhase, rejected: bool) -> None:
    """Report one real failure before raising; foreign tenants and independent invocations cannot affect the record."""
    record = _current_record.get()
    if record is not None and record._tenant_id == tenant_id:
        outcome = (
            (_Outcome.INPUT_REJECTED if phase == "input" else _Outcome.OUTPUT_REJECTED)
            if rejected
            else _Outcome.UNAVAILABLE
        )
        record._pending.put(outcome)
