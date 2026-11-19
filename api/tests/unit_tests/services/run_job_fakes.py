"""In-memory fakes shared by the run job tests."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import timedelta

from core.app.entities.task_entities import HumanInputRequiredResponse
from models.enums import CreatorUserRole
from models.model import AppMode
from services.app_task_service import WorkflowStopOutcome
from services.run_job_contracts import JobRecord
from services.run_job_service import RunResult

# Core's default WORKFLOW_MAX_EXECUTION_TIME.
RUN_TIME_LIMIT = timedelta(hours=1)


@dataclass
class InMemoryRedis:
    """Implements only the Redis methods RedisRunJobStore calls."""

    values: dict[str, str] = field(default_factory=dict)
    hashes: dict[str, dict[str, str]] = field(default_factory=dict)
    ttls: dict[str, int] = field(default_factory=dict)

    def set(self, name: str, value: str, ex: int | None = None, nx: bool = False) -> bool | None:
        if nx and name in self.values:
            return None
        self.values[name] = value
        if ex is not None:
            self.ttls[name] = ex
        return True

    def get(self, name: str) -> bytes | None:
        value = self.values.get(name)
        return None if value is None else value.encode()

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

    def stop(self, record: JobRecord) -> None:
        self.stopped.append(record)


@dataclass
class InMemoryRunResults:
    runs: dict[tuple[str, str], RunResult] = field(default_factory=dict)
    forms: dict[tuple[str, str, str, AppMode], HumanInputRequiredResponse] = field(default_factory=dict)

    def run(self, *, tenant_id: str, run_id: str) -> RunResult | None:
        return self.runs.get((tenant_id, run_id))

    def pending_form(
        self, *, tenant_id: str, app_id: str, run_id: str, mode: AppMode
    ) -> HumanInputRequiredResponse | None:
        return self.forms.get((tenant_id, app_id, run_id, mode))


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
