import json
from collections.abc import Callable, Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from functools import partial
from typing import override
from unittest.mock import MagicMock, patch
from uuid import UUID, uuid4

import pytest
from redis import Redis
from redis.client import Pipeline
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import event, select
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.orm import Session, sessionmaker

import core.app.apps.base_app_queue_manager as queue_module
import core.app.apps.execution_coordinator as coordinator_module
import services.app_task_service as task_module
from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom, WorkflowAppGenerateEntity
from core.app.layers.pause_state_persist_layer import (
    WorkflowResumptionContext,
    _AdvancedChatAppGenerateEntityWrapper,
    _WorkflowGenerateEntityWrapper,
)
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.nodes.agent_v2.session_store import WorkflowAgentWorkspaceStore
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from extensions.ext_redis import RedisClientWrapper
from extensions.logstore.aliyun_logstore import AliyunLogStore
from graphon.engine.command import AbortCommand
from graphon.entities import WorkflowNodeExecution
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from graphon.enums import WorkflowType as _paused_workflow_stop_WorkflowType
from libs.broadcast_channel.redis.pubsub_channel import Topic
from models import EndUser
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.human_input import HumanInputForm
from models.model import AppMode
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom, WorkflowPause, WorkflowRun
from models.workflow import WorkflowType as _legacy_workflow_task_recovery_WorkflowType
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
from services.app_task_service import AppTaskControlService, AppTaskService

"""Injected workflow cancellation preserves both transport mechanisms."""


class TestAppTaskControlServiceCases:
    @staticmethod
    @pytest.mark.parametrize("command_fails", [False, True])
    @pytest.mark.parametrize("task_id", ["task-1", ""])
    def test_workflow_stop_sets_flag_before_sending_command(
        redis_transport: tuple[RedisClientWrapper, MagicMock], command_fails: bool, task_id: str
    ) -> None:
        redis, commands = redis_transport
        events: list[str] = []
        queued: list[tuple[object, ...]] = []
        commands.side_effect = lambda *_, **__: events.append("flag")

        def execute_pipeline(pipeline: "Pipeline[bytes]") -> list[object]:
            events.append("command")
            queued.extend(args for args, _ in pipeline.command_stack)
            if command_fails:
                raise RuntimeError("command channel unavailable")
            return []

        with patch.object(Pipeline, "execute", autospec=True, side_effect=execute_pipeline):
            AppTaskControlService(redis_client=redis).stop_workflow_task_no_user_check(task_id=task_id)

        if task_id:
            assert events == ["flag", "command"]
            commands.assert_called_once_with("SETEX", "generate_task_stopped:task-1", 600, 1)
            pushes = [args for args in queued if args[0] == "RPUSH"]
            assert len(pushes) == 1
            _, key, payload = pushes[0]
            assert key == "workflow:task-1:commands"
            assert isinstance(payload, str)
            assert AbortCommand.model_validate_json(payload) == AbortCommand(reason="User requested stop")
        else:
            assert events == []
            assert queued == []
            commands.assert_not_called()

    @staticmethod
    def test_flag_failure_does_not_send_command(redis_transport: tuple[RedisClientWrapper, MagicMock]) -> None:
        redis, commands = redis_transport
        commands.side_effect = RuntimeError("flag store unavailable")
        with patch.object(Pipeline, "execute", autospec=True) as execute:
            with pytest.raises(RuntimeError, match="flag store unavailable"):
                AppTaskControlService(redis_client=redis).stop_workflow_task_no_user_check(task_id="task-1")
        execute.assert_not_called()


_TASK_ID = "task-with-non-uuid-id"
_USER_ID = "user-1"
_OWNER_KEY = f"generate_task_belong:{_TASK_ID}"
_STOP_KEY = f"generate_task_stopped:{_TASK_ID}"
_COMMAND_KEY = f"workflow:{_TASK_ID}:commands"


@dataclass
class _AppTaskServiceStopredis(RedisClientWrapper):
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
    redis: _AppTaskServiceStopredis
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


def _assert_stop_flag(redis: _AppTaskServiceStopredis) -> None:
    assert redis.values[_STOP_KEY] == b"1"
    assert redis.expirations[_STOP_KEY] == 600


def _assert_graph_command(redis: _AppTaskServiceStopredis) -> None:
    assert set(redis.commands) == {_COMMAND_KEY}
    assert [json.loads(command) for command in redis.commands[_COMMAND_KEY]] == [
        {"command_type": "abort", "reason": "User requested stop"}
    ]
    assert redis.expirations[_COMMAND_KEY] == 3600
    assert redis.values[f"{_COMMAND_KEY}:pending"] == b"1"
    assert redis.expirations[f"{_COMMAND_KEY}:pending"] == 3600


class TestAppTaskServiceCases:
    @staticmethod
    @pytest.fixture(autouse=True)
    def global_redis(monkeypatch: pytest.MonkeyPatch) -> Generator[_AppTaskServiceStopredis]:
        redis = _AppTaskServiceStopredis(
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

    @staticmethod
    def test_stop_task_sets_only_the_legacy_flag() -> None:
        redis = _AppTaskServiceStopredis(values={_OWNER_KEY: f"end-user-{_USER_ID}".encode()})

        assert AppTaskControlService(redis_client=redis).stop_task(_TASK_ID, InvokeFrom.WEB_APP, _USER_ID) is True

        assert redis.reads == [_OWNER_KEY]
        _assert_stop_flag(redis)
        assert redis.operations == ["legacy_flag"]
        assert redis.commands == {}

    @staticmethod
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
        redis = _AppTaskServiceStopredis(values={_OWNER_KEY: owner} if owner is not None else {})

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

    @staticmethod
    @pytest.mark.parametrize("app_mode", [AppMode.CHAT, AppMode.COMPLETION])
    @pytest.mark.parametrize(
        ("caller_role", "cached_owner", "admitted"),
        [
            (CreatorUserRole.END_USER, b"end-user-user-1", True),
            (CreatorUserRole.END_USER, b"end-user-other", False),
            (CreatorUserRole.END_USER, b"account-user-1", False),
            (CreatorUserRole.END_USER, None, False),
            (CreatorUserRole.ACCOUNT, b"end-user-other", True),
            (CreatorUserRole.ACCOUNT, None, True),
        ],
    )
    def test_stop_app_task_applies_legacy_caller_ownership(
        app_mode: AppMode, caller_role: CreatorUserRole, cached_owner: bytes | None, admitted: bool
    ) -> None:
        redis = _AppTaskServiceStopredis(values={_OWNER_KEY: cached_owner} if cached_owner is not None else {})

        result = AppTaskControlService(redis_client=redis).stop_app_task(
            tenant_id="tenant-1",
            app_id="app-1",
            task_id=_TASK_ID,
            app_mode=app_mode,
            caller_role=caller_role,
            caller_id=_USER_ID,
        )

        assert result is admitted
        assert redis.reads == ([_OWNER_KEY] if caller_role is CreatorUserRole.END_USER else [])
        assert redis.operations == (["legacy_flag"] if admitted else [])
        assert redis.commands == {}
        if admitted:
            _assert_stop_flag(redis)
        else:
            assert _STOP_KEY not in redis.values

    @staticmethod
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

    @staticmethod
    @pytest.mark.parametrize("app_mode", [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
    @pytest.mark.parametrize(
        ("caller_role", "run_owner_role", "run_owner_id"),
        [
            (CreatorUserRole.END_USER, CreatorUserRole.END_USER, _USER_ID),
            (CreatorUserRole.ACCOUNT, CreatorUserRole.END_USER, "other-user"),
            (CreatorUserRole.ACCOUNT, CreatorUserRole.ACCOUNT, "other-account"),
        ],
    )
    def test_stop_app_task_signals_admitted_running_workflow(
        sqlite_session: Session,
        app_task_workflow_run: WorkflowRun,
        app_mode: AppMode,
        caller_role: CreatorUserRole,
        run_owner_role: CreatorUserRole,
        run_owner_id: str,
    ) -> None:
        run = app_task_workflow_run
        run.created_by_role = run_owner_role
        run.created_by = run_owner_id
        sqlite_session.commit()
        task_id = run.task_id
        assert task_id is not None
        redis = _AppTaskServiceStopredis(
            read_error=AssertionError("Durable workflow ownership must not depend on Redis")
        )

        admitted = AppTaskControlService(redis_client=redis).stop_app_task(
            tenant_id=run.tenant_id,
            app_id=run.app_id,
            task_id=task_id,
            app_mode=app_mode,
            caller_role=caller_role,
            caller_id=_USER_ID,
        )

        assert admitted is True
        sqlite_session.refresh(run)
        assert run.status == WorkflowExecutionStatus.RUNNING
        assert run.stop_requested_at is not None
        assert redis.reads == []
        assert redis.operations == ["legacy_flag", "graph_command"]
        assert redis.values[f"generate_task_stopped:{task_id}"] == b"1"
        assert [json.loads(command) for command in redis.commands[f"workflow:{task_id}:commands"]] == [
            {"command_type": "abort", "reason": "User requested stop"}
        ]

    @staticmethod
    @pytest.mark.parametrize("app_mode", [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
    @pytest.mark.parametrize("status", [WorkflowExecutionStatus.RUNNING, WorkflowExecutionStatus.PAUSED])
    @pytest.mark.parametrize(
        ("caller_role", "mismatch"),
        [
            (CreatorUserRole.END_USER, "owner-id"),
            (CreatorUserRole.END_USER, "owner-role"),
            (CreatorUserRole.END_USER, "app"),
            (CreatorUserRole.END_USER, "tenant"),
            (CreatorUserRole.END_USER, "missing"),
            (CreatorUserRole.ACCOUNT, "app"),
            (CreatorUserRole.ACCOUNT, "tenant"),
            (CreatorUserRole.ACCOUNT, "missing"),
        ],
    )
    def test_stop_app_task_preserves_unadmitted_workflow_and_pause(
        sqlite_session: Session,
        app_task_workflow_run: WorkflowRun,
        app_mode: AppMode,
        status: WorkflowExecutionStatus,
        caller_role: CreatorUserRole,
        mismatch: str,
    ) -> None:
        run = app_task_workflow_run
        run.status = status
        if mismatch == "owner-id":
            run.created_by = "other-user"
        if mismatch == "owner-role":
            run.created_by_role = CreatorUserRole.ACCOUNT
        pause = None
        form = None
        if status == WorkflowExecutionStatus.PAUSED:
            pause = WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=run.id, state_object_key="state")
            form = HumanInputForm(
                id="form-1",
                tenant_id=run.tenant_id,
                app_id=run.app_id,
                workflow_run_id=run.id,
                node_id="review",
                form_definition="{}",
                rendered_content="Review",
                expiration_time=datetime(2026, 10, 20),
            )
            sqlite_session.add_all([pause, form])
        sqlite_session.commit()
        task_id = "22222222-2222-2222-2222-222222222222" if mismatch == "missing" else run.task_id
        assert task_id is not None
        redis = _AppTaskServiceStopredis(
            read_error=AssertionError("Durable workflow ownership must not depend on Redis")
        )

        admitted = AppTaskControlService(redis_client=redis).stop_app_task(
            tenant_id="other-tenant" if mismatch == "tenant" else run.tenant_id,
            app_id="other-app" if mismatch == "app" else run.app_id,
            task_id=task_id,
            app_mode=app_mode,
            caller_role=caller_role,
            caller_id=_USER_ID,
        )

        assert admitted is (caller_role is CreatorUserRole.ACCOUNT)
        assert redis.reads == []
        assert redis.operations == []
        assert redis.values == {}
        assert redis.commands == {}
        sqlite_session.refresh(run)
        assert run.status == status
        assert run.stop_requested_at is None
        assert run.finished_at is None
        if pause is not None and form is not None:
            sqlite_session.refresh(pause)
            sqlite_session.refresh(form)
            assert pause.state_object_key == "state"
            assert form.status == HumanInputFormStatus.WAITING
            assert form.submitted_at is None

    @staticmethod
    @pytest.mark.parametrize("owner", [None, b"account-another-user"])
    def test_unchecked_workflow_stop_skips_ownership_read(owner: bytes | None) -> None:
        redis = _AppTaskServiceStopredis(
            values={_OWNER_KEY: owner} if owner is not None else {},
            read_error=AssertionError("Unchecked workflow stop must not read ownership"),
        )

        AppTaskControlService(redis_client=redis).stop_workflow_task_no_user_check(task_id=_TASK_ID)

        assert redis.reads == []
        assert redis.operations == ["legacy_flag", "graph_command"]
        _assert_stop_flag(redis)
        _assert_graph_command(redis)

    @staticmethod
    def test_unchecked_workflow_stop_with_empty_task_id_is_noop() -> None:
        redis = _AppTaskServiceStopredis()

        AppTaskControlService(redis_client=redis).stop_workflow_task_no_user_check(task_id="")

        assert redis.reads == []
        assert redis.operations == []
        assert redis.values == {}
        assert redis.commands == {}

    @staticmethod
    @pytest.mark.parametrize("unchecked", [False, True])
    def test_flag_write_failure_propagates_before_graph_command(unchecked: bool) -> None:
        error = RedisConnectionError("stop flag write failed")
        redis = _AppTaskServiceStopredis(values={_OWNER_KEY: b"account-user-1"}, flag_error=error)
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

    @staticmethod
    def test_graph_redis_failure_is_swallowed_after_legacy_flag(caplog: pytest.LogCaptureFixture) -> None:
        redis = _AppTaskServiceStopredis(
            values={_OWNER_KEY: b"account-user-1"}, command_error=RedisConnectionError("command write failed")
        )

        AppTaskControlService(redis_client=redis).stop_workflow_task_no_user_check(task_id=_TASK_ID)

        _assert_stop_flag(redis)
        assert redis.operations == ["legacy_flag", "graph_command"]
        assert redis.commands == {}
        assert "Failed to send Engine abort command" in caplog.text

    @staticmethod
    def test_ownership_read_failure_propagates_without_either_stop_signal() -> None:
        error = RedisConnectionError("ownership read failed")
        redis = _AppTaskServiceStopredis(read_error=error)

        with pytest.raises(RedisConnectionError, match="ownership read failed") as caught:
            AppTaskControlService(redis_client=redis).stop_task(_TASK_ID, InvokeFrom.EXPLORE, _USER_ID)

        assert caught.value is error
        assert redis.reads == [_OWNER_KEY]
        assert redis.operations == []
        assert redis.values == {}
        assert redis.commands == {}

    @staticmethod
    def test_service_instances_keep_their_redis_dependencies_separate() -> None:
        first = _AppTaskServiceStopredis(values={_OWNER_KEY: b"account-user-1"})
        second = _AppTaskServiceStopredis(values={_OWNER_KEY: b"account-another-user"})
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

    @staticmethod
    def test_legacy_static_entry_point_passes_global_client_through_the_same_implementation(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        redis = _AppTaskServiceStopredis(values={_OWNER_KEY: b"end-user-user-1"})
        # Only the legacy composition point gets a global client; lower-level globals remain traps.
        monkeypatch.setattr(task_module, "redis_client", redis)

        AppTaskService.stop_task(
            _TASK_ID, InvokeFrom.SERVICE_API, _USER_ID, AppMode.CHAT, tenant_id="tenant-1", app_id="app-1"
        )

        assert redis.reads == [_OWNER_KEY]
        assert redis.operations == ["legacy_flag"]
        _assert_stop_flag(redis)

    @staticmethod
    @pytest.mark.parametrize("cached_owner", [None, b"end-user-other", b"account-user-1"])
    def test_live_chatflow_stop_does_not_send_either_signal_for_another_owner(
        monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, cached_owner: bytes | None
    ) -> None:
        task_id = "11111111-1111-1111-1111-111111111111"
        redis = _AppTaskServiceStopredis(values={_OWNER_KEY: cached_owner} if cached_owner else {})
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

    @staticmethod
    def test_live_chatflow_stop_sends_signals_for_its_owner(
        monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
    ) -> None:
        task_id = "11111111-1111-1111-1111-111111111111"
        redis = _AppTaskServiceStopredis(values={_OWNER_KEY: b"end-user-user-1"})
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

    @staticmethod
    def test_invalid_workflow_task_id_is_rejected_before_database_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
        def reject_lookup(*_args: object, **_kwargs: object) -> None:
            pytest.fail("Invalid task IDs must be rejected before database lookup")

        monkeypatch.setattr(task_module, "DifyAPISQLAlchemyWorkflowRunRepository", reject_lookup)
        with pytest.raises(ValueError, match="Invalid task ID"):
            AppTaskService.stop_workflow_task(
                tenant_id="tenant-1", app_id="app-1", task_id="not-a-uuid", app_mode=AppMode.WORKFLOW, owner=None
            )


"""Legacy pauses recover task IDs on demand without an offline backfill."""


_LegacyWorkflowTaskRecoveryStopRedis = _AppTaskServiceStopredis


def _seed_pause(
    session: Session,
    states: dict[str, bytes],
    app_mode: AppMode = AppMode.WORKFLOW,
    *,
    pause_id: str | None = None,
) -> tuple[WorkflowRun, WorkflowPause, WorkflowResumptionContext]:
    run = WorkflowRun(
        id=str(uuid4()),
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        type=_legacy_workflow_task_recovery_WorkflowType.WORKFLOW
        if app_mode == AppMode.WORKFLOW
        else _legacy_workflow_task_recovery_WorkflowType.CHAT,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        status=WorkflowExecutionStatus.PAUSED,
        created_by_role=CreatorUserRole.END_USER,
        created_by="user-1",
        created_at=datetime(2026, 10, 10),
        elapsed_time=0,
        total_tokens=0,
        total_steps=1,
        exceptions_count=0,
    )
    pause = WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=run.id, state_object_key=f"pause/{run.id}")
    if pause_id is not None:
        pause.id = pause_id
    config = WorkflowUIBasedAppConfig(
        tenant_id=run.tenant_id, app_id=run.app_id, app_mode=app_mode, workflow_id=run.workflow_id
    )
    if app_mode == AppMode.WORKFLOW:
        wrapper = _WorkflowGenerateEntityWrapper(
            entity=WorkflowAppGenerateEntity(
                task_id=str(uuid4()),
                app_config=config,
                inputs={},
                files=[],
                user_id=run.created_by,
                stream=True,
                invoke_from=InvokeFrom.WEB_APP,
                workflow_execution_id=run.id,
            )
        )
    else:
        wrapper = _AdvancedChatAppGenerateEntityWrapper(
            entity=AdvancedChatAppGenerateEntity(
                task_id=str(uuid4()),
                app_config=config,
                inputs={},
                files=[],
                user_id=run.created_by,
                stream=True,
                invoke_from=InvokeFrom.WEB_APP,
                workflow_run_id=run.id,
                query="Approve this run",
                conversation_id="conversation-1",
            )
        )
    context = WorkflowResumptionContext(generate_entity=wrapper, serialized_graph_runtime_state="{}")
    states[pause.state_object_key] = context.dumps().encode()
    session.add_all([run, pause])
    session.commit()
    return run, pause, context


def _stop(service: AppTaskControlService, task_id: str, app_mode: AppMode = AppMode.WORKFLOW) -> bool:
    return service.stop_workflow_task(
        tenant_id="tenant-1",
        app_id="app-1",
        task_id=task_id,
        app_mode=app_mode,
        owner=(CreatorUserRole.END_USER, "user-1"),
    )


class TestLegacyWorkflowTaskRecoveryCases:
    @staticmethod
    @pytest.fixture
    def pause_states(monkeypatch: pytest.MonkeyPatch) -> dict[str, bytes]:
        states: dict[str, bytes] = {}

        def load(key: str) -> bytes:
            try:
                return states[key]
            except KeyError as error:
                raise FileNotFoundError(key) from error

        monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.load", load)
        return states

    @staticmethod
    @pytest.fixture
    def recovery_redis() -> _LegacyWorkflowTaskRecoveryStopRedis:
        return _LegacyWorkflowTaskRecoveryStopRedis(read_error=AssertionError("Recovery must use persisted ownership"))

    @staticmethod
    @pytest.fixture
    def recovery_service(
        sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch, recovery_redis: _LegacyWorkflowTaskRecoveryStopRedis
    ) -> AppTaskControlService:
        monkeypatch.setattr(type(task_module.db), "engine", property(lambda _: sqlite_engine))
        monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.delete", lambda _: None)
        monkeypatch.setattr(AppTaskService, "_persist_stopped_history", lambda _: None)
        monkeypatch.setattr(
            "core.workflow.nodes.agent_v2.session_store.WorkflowAgentWorkspaceStore.retire_workflow_run",
            lambda *_args, **_kwargs: [],
        )
        monkeypatch.setattr(
            "tasks.collect_agent_resources_task.enqueue_agent_resource_collection", lambda **_kwargs: None
        )
        topic = Topic(Redis(), "recovery-test")
        monkeypatch.setattr(topic, "publish", lambda _payload: None)
        monkeypatch.setattr(task_module.MessageBasedAppGenerator, "get_response_topic", lambda *_: topic)
        return AppTaskControlService(redis_client=recovery_redis)

    @staticmethod
    @pytest.mark.parametrize("app_mode", [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
    def test_stop_recovers_and_cancels_a_legacy_pause_without_prior_replay(
        sqlite_session: Session,
        pause_states: dict[str, bytes],
        recovery_service: AppTaskControlService,
        app_mode: AppMode,
        recovery_redis: _LegacyWorkflowTaskRecoveryStopRedis,
    ) -> None:
        run, pause, context = _seed_pause(sqlite_session, pause_states, app_mode)
        task_id = context.get_generate_entity().task_id
        assert task_id != run.id
        assert run.task_id is None
        context.get_generate_entity().task_id = task_id.upper()
        pause_states[pause.state_object_key] = context.dumps().encode()

        assert _stop(recovery_service, task_id.upper(), app_mode)

        sqlite_session.refresh(run)
        assert run.task_id == task_id
        assert run.status == WorkflowExecutionStatus.STOPPED
        assert run.stop_requested_at is not None
        assert sqlite_session.scalar(select(WorkflowPause.id).where(WorkflowPause.id == pause.id)) is None
        sqlite_session.commit()
        pause_states.clear()
        assert _stop(recovery_service, task_id, app_mode)
        assert recovery_redis.reads == []
        assert recovery_redis.operations == []

    @staticmethod
    @pytest.mark.parametrize("field", ["tenant_id", "app_id", "created_by", "created_by_role"])
    def test_recovery_excludes_unauthorized_pauses_before_storage_reads(
        sqlite_session: Session,
        pause_states: dict[str, bytes],
        recovery_service: AppTaskControlService,
        monkeypatch: pytest.MonkeyPatch,
        field: str,
    ) -> None:
        run, _, context = _seed_pause(sqlite_session, pause_states)
        setattr(run, field, CreatorUserRole.ACCOUNT if field == "created_by_role" else "other-owner")
        sqlite_session.commit()

        def reject_load(_key: str) -> bytes:
            pytest.fail("Unauthorized pauses must not reach snapshot storage")

        monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.load", reject_load)
        assert not _stop(recovery_service, context.get_generate_entity().task_id)
        sqlite_session.refresh(run)
        assert run.task_id is None
        assert run.stop_requested_at is None
        assert run.status == WorkflowExecutionStatus.PAUSED

    @staticmethod
    @pytest.mark.parametrize("field", ["task_id", "run_id", "tenant_id", "app_id", "user_id", "app_config"])
    def test_recovery_rejects_snapshot_identity_mismatches_and_continues(
        sqlite_session: Session,
        pause_states: dict[str, bytes],
        recovery_service: AppTaskControlService,
        field: str,
    ) -> None:
        invalid, pause, invalid_context = _seed_pause(sqlite_session, pause_states, pause_id=str(UUID(int=1)))
        valid, _, valid_context = _seed_pause(sqlite_session, pause_states, pause_id=str(UUID(int=2)))
        state = json.loads(pause_states[pause.state_object_key])
        entity = state["generate_entity"]["entity"]
        if field in {"tenant_id", "app_id"}:
            entity["app_config"][field] = "other-owner"
        elif field == "app_config":
            del entity["app_config"]
        else:
            entity["workflow_execution_id" if field == "run_id" else field] = "invalid-task-or-owner"
        pause_states[pause.state_object_key] = json.dumps(state).encode()

        assert not _stop(recovery_service, invalid_context.get_generate_entity().task_id)
        sqlite_session.refresh(invalid)
        sqlite_session.refresh(valid)
        assert invalid.task_id is None
        assert invalid.status == WorkflowExecutionStatus.PAUSED
        assert invalid.stop_requested_at is None
        assert valid.task_id is None
        sqlite_session.commit()

        assert _stop(recovery_service, valid_context.get_generate_entity().task_id)
        sqlite_session.refresh(invalid)
        sqlite_session.refresh(valid)
        assert invalid.task_id is None
        assert valid.task_id == valid_context.get_generate_entity().task_id
        assert valid.status == WorkflowExecutionStatus.STOPPED

    @staticmethod
    @pytest.mark.parametrize("missing", ["pause", "state", "corrupt_state"])
    def test_recovery_skips_unrecoverable_pause_and_finds_later_match(
        sqlite_session: Session,
        pause_states: dict[str, bytes],
        recovery_service: AppTaskControlService,
        missing: str,
    ) -> None:
        invalid, pause, invalid_context = _seed_pause(sqlite_session, pause_states, pause_id=str(UUID(int=1)))
        valid, _, valid_context = _seed_pause(sqlite_session, pause_states, pause_id=str(UUID(int=2)))
        if missing == "pause":
            sqlite_session.delete(pause)
            sqlite_session.commit()
        elif missing == "state":
            del pause_states[pause.state_object_key]
        else:
            pause_states[pause.state_object_key] = b"invalid JSON"

        assert not _stop(recovery_service, invalid_context.get_generate_entity().task_id)
        assert _stop(recovery_service, valid_context.get_generate_entity().task_id)

        sqlite_session.refresh(invalid)
        sqlite_session.refresh(valid)
        assert invalid.task_id is None
        assert invalid.status == WorkflowExecutionStatus.PAUSED
        assert invalid.stop_requested_at is None
        assert valid.status == WorkflowExecutionStatus.STOPPED

    @staticmethod
    @pytest.mark.parametrize("change", ["replaced_pause", "resumed", "already_bound"])
    def test_indexing_does_not_overwrite_a_concurrent_transition(
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        pause_states: dict[str, bytes],
        change: str,
    ) -> None:
        run, pause, context = _seed_pause(sqlite_session, pause_states)
        repository = DifyAPISQLAlchemyWorkflowRunRepository(sqlite_session_factory)
        saved_pause = repository.get_workflow_pause(run.id)
        assert saved_pause is not None
        task_id = str(uuid4()) if change == "already_bound" else None
        if change == "replaced_pause":
            sqlite_session.delete(pause)
            sqlite_session.flush()
            sqlite_session.add(
                WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=run.id, state_object_key="replacement")
            )
        elif change == "resumed":
            run.status = WorkflowExecutionStatus.RUNNING
            pause.resumed_at = datetime(2026, 10, 10, 1)
        else:
            run.task_id = task_id
        sqlite_session.commit()

        assert not AppTaskService.index_workflow_pause_task(
            workflow_run=run,
            pause_entity=saved_pause,
            resumption_context=context,
            workflow_run_repo=repository,
        )

        sqlite_session.refresh(run)
        assert run.task_id == task_id

    @staticmethod
    @pytest.mark.parametrize("resumed", [False, True])
    def test_stop_retries_durable_admission_after_another_request_binds_the_task(
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        pause_states: dict[str, bytes],
        recovery_service: AppTaskControlService,
        monkeypatch: pytest.MonkeyPatch,
        resumed: bool,
        recovery_redis: _LegacyWorkflowTaskRecoveryStopRedis,
    ) -> None:
        run, pause, context = _seed_pause(sqlite_session, pause_states)
        task_id = context.get_generate_entity().task_id

        def load(key: str) -> bytes:
            with sqlite_session_factory() as session, session.begin():
                concurrent_run = session.get(WorkflowRun, run.id)
                assert concurrent_run is not None
                concurrent_run.task_id = task_id
                if resumed:
                    concurrent_run.status = WorkflowExecutionStatus.RUNNING
                    concurrent_pause = session.get(WorkflowPause, pause.id)
                    assert concurrent_pause is not None
                    concurrent_pause.resumed_at = datetime(2026, 10, 10, 1)
            return pause_states[key]

        monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.load", load)
        assert _stop(recovery_service, task_id)
        sqlite_session.refresh(run)
        assert run.task_id == task_id
        assert run.stop_requested_at is not None
        assert run.status == (WorkflowExecutionStatus.RUNNING if resumed else WorkflowExecutionStatus.STOPPED)
        assert recovery_redis.reads == []
        assert recovery_redis.operations == (["legacy_flag", "graph_command"] if resumed else [])

    @staticmethod
    @pytest.mark.parametrize("status", [WorkflowExecutionStatus.PAUSED, WorkflowExecutionStatus.RUNNING])
    def test_prebound_tasks_stop_without_reading_legacy_snapshots(
        sqlite_session: Session,
        pause_states: dict[str, bytes],
        recovery_service: AppTaskControlService,
        monkeypatch: pytest.MonkeyPatch,
        status: WorkflowExecutionStatus,
    ) -> None:
        run, _, context = _seed_pause(sqlite_session, pause_states)
        run.task_id = context.get_generate_entity().task_id
        run.status = status
        sqlite_session.commit()

        def reject_load(_key: str) -> bytes:
            pytest.fail("Already indexed tasks must not read snapshots")

        monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.load", reject_load)
        assert _stop(recovery_service, context.get_generate_entity().task_id)
        sqlite_session.refresh(run)
        assert run.stop_requested_at is not None

    @staticmethod
    @pytest.mark.parametrize("excluded", ["terminal", "pipeline", "resumed", "running"])
    def test_recovery_excludes_nonrecoverable_runs_before_storage_reads(
        sqlite_session: Session,
        pause_states: dict[str, bytes],
        recovery_service: AppTaskControlService,
        monkeypatch: pytest.MonkeyPatch,
        excluded: str,
    ) -> None:
        run, pause, context = _seed_pause(sqlite_session, pause_states)
        if excluded == "terminal":
            run.status = WorkflowExecutionStatus.SUCCEEDED
        elif excluded == "pipeline":
            run.type = _legacy_workflow_task_recovery_WorkflowType.RAG_PIPELINE
        elif excluded == "resumed":
            pause.resumed_at = datetime(2026, 10, 10, 1)
        else:
            run.status = WorkflowExecutionStatus.RUNNING
        sqlite_session.commit()

        def reject_load(_key: str) -> bytes:
            pytest.fail("Ineligible runs must not read snapshots")

        monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.load", reject_load)
        assert not _stop(recovery_service, context.get_generate_entity().task_id)
        sqlite_session.refresh(run)
        assert run.task_id is None
        assert run.stop_requested_at is None

    @staticmethod
    def test_recovery_pages_pauses_without_backfilling_unrelated_runs(
        sqlite_session: Session,
        pause_states: dict[str, bytes],
        recovery_service: AppTaskControlService,
    ) -> None:
        for index in range(1, 101):
            _seed_pause(sqlite_session, pause_states, pause_id=str(UUID(int=index)))
        run, _, context = _seed_pause(sqlite_session, pause_states, pause_id=str(UUID(int=101)))
        task_id = context.get_generate_entity().task_id

        assert _stop(recovery_service, task_id)

        indexed = sqlite_session.execute(
            select(WorkflowRun.id, WorkflowRun.task_id).where(WorkflowRun.task_id.is_not(None))
        )
        assert indexed.tuples().all() == [(run.id, task_id)]

    @staticmethod
    def test_snapshot_storage_reads_do_not_hold_a_database_transaction(
        sqlite_session: Session,
        sqlite_engine: Engine,
        pause_states: dict[str, bytes],
        recovery_service: AppTaskControlService,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _, _, context = _seed_pause(sqlite_session, pause_states)
        active_transactions: set[Connection] = set()

        def load(key: str) -> bytes:
            assert not active_transactions
            return pause_states[key]

        monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.load", load)
        listeners: tuple[tuple[str, Callable[[Connection], None]], ...] = (
            ("begin", active_transactions.add),
            ("commit", active_transactions.discard),
            ("rollback", active_transactions.discard),
        )
        for name, listener in listeners:
            event.listen(sqlite_engine, name, listener)
        try:
            assert _stop(recovery_service, context.get_generate_entity().task_id)
        finally:
            for name, listener in listeners:
                event.remove(sqlite_engine, name, listener)


"""Paused stops persist before publishing terminal events or retiring resources."""


_PausedWorkflowStopStopRedis = _AppTaskServiceStopredis


class TestPausedWorkflowStopCases:
    @staticmethod
    @pytest.mark.parametrize("app_mode", [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
    @pytest.mark.parametrize("backend", ["sql", "celery", "logstore"])
    @pytest.mark.parametrize("node_status", [WorkflowNodeExecutionStatus.PAUSED, WorkflowNodeExecutionStatus.RETRY])
    def test_paused_stop_publishes_terminal_event_after_commit_and_retires_run_resources(
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
        app_mode: AppMode,
        backend: str,
        node_status: WorkflowNodeExecutionStatus,
        config_overrides: Callable[..., None],
    ) -> None:
        config_overrides(
            CORE_WORKFLOW_EXECUTION_REPOSITORY={
                "sql": (
                    "core.repositories.sqlalchemy_workflow_execution_repository.SQLAlchemyWorkflowExecutionRepository"
                ),
                "celery": "core.repositories.celery_workflow_execution_repository.CeleryWorkflowExecutionRepository",
                "logstore": (
                    "extensions.logstore.repositories.logstore_workflow_execution_repository."
                    "LogstoreWorkflowExecutionRepository"
                ),
            }[backend],
            CORE_WORKFLOW_NODE_EXECUTION_REPOSITORY={
                "sql": (
                    "core.repositories.sqlalchemy_workflow_node_execution_repository."
                    "SQLAlchemyWorkflowNodeExecutionRepository"
                ),
                "celery": (
                    "core.repositories.celery_workflow_node_execution_repository.CeleryWorkflowNodeExecutionRepository"
                ),
                "logstore": (
                    "extensions.logstore.repositories.logstore_workflow_node_execution_repository."
                    "LogstoreWorkflowNodeExecutionRepository"
                ),
            }[backend],
            LOGSTORE_DUAL_WRITE_ENABLED=False,
        )
        monkeypatch.setattr(
            "repositories.sqlalchemy_api_workflow_run_repository.naive_utc_now", lambda: datetime(2026, 10, 10, 0, 1)
        )
        logstore_records: dict[str, list[dict[str, str]]] = {}
        monkeypatch.setattr(AliyunLogStore, "_instance", None)
        monkeypatch.setattr(AliyunLogStore, "_initialized", False)
        monkeypatch.setenv("ALIYUN_SLS_ENDPOINT", "localhost")
        monkeypatch.setattr(AliyunLogStore, "_check_endpoint_connectivity", staticmethod(lambda *_: None))
        monkeypatch.setattr(
            AliyunLogStore,
            "put_log",
            lambda _self, name, record: logstore_records.setdefault(name, []).append(dict(record)),
        )
        queued_node_saves: list[object] = []
        queued_saves: list[object] = []
        monkeypatch.setattr(
            "core.repositories.celery_workflow_node_execution_repository.save_workflow_node_executions_task.delay",
            lambda *args, **kwargs: queued_node_saves.append((args, kwargs)),
        )
        monkeypatch.setattr(
            "core.repositories.celery_workflow_execution_repository.save_workflow_execution_task.delay",
            lambda *args, **kwargs: queued_saves.append((args, kwargs)),
        )
        run = WorkflowRun(
            id="run-1",
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            type=_paused_workflow_stop_WorkflowType.WORKFLOW,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            version="1",
            status=WorkflowExecutionStatus.PAUSED,
            created_by_role=CreatorUserRole.END_USER,
            created_by="user-1",
            created_at=datetime(2026, 10, 10),
            elapsed_time=1,
            total_tokens=0,
            total_steps=2,
            exceptions_count=0,
        )
        run.task_id = "11111111-1111-1111-1111-111111111111"
        pause = WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=run.id, state_object_key="state")
        sqlite_session.add_all([run, pause])
        sqlite_session.commit()
        for node_app, origin in (
            ("app-1", WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN),
            ("source-app", WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL),
        ):
            SQLAlchemyWorkflowNodeExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id="tenant-1",
                user=EndUser(id="user-1"),
                app_id=node_app,
                triggered_from=origin,
            ).save(
                WorkflowNodeExecution(
                    id=f"node-{node_app}",
                    node_execution_id=f"node-{node_app}",
                    workflow_id=f"workflow-{node_app}",
                    workflow_execution_id=run.id,
                    index=1,
                    node_id="review",
                    node_type="human-input",
                    title="Review",
                    status=node_status,
                    process_data={"__dify_retry_history": [{"retry_index": 1, "error": "retry failed"}]},
                    created_at=run.created_at,
                )
            )
        monkeypatch.setattr(type(task_module.db), "engine", property(lambda _: sqlite_session_factory.kw["bind"]))
        redis = _PausedWorkflowStopStopRedis()
        monkeypatch.setattr(task_module, "redis_client", redis)
        monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.delete", lambda _: None)
        calls: list[str] = []

        def retire(*, tenant_id: str, app_id: str, workflow_run_id: str) -> list[str]:
            assert (tenant_id, app_id, workflow_run_id) == ("tenant-1", "app-1", "run-1")
            with sqlite_session_factory() as session:
                persisted = session.get(WorkflowRun, workflow_run_id)
                assert persisted is not None
                assert persisted.status == WorkflowExecutionStatus.STOPPED
                assert persisted.elapsed_time == 1
                node = session.get(WorkflowNodeExecutionModel, "node-app-1")
                assert node is not None
                assert node.status == WorkflowNodeExecutionStatus.FAILED
                assert node.finished_at == datetime(2026, 10, 10, 0, 1)
                assert node.process_data_dict == {"__dify_retry_history": [{"retry_index": 1, "error": "retry failed"}]}
            calls.append("retire")
            return ["workspace-1"]

        monkeypatch.setattr(WorkflowAgentWorkspaceStore, "retire_workflow_run", staticmethod(retire))
        collections: list[dict[str, object]] = []

        def enqueue(**kwargs: object) -> None:
            calls.append("collect")
            collections.append(kwargs)

        monkeypatch.setattr("tasks.collect_agent_resources_task.enqueue_agent_resource_collection", enqueue)
        publications: list[bytes] = []

        def publish(_channel: str, payload: bytes) -> None:
            calls.append("publish")
            publications.append(payload)

        topic_client = Redis()
        monkeypatch.setattr(topic_client, "publish", publish)
        topic = Topic(topic_client, "workflow-events")
        monkeypatch.setattr(task_module.MessageBasedAppGenerator, "get_response_topic", lambda *_: topic)

        assert run.task_id is not None
        AppTaskService.stop_workflow_task(
            tenant_id="tenant-1",
            app_id="app-1",
            task_id=run.task_id,
            app_mode=app_mode,
            owner=(CreatorUserRole.END_USER, "user-1"),
        )

        assert calls == ["retire", "collect", "publish"]
        assert collections == [{"tenant_id": "tenant-1", "workspace_ids": ["workspace-1"]}]
        assert len(publications) == 1
        event = json.loads(publications[0])
        assert event["event"] == "workflow_finished"
        assert event["data"]["status"] == "stopped"
        assert event["data"]["elapsed_time"] == 1
        assert event["workflow_run_id"] == "run-1"
        assert event["task_id"] == run.task_id
        assert redis.reads == []
        assert redis.operations == []
        assert queued_saves == []
        if backend == "logstore":
            assert len(logstore_records[AliyunLogStore.workflow_execution_logstore]) == 1
            history = logstore_records[AliyunLogStore.workflow_execution_logstore][0]
            assert history["status"] == "stopped"
            assert float(history["elapsed_time"]) == 1
            assert (history["tenant_id"], history["app_id"], history["id"]) == ("tenant-1", "app-1", "run-1")
            node_history = logstore_records[AliyunLogStore.workflow_node_execution_logstore]
            assert all(float(record["elapsed_time"]) == 60 for record in node_history)
            assert all(
                json.loads(record["process_data"])["__dify_retry_history"][0]["error"] == "retry failed"
                for record in node_history
            )
            assert {(record["app_id"], record["triggered_from"], record["status"]) for record in node_history} == {
                ("app-1", "workflow-run", "failed"),
                ("source-app", "workflow-tool", "failed"),
            }

    @staticmethod
    @pytest.mark.parametrize(
        "task_id_input", ["11111111-aaaa-1111-1111-111111111111", "11111111AAAA11111111111111111111"]
    )
    def test_stop_after_resume_claim_uses_durable_owner_before_queue_is_recreated(
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
        task_id_input: str,
    ) -> None:
        run = WorkflowRun(
            id="run-1",
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            type=_paused_workflow_stop_WorkflowType.WORKFLOW,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            version="1",
            status=WorkflowExecutionStatus.PAUSED,
            created_by_role=CreatorUserRole.END_USER,
            created_by="user-1",
        )
        run.task_id = "11111111-aaaa-1111-1111-111111111111"
        pause = WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=run.id, state_object_key="state")
        sqlite_session.add_all([run, pause])
        sqlite_session.commit()
        repository = DifyAPISQLAlchemyWorkflowRunRepository(sqlite_session_factory)
        entity = repository.get_workflow_pause(run.id)
        assert entity is not None
        repository.resume_workflow_pause(run.id, entity)
        redis = _PausedWorkflowStopStopRedis()
        monkeypatch.setattr(type(task_module.db), "engine", property(lambda _: sqlite_session_factory.kw["bind"]))
        monkeypatch.setattr(task_module, "redis_client", redis)
        AppTaskService.stop_workflow_task(
            tenant_id="tenant-1",
            app_id="app-1",
            task_id=task_id_input,
            app_mode=AppMode.ADVANCED_CHAT,
            owner=(CreatorUserRole.END_USER, "user-1"),
        )
        assert redis.reads == []
        assert redis.values[f"generate_task_stopped:{run.task_id}"] == b"1"
        assert json.loads(redis.commands[f"workflow:{run.task_id}:commands"][0])["command_type"] == "abort"

    @staticmethod
    @pytest.mark.parametrize(
        ("tenant_id", "app_id", "owner"),
        [
            ("other-tenant", "app-1", None),
            ("tenant-1", "other-app", None),
            ("tenant-1", "app-1", (CreatorUserRole.END_USER, "other-user")),
            ("tenant-1", "app-1", (CreatorUserRole.ACCOUNT, "user-1")),
        ],
    )
    def test_running_task_admission_rejects_foreign_tenant_app_user_and_role(
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
        tenant_id: str,
        app_id: str,
        owner: tuple[CreatorUserRole, str] | None,
    ) -> None:
        task_id = "22222222-2222-2222-2222-222222222222"
        run = WorkflowRun(
            id="run-1",
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            task_id=task_id,
            type=_paused_workflow_stop_WorkflowType.WORKFLOW,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            version="1",
            status=WorkflowExecutionStatus.RUNNING,
            created_by_role=CreatorUserRole.END_USER,
            created_by="user-1",
        )
        sqlite_session.add(run)
        sqlite_session.commit()
        monkeypatch.setattr(type(task_module.db), "engine", property(lambda _: sqlite_session_factory.kw["bind"]))
        redis = _PausedWorkflowStopStopRedis(values={f"generate_task_belong:{task_id}": b"end-user-user-1"})
        monkeypatch.setattr(task_module, "redis_client", redis)
        AppTaskService.stop_workflow_task(
            tenant_id=tenant_id, app_id=app_id, task_id=task_id, app_mode=AppMode.WORKFLOW, owner=owner
        )
        sqlite_session.expire_all()
        assert run.status == WorkflowExecutionStatus.RUNNING
        assert run.stop_requested_at is None
        assert redis.reads == []
        assert redis.operations == []
