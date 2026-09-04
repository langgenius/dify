"""Curated, replaceable execution progress for long-running Builder handlers."""

import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from types import TracebackType
from typing import Literal

from core.dify_builder.contract import ExecutionActivity, ExecutionProgress, ProgressEventData
from core.dify_builder.models import NodeEvent, Session

__all__ = ["ProgressReporter"]

_InternalActivityState = Literal["pending", "active", "done", "failed", "stopped"]


@dataclass
class _ActivityRecord:
    id: str
    label: str
    state: _InternalActivityState = "pending"
    kind: Literal["stage", "node"] = "stage"
    parent_id: str | None = None


class ProgressReporter:
    """Publish snapshots of actions that have actually started.

    Handlers may declare their possible stages up front, but pending stages
    stay private. A stage enters the public snapshot only when activate is
    called. Workflow node events are folded into the same authoritative stream
    as child activities, so clients never have to merge two timelines.
    """

    def __init__(
        self,
        *,
        emit: Callable[[ProgressEventData], None] | None,
        session_id: str,
        stage_id: str,
        at_version: int,
        activities: Iterable[ExecutionActivity],
        operation_id: str | None = None,
    ) -> None:
        self._emit = emit
        self._session_id = session_id
        self._stage_id = stage_id
        self._at_version = at_version
        self._operation_id = operation_id or str(uuid.uuid4())
        self._revision = 0
        self._status: Literal["running", "completed", "error", "stopped"] = "running"
        self._finished = False
        self._activities = [
            _ActivityRecord(
                id=activity.id,
                label=activity.label,
                kind=activity.kind,
                parent_id=activity.parent_id,
            )
            for activity in activities
        ]
        if len({activity.id for activity in self._activities}) != len(self._activities):
            raise ValueError("dify_builder: execution activity ids must be unique")

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
            activities=[ExecutionActivity(id=activity_id, label=label, state="active") for activity_id, label in steps],
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

    def activate(self, activity_id: str) -> None:
        """Complete prior active work and reveal the next stage."""
        activity = self._find(activity_id)
        for current in self._activities:
            if current.state == "active":
                current.state = "done"
        activity.state = "active"
        self._status = "running"
        self._publish()

    def complete(self, activity_id: str) -> None:
        """Mark one revealed activity complete while the operation continues."""
        self._find(activity_id).state = "done"
        self._publish()

    def add_steps(self, steps: Iterable[tuple[str, str]]) -> None:
        """Declare branch-specific stages without revealing them yet."""
        additions = [_ActivityRecord(id=activity_id, label=label) for activity_id, label in steps]
        known_ids = {activity.id for activity in self._activities}
        addition_ids = {activity.id for activity in additions}
        if len(addition_ids) != len(additions) or addition_ids & known_ids:
            raise ValueError("dify_builder: execution activity ids must be unique")
        self._activities.extend(additions)

    def fail_step(self, activity_id: str) -> None:
        """Mark one observable activity as failed before recovery continues."""
        self._find(activity_id).state = "failed"
        self._publish()

    def observe_node(self, parent_id: str, event: NodeEvent) -> None:
        """Fold a workflow node event into the canonical execution timeline."""
        activity_id = f"node:{event.node_id}"
        activity = next((item for item in self._activities if item.id == activity_id), None)
        if activity is None:
            activity = _ActivityRecord(
                id=activity_id,
                label=event.title or event.node_id,
                state="active",
                kind="node",
                parent_id=parent_id,
            )
            self._activities.append(activity)
        else:
            activity.label = event.title or event.node_id
            activity.parent_id = parent_id

        if event.status in {"success", "succeeded"}:
            activity.state = "done"
        elif event.status in {"error", "exception", "failed"}:
            activity.state = "failed"
        elif event.status == "running":
            activity.state = "active"
        else:
            activity.state = "stopped"
        self._publish()

    def finish(
        self,
        *,
        status: Literal["completed", "error", "stopped"] = "completed",
    ) -> ExecutionProgress:
        """Publish and return the final snapshot for durable assistant output."""
        if self._finished:
            return self._snapshot()
        self._status = status
        for activity in self._activities:
            if activity.state != "active":
                continue
            activity.state = "done" if status == "completed" else "failed" if status == "error" else "stopped"
        execution = self._snapshot()
        self._finished = True
        self._publish(execution)
        return execution

    def _find(self, activity_id: str) -> _ActivityRecord:
        activity = next((item for item in self._activities if item.id == activity_id), None)
        if activity is None:
            raise ValueError(f"dify_builder: unknown execution activity {activity_id}")
        return activity

    def _snapshot(self) -> ExecutionProgress:
        return ExecutionProgress(
            status=self._status,
            activities=[
                ExecutionActivity(
                    id=activity.id,
                    label=activity.label,
                    state=activity.state,
                    kind=activity.kind,
                    parent_id=activity.parent_id,
                )
                for activity in self._activities
                if activity.state != "pending"
            ],
        )

    def _publish(self, execution: ExecutionProgress | None = None) -> None:
        self._revision += 1
        if self._emit is None:
            return
        snapshot = execution or self._snapshot()
        self._emit(
            ProgressEventData(
                session_id=self._session_id,
                operation_id=self._operation_id,
                stage_id=self._stage_id,
                at_version=self._at_version,
                revision=self._revision,
                execution=ExecutionProgress(
                    status=snapshot.status,
                    activities=[
                        ExecutionActivity(
                            id=activity.id,
                            label=activity.label,
                            state=activity.state,
                            kind=activity.kind,
                            parent_id=activity.parent_id,
                        )
                        for activity in snapshot.activities
                    ],
                ),
            )
        )
