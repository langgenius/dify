import json
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import timedelta
from functools import partial
from typing import override

import pytest
from redis.exceptions import ConnectionError as RedisConnectionError

import core.app.apps.base_app_queue_manager as queue_module
import core.app.apps.execution_coordinator as coordinator_module
import services.app_task_service as task_module
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_redis import RedisClientWrapper
from models.model import AppMode
from services.app_task_service import AppTaskControlService, AppTaskService

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
        {"command_type": "abort", "payload": None, "reason": "User requested stop"}
    ]
    assert redis.expirations[_COMMAND_KEY] == 3600
    assert redis.values[f"{_COMMAND_KEY}:pending"] == b"1"
    assert redis.expirations[f"{_COMMAND_KEY}:pending"] == 3600


@pytest.mark.parametrize("app_mode", list(AppMode))
def test_stop_task_sends_graph_command_only_for_workflow_modes(app_mode: AppMode) -> None:
    redis = _StopRedis(values={_OWNER_KEY: f"end-user-{_USER_ID}".encode()})

    AppTaskControlService(redis_client=redis).stop_task(_TASK_ID, InvokeFrom.WEB_APP, _USER_ID, app_mode)

    assert redis.reads == [_OWNER_KEY]
    _assert_stop_flag(redis)
    if app_mode in (AppMode.ADVANCED_CHAT, AppMode.WORKFLOW):
        assert redis.operations == ["legacy_flag", "graph_command"]
        _assert_graph_command(redis)
    else:
        assert redis.operations == ["legacy_flag"]
        assert redis.commands == {}


@pytest.mark.parametrize(
    ("invoke_from", "owner", "should_set_flag"),
    [
        (InvokeFrom.EXPLORE, b"account-user-1", True),
        (InvokeFrom.DEBUGGER, b"account-user-1", True),
        (InvokeFrom.WEB_APP, b"end-user-user-1", True),
        (InvokeFrom.SERVICE_API, b"end-user-user-1", True),
        (InvokeFrom.EXPLORE, b"end-user-user-1", False),
        (InvokeFrom.DEBUGGER, b"end-user-user-1", False),
        (InvokeFrom.WEB_APP, b"account-user-1", False),
        (InvokeFrom.SERVICE_API, b"account-user-1", False),
        (InvokeFrom.EXPLORE, b"account-another-user", False),
        (InvokeFrom.WEB_APP, b"end-user-another-user", False),
        (InvokeFrom.EXPLORE, None, False),
        (InvokeFrom.WEB_APP, None, False),
    ],
)
def test_task_ownership_controls_only_the_legacy_flag(
    invoke_from: InvokeFrom, owner: bytes | None, should_set_flag: bool
) -> None:
    redis = _StopRedis(values={_OWNER_KEY: owner} if owner is not None else {})

    AppTaskControlService(redis_client=redis).stop_task(_TASK_ID, invoke_from, _USER_ID, AppMode.WORKFLOW)

    assert redis.reads == [_OWNER_KEY]
    if should_set_flag:
        _assert_stop_flag(redis)
        assert redis.operations == ["legacy_flag", "graph_command"]
    else:
        assert _STOP_KEY not in redis.values
        assert redis.operations == ["graph_command"]
    # Preserve the existing behavior even when the legacy ownership check does not match.
    _assert_graph_command(redis)


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
        else partial(service.stop_task, _TASK_ID, InvokeFrom.EXPLORE, _USER_ID, AppMode.WORKFLOW)
    )

    with pytest.raises(RedisConnectionError, match="stop flag write failed") as caught:
        stop()

    assert caught.value is error
    assert redis.operations == ["legacy_flag"]
    assert _STOP_KEY not in redis.values
    assert redis.commands == {}


@pytest.mark.parametrize("unchecked", [False, True])
def test_graph_redis_failure_is_swallowed_after_legacy_flag(unchecked: bool, caplog: pytest.LogCaptureFixture) -> None:
    redis = _StopRedis(
        values={_OWNER_KEY: b"account-user-1"}, command_error=RedisConnectionError("command write failed")
    )
    service = AppTaskControlService(redis_client=redis)

    if unchecked:
        service.stop_workflow_task_no_user_check(task_id=_TASK_ID)
    else:
        service.stop_task(_TASK_ID, InvokeFrom.EXPLORE, _USER_ID, AppMode.WORKFLOW)

    _assert_stop_flag(redis)
    assert redis.operations == ["legacy_flag", "graph_command"]
    assert redis.commands == {}
    assert "Failed to send graph engine command AbortCommand" in caplog.text


def test_ownership_read_failure_propagates_without_either_stop_signal() -> None:
    error = RedisConnectionError("ownership read failed")
    redis = _StopRedis(read_error=error)

    with pytest.raises(RedisConnectionError, match="ownership read failed") as caught:
        AppTaskControlService(redis_client=redis).stop_task(_TASK_ID, InvokeFrom.EXPLORE, _USER_ID, AppMode.WORKFLOW)

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

    first_service.stop_task(_TASK_ID, InvokeFrom.EXPLORE, _USER_ID, AppMode.CHAT)
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

    AppTaskService.stop_task(_TASK_ID, InvokeFrom.SERVICE_API, _USER_ID, AppMode.ADVANCED_CHAT)

    assert redis.reads == [_OWNER_KEY]
    assert redis.operations == ["legacy_flag", "graph_command"]
    _assert_stop_flag(redis)
    _assert_graph_command(redis)
