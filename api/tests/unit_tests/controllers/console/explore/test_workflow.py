import json
from collections.abc import Generator, Mapping
from dataclasses import dataclass, field
from datetime import datetime

import pytest
from flask import Flask, got_request_exception
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy.orm import Session, sessionmaker

import controllers.console.explore.workflow as workflow_module
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from graphon.model_runtime.errors.invoke import InvokeError
from models import App, AppMode, InstalledApp, Tenant
from repositories.app_definition_query_repository import AppDefinitionQueryRepository
from repositories.installed_app_repository import SQLAlchemyInstalledAppRepository
from services.account_errors import AccountNotFoundError
from services.app_definition_query_service import AppDefinitionQueryService, AppDefinitionUnavailableError
from services.app_task_service import AppTaskControlService
from services.errors.llm import InvokeRateLimitError
from services.installed_app_generation_service import GenerationResponse, InstalledAppGenerationService
from tests.unit_tests.controllers.console.explore.test_installed_app_admission import (
    _assert_json_response,
    _Harness,
    _set_app_mode,
    harness,
)
from tests.unit_tests.services.test_app_task_service import _StopRedis

__all__ = ["harness"]

_LAST_USED_AT = datetime(2026, 9, 1, 12, 0, 0)
_TASK_ID = "workflow-task-with-non-uuid-id"
_STOP_KEY = f"generate_task_stopped:{_TASK_ID}"
_COMMAND_KEY = f"workflow:{_TASK_ID}:commands"


@dataclass(frozen=True)
class _RuntimeCall:
    app_id: str
    account_id: str
    args: Mapping[str, object]
    streaming: bool


@dataclass
class _Runtime:
    session_factory: sessionmaker[Session]
    installed_app_id: str
    response: GenerationResponse = field(
        default_factory=lambda: {"workflow_run_id": "run-1", "data": {"total_tokens": 0}}
    )
    error: Exception | None = None
    last_used_at: datetime | None = _LAST_USED_AT
    calls: list[_RuntimeCall] = field(default_factory=list)

    def generate(
        self, *, app_id: str, account_id: str, args: Mapping[str, object], streaming: bool
    ) -> GenerationResponse:
        # Workflow run never updates usage, including before a failed generation.
        self.assert_usage_unchanged()
        self.calls.append(_RuntimeCall(app_id, account_id, dict(args), streaming))
        if self.error is not None:
            raise self.error
        return self.response

    def assert_usage_unchanged(self) -> None:
        with self.session_factory() as session:
            installation = session.get(InstalledApp, self.installed_app_id)
            assert installation is not None
            assert installation.last_used_at == self.last_used_at


@dataclass(frozen=True)
class _Services:
    installed_app_generation: InstalledAppGenerationService
    app_definitions: AppDefinitionQueryService
    app_tasks: AppTaskControlService


@pytest.fixture
def runtime(
    harness: _Harness,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    stop_redis: _StopRedis,
) -> _Runtime:
    _set_app_mode(harness, sqlite_session_factory, AppMode.WORKFLOW)
    with sqlite_session_factory.begin() as session:
        installation = session.get(InstalledApp, harness.installed_app.id)
        assert installation is not None
        installation.last_used_at = _LAST_USED_AT
    runtime = _Runtime(sqlite_session_factory, harness.installed_app.id)
    definitions = AppDefinitionQueryService(
        definitions=AppDefinitionQueryRepository(session_factory=sqlite_session_factory),
        builtin_icon_url_prefix="/tools/icons",
    )
    services = _Services(
        installed_app_generation=InstalledAppGenerationService(
            app_definitions=definitions,
            usage=SQLAlchemyInstalledAppRepository(session_factory=sqlite_session_factory),
            runtime=runtime,
        ),
        app_definitions=definitions,
        app_tasks=AppTaskControlService(redis_client=stop_redis),
    )
    monkeypatch.setattr(workflow_module, "application_services", lambda: services)
    harness.api.add_resource(
        workflow_module.InstalledAppWorkflowRunApi,
        "/installed-apps/<uuid:installed_app_id>/workflows/run",
    )
    harness.api.add_resource(
        workflow_module.InstalledAppWorkflowTaskStopApi,
        "/installed-apps/<uuid:installed_app_id>/workflows/tasks/<string:task_id>/stop",
    )
    return runtime


@pytest.fixture
def stop_redis() -> _StopRedis:
    return _StopRedis(
        values={f"generate_task_belong:{_TASK_ID}": b"account-someone-else"},
        read_error=AssertionError("Workflow stop must not inspect task ownership"),
    )


def _url(harness: _Harness, action: str = "run") -> str:
    suffix = "run" if action == "run" else f"tasks/{_TASK_ID}/stop"
    return f"/installed-apps/{harness.installed_app.id}/workflows/{suffix}"


@pytest.mark.parametrize("last_used_at", [None, _LAST_USED_AT])
@pytest.mark.parametrize(
    ("payload", "expected_args"),
    [
        (
            {"inputs": {"zero": 0, "enabled": False, "empty": [], "nullable": None}},
            {"inputs": {"zero": 0, "enabled": False, "empty": [], "nullable": None}},
        ),
        ({"inputs": {}, "files": None}, {"inputs": {}}),
        (
            {"inputs": {}, "files": [], "response_mode": "blocking", "auto_generate_name": True},
            {"inputs": {}, "files": []},
        ),
        (
            {
                "inputs": {},
                "files": [{"type": "image", "transfer_method": "remote_url", "url": "https://example.com/i.png"}],
            },
            {
                "inputs": {},
                "files": [{"type": "image", "transfer_method": "remote_url", "url": "https://example.com/i.png"}],
            },
        ),
    ],
)
def test_workflow_run_preserves_args_and_response_without_updating_usage(
    harness: _Harness,
    runtime: _Runtime,
    sqlite_session_factory: sessionmaker[Session],
    payload: dict[str, object],
    expected_args: dict[str, object],
    last_used_at: datetime | None,
) -> None:
    runtime.last_used_at = last_used_at
    with sqlite_session_factory.begin() as session:
        installation = session.get(InstalledApp, harness.installed_app.id)
        assert installation is not None
        installation.last_used_at = last_used_at

    response = harness.app.test_client().post(_url(harness), json=payload)

    assert response.status_code == 200
    assert response.get_json() == {"workflow_run_id": "run-1", "data": {"total_tokens": 0}}
    assert dict(response.headers) == {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": str(len(response.data)),
    }
    assert runtime.calls == [_RuntimeCall(harness.target_app.id, harness.account.id, expected_args, True)]
    runtime.assert_usage_unchanged()


@pytest.mark.parametrize("consume_all", [False, True])
def test_workflow_run_preserves_stream_bytes_headers_and_closes_on_completion_or_disconnect(
    harness: _Harness, runtime: _Runtime, consume_all: bool
) -> None:
    closed: list[bool] = []

    def chunks() -> Generator[str]:
        try:
            yield 'data: {"event":"workflow_started"}\n\n'
            yield 'data: {"event":"workflow_finished","answer":"你好"}\n\n'
        finally:
            closed.append(True)

    runtime.response = chunks()
    response = harness.app.test_client().post(_url(harness), json={"inputs": {}}, buffered=False)

    assert response.status_code == 200
    assert dict(response.headers) == {"Content-Type": "text/event-stream; charset=utf-8"}
    if consume_all:
        assert (
            response.data
            == (
                'data: {"event":"workflow_started"}\n\ndata: {"event":"workflow_finished","answer":"你好"}\n\n'
            ).encode()
        )
    else:
        assert next(iter(response.response)) == b'data: {"event":"workflow_started"}\n\n'
        assert closed == []
    response.close()
    assert closed == [True]
    assert runtime.calls == [_RuntimeCall(harness.target_app.id, harness.account.id, {"inputs": {}}, True)]
    runtime.assert_usage_unchanged()


@pytest.mark.parametrize(
    ("failure", "status", "code", "message"),
    [
        (ProviderTokenNotInitError("Missing credentials"), 400, "provider_not_initialize", "Missing credentials"),
        (
            QuotaExceededError(),
            400,
            "provider_quota_exceeded",
            "Your quota for Dify Hosted Model Provider has been exhausted. "
            "Please go to Settings -> Model Provider to complete your own provider credentials.",
        ),
        (
            ModelCurrentlyNotSupportError(),
            400,
            "model_currently_not_support",
            "Dify Hosted OpenAI trial currently not support the GPT-4 model.",
        ),
        (InvokeError("Provider rejected input"), 400, "completion_request_error", "Provider rejected input"),
        (InvokeRateLimitError("Too many requests"), 429, "rate_limit_error", "Too many requests"),
        (ValueError("Invalid runtime arguments"), 400, "invalid_param", "Invalid runtime arguments"),
        (AccountNotFoundError(), 401, "unauthorized", "Account no longer exists."),
        (AppDefinitionUnavailableError("App removed"), 400, "not_workflow_app", "Only support workflow app."),
        (
            RuntimeError("Unexpected generation failure"),
            500,
            "internal_server_error",
            "The server encountered an internal error and was unable to complete your request. "
            "Either the server is overloaded or there is an error in the application.",
        ),
    ],
)
def test_workflow_run_preserves_error_contract_without_updating_usage(
    harness: _Harness, runtime: _Runtime, failure: Exception, status: int, code: str, message: str
) -> None:
    runtime.error = failure

    response = harness.app.test_client().post(_url(harness), json={"inputs": {}})

    _assert_json_response(response, status=status, body={"code": code, "message": message, "status": status})
    assert len(runtime.calls) == 1
    assert runtime.calls[0].streaming is True
    runtime.assert_usage_unchanged()
    if status == 401:
        assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'


@pytest.mark.parametrize(
    ("payload", "error"),
    [
        ({}, {"type": "missing", "loc": ["inputs"], "msg": "Field required"}),
        ({"inputs": None}, {"type": "dict_type", "loc": ["inputs"], "msg": "Input should be a valid dictionary"}),
        (
            {"inputs": {}, "files": {}},
            {"type": "list_type", "loc": ["files"], "msg": "Input should be a valid list"},
        ),
    ],
)
def test_workflow_run_validates_payload_before_mode(
    harness: _Harness,
    runtime: _Runtime,
    sqlite_session_factory: sessionmaker[Session],
    payload: dict[str, object],
    error: dict[str, object],
) -> None:
    _set_app_mode(harness, sqlite_session_factory, AppMode.CHAT)

    response = harness.app.test_client().post(_url(harness), json=payload)

    _assert_json_response(
        response,
        status=422,
        body={"code": "unprocessable_entity", "message": json.dumps([error]), "status": 422},
    )
    assert runtime.calls == []
    runtime.assert_usage_unchanged()


@pytest.mark.parametrize("action", ["run", "stop"])
@pytest.mark.parametrize("mode", [AppMode.COMPLETION, AppMode.CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT_CHAT])
def test_workflow_handlers_reject_other_modes_without_side_effects(
    harness: _Harness,
    runtime: _Runtime,
    stop_redis: _StopRedis,
    sqlite_session_factory: sessionmaker[Session],
    action: str,
    mode: AppMode,
) -> None:
    _set_app_mode(harness, sqlite_session_factory, mode)

    response = harness.app.test_client().post(_url(harness, action), json={"inputs": {}})

    _assert_json_response(
        response, status=400, body={"code": "not_workflow_app", "message": "Only support workflow app.", "status": 400}
    )
    assert runtime.calls == []
    assert stop_redis.operations == []
    assert stop_redis.reads == []
    runtime.assert_usage_unchanged()


@pytest.mark.parametrize("action", ["run", "stop"])
@pytest.mark.parametrize("rejection", ["permission", "tenant", "missing"])
def test_workflow_handlers_require_admission_before_payload_or_task_actions(
    harness: _Harness,
    runtime: _Runtime,
    stop_redis: _StopRedis,
    sqlite_session_factory: sessionmaker[Session],
    action: str,
    rejection: str,
) -> None:
    if rejection == "permission":
        harness.state.allowed = False
    elif rejection == "tenant":
        harness.account._current_tenant = Tenant(name="Other workspace")
    else:
        with sqlite_session_factory.begin() as session:
            installation = session.get(InstalledApp, harness.installed_app.id)
            assert installation is not None
            session.delete(installation)

    response = harness.app.test_client().post(_url(harness, action), json={})

    if rejection == "permission":
        _assert_json_response(
            response, status=403, body={"code": "access_denied", "message": "App access denied.", "status": 403}
        )
    else:
        _assert_json_response(
            response, status=404, body={"code": "not_found", "message": "Installed app not found", "status": 404}
        )
    assert runtime.calls == []
    assert stop_redis.operations == []
    assert stop_redis.reads == []


@pytest.mark.parametrize("action", ["run", "stop"])
def test_workflow_handlers_preserve_not_workflow_error_when_app_disappears_after_admission(
    harness: _Harness,
    runtime: _Runtime,
    stop_redis: _StopRedis,
    sqlite_session_factory: sessionmaker[Session],
    action: str,
) -> None:
    def remove_app() -> None:
        with sqlite_session_factory.begin() as session:
            app = session.get(App, harness.target_app.id)
            assert app is not None
            session.delete(app)

    harness.state.permission_action = remove_app

    response = harness.app.test_client().post(_url(harness, action), json={"inputs": {}})

    _assert_json_response(
        response, status=400, body={"code": "not_workflow_app", "message": "Only support workflow app.", "status": 400}
    )
    assert runtime.calls == []
    assert stop_redis.operations == []
    runtime.assert_usage_unchanged()


def test_workflow_stop_sets_both_signals_in_order_without_reading_task_ownership(
    harness: _Harness, runtime: _Runtime, stop_redis: _StopRedis
) -> None:
    response = harness.app.test_client().post(_url(harness, "stop"))

    _assert_json_response(response, status=200, body={"result": "success"})
    assert stop_redis.operations == ["legacy_flag", "graph_command"]
    assert stop_redis.reads == []
    assert stop_redis.values[_STOP_KEY] == b"1"
    assert stop_redis.expirations[_STOP_KEY] == 600
    assert set(stop_redis.commands) == {_COMMAND_KEY}
    assert [json.loads(command) for command in stop_redis.commands[_COMMAND_KEY]] == [
        {"command_type": "abort", "payload": None, "reason": "User requested stop"}
    ]
    assert stop_redis.expirations[_COMMAND_KEY] == 3600
    assert runtime.calls == []
    runtime.assert_usage_unchanged()


def test_workflow_stop_preserves_legacy_redis_failure_without_attempting_graph_command(
    harness: _Harness, runtime: _Runtime, stop_redis: _StopRedis
) -> None:
    failure = RedisConnectionError("Legacy Redis unavailable")
    stop_redis.flag_error = failure
    exceptions: list[Exception] = []

    def capture_exception(_sender: Flask, exception: Exception) -> None:
        exceptions.append(exception)

    with got_request_exception.connected_to(capture_exception):
        response = harness.app.test_client().post(_url(harness, "stop"))

    _assert_json_response(
        response, status=500, body={"code": "unknown", "message": "Internal Server Error", "status": 500}
    )
    assert any(exception is failure for exception in exceptions)
    assert stop_redis.operations == ["legacy_flag"]
    assert stop_redis.reads == []
    assert _STOP_KEY not in stop_redis.values
    assert stop_redis.commands == {}
    runtime.assert_usage_unchanged()


def test_workflow_stop_keeps_legacy_flag_and_success_when_graph_command_fails(
    harness: _Harness, runtime: _Runtime, stop_redis: _StopRedis, caplog: pytest.LogCaptureFixture
) -> None:
    failure = RedisConnectionError("Graph channel unavailable")
    stop_redis.command_error = failure

    response = harness.app.test_client().post(_url(harness, "stop"))

    _assert_json_response(response, status=200, body={"result": "success"})
    assert stop_redis.operations == ["legacy_flag", "graph_command"]
    assert stop_redis.reads == []
    assert stop_redis.values[_STOP_KEY] == b"1"
    assert any(record.exc_info is not None and record.exc_info[1] is failure for record in caplog.records)
    runtime.assert_usage_unchanged()
