from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import BadRequest

from controllers.service_api.app import completion as completion_module
from controllers.service_api.app import workflow as workflow_module
from core.helper.trace_id_helper import get_trace_session_id
from models.model import AppMode


class _Request:
    def __init__(self, *, headers=None, args=None, json=None, is_json=True):
        self.headers = headers or {}
        self.args = args or {}
        self.json = json
        self.is_json = is_json


def test_trace_session_id_header_query_body_priority_matches_service_api_contract():
    req = _Request(
        headers={"X-Trace-Session-Id": "header"},
        args={"trace_session_id": "query"},
        json={"trace_session_id": "body"},
    )

    assert get_trace_session_id(req) == "header"


def test_trace_session_id_invalid_highest_priority_raises_bad_request():
    req = _Request(
        headers={"X-Trace-Session-Id": "   "},
        args={"trace_session_id": "query"},
        json={"trace_session_id": "body"},
    )

    with pytest.raises(BadRequest):
        get_trace_session_id(req)


def _app(mode: AppMode) -> SimpleNamespace:
    return SimpleNamespace(id="app-1", mode=mode, tenant_id="tenant-1")


def _end_user() -> SimpleNamespace:
    return SimpleNamespace(id="user-1")


def _assert_generate_trace_session_id(mock_generate_service: MagicMock, expected: str) -> None:
    _, kwargs = mock_generate_service.generate.call_args
    assert kwargs["args"]["trace_session_id"] == expected


@patch("controllers.service_api.app.completion.AppGenerateService")
@patch("controllers.service_api.app.completion.service_api_ns")
def test_chat_api_rejects_invalid_highest_priority_query_trace_session_id_without_generating(
    mock_service_api_ns: MagicMock,
    mock_generate_service: MagicMock,
    app: Flask,
):
    payload = {"inputs": {}, "query": "hello", "trace_session_id": "body-session"}
    mock_service_api_ns.payload = payload

    with app.test_request_context(
        "/chat-messages?trace_session_id=%20%20%20",
        method="POST",
        json=payload,
    ):
        with pytest.raises(BadRequest):
            completion_module.ChatApi().post.__wrapped__(
                completion_module.ChatApi(),
                _app(AppMode.CHAT),
                _end_user(),
            )

    mock_generate_service.generate.assert_not_called()


@patch("controllers.service_api.app.workflow.AppGenerateService")
@patch("controllers.service_api.app.workflow.service_api_ns")
def test_workflow_run_api_rejects_invalid_highest_priority_body_trace_session_id_without_generating(
    mock_service_api_ns: MagicMock,
    mock_generate_service: MagicMock,
    app: Flask,
):
    payload = {"inputs": {}, "trace_session_id": 123}
    mock_service_api_ns.payload = payload

    with app.test_request_context("/workflows/run", method="POST", json=payload):
        with pytest.raises(BadRequest):
            workflow_module.WorkflowRunApi().post.__wrapped__(
                workflow_module.WorkflowRunApi(),
                _app(AppMode.WORKFLOW),
                _end_user(),
            )

    mock_generate_service.generate.assert_not_called()


@patch("controllers.service_api.app.completion.helper.compact_generate_response", return_value={"answer": "ok"})
@patch("controllers.service_api.app.completion.AppGenerateService")
@patch("controllers.service_api.app.completion.service_api_ns")
def test_completion_api_passes_header_trace_session_id_when_body_value_is_invalid_lower_priority(
    mock_service_api_ns: MagicMock,
    mock_generate_service: MagicMock,
    mock_compact: MagicMock,
    app: Flask,
):
    payload = {"inputs": {}, "trace_session_id": 123}
    mock_service_api_ns.payload = payload
    mock_generate_service.generate.return_value = "response"

    with app.test_request_context(
        "/completion-messages",
        method="POST",
        json=payload,
        headers={"X-Trace-Session-Id": " header-session "},
    ):
        response = completion_module.CompletionApi().post.__wrapped__(
            completion_module.CompletionApi(),
            _app(AppMode.COMPLETION),
            _end_user(),
        )

    assert response == {"answer": "ok"}
    _assert_generate_trace_session_id(mock_generate_service, "header-session")


@patch("controllers.service_api.app.completion.helper.compact_generate_response", return_value={"answer": "ok"})
@patch("controllers.service_api.app.completion.AppGenerateService")
@patch("controllers.service_api.app.completion.service_api_ns")
def test_chat_api_passes_query_trace_session_id_when_body_value_is_invalid_lower_priority(
    mock_service_api_ns: MagicMock,
    mock_generate_service: MagicMock,
    mock_compact: MagicMock,
    app: Flask,
):
    payload = {"inputs": {}, "query": "hello", "trace_session_id": 123}
    mock_service_api_ns.payload = payload
    mock_generate_service.generate.return_value = "response"

    with app.test_request_context(
        "/chat-messages?trace_session_id=query-session",
        method="POST",
        json=payload,
    ):
        response = completion_module.ChatApi().post.__wrapped__(
            completion_module.ChatApi(),
            _app(AppMode.CHAT),
            _end_user(),
        )

    assert response == {"answer": "ok"}
    _assert_generate_trace_session_id(mock_generate_service, "query-session")


@patch("controllers.service_api.app.workflow.helper.compact_generate_response", return_value={"result": "ok"})
@patch("controllers.service_api.app.workflow.AppGenerateService")
@patch("controllers.service_api.app.workflow.service_api_ns")
def test_workflow_run_api_passes_body_trace_session_id(
    mock_service_api_ns: MagicMock,
    mock_generate_service: MagicMock,
    mock_compact: MagicMock,
    app: Flask,
):
    payload = {"inputs": {}, "trace_session_id": " body-session "}
    mock_service_api_ns.payload = payload
    mock_generate_service.generate.return_value = "response"

    with app.test_request_context("/workflows/run", method="POST", json=payload):
        response = workflow_module.WorkflowRunApi().post.__wrapped__(
            workflow_module.WorkflowRunApi(),
            _app(AppMode.WORKFLOW),
            _end_user(),
        )

    assert response == {"result": "ok"}
    _assert_generate_trace_session_id(mock_generate_service, "body-session")
