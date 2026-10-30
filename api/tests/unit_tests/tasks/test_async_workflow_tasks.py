from __future__ import annotations

import sys
from collections.abc import Generator
from contextlib import contextmanager, nullcontext
from dataclasses import dataclass, field
from datetime import UTC, datetime
from threading import Event
from types import ModuleType
from typing import Protocol, cast, override
from unittest.mock import patch

import pytest
from celery import current_app
from redis.exceptions import RedisError
from sqlalchemy import Table
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from enums.creator import CreatorUserRole
from graphon.enums import WorkflowExecutionStatus
from models.account import Account, TenantAccountJoin, TenantAccountRole
from models.enums import AppTriggerType, WorkflowRunTriggeredFrom, WorkflowTriggerStatus
from models.model import App, AppMode, EndUser, Tenant
from models.trigger import WorkflowTriggerLog
from models.workflow import Workflow, WorkflowPause, WorkflowRun, WorkflowType
from services.knowledge.retrieval.retrieval import KnowledgeRetriever
from services.workflow.entities import TriggerData, WorkflowTaskData
from tasks import async_workflow_tasks

SQLITE_MODELS = (
    Tenant,
    Account,
    TenantAccountJoin,
    EndUser,
    App,
    Workflow,
    WorkflowTriggerLog,
    WorkflowRun,
    WorkflowPause,
)
pytestmark = [
    pytest.mark.usefixtures("sqlite_session"),
    pytest.mark.parametrize("sqlite_session", [SQLITE_MODELS], indirect=True),
]


@dataclass(frozen=True)
class _KnowledgeServices:
    retrieval: KnowledgeRetriever


@dataclass(frozen=True)
class _ApplicationServices:
    knowledge: _KnowledgeServices


class _RunnableTask(Protocol):
    acks_late: bool
    reject_on_worker_lost: bool

    def run(self, task_data: dict[str, str]) -> None: ...


class _OwnedExecutionLease:
    @staticmethod
    def renew() -> bool:
        return True


@dataclass
class _RedisLock:
    acquire_result: bool
    reacquire_results: list[bool | Exception] = field(default_factory=list)
    released: bool = False

    def acquire(self, *, blocking: bool, token: str) -> bool:
        assert blocking is False
        assert token
        return self.acquire_result

    def reacquire(self) -> bool:
        result = self.reacquire_results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result

    def release(self) -> None:
        self.released = True


class _TransientHeartbeatRedisLock(_RedisLock):
    def __init__(self) -> None:
        super().__init__(acquire_result=True)
        self.transient_seen = Event()
        self.recovered = Event()
        self._reacquire_calls = 0

    @override
    def reacquire(self) -> bool:
        self._reacquire_calls += 1
        if self._reacquire_calls == 1:
            self.transient_seen.set()
            raise RedisError("temporary heartbeat transport failure")
        self.recovered.set()
        return True


@dataclass(frozen=True)
class _RedisClient:
    execution_lock: _RedisLock

    def lock(
        self,
        name: str,
        *,
        timeout: float | None,
        blocking: bool,
        thread_local: bool,
    ) -> _RedisLock:
        assert name.endswith("workflow-trigger-execution:trigger-1")
        assert timeout == async_workflow_tasks._EXECUTION_LEASE_TIMEOUT_SECONDS
        assert blocking is False
        assert thread_local is False
        return self.execution_lock


def _trigger_data() -> TriggerData:
    return TriggerData(
        app_id="app-1",
        tenant_id="tenant-1",
        workflow_id="workflow-1",
        root_node_id="root-1",
        inputs={"name": "dify"},
        files=[],
        trigger_type=AppTriggerType.UNKNOWN,
        trigger_from=WorkflowRunTriggeredFrom.APP_RUN,
        trigger_metadata=None,
    )


def _trigger_log(
    *,
    created_by_role: CreatorUserRole = CreatorUserRole.END_USER,
    created_by: str = "end-user-1",
) -> WorkflowTriggerLog:
    log = WorkflowTriggerLog(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_run_id=None,
        root_node_id="root-1",
        trigger_metadata="{}",
        trigger_type=AppTriggerType.UNKNOWN,
        trigger_data=_trigger_data().model_dump_json(),
        inputs='{"name": "dify"}',
        outputs=None,
        status=WorkflowTriggerStatus.PENDING,
        error=None,
        queue_name="workflow",
        celery_task_id=None,
        created_by_role=created_by_role,
        created_by=created_by,
        retry_count=0,
        elapsed_time=None,
        total_tokens=None,
        triggered_at=None,
        finished_at=None,
    )
    log.id = "trigger-1"
    return log


def _workflow() -> Workflow:
    return Workflow(
        id="workflow-1",
        tenant_id="tenant-1",
        app_id="app-1",
        type=WorkflowType.WORKFLOW,
        version="1",
        graph="{}",
        _features="{}",
        created_by="account-1",
    )


def _app() -> App:
    return App(
        id="app-1",
        tenant_id="tenant-1",
        name="Async workflow app",
        description="",
        mode=AppMode.WORKFLOW,
        enable_site=True,
        enable_api=True,
        max_active_requests=0,
    )


def _bind_task_session(monkeypatch: pytest.MonkeyPatch, session: Session) -> None:
    monkeypatch.setattr(async_workflow_tasks.session_factory, "create_session", lambda: nullcontext(session))
    monkeypatch.setattr(async_workflow_tasks, "build_workflow_execution_identity", lambda _user: object())
    monkeypatch.setattr(
        async_workflow_tasks,
        "_hold_workflow_execution",
        lambda _trigger_log_id: nullcontext(_OwnedExecutionLease()),
    )


def test_build_generator_args_detaches_trigger_collections() -> None:
    trigger_data = _trigger_data()

    result = async_workflow_tasks._build_generator_args(trigger_data)

    assert result == {"inputs": {"name": "dify"}, "files": []}
    assert result["inputs"] is not trigger_data.inputs
    assert result["files"] is not trigger_data.files


def test_execution_lease_busy_is_retryable(monkeypatch: pytest.MonkeyPatch) -> None:
    execution_lock = _RedisLock(acquire_result=False)
    monkeypatch.setattr(async_workflow_tasks, "redis_client", _RedisClient(execution_lock))

    with pytest.raises(async_workflow_tasks.WorkflowExecutionBusyError):
        with async_workflow_tasks._hold_workflow_execution("trigger-1"):
            raise AssertionError("a busy execution lock must not enter the task body")


def test_execution_lease_loss_is_retryable(monkeypatch: pytest.MonkeyPatch) -> None:
    execution_lock = _RedisLock(acquire_result=True, reacquire_results=[False])
    monkeypatch.setattr(async_workflow_tasks, "redis_client", _RedisClient(execution_lock))

    with pytest.raises(async_workflow_tasks.WorkflowExecutionLeaseLostError):
        with async_workflow_tasks._hold_workflow_execution("trigger-1") as lease:
            assert lease is not None

    assert execution_lock.released is False


def test_heartbeat_start_failure_releases_execution_lease_and_is_retryable(monkeypatch: pytest.MonkeyPatch) -> None:
    execution_lock = _RedisLock(acquire_result=True)
    monkeypatch.setattr(async_workflow_tasks, "redis_client", _RedisClient(execution_lock))

    with (
        patch.object(async_workflow_tasks.Thread, "start", side_effect=RuntimeError("cannot start new thread")),
        pytest.raises(async_workflow_tasks.WorkflowExecutionBusyError, match="Cannot start"),
        async_workflow_tasks._hold_workflow_execution("trigger-1"),
    ):
        pytest.fail("execution must not start without its heartbeat")

    assert execution_lock.released is True


def test_transient_heartbeat_error_does_not_forfeit_execution_lease(monkeypatch: pytest.MonkeyPatch) -> None:
    execution_lock = _TransientHeartbeatRedisLock()
    monkeypatch.setattr(async_workflow_tasks, "redis_client", _RedisClient(execution_lock))
    monkeypatch.setattr(async_workflow_tasks, "_EXECUTION_LEASE_HEARTBEAT_SECONDS", 0.001)

    with async_workflow_tasks._hold_workflow_execution("trigger-1"):
        assert execution_lock.transient_seen.wait(timeout=1)
        assert execution_lock.recovered.wait(timeout=1)

    assert execution_lock.released is True


def test_synchronous_ownership_check_propagates_transient_redis_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    execution_lock = _RedisLock(
        acquire_result=True,
        reacquire_results=[RedisError("temporary ownership check failure")],
    )
    monkeypatch.setattr(async_workflow_tasks, "redis_client", _RedisClient(execution_lock))

    with pytest.raises(RedisError, match="temporary ownership check failure"):
        with async_workflow_tasks._hold_workflow_execution("trigger-1"):
            pass

    assert execution_lock.released is True


def test_missing_trigger_log_is_acknowledged_without_execution(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    sqlite_session: Session,
) -> None:
    _bind_task_session(monkeypatch, sqlite_session)

    class UnexpectedGenerator:
        def __init__(self, **_kwargs: object) -> None:
            raise AssertionError("a missing trigger log must not start a workflow generator")

    monkeypatch.setattr(async_workflow_tasks, "WorkflowAppGenerator", UnexpectedGenerator)

    async_workflow_tasks._execute_workflow_common(
        WorkflowTaskData(workflow_trigger_log_id="missing"),
        knowledge_retrieval=cast(KnowledgeRetriever, object()),
    )

    assert "Workflow trigger log not found: missing" in caplog.text


def test_execute_workflow_marks_running_before_generation(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    trigger_log = _trigger_log()
    app = _app()
    workflow = _workflow()
    sqlite_session.add_all([trigger_log, app, workflow])
    sqlite_session.commit()
    _bind_task_session(monkeypatch, sqlite_session)
    user = object()
    monkeypatch.setattr(async_workflow_tasks, "_get_user", lambda _session, _trigger: user)
    monkeypatch.setattr(async_workflow_tasks.session_factory, "get_session_maker", lambda: "session-maker")
    generated: list[dict[str, object]] = []

    class Generator:
        def __init__(self, *, execution_driver: object, knowledge_retrieval: KnowledgeRetriever) -> None:
            assert execution_driver is async_workflow_tasks.WorkflowRunAgg.run
            assert knowledge_retrieval is retrieval

        def generate(self, **kwargs: object) -> None:
            generated.append(kwargs)

    retrieval = cast(KnowledgeRetriever, object())
    monkeypatch.setattr(async_workflow_tasks, "WorkflowAppGenerator", Generator)

    with pytest.raises(async_workflow_tasks.WorkflowExecutionPublicationError):
        async_workflow_tasks._execute_workflow_common(
            WorkflowTaskData(workflow_trigger_log_id="trigger-1"),
            knowledge_retrieval=retrieval,
        )

    assert trigger_log.status == WorkflowTriggerStatus.RUNNING
    assert trigger_log.error is None
    assert trigger_log.workflow_run_id is not None
    assert len(generated) == 1
    assert generated[0]["app_model"] is app
    assert generated[0]["workflow"] is workflow
    assert generated[0]["user"] is user
    assert generated[0]["args"] == {"inputs": {"name": "dify"}, "files": []}
    assert generated[0]["root_node_id"] == "root-1"
    assert len(cast(list[object], generated[0]["graph_engine_layers"])) == 1
    assert generated[0]["workflow_run_id"] == trigger_log.workflow_run_id


@pytest.mark.parametrize("status", [WorkflowExecutionStatus.SUCCEEDED, WorkflowExecutionStatus.PAUSED])
@pytest.mark.parametrize("failure", [RedisError, SQLAlchemyError])
def test_publication_failure_reconciles_committed_result_without_reexecution(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    status: WorkflowExecutionStatus,
    failure: type[Exception],
) -> None:
    trigger_log = _trigger_log()
    sqlite_session.add_all([trigger_log, _app(), _workflow()])
    sqlite_session.commit()
    _bind_task_session(monkeypatch, sqlite_session)
    monkeypatch.setattr(async_workflow_tasks, "_get_user", lambda _session, _trigger: object())
    monkeypatch.setattr(async_workflow_tasks.session_factory, "get_session_maker", lambda: "session-maker")
    generated_ids: list[str] = []

    class PersistedGenerator:
        def __init__(self, **_kwargs: object) -> None:
            pass

        def generate(self, *, workflow_run_id: str, **_kwargs: object) -> None:
            generated_ids.append(workflow_run_id)
            sqlite_session.add(
                WorkflowRun(
                    id=workflow_run_id,
                    tenant_id="tenant-1",
                    app_id="app-1",
                    workflow_id="workflow-1",
                    type=WorkflowType.WORKFLOW,
                    triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                    version="1",
                    status=status,
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_by="account-1",
                )
            )
            if status == WorkflowExecutionStatus.PAUSED:
                sqlite_session.add(
                    WorkflowPause(
                        workflow_id="workflow-1", workflow_run_id=workflow_run_id, state_object_key="pause-state"
                    )
                )
            sqlite_session.commit()

    def fail_publication(_layer: object) -> None:
        raise failure("temporary projection failure")

    monkeypatch.setattr(async_workflow_tasks, "WorkflowAppGenerator", PersistedGenerator)
    monkeypatch.setattr(async_workflow_tasks.TriggerPostLayer, "publish_pending_terminal", fail_publication)
    task_data = WorkflowTaskData(workflow_trigger_log_id=trigger_log.id)
    with pytest.raises(async_workflow_tasks.WorkflowExecutionPublicationError):
        async_workflow_tasks._execute_workflow_common(task_data, knowledge_retrieval=cast(KnowledgeRetriever, object()))

    sqlite_session.refresh(trigger_log)
    assert trigger_log.status == WorkflowTriggerStatus.RUNNING
    assert trigger_log.workflow_run_id == generated_ids[0]
    assert sqlite_session.get_one(WorkflowRun, generated_ids[0]).status == status

    # A new task invocation has no in-memory layer receipt. It must reconstruct
    # the result through the persisted identity and leave execution untouched.
    async_workflow_tasks._execute_workflow_common(task_data, knowledge_retrieval=cast(KnowledgeRetriever, object()))
    sqlite_session.refresh(trigger_log)
    assert trigger_log.status == (
        WorkflowTriggerStatus.PAUSED if status == WorkflowExecutionStatus.PAUSED else WorkflowTriggerStatus.SUCCEEDED
    )
    assert generated_ids == [trigger_log.workflow_run_id]
    assert trigger_log.error is None


def test_execute_workflow_persists_terminal_failure(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    trigger_log = _trigger_log()
    sqlite_session.add_all([trigger_log, _app(), _workflow()])
    sqlite_session.commit()
    _bind_task_session(monkeypatch, sqlite_session)
    monkeypatch.setattr(async_workflow_tasks, "_get_user", lambda _session, _trigger: object())
    monkeypatch.setattr(async_workflow_tasks.session_factory, "get_session_maker", lambda: "session-maker")

    class FailingGenerator:
        def __init__(self, **_kwargs: object) -> None:
            pass

        def generate(self, **_kwargs: object) -> None:
            raise RuntimeError("generation failed")

    monkeypatch.setattr(async_workflow_tasks, "WorkflowAppGenerator", FailingGenerator)

    async_workflow_tasks._execute_workflow_common(
        WorkflowTaskData(workflow_trigger_log_id="trigger-1"),
        knowledge_retrieval=cast(KnowledgeRetriever, object()),
    )

    assert trigger_log.status == WorkflowTriggerStatus.FAILED
    assert trigger_log.error == "generation failed"
    assert isinstance(trigger_log.finished_at, datetime)
    assert trigger_log.finished_at.tzinfo == UTC
    assert cast(float, trigger_log.elapsed_time) >= 0
    sqlite_session.expire_all()
    stored = sqlite_session.get(WorkflowTriggerLog, trigger_log.id)
    assert stored is not None
    assert stored.status == WorkflowTriggerStatus.FAILED
    assert stored.error == "generation failed"


@pytest.mark.parametrize(
    "terminal_status",
    [
        WorkflowTriggerStatus.SUCCEEDED,
        WorkflowTriggerStatus.FAILED,
        WorkflowTriggerStatus.PAUSED,
        WorkflowTriggerStatus.RATE_LIMITED,
    ],
)
def test_redelivery_does_not_restart_terminal_or_paused_trigger(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    terminal_status: WorkflowTriggerStatus,
) -> None:
    trigger_log = _trigger_log()
    trigger_log.status = terminal_status
    sqlite_session.add(trigger_log)
    sqlite_session.commit()
    _bind_task_session(monkeypatch, sqlite_session)

    class UnexpectedGenerator:
        def __init__(self, **_kwargs: object) -> None:
            raise AssertionError("terminal trigger-log redelivery must not construct a generator")

    monkeypatch.setattr(async_workflow_tasks, "WorkflowAppGenerator", UnexpectedGenerator)

    async_workflow_tasks._execute_workflow_common(
        WorkflowTaskData(workflow_trigger_log_id=trigger_log.id),
        knowledge_retrieval=cast(KnowledgeRetriever, object()),
    )

    sqlite_session.refresh(trigger_log)
    assert trigger_log.status == terminal_status


def test_running_trigger_with_unknown_result_is_not_replayed(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    trigger_log = _trigger_log()
    trigger_log.status = WorkflowTriggerStatus.RUNNING
    sqlite_session.add(trigger_log)
    sqlite_session.commit()
    _bind_task_session(monkeypatch, sqlite_session)

    class UnexpectedGenerator:
        def __init__(self, **_kwargs: object) -> None:
            raise AssertionError("a RUNNING trigger with unknown effects must not be replayed")

    monkeypatch.setattr(async_workflow_tasks, "WorkflowAppGenerator", UnexpectedGenerator)

    async_workflow_tasks._execute_workflow_common(
        WorkflowTaskData(workflow_trigger_log_id=trigger_log.id),
        knowledge_retrieval=cast(KnowledgeRetriever, object()),
    )

    sqlite_session.refresh(trigger_log)
    assert trigger_log.status == WorkflowTriggerStatus.FAILED
    assert trigger_log.workflow_run_id is None
    assert trigger_log.error is not None
    assert "automatic replay was refused" in trigger_log.error
    assert trigger_log.finished_at is not None


def test_concurrent_redelivery_does_not_start_a_second_generator(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    trigger_log = _trigger_log()
    sqlite_session.add_all([trigger_log, _app(), _workflow()])
    sqlite_session.commit()
    engine = sqlite_session.get_bind()
    lease_active = False

    @contextmanager
    def create_session() -> Generator[Session]:
        with Session(engine) as session:
            yield session

    @contextmanager
    def hold_execution(_trigger_log_id: str) -> Generator[_OwnedExecutionLease]:
        nonlocal lease_active
        if lease_active:
            raise async_workflow_tasks.WorkflowExecutionBusyError("execution already active")
        lease_active = True
        try:
            yield _OwnedExecutionLease()
        finally:
            lease_active = False

    monkeypatch.setattr(async_workflow_tasks.session_factory, "create_session", create_session)
    monkeypatch.setattr(async_workflow_tasks, "_hold_workflow_execution", hold_execution)
    monkeypatch.setattr(async_workflow_tasks, "_get_user", lambda _session, _trigger: object())
    monkeypatch.setattr(async_workflow_tasks.session_factory, "get_session_maker", lambda: "session-maker")
    generator_calls: list[str] = []
    retrieval = cast(KnowledgeRetriever, object())

    class GeneratorImpl:
        def __init__(self, **_kwargs: object) -> None:
            pass

        def generate(self, **_kwargs: object) -> None:
            generator_calls.append("started")
            with pytest.raises(async_workflow_tasks.WorkflowExecutionBusyError):
                async_workflow_tasks._execute_workflow_common(
                    WorkflowTaskData(workflow_trigger_log_id=trigger_log.id),
                    knowledge_retrieval=retrieval,
                )

    monkeypatch.setattr(async_workflow_tasks, "WorkflowAppGenerator", GeneratorImpl)

    # This probe's generator only exercises concurrent delivery; it does not
    # publish a terminal result, so the owner must request reconciliation.
    with pytest.raises(async_workflow_tasks.WorkflowExecutionPublicationError):
        async_workflow_tasks._execute_workflow_common(
            WorkflowTaskData(workflow_trigger_log_id=trigger_log.id),
            knowledge_retrieval=retrieval,
        )

    assert generator_calls == ["started"]


def test_failure_does_not_overwrite_terminal_state_published_by_another_worker(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    trigger_log = _trigger_log()
    sqlite_session.add_all([trigger_log, _app(), _workflow()])
    sqlite_session.commit()
    engine = sqlite_session.get_bind()
    _bind_task_session(monkeypatch, sqlite_session)
    monkeypatch.setattr(async_workflow_tasks, "_get_user", lambda _session, _trigger: object())
    monkeypatch.setattr(async_workflow_tasks.session_factory, "get_session_maker", lambda: "session-maker")

    class LosingGenerator:
        def __init__(self, **_kwargs: object) -> None:
            pass

        def generate(self, **_kwargs: object) -> None:
            with Session(engine) as winner:
                current = winner.get_one(WorkflowTriggerLog, trigger_log.id)
                current.status = WorkflowTriggerStatus.SUCCEEDED
                current.outputs = '{"answer":"winner"}'
                winner.commit()
            raise RuntimeError("late worker failure")

    monkeypatch.setattr(async_workflow_tasks, "WorkflowAppGenerator", LosingGenerator)

    async_workflow_tasks._execute_workflow_common(
        WorkflowTaskData(workflow_trigger_log_id=trigger_log.id),
        knowledge_retrieval=cast(KnowledgeRetriever, object()),
    )

    sqlite_session.expire_all()
    stored = sqlite_session.get_one(WorkflowTriggerLog, trigger_log.id)
    assert stored.status == WorkflowTriggerStatus.SUCCEEDED
    assert stored.outputs == '{"answer":"winner"}'
    assert stored.error is None


@pytest.mark.parametrize(
    "task",
    [
        async_workflow_tasks.execute_workflow_professional,
        async_workflow_tasks.execute_workflow_team,
        async_workflow_tasks.execute_workflow_sandbox,
    ],
)
def test_queue_entrypoints_resolve_retrieval_service_and_validate_payload(
    monkeypatch: pytest.MonkeyPatch,
    task: object,
) -> None:
    retrieval = cast(KnowledgeRetriever, object())

    def application_services() -> _ApplicationServices:
        return _ApplicationServices(knowledge=_KnowledgeServices(retrieval=retrieval))

    application_services_module = ModuleType("extensions.ext_application_services")
    application_services_module.application_services = application_services  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "extensions.ext_application_services", application_services_module)
    calls: list[tuple[WorkflowTaskData, KnowledgeRetriever]] = []
    monkeypatch.setattr(
        async_workflow_tasks,
        "_execute_workflow_common",
        lambda task_data, *, knowledge_retrieval: calls.append((task_data, knowledge_retrieval)),
    )

    cast(_RunnableTask, task).run({"workflow_trigger_log_id": "trigger-1"})

    assert calls == [(WorkflowTaskData(workflow_trigger_log_id="trigger-1"), retrieval)]
    assert cast(_RunnableTask, task).acks_late is True
    assert cast(_RunnableTask, task).reject_on_worker_lost is True


@pytest.fixture
def resume_retrieval(monkeypatch: pytest.MonkeyPatch) -> KnowledgeRetriever:
    retrieval = cast(KnowledgeRetriever, object())
    monkeypatch.setattr(
        "extensions.ext_application_services.application_services",
        lambda: _ApplicationServices(_KnowledgeServices(retrieval)),
    )
    return retrieval


def test_legacy_resume_task_keeps_name_and_delegates_to_shared_execution(
    monkeypatch: pytest.MonkeyPatch,
    resume_retrieval: KnowledgeRetriever,
) -> None:
    calls: list[tuple[dict[str, str], KnowledgeRetriever, bool]] = []

    def resume(payload: dict[str, str], *, knowledge_retrieval: KnowledgeRetriever, reconcile_only: bool) -> None:
        calls.append((payload, knowledge_retrieval, reconcile_only))

    monkeypatch.setattr(async_workflow_tasks, "_resume_app_execution", resume)
    payload = {"workflow_run_id": "workflow-run-id"}
    registered_task = current_app.tasks["resume_workflow_execution"]

    registered_task.run(payload)

    assert registered_task.name == "resume_workflow_execution"
    assert calls == [(payload, resume_retrieval, False)]


@pytest.mark.usefixtures("resume_retrieval")
def test_legacy_resume_task_propagates_execution_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def unavailable(_payload: dict[str, str], **_kwargs: object) -> None:
        raise OSError("pause storage unavailable")

    monkeypatch.setattr(async_workflow_tasks, "_resume_app_execution", unavailable)

    with pytest.raises(OSError, match="pause storage unavailable"):
        async_workflow_tasks.resume_workflow_execution.run({"workflow_run_id": "workflow-run-id"})


def test_legacy_resume_retries_publication_with_its_own_request_context(
    monkeypatch: pytest.MonkeyPatch,
    resume_retrieval: KnowledgeRetriever,
) -> None:
    registered_task = current_app.tasks["resume_workflow_execution"]
    calls: list[tuple[int, bool]] = []
    payload = {"workflow_run_id": "workflow-run-id"}

    def resume(value: dict[str, str], *, knowledge_retrieval: KnowledgeRetriever, reconcile_only: bool) -> None:
        assert value == payload
        assert knowledge_retrieval is resume_retrieval
        assert registered_task.request.called_directly is False
        calls.append((registered_task.request.retries, reconcile_only))
        if not reconcile_only:
            raise async_workflow_tasks.WorkflowTriggerPublicationError("temporary projection failure")

    monkeypatch.setattr(async_workflow_tasks, "_resume_app_execution", resume)

    result = registered_task.apply(args=[payload], throw=False)

    assert result.state == "SUCCESS"
    assert calls == [(0, False), (1, True)]


def test_canonical_resume_owner_is_noop_when_pause_is_missing(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    from tasks.app_generate import workflow_execute_task

    WorkflowRun.metadata.create_all(sqlite_session.get_bind(), tables=[cast(Table, WorkflowRun.__table__)])
    sqlite_session.add(
        WorkflowRun(
            id="missing-pause-run",
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            type=WorkflowType.CHAT,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            version="1",
            status=WorkflowExecutionStatus.PAUSED,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="account-1",
        )
    )
    sqlite_session.commit()

    queried_run_ids: list[str] = []

    class MissingPauseRepository:
        def get_workflow_pause(self, workflow_run_id: str) -> None:
            queried_run_ids.append(workflow_run_id)

    class DatabaseStub:
        engine = sqlite_session.get_bind()

    monkeypatch.setattr(workflow_execute_task, "db", DatabaseStub())
    monkeypatch.setattr(
        workflow_execute_task.WorkflowRepositoryFactory,
        "create_api_workflow_run_repository",
        lambda **_kwargs: MissingPauseRepository(),
    )

    workflow_execute_task._resume_app_execution(
        {"workflow_run_id": "missing-pause-run"},
        knowledge_retrieval=cast(KnowledgeRetriever, object()),
    )

    assert queried_run_ids == ["missing-pause-run"]


def test_get_user_sets_account_tenant_with_explicit_session(sqlite_session: Session) -> None:
    tenant = Tenant(name="Tenant")
    tenant.id = "tenant-1"
    account = Account(name="Account", email="account@example.com")
    account.id = "account-1"
    membership = TenantAccountJoin(
        tenant_id=tenant.id,
        account_id=account.id,
        role=TenantAccountRole.OWNER,
        current=True,
    )
    sqlite_session.add_all([tenant, account, membership])
    sqlite_session.commit()
    workflow_run = _trigger_log(
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
    )

    result = async_workflow_tasks._get_user(sqlite_session, workflow_run)

    assert result is account
    assert account.current_tenant_id == tenant.id
    assert account.role == TenantAccountRole.OWNER


def test_get_user_returns_tenant_scoped_end_user(sqlite_session: Session) -> None:
    tenant = Tenant(name="Tenant")
    tenant.id = "tenant-1"
    end_user = EndUser(
        id="end-user-1",
        tenant_id="tenant-1",
        app_id="app-1",
        type="browser",
        name="End User",
        session_id="session-1",
    )
    sqlite_session.add_all([tenant, end_user])
    sqlite_session.commit()
    workflow_run = _trigger_log(
        created_by_role=CreatorUserRole.END_USER,
        created_by="end-user-1",
    )

    assert async_workflow_tasks._get_user(sqlite_session, workflow_run) is end_user


def test_get_user_rejects_missing_tenant(sqlite_session: Session) -> None:
    workflow_run = _trigger_log()
    workflow_run.tenant_id = "missing"

    with pytest.raises(async_workflow_tasks._TenantNotFoundError):
        async_workflow_tasks._get_user(sqlite_session, workflow_run)
