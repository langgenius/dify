"""In-memory fakes shared by the run job tests."""

import threading
import time
from collections.abc import Callable, Iterable, Iterator, Mapping
from dataclasses import dataclass, field
from datetime import timedelta

from core.app.entities.task_entities import HumanInputRequiredResponse, WorkflowFinishStreamResponse
from graphon.enums import WorkflowExecutionStatus
from models.enums import CreatorUserRole
from models.model import AppMode
from services.app_task_service import WorkflowStopOutcome
from services.run_job.contracts import JobRecord, RunJobStore
from services.run_job.service import (
    READER_THREAD_NAME,
    MessageResult,
    RunJobService,
    RunResult,
    RunResultReader,
    RunTaskControl,
)

# Core's default WORKFLOW_MAX_EXECUTION_TIME.
RUN_TIME_LIMIT = timedelta(hours=1)


@dataclass
class InMemoryRedis:
    """Implements only the Redis methods RedisRunJobStore calls."""

    values: dict[str, str] = field(default_factory=dict)
    hashes: dict[str, dict[str, str]] = field(default_factory=dict)
    ttls: dict[str, int] = field(default_factory=dict)

    def set(self, name: str, value: str, ex: int | None = None) -> bool:
        self.values[name] = value
        if ex is not None:
            self.ttls[name] = ex
        return True

    def hset(self, name: str, *, mapping: Mapping[str, str]) -> int:
        self.hashes.setdefault(name, {}).update(mapping)
        return len(mapping)

    def hgetall(self, name: str) -> dict[bytes, bytes]:
        if name in self.values:
            raise TypeError("WRONGTYPE Operation against a key holding the wrong kind of value")
        return {key.encode(): value.encode() for key, value in self.hashes.get(name, {}).items()}

    def expire(self, name: str, time: int) -> bool:
        exists = name in self.hashes or name in self.values
        if exists:
            self.ttls[name] = time
        return exists

    def hsetnx(self, name: str, key: str, value: str) -> int:
        fields = self.hashes.setdefault(name, {})
        if key in fields:
            return 0
        fields[key] = value
        return 1

    def exists(self, *names: str) -> int:
        return sum(name in self.hashes or name in self.values for name in names)

    def delete(self, *names: str) -> int:
        removed = 0
        for name in names:
            removed += self.hashes.pop(name, None) is not None
            removed += self.values.pop(name, None) is not None
            self.ttls.pop(name, None)
        return removed


@dataclass
class RecordingJobStopper:
    stopped: list[JobRecord] = field(default_factory=list)

    def __call__(self, record: JobRecord) -> None:
        self.stopped.append(record)


@dataclass
class InMemoryRunResults:
    runs: dict[tuple[str, str], RunResult] = field(default_factory=dict)
    forms: dict[tuple[str, str, str, AppMode], HumanInputRequiredResponse] = field(default_factory=dict)
    messages: dict[tuple[str, str], MessageResult] = field(default_factory=dict)

    def run(self, *, tenant_id: str, run_id: str) -> RunResult | None:
        return self.runs.get((tenant_id, run_id))

    def pending_form(
        self, *, tenant_id: str, app_id: str, run_id: str, mode: AppMode
    ) -> HumanInputRequiredResponse | None:
        return self.forms.get((tenant_id, app_id, run_id, mode))

    def message(self, *, app_id: str, message_id: str) -> MessageResult | None:
        return self.messages.get((app_id, message_id))


def human_input_form(form_id: str = "f1") -> HumanInputRequiredResponse:
    """A pending form as core's snapshot reports it."""
    return HumanInputRequiredResponse(
        task_id="task-1",
        workflow_run_id="run-1",
        data=HumanInputRequiredResponse.Data(
            form_id=form_id, node_id="n1", node_title="Review", form_content="", expiration_time=4102444800
        ),
    )


@dataclass(frozen=True)
class WorkflowStop:
    tenant_id: str
    app_id: str
    run_id: str
    app_mode: AppMode
    caller_role: CreatorUserRole
    caller_id: str


@dataclass(frozen=True)
class MessageStop:
    task_id: str
    caller_role: CreatorUserRole
    caller_id: str


@dataclass
class RecordingTaskControl:
    workflow_stops: list[WorkflowStop] = field(default_factory=list)
    message_stops: list[MessageStop] = field(default_factory=list)

    def stop_workflow_run(
        self,
        *,
        tenant_id: str,
        app_id: str,
        run_id: str,
        app_mode: AppMode,
        caller_role: CreatorUserRole,
        caller_id: str,
    ) -> WorkflowStopOutcome:
        self.workflow_stops.append(WorkflowStop(tenant_id, app_id, run_id, app_mode, caller_role, caller_id))
        return WorkflowStopOutcome.STOPPED

    def stop_message_task(self, *, task_id: str, caller_role: CreatorUserRole, caller_id: str) -> bool:
        self.message_stops.append(MessageStop(task_id, caller_role, caller_id))
        return True


class ClosableFrames:
    def __init__(self, frames: Iterable[str] = ()) -> None:
        self._frames = list(frames)
        self.closed = False

    def __iter__(self) -> Iterator[str]:
        return iter(self._frames)

    def close(self) -> None:
        self.closed = True


def workflow_finished(status: WorkflowExecutionStatus, error: str | None = None) -> WorkflowFinishStreamResponse:
    """Core's workflow_finished response for run-1 of task-1."""
    return WorkflowFinishStreamResponse(
        task_id="task-1",
        workflow_run_id="run-1",
        data=WorkflowFinishStreamResponse.Data(
            id="run-1",
            workflow_id="wf-1",
            status=status,
            error=error,
            elapsed_time=0.1,
            total_tokens=0,
            total_steps=1,
            created_at=1,
            finished_at=2,
        ),
    )


def start_reader_plainly(read: Callable[[], None]) -> None:
    """A reader starter without Flask: a daemon thread named as the host names it."""
    threading.Thread(target=read, name=READER_THREAD_NAME, daemon=True).start()


def polling_service(
    *, store: RunJobStore, results: RunResultReader, tasks: RunTaskControl, max_background_runs: int = 10
) -> RunJobService:
    """A service over the given fakes that polls every 10 ms on the real clock."""
    return RunJobService(
        store=store,
        results=results,
        tasks=tasks,
        max_background_runs=max_background_runs,
        max_waiters=4,
        run_time_limit=RUN_TIME_LIMIT,
        start_reader=start_reader_plainly,
        sleep=lambda _seconds: time.sleep(0.01),
    )
