"""Tests: openapi /run always streams; response_mode removed from AppRunRequest."""

from __future__ import annotations

import sys
import uuid
from unittest.mock import Mock

import pytest
from flask import Flask

from controllers.openapi._models import AppRunRequest
from models import Account
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


def test_run_chat_always_calls_generate_with_streaming_true(
    app: Flask, bypass_pipeline, monkeypatch: pytest.MonkeyPatch
):
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
    with app.test_request_context(f"/openapi/v1/apps/{_TEST_APP_ID}/run", method="POST"):
        _run_chat(
            _make_app(),
            _make_account(),
            AppRunRequest(inputs={}, query="hello"),
        )
    _, kwargs = generate_mock.call_args
    assert kwargs["streaming"] is True


def test_stop_task_endpoint_registered(openapi_app):
    """POST /openapi/v1/apps/<id>/tasks/<task_id>/stop must be registered."""
    rules = {r.rule for r in openapi_app.url_map.iter_rules()}
    assert "/openapi/v1/apps/<string:app_id>/tasks/<string:task_id>/stop" in rules


def test_stop_task_calls_queue_manager_and_graph_engine(app: Flask, bypass_pipeline, monkeypatch: pytest.MonkeyPatch):
    import uuid

    from controllers.openapi.app_run import AppRunTaskStopApi
    from controllers.openapi.auth.data import AuthData
    from libs.oauth_bearer import Scope, TokenType

    queue_mock = Mock()
    graph_mock = Mock()
    graph_instance = Mock()
    graph_mock.return_value = graph_instance

    run_module = sys.modules["controllers.openapi.app_run"]
    monkeypatch.setattr(run_module, "AppQueueManager", queue_mock)
    monkeypatch.setattr(run_module, "GraphEngineManager", graph_mock)
    monkeypatch.setattr(run_module, "redis_client", object())

    auth_data = AuthData.model_construct(
        token_type=TokenType.OAUTH_ACCOUNT,
        account_id=uuid.UUID(_TEST_ACCOUNT_ID),
        token_hash="test",
        scopes=frozenset({Scope.FULL}),
        app=_make_app(),
        caller=_make_account(),
        caller_kind="account",
    )

    api = AppRunTaskStopApi()
    with app.test_request_context("/openapi/v1/apps/app-1/tasks/task-1/stop", method="POST"):
        result = api.post.__wrapped__(
            api,
            app_id="app-1",
            task_id="task-1",
            auth_data=auth_data,
        )

    queue_mock.set_stop_flag_no_user_check.assert_called_once_with("task-1")
    graph_instance.send_stop_command.assert_called_once_with("task-1")
    assert result == ({"result": "success"}, 200)
