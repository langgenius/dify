import json
from collections.abc import Callable, Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from functools import partial
from typing import override

import pytest
from _pytest.mark.structures import ParameterSet
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import select
from sqlalchemy.orm import Session

import core.app.apps.base_app_queue_manager as queue_module
import core.app.apps.execution_coordinator as coordinator_module
import services.app_task_service as task_module
from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.nodes.human_input.entities import FormDefinition
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from extensions.ext_redis import RedisClientWrapper
from graphon.enums import WorkflowExecutionStatus
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.human_input import HumanInputForm
from models.model import AppMode
from models.workflow import WorkflowPause, WorkflowRun
from services.app_task_service import AppTaskControlService, AppTaskService, WorkflowStopOutcome

_TASK_ID = "task-with-non-uuid-id"
_USER_ID = "user-1"
_OWNER_KEY = f"generate_task_belong:{_TASK_ID}"
_STOP_KEY = f"generate_task_stopped:{_TASK_ID}"
_COMMAND_KEY = f"workflow:{_TASK_ID}:commands"


@dataclass
class _StopRedis(RedisClientWrapper):
    """In-memory Redis boundary; task policy and GraphEngine serialization stay real."""

    values: dict[str, bytes] = field(default_factory=dict)
    commands: dict[str, list[str]] = field(default_factory=dict)
    expirations: dict[str, int] = field(default_factory=dict)
    reads: list[str] = field(default_factory=list)
    operations: list[str] = field(default_factory=list)
    read_error: Exception | None = None
    flag_error: Exception | None = None
    command_error: Exception | None = None

    @override
    def get(self, name: str | bytes) -> bytes | None:
        key = name.decode() if isinstance(name, bytes) else name
        self.reads.append(key)
        if self.read_error is not None:
            raise self.read_error
        return self.values.get(key)

    @override
    def setex(self, name: str | bytes, time: int | timedelta, value: object) -> None:
        self.operations.append("legacy_flag")
        if self.flag_error is not None:
            raise self.flag_error
        key = name.decode() if isinstance(name, bytes) else name
        self.values[key] = str(value).encode()
        self.expirations[key] = int(time.total_seconds()) if isinstance(time, timedelta) else time

    @override
    @contextmanager
    def pipeline(self, transaction: bool = True, shard_hint: str | None = None) -> Generator["_StopPipeline"]:
        yield _StopPipeline(self)


@dataclass
class _StopPipeline:
    redis: _StopRedis
    values: dict[str, bytes] = field(default_factory=dict)
    commands: dict[str, list[str]] = field(default_factory=dict)
    expirations: dict[str, int] = field(default_factory=dict)

    def rpush(self, name: str, value: str) -> None:
        self.commands.setdefault(name, []).append(value)

    def expire(self, name: str, time: int) -> None:
        self.expirations[name] = time

    def set(self, name: str, value: str, *, ex: int) -> None:
        self.values[name] = value.encode()
        self.expirations[name] = ex

    def execute(self) -> list[object]:
        self.redis.operations.append("graph_command")
        if self.redis.command_error is not None:
            raise self.redis.command_error
        self.redis.values.update(self.values)
        self.redis.expirations.update(self.expirations)
        for name, values in self.commands.items():
            self.redis.commands.setdefault(name, []).extend(values)
        return []


@pytest.fixture(autouse=True)
def global_redis(monkeypatch: pytest.MonkeyPatch) -> Generator[_StopRedis]:
    redis = _StopRedis(
        read_error=AssertionError("Must use the injected Redis for ownership reads"),
        flag_error=AssertionError("Must use the injected Redis for stop flags"),
        command_error=AssertionError("Must use the injected Redis for GraphEngine commands"),
    )
    monkeypatch.setattr(queue_module, "redis_client", redis)
    monkeypatch.setattr(coordinator_module, "redis_client", redis)
    monkeypatch.setattr(task_module, "redis_client", redis)
    yield redis
    # GraphEngine catches Redis failures, so a trap exception alone would not fail the test.
    assert redis.reads == []
    assert redis.operations == []


def _assert_stop_flag(redis: _StopRedis) -> None:
    assert redis.values[_STOP_KEY] == b"1"
    assert redis.expirations[_STOP_KEY] == 600


def _assert_graph_command(redis: _StopRedis) -> None:
    assert set(redis.commands) == {_COMMAND_KEY}
    assert [json.loads(command) for command in redis.commands[_COMMAND_KEY]] == [
        {"command_type": "abort", "reason": "User requested stop"}
    ]
    assert redis.expirations[_COMMAND_KEY] == 3600
    assert redis.values[f"{_COMMAND_KEY}:pending"] == b"1"
    assert redis.expirations[f"{_COMMAND_KEY}:pending"] == 3600


def test_stop_task_sets_only_the_legacy_flag() -> None:
    redis = _StopRedis(values={_OWNER_KEY: f"end-user-{_USER_ID}".encode()})

    assert AppTaskControlService(redis_client=redis).stop_task(_TASK_ID, InvokeFrom.WEB_APP, _USER_ID) is True

    assert redis.reads == [_OWNER_KEY]
    _assert_stop_flag(redis)
    assert redis.operations == ["legacy_flag"]
    assert redis.commands == {}


@pytest.mark.parametrize(
    ("invoke_from", "owner", "should_set_flag"),
    [
        (InvokeFrom.EXPLORE, b"account-user-1", True),
        (InvokeFrom.DEBUGGER, b"account-user-1", True),
        (InvokeFrom.WEB_APP, b"end-user-user-1", True),
        (InvokeFrom.SERVICE_API, b"end-user-user-1", True),
        (InvokeFrom.OPENAPI, b"end-user-user-1", True),
        (InvokeFrom.EXPLORE, b"end-user-user-1", False),
        (InvokeFrom.DEBUGGER, b"end-user-user-1", False),
        (InvokeFrom.WEB_APP, b"account-user-1", False),
        (InvokeFrom.SERVICE_API, b"account-user-1", False),
        (InvokeFrom.OPENAPI, b"account-user-1", False),
        (InvokeFrom.EXPLORE, b"account-another-user", False),
        (InvokeFrom.WEB_APP, b"end-user-another-user", False),
        (InvokeFrom.OPENAPI, b"end-user-another-user", False),
        (InvokeFrom.EXPLORE, None, False),
        (InvokeFrom.WEB_APP, None, False),
        (InvokeFrom.OPENAPI, None, False),
    ],
)
def test_task_ownership_controls_the_legacy_flag(
    invoke_from: InvokeFrom, owner: bytes | None, should_set_flag: bool
) -> None:
    redis = _StopRedis(values={_OWNER_KEY: owner} if owner is not None else {})

    admitted = AppTaskControlService(redis_client=redis).stop_task(_TASK_ID, invoke_from, _USER_ID)

    assert admitted is should_set_flag
    assert redis.reads == [_OWNER_KEY]
    if should_set_flag:
        _assert_stop_flag(redis)
        assert redis.operations == ["legacy_flag"]
    else:
        assert _STOP_KEY not in redis.values
        assert redis.operations == []
    assert redis.commands == {}


@pytest.fixture
def app_task_workflow_run(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> WorkflowRun:
    run = WorkflowRun(
        id="run-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        task_id="11111111-1111-1111-1111-111111111111",
        type="workflow",
        version="1",
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        status=WorkflowExecutionStatus.RUNNING,
        created_by_role=CreatorUserRole.END_USER,
        created_by=_USER_ID,
    )
    sqlite_session.add(run)
    monkeypatch.setattr(type(task_module.db), "engine", property(lambda _: sqlite_session.get_bind()))
    return run


_GRAPH_STOP_OPERATIONS = ["legacy_flag", "graph_command"]


@dataclass
class _StopTarget:
    """What the stop call addresses; a case's setup may change the run or redirect the call."""

    run: WorkflowRun
    session: Session
    tenant_id: str
    app_id: str
    run_id: str


_FORM_ID = "form-1"


def _pause(target: _StopTarget) -> None:
    target.run.status = WorkflowExecutionStatus.PAUSED
    target.session.add(
        WorkflowPause(workflow_id=target.run.workflow_id, workflow_run_id=target.run.id, state_object_key="state")
    )
    target.session.add(
        HumanInputForm(
            id=_FORM_ID,
            tenant_id=target.run.tenant_id,
            app_id=target.run.app_id,
            form_kind=HumanInputFormKind.RUNTIME,
            expiration_time=datetime(2030, 1, 1),
            workflow_run_id=target.run.id,
            node_id="review",
            form_definition=FormDefinition(
                form_content="", rendered_content="", expiration_time=datetime(2030, 1, 1)
            ).model_dump_json(),
            rendered_content="",
            status=HumanInputFormStatus.WAITING,
        )
    )


def _on_paused_run(setup: Callable[[_StopTarget], None]) -> Callable[[_StopTarget], None]:
    def paused_then(target: _StopTarget) -> None:
        _pause(target)
        setup(target)

    return paused_then


def _redirect(**address: str) -> Callable[[_StopTarget], None]:
    def setup(target: _StopTarget) -> None:
        for name, value in address.items():
            setattr(target, name, value)

    return setup


def _edit_run(**run_fields: object) -> Callable[[_StopTarget], None]:
    def setup(target: _StopTarget) -> None:
        for name, value in run_fields.items():
            setattr(target.run, name, value)

    return setup


def _no_change(_: _StopTarget) -> None:
    return None


@dataclass(frozen=True)
class _StopRunCase:
    setup: Callable[[_StopTarget], None]
    caller_role: CreatorUserRole
    outcome: WorkflowStopOutcome
    operations: list[str]
    persisted_status: WorkflowExecutionStatus | None = None
    form_status: HumanInputFormStatus | None = None
    stays_paused: bool = False


def _stop_run_cases() -> list[ParameterSet]:
    stopped = WorkflowStopOutcome.STOPPED
    not_stoppable = WorkflowStopOutcome.NOT_STOPPABLE
    not_found = WorkflowStopOutcome.NOT_FOUND
    account = CreatorUserRole.ACCOUNT
    end_user = CreatorUserRole.END_USER
    cases = {
        "running": _StopRunCase(_no_change, account, stopped, _GRAPH_STOP_OPERATIONS),
        "paused": _StopRunCase(
            _pause,
            account,
            stopped,
            [],
            persisted_status=WorkflowExecutionStatus.STOPPED,
            form_status=HumanInputFormStatus.EXPIRED,
        ),
        "already-stopped": _StopRunCase(
            _edit_run(status=WorkflowExecutionStatus.STOPPED, stop_requested_at=datetime(2026, 10, 20)),
            account,
            stopped,
            [],
        ),
        "finished": _StopRunCase(_edit_run(status=WorkflowExecutionStatus.SUCCEEDED), account, not_stoppable, []),
        "legacy-no-task-id": _StopRunCase(_edit_run(task_id=None), account, not_stoppable, []),
        "missing": _StopRunCase(_redirect(run_id="22222222-2222-2222-2222-222222222222"), account, not_found, []),
        "other-app": _StopRunCase(_redirect(app_id="other-app"), account, not_found, []),
        "other-tenant": _StopRunCase(_redirect(tenant_id="other-tenant"), account, not_found, []),
        "other-end-user": _StopRunCase(_edit_run(created_by="other-user"), end_user, not_found, []),
        "owner-role": _StopRunCase(_edit_run(created_by_role=CreatorUserRole.ACCOUNT), end_user, not_found, []),
        "own-end-user": _StopRunCase(_no_change, end_user, stopped, _GRAPH_STOP_OPERATIONS),
        "paused-missing": _StopRunCase(
            _on_paused_run(_redirect(run_id="22222222-2222-2222-2222-222222222222")),
            account,
            not_found,
            [],
            form_status=HumanInputFormStatus.WAITING,
            stays_paused=True,
        ),
        "paused-other-app": _StopRunCase(
            _on_paused_run(_redirect(app_id="other-app")),
            account,
            not_found,
            [],
            form_status=HumanInputFormStatus.WAITING,
            stays_paused=True,
        ),
        "paused-other-tenant": _StopRunCase(
            _on_paused_run(_redirect(tenant_id="other-tenant")),
            account,
            not_found,
            [],
            form_status=HumanInputFormStatus.WAITING,
            stays_paused=True,
        ),
        "paused-other-end-user": _StopRunCase(
            _on_paused_run(_edit_run(created_by="other-user")),
            end_user,
            not_found,
            [],
            form_status=HumanInputFormStatus.WAITING,
            stays_paused=True,
        ),
        "paused-owner-role": _StopRunCase(
            _on_paused_run(_edit_run(created_by_role=CreatorUserRole.ACCOUNT)),
            end_user,
            not_found,
            [],
            form_status=HumanInputFormStatus.WAITING,
            stays_paused=True,
        ),
        "draft-run": _StopRunCase(
            _edit_run(triggered_from=WorkflowRunTriggeredFrom.DEBUGGING), account, stopped, _GRAPH_STOP_OPERATIONS
        ),
    }
    return [pytest.param(case, id=name) for name, case in cases.items()]


@pytest.mark.parametrize("case", _stop_run_cases())
def test_stop_workflow_run_outcomes(
    sqlite_session: Session, app_task_workflow_run: WorkflowRun, case: _StopRunCase
) -> None:
    run = app_task_workflow_run
    target = _StopTarget(run=run, session=sqlite_session, tenant_id=run.tenant_id, app_id=run.app_id, run_id=run.id)
    case.setup(target)
    sqlite_session.commit()
    redis = _StopRedis(read_error=AssertionError("Durable workflow ownership must not depend on Redis"))

    result = AppTaskControlService(redis_client=redis).stop_workflow_run(
        tenant_id=target.tenant_id,
        app_id=target.app_id,
        run_id=target.run_id,
        app_mode=AppMode.WORKFLOW,
        caller_role=case.caller_role,
        caller_id=_USER_ID,
    )

    assert result is case.outcome
    assert redis.operations == case.operations
    if case.persisted_status is not None:
        sqlite_session.refresh(run)
        assert run.status == case.persisted_status
    if case.form_status is not None:
        sqlite_session.expire_all()
        assert sqlite_session.get(HumanInputForm, _FORM_ID).status == case.form_status
    if case.stays_paused:
        sqlite_session.expire_all()
        assert sqlite_session.scalar(select(WorkflowPause).where(WorkflowPause.workflow_run_id == run.id)) is not None
        assert run.status == WorkflowExecutionStatus.PAUSED
        assert run.stop_requested_at is None
        assert run.finished_at is None


@pytest.mark.parametrize(
    ("caller_role", "cached_owner", "admitted"),
    [
        (CreatorUserRole.END_USER, b"end-user-user-1", True),
        (CreatorUserRole.END_USER, b"end-user-other", False),
        (CreatorUserRole.END_USER, None, False),
        (CreatorUserRole.ACCOUNT, b"end-user-other", True),
        (CreatorUserRole.ACCOUNT, None, True),
    ],
)
def test_stop_message_task_applies_legacy_caller_ownership(
    caller_role: CreatorUserRole, cached_owner: bytes | None, admitted: bool
) -> None:
    redis = _StopRedis(values={_OWNER_KEY: cached_owner} if cached_owner is not None else {})

    result = AppTaskControlService(redis_client=redis).stop_message_task(
        task_id=_TASK_ID, caller_role=caller_role, caller_id=_USER_ID
    )

    assert result is admitted
    assert redis.operations == (["legacy_flag"] if admitted else [])
    assert redis.commands == {}


@pytest.mark.parametrize("owner", [None, b"account-another-user"])
def test_unchecked_workflow_stop_skips_ownership_read(owner: bytes | None) -> None:
    redis = _StopRedis(
        values={_OWNER_KEY: owner} if owner is not None else {},
        read_error=AssertionError("Unchecked workflow stop must not read ownership"),
    )

    AppTaskControlService(redis_client=redis).stop_workflow_task_no_user_check(task_id=_TASK_ID)

    assert redis.reads == []
    assert redis.operations == ["legacy_flag", "graph_command"]
    _assert_stop_flag(redis)
    _assert_graph_command(redis)


def test_unchecked_workflow_stop_with_empty_task_id_is_noop() -> None:
    redis = _StopRedis()

    AppTaskControlService(redis_client=redis).stop_workflow_task_no_user_check(task_id="")

    assert redis.reads == []
    assert redis.operations == []
    assert redis.values == {}
    assert redis.commands == {}


@pytest.mark.parametrize("unchecked", [False, True])
def test_flag_write_failure_propagates_before_graph_command(unchecked: bool) -> None:
    error = RedisConnectionError("stop flag write failed")
    redis = _StopRedis(values={_OWNER_KEY: b"account-user-1"}, flag_error=error)
    service = AppTaskControlService(redis_client=redis)
    stop = (
        partial(service.stop_workflow_task_no_user_check, task_id=_TASK_ID)
        if unchecked
        else partial(service.stop_task, _TASK_ID, InvokeFrom.EXPLORE, _USER_ID)
    )

    with pytest.raises(RedisConnectionError, match="stop flag write failed") as caught:
        stop()

    assert caught.value is error
    assert redis.operations == ["legacy_flag"]
    assert _STOP_KEY not in redis.values
    assert redis.commands == {}


def test_graph_redis_failure_is_swallowed_after_legacy_flag(caplog: pytest.LogCaptureFixture) -> None:
    redis = _StopRedis(
        values={_OWNER_KEY: b"account-user-1"}, command_error=RedisConnectionError("command write failed")
    )

    AppTaskControlService(redis_client=redis).stop_workflow_task_no_user_check(task_id=_TASK_ID)

    _assert_stop_flag(redis)
    assert redis.operations == ["legacy_flag", "graph_command"]
    assert redis.commands == {}
    assert "Failed to send Engine abort command" in caplog.text


def test_ownership_read_failure_propagates_without_either_stop_signal() -> None:
    error = RedisConnectionError("ownership read failed")
    redis = _StopRedis(read_error=error)

    with pytest.raises(RedisConnectionError, match="ownership read failed") as caught:
        AppTaskControlService(redis_client=redis).stop_task(_TASK_ID, InvokeFrom.EXPLORE, _USER_ID)

    assert caught.value is error
    assert redis.reads == [_OWNER_KEY]
    assert redis.operations == []
    assert redis.values == {}
    assert redis.commands == {}


def test_service_instances_keep_their_redis_dependencies_separate() -> None:
    first = _StopRedis(values={_OWNER_KEY: b"account-user-1"})
    second = _StopRedis(values={_OWNER_KEY: b"account-another-user"})
    first_service = AppTaskControlService(redis_client=first)
    second_service = AppTaskControlService(redis_client=second)

    first_service.stop_task(_TASK_ID, InvokeFrom.EXPLORE, _USER_ID)
    second_service.stop_workflow_task_no_user_check(task_id=_TASK_ID)

    assert first.reads == [_OWNER_KEY]
    assert first.operations == ["legacy_flag"]
    assert first.commands == {}
    assert second.reads == []
    assert second.operations == ["legacy_flag", "graph_command"]
    _assert_stop_flag(first)
    _assert_stop_flag(second)
    _assert_graph_command(second)


def test_legacy_static_entry_point_passes_global_client_through_the_same_implementation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    redis = _StopRedis(values={_OWNER_KEY: b"end-user-user-1"})
    # Only the legacy composition point gets a global client; lower-level globals remain traps.
    monkeypatch.setattr(task_module, "redis_client", redis)

    AppTaskService.stop_task(
        _TASK_ID, InvokeFrom.SERVICE_API, _USER_ID, AppMode.CHAT, tenant_id="tenant-1", app_id="app-1"
    )

    assert redis.reads == [_OWNER_KEY]
    assert redis.operations == ["legacy_flag"]
    _assert_stop_flag(redis)


@pytest.mark.parametrize("cached_owner", [None, b"end-user-other", b"account-user-1"])
def test_live_chatflow_stop_does_not_send_either_signal_for_another_owner(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, cached_owner: bytes | None
) -> None:
    task_id = "11111111-1111-1111-1111-111111111111"
    redis = _StopRedis(values={_OWNER_KEY: cached_owner} if cached_owner else {})
    monkeypatch.setattr(type(task_module.db), "engine", property(lambda _: sqlite_session.get_bind()))
    admissions: list[dict[str, object]] = []
    repository_type = task_module.DifyAPISQLAlchemyWorkflowRunRepository
    original_stop = repository_type.stop_paused_workflow_task

    def stop(
        repository: task_module.DifyAPISQLAlchemyWorkflowRunRepository,
        *,
        tenant_id: str,
        app_id: str,
        task_id: str,
        owner: tuple[CreatorUserRole, str] | None,
    ) -> WorkflowRun | None:
        admissions.append({"tenant_id": tenant_id, "app_id": app_id, "task_id": task_id, "owner": owner})
        return original_stop(repository, tenant_id=tenant_id, app_id=app_id, task_id=task_id, owner=owner)

    monkeypatch.setattr(repository_type, "stop_paused_workflow_task", stop)
    monkeypatch.setattr(task_module, "redis_client", redis)
    AppTaskService.stop_task(
        task_id, InvokeFrom.SERVICE_API, _USER_ID, AppMode.ADVANCED_CHAT, tenant_id="tenant-1", app_id="app-1"
    )
    assert (
        admissions
        == [
            {
                "tenant_id": "tenant-1",
                "app_id": "app-1",
                "task_id": task_id,
                "owner": (CreatorUserRole.END_USER, _USER_ID),
            }
        ]
        * 2
    )
    assert redis.reads == []
    assert redis.operations == []
    assert redis.commands == {}


def test_live_chatflow_stop_sends_signals_for_its_owner(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    task_id = "11111111-1111-1111-1111-111111111111"
    redis = _StopRedis(values={_OWNER_KEY: b"end-user-user-1"})
    run = WorkflowRun(
        id="run-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        task_id=task_id,
        type="workflow",
        version="1",
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        status=WorkflowExecutionStatus.RUNNING,
        created_by_role=CreatorUserRole.END_USER,
        created_by=_USER_ID,
    )
    sqlite_session.add(run)
    sqlite_session.commit()
    monkeypatch.setattr(type(task_module.db), "engine", property(lambda _: sqlite_session.get_bind()))
    monkeypatch.setattr(task_module, "redis_client", redis)
    AppTaskService.stop_task(
        task_id, InvokeFrom.SERVICE_API, _USER_ID, AppMode.ADVANCED_CHAT, tenant_id="tenant-1", app_id="app-1"
    )
    assert redis.values[f"generate_task_stopped:{task_id}"] == b"1"
    assert json.loads(redis.commands[f"workflow:{task_id}:commands"][0])["command_type"] == "abort"


def test_invalid_workflow_task_id_is_rejected_before_database_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
    def reject_lookup(*_args: object, **_kwargs: object) -> None:
        pytest.fail("Invalid task IDs must be rejected before database lookup")

    monkeypatch.setattr(task_module, "DifyAPISQLAlchemyWorkflowRunRepository", reject_lookup)
    with pytest.raises(ValueError, match="Invalid task ID"):
        AppTaskService.stop_workflow_task(
            tenant_id="tenant-1", app_id="app-1", task_id="not-a-uuid", app_mode=AppMode.WORKFLOW, owner=None
        )
