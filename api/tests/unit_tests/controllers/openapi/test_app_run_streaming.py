"""Tests: openapi /run always streams; response_mode removed from AppRunRequest."""

from __future__ import annotations

import sys
import uuid
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import Flask

from controllers.openapi._models import AppRunRequest, TaskStopResponse
from controllers.openapi.app_run import AppRunApi, AppRunTaskStopApi
from models import Account
from models.enums import CreatorUserRole
from models.model import App, AppMode

_TEST_APP_ID = str(uuid.uuid4())
_TEST_TENANT_ID = str(uuid.uuid4())
_TEST_ACCOUNT_ID = str(uuid.uuid4())


def _make_app() -> App:
    app = App()
    app.id = _TEST_APP_ID
    app.tenant_id = _TEST_TENANT_ID
    app.name = "Streaming app"
    app.mode = AppMode.CHAT
    app.enable_site = False
    app.enable_api = True
    return app


def _make_account() -> Account:
    account = Account(name="OpenAPI caller", email="caller@example.com")
    account.id = _TEST_ACCOUNT_ID
    return account


def test_app_run_request_has_no_response_mode_field():
    """response_mode must not be a declared field."""
    assert "response_mode" not in AppRunRequest.model_fields


def test_app_run_request_ignores_response_mode_in_payload():
    """Sending response_mode in JSON body is silently ignored (Pydantic extra='ignore')."""
    req = AppRunRequest.model_validate({"inputs": {}, "response_mode": "blocking"})
    assert not hasattr(req, "response_mode")


def test_app_run_request_valid_minimal():
    req = AppRunRequest.model_validate({"inputs": {}})
    assert req.inputs == {}


def test_app_run_request_with_query():
    req = AppRunRequest.model_validate({"inputs": {}, "query": "hello"})
    assert req.query == "hello"


@pytest.mark.parametrize(
    ("view", "write"),
    [(AppRunApi.post, True), (AppRunTaskStopApi.post, False)],
    ids=["run", "stop"],
)
def test_transaction_boundary_matches_the_pre_migration_decorator(view, write: bool):
    """`run` carried a bare `@with_session` (its own default) and commits the
    request's session; `stop` carried none at all and must not. The allow/deny
    matrix cannot see this — it observes admission before the view body runs.
    """
    assert view.__spec__.write is write


def test_run_chat_always_calls_generate_with_streaming_true(app: Flask, monkeypatch: pytest.MonkeyPatch):
    """_run_chat must always invoke AppGenerateService.generate with streaming=True."""
    from controllers.openapi.app_run import _run_chat

    generate_mock = Mock(return_value=iter([]))

    class GenerateService:
        generate = generate_mock

    monkeypatch.setattr(
        sys.modules["controllers.openapi.app_run"],
        "AppGenerateService",
        GenerateService,
    )
    with app.test_request_context(f"/openapi/v1/apps/{_TEST_APP_ID}:run", method="POST"):
        _run_chat(
            _make_app(),
            _make_account(),
            AppRunRequest(inputs={}, query="hello"),
            Mock(),
        )
    _, kwargs = generate_mock.call_args
    assert kwargs["streaming"] is True


def test_stop_task_endpoint_registered(openapi_app):
    """POST /openapi/v1/apps/<id>/tasks/<task_id>:stop must be registered."""
    rules = {r.rule for r in openapi_app.url_map.iter_rules()}
    assert "/openapi/v1/apps/<string:app_id>/tasks/<string:task_id>:stop" in rules


def test_stop_task_calls_queue_manager_and_graph_engine(app: Flask, monkeypatch: pytest.MonkeyPatch):
    queue_mock = Mock()
    graph_mock = Mock()
    graph_instance = Mock()
    graph_mock.return_value = graph_instance

    run_module = sys.modules["controllers.openapi.app_run"]
    monkeypatch.setattr(run_module, "AppQueueManager", queue_mock)
    monkeypatch.setattr(run_module, "GraphEngineManager", graph_mock)
    monkeypatch.setattr(run_module, "redis_client", object())

    api = AppRunTaskStopApi()
    with app.test_request_context("/openapi/v1/apps/app-1/tasks/task-1:stop", method="POST"):
        result = api.post.__handler__(api, _SealableContext(), app_id="app-1", task_id="task-1")

    queue_mock.set_stop_flag_no_user_check.assert_called_once_with("task-1")
    graph_instance.send_stop_command.assert_called_once_with("task-1")
    assert result == TaskStopResponse(result="success")


class _SealableContext:
    """A `Context` stand-in that refuses reads once `seal()` is called.

    The router's session closes when the handler returns, so anything the SSE
    body still needs off `ctx` would be read through a closed session.
    """

    def __init__(self, **values: object) -> None:
        self._values = values
        self._sealed = False

    def seal(self) -> None:
        self._sealed = True

    def __getattr__(self, name: str) -> object:
        if self._sealed:
            raise AssertionError(f"ctx.{name} was read after the handler returned")
        return self._values[name]


def test_run_reads_everything_off_the_context_before_streaming(app: Flask, monkeypatch: pytest.MonkeyPatch):
    generate_mock = Mock(return_value=iter(["event: a\n\n", "event: b\n\n"]))

    class GenerateService:
        generate = generate_mock

    monkeypatch.setattr(sys.modules["controllers.openapi.app_run"], "AppGenerateService", GenerateService)

    ctx = _SealableContext(
        app=_make_app(),
        caller=_make_account(),
        session=Mock(),
        subject=SimpleNamespace(caller_role=CreatorUserRole.ACCOUNT),
    )

    api = AppRunApi()
    with app.test_request_context(f"/openapi/v1/apps/{_TEST_APP_ID}:run", method="POST"):
        response = api.post.__handler__(api, ctx, app_id=_TEST_APP_ID, body=AppRunRequest(inputs={}, query="hello"))
        ctx.seal()
        body = "".join(response.response)

    assert body == "event: a\n\nevent: b\n\n"
