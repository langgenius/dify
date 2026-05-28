"""Tests: openapi /run always streams; response_mode removed from AppRunRequest."""

from __future__ import annotations

import sys
from types import SimpleNamespace
from unittest.mock import Mock

from controllers.openapi._models import AppRunRequest


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


def test_run_chat_always_calls_generate_with_streaming_true(app, bypass_pipeline, monkeypatch):
    """_run_chat must always invoke AppGenerateService.generate with streaming=True."""
    from controllers.openapi.app_run import _run_chat

    generate_mock = Mock(return_value=iter([]))
    monkeypatch.setattr(
        sys.modules["controllers.openapi.app_run"],
        "AppGenerateService",
        SimpleNamespace(generate=generate_mock),
    )
    with app.test_request_context("/openapi/v1/apps/app-1/run", method="POST"):
        _run_chat(
            SimpleNamespace(id="app-1", tenant_id="t-1"),
            SimpleNamespace(id="acct-1"),
            AppRunRequest(inputs={}, query="hello"),
        )
    _, kwargs = generate_mock.call_args
    assert kwargs["streaming"] is True


def test_stop_task_endpoint_registered(openapi_app):
    """POST /openapi/v1/apps/<id>/tasks/<task_id>/stop must be registered."""
    rules = {r.rule for r in openapi_app.url_map.iter_rules()}
    assert "/openapi/v1/apps/<string:app_id>/tasks/<string:task_id>/stop" in rules


def test_stop_task_calls_queue_manager_and_graph_engine(app, bypass_pipeline, monkeypatch):
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
        account_id=uuid.uuid4(),
        token_hash="test",
        scopes=frozenset({Scope.FULL}),
        app=SimpleNamespace(id="app-1", tenant_id="t-1"),
        caller=SimpleNamespace(id="acct-1"),
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
    assert result == {"result": "success"}
