"""Curated, replaceable progress traces for long-running Builder handlers."""

import uuid
from collections.abc import Callable, Iterable
from dataclasses import replace
from types import TracebackType
from typing import Literal

from core.dify_builder.contract import ProgressEventData, Trace, TraceStep
from core.dify_builder.models import Session

__all__ = ["ProgressReporter"]


class ProgressReporter:
    """Publish full trace snapshots without mutating durable session state.

    Full snapshots make reconnect, duplicate delivery, and out-of-order event
    handling deterministic on the client. Step labels are authored by the
    handler and must describe observable work, never hidden model reasoning.
    """

    def __init__(
        self,
        *,
        emit: Callable[[ProgressEventData], None] | None,
        session_id: str,
        stage_id: str,
        at_version: int,
        steps: Iterable[TraceStep],
        operation_id: str | None = None,
    ) -> None:
        self._emit = emit
        self._session_id = session_id
        self._stage_id = stage_id
        self._at_version = at_version
        self._operation_id = operation_id or str(uuid.uuid4())
        self._revision = 0
        self._status = "running"
        self._finished = False
        self._steps = [replace(step, state="pending") for step in steps]
        if len({step.id for step in self._steps}) != len(self._steps):
            raise ValueError("dify_builder: progress step ids must be unique")

    @classmethod
    def for_session(
        cls,
        *,
        emit: Callable[[ProgressEventData], None] | None,
        session: Session,
        stage_id: str,
        steps: Iterable[tuple[str, str]],
        operation_id: str | None = None,
    ) -> "ProgressReporter":
        return cls(
            emit=emit,
            session_id=session.id,
            stage_id=stage_id,
            at_version=session.version + 1,
            steps=[TraceStep(id=step_id, label=label, state="pending") for step_id, label in steps],
            operation_id=operation_id,
        )

    @property
    def operation_id(self) -> str:
        return self._operation_id

    def __enter__(self) -> "ProgressReporter":
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        _exc: BaseException | None,
        _traceback: TracebackType | None,
    ) -> bool:
        if not self._finished:
            self.finish(status="error" if exc_type is not None else "completed")
        return False

    def activate(self, step_id: str) -> None:
        """Complete the prior active step and activate ``step_id``."""
        found = False
        updated: list[TraceStep] = []
        for step in self._steps:
            if step.id == step_id:
                found = True
                updated.append(replace(step, state="active"))
            elif step.state == "active":
                updated.append(replace(step, state="done"))
            else:
                updated.append(step)
        if not found:
            raise ValueError(f"dify_builder: unknown progress step {step_id}")
        self._steps = updated
        self._status = "running"
        self._publish()

    def complete(self, step_id: str) -> None:
        """Mark one step complete while leaving the operation running."""
        self._replace_step(step_id, state="done")
        self._publish()

    def add_steps(self, steps: Iterable[tuple[str, str]]) -> None:
        """Append branch-specific planned work to the next full snapshot."""
        additions = [TraceStep(id=step_id, label=label, state="pending") for step_id, label in steps]
        known_ids = {step.id for step in self._steps}
        if any(step.id in known_ids for step in additions) or len({step.id for step in additions}) != len(additions):
            raise ValueError("dify_builder: progress step ids must be unique")
        self._steps.extend(additions)

    def fail_step(self, step_id: str) -> None:
        """Mark one observable activity as failed before recovery continues."""
        self._replace_step(step_id, state="stopped", tone="error")
        self._publish()

    def finish(self, *, status: Literal["completed", "error", "stopped"] = "completed") -> Trace:
        """Publish and return the final snapshot for durable assistant output."""
        if self._finished:
            return self._snapshot()
        self._status = status
        if status == "completed":
            self._steps = [replace(step, state="done") if step.state == "active" else step for step in self._steps]
        else:
            self._steps = [
                replace(step, state="stopped", tone="error") if step.state == "active" else step for step in self._steps
            ]
        trace = self._snapshot()
        self._finished = True
        self._publish(trace)
        return trace

    def _replace_step(self, step_id: str, *, state: str, tone: str | None = None) -> None:
        found = False
        updated: list[TraceStep] = []
        for step in self._steps:
            if step.id == step_id:
                found = True
                updated.append(replace(step, state=state) if tone is None else replace(step, state=state, tone=tone))
            else:
                updated.append(step)
        if not found:
            raise ValueError(f"dify_builder: unknown progress step {step_id}")
        self._steps = updated

    def _snapshot(self) -> Trace:
        return Trace(status=self._status, steps=[replace(step) for step in self._steps])

    def _publish(self, trace: Trace | None = None) -> None:
        self._revision += 1
        if self._emit is None:
            return
        snapshot = trace or self._snapshot()
        self._emit(
            ProgressEventData(
                session_id=self._session_id,
                operation_id=self._operation_id,
                stage_id=self._stage_id,
                at_version=self._at_version,
                revision=self._revision,
                trace=Trace(status=snapshot.status, steps=[replace(step) for step in snapshot.steps]),
            )
        )
