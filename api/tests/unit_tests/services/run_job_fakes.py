"""In-memory fakes shared by the run job tests."""

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field

from models.enums import CreatorUserRole
from models.model import AppMode
from repositories.run_job_store import SETTLE_SCRIPT
from services.app_task_service import WorkflowStopOutcome
from services.run_job_contracts import JobRecord
from services.run_job_service import RunResult


@dataclass
class InMemoryRedis:
    """Implements only the Redis methods RedisRunJobStore calls."""

    values: dict[str, str] = field(default_factory=dict)
    hashes: dict[str, dict[str, str]] = field(default_factory=dict)
    ttls: dict[str, int] = field(default_factory=dict)
    scripts: list[str] = field(default_factory=list)

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

    def register_script(self, script: str) -> Callable[..., int]:
        """Return a Python stand-in for one of the store's scripts; the real scripts run in the container tests."""
        self.scripts.append(script)
        if script == SETTLE_SCRIPT:
            return self._settle
        return self._delete_if_equal

    def _settle(self, *, keys: list[str], args: list[object]) -> int:
        job = self.hashes.get(keys[0])
        if job is None:
            return 0
        if job.get("status") in args[4:]:
            return 0
        status, error, failure, ttl = args[:4]
        job.update({"status": str(status), "error": str(error), "failure": str(failure)})
        self.ttls[keys[0]] = int(str(ttl))
        return 1

    def _delete_if_equal(self, *, keys: list[str], args: list[str]) -> int:
        if self.values.get(keys[0]) != args[0]:
            return 0
        return self.delete(keys[0])

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
    forms: dict[tuple[str, str, str, AppMode], Mapping[str, object]] = field(default_factory=dict)

    def run(self, *, tenant_id: str, run_id: str) -> RunResult | None:
        return self.runs.get((tenant_id, run_id))

    def pending_form(self, *, tenant_id: str, app_id: str, run_id: str, mode: AppMode) -> Mapping[str, object] | None:
        return self.forms.get((tenant_id, app_id, run_id, mode))


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
