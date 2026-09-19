"""Tests for the /openapi/v1 run routes: per-mode bodies and handlers, the deprecated :run, task stop."""

from __future__ import annotations

import json
import sys
import uuid
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import Flask
from pydantic import BaseModel, ValidationError
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import UnprocessableEntity

from controllers.openapi._models import (
    AdvancedChatRunPayload,
    AppRunRequest,
    ChatRunPayload,
    CompletionRunPayload,
    TaskStopResponse,
    WorkflowRunPayload,
)
from controllers.openapi.app_run import AdvancedChatRunApi, AppRunTaskStopApi, ChatRunApi, CompletionRunApi
from graphon.file import FileType
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
    """Not a declared field, and a body carrying it is accepted and ignored."""
    assert "response_mode" not in AppRunRequest.model_fields
    req = AppRunRequest.model_validate({"inputs": {}, "response_mode": "blocking"})
    assert not hasattr(req, "response_mode")


@pytest.mark.parametrize(
    ("model", "payload"),
    [
        pytest.param(ChatRunPayload, {"inputs": {}, "query": "   "}, id="chat.blank_query"),
        pytest.param(WorkflowRunPayload, {"inputs": {}, "query": "x"}, id="workflow.query_is_foreign"),
        pytest.param(CompletionRunPayload, {"inputs": {}, "conversation_id": "x"}, id="completion.conversation_id"),
    ],
)
def test_per_mode_payloads_reject_what_the_mode_does_not_take(model: type[BaseModel], payload: dict):
    with pytest.raises(ValidationError):
        model.model_validate(payload)


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


def _generate_stub(monkeypatch: pytest.MonkeyPatch, chunks: list[str]) -> Mock:
    generate_mock = Mock(return_value=iter(chunks))

    class GenerateService:
        generate = generate_mock

    monkeypatch.setattr(sys.modules["controllers.openapi.app_run"], "AppGenerateService", GenerateService)
    return generate_mock


def _ctx(mode: AppMode) -> _SealableContext:
    app_model = _make_app()
    app_model.mode = mode
    return _SealableContext(
        app=app_model,
        caller=_make_account(),
        session=Mock(),
        subject=SimpleNamespace(caller_role=CreatorUserRole.ACCOUNT),
    )


def test_run_reads_everything_off_the_context_before_streaming(app: Flask, monkeypatch: pytest.MonkeyPatch):
    generate_mock = _generate_stub(monkeypatch, ["event: a\n\n", "event: b\n\n"])
    ctx = _ctx(AppMode.ADVANCED_CHAT)
    api = AdvancedChatRunApi()
    body = AdvancedChatRunPayload(inputs={}, query="hi")
    with app.test_request_context(f"/openapi/v1/apps/{_TEST_APP_ID}/advanced-chat:run", method="POST"):
        response = api.post.__handler__(api, ctx, app_id=_TEST_APP_ID, body=body)
        ctx.seal()
        body = "".join(response.response)

    assert body == "event: a\n\nevent: b\n\n"
    assert generate_mock.call_args.kwargs["streaming"] is True


def test_per_mode_route_refuses_an_app_of_another_mode(app: Flask, monkeypatch: pytest.MonkeyPatch):
    generate_mock = _generate_stub(monkeypatch, [])
    api = ChatRunApi()
    body = ChatRunPayload(inputs={}, query="hi")
    with app.test_request_context(f"/openapi/v1/apps/{_TEST_APP_ID}/chat:run", method="POST"):
        with pytest.raises(UnprocessableEntity, match="app_mode_mismatch"):
            api.post.__handler__(api, _ctx(AppMode.WORKFLOW), app_id=_TEST_APP_ID, body=body)
    generate_mock.assert_not_called()


def test_run_hands_the_generator_file_mappings_for_inputs_and_attachments(app: Flask, monkeypatch: pytest.MonkeyPatch):
    generate_mock = _generate_stub(monkeypatch, [])
    upload_service = Mock()
    upload_service.upload_file.side_effect = lambda **kw: SimpleNamespace(
        id=f"uf-{kw['filename']}", extension=kw["filename"].rsplit(".", 1)[-1], mime_type=kw["mimetype"]
    )
    monkeypatch.setattr(
        sys.modules["controllers.openapi._files"], "application_services", lambda: SimpleNamespace(files=upload_service)
    )
    body = CompletionRunPayload(
        inputs={},
        files={"doc": FileStorage(stream=BytesIO(b"pdf"), filename="r.pdf", content_type="application/pdf")},
        attachments=[FileStorage(stream=BytesIO(b"jpg"), filename="p.jpg", content_type="image/jpeg")],
    )

    api = CompletionRunApi()
    with app.test_request_context(f"/openapi/v1/apps/{_TEST_APP_ID}/completion:run", method="POST"):
        api.post.__handler__(api, _ctx(AppMode.COMPLETION), app_id=_TEST_APP_ID, body=body)

    args = generate_mock.call_args.kwargs["args"]
    assert args["inputs"]["doc"] == {
        "transfer_method": "local_file",
        "upload_file_id": "uf-r.pdf",
        "type": FileType.DOCUMENT,
    }
    assert args["files"] == [{"transfer_method": "local_file", "upload_file_id": "uf-p.jpg", "type": FileType.IMAGE}]
    assert args["query"] == ""
    assert {"attachments", "auto_generate_name"}.isdisjoint(args)


def test_chat_route_hints_the_reply_on_message_end(app: Flask, monkeypatch: pytest.MonkeyPatch):
    message = 'data: {"event": "message", "answer": "hi"}\n\n'
    end = {"event": "message_end", "conversation_id": "c1", "message_id": "m1", "created_at": 1, "id": "m1"}
    end["task_id"] = "t1"
    _generate_stub(monkeypatch, [message, f"data: {json.dumps(end)}\n\n"])
    api = ChatRunApi()
    body = ChatRunPayload(inputs={}, query="hi")
    with app.test_request_context(f"/openapi/v1/apps/{_TEST_APP_ID}/chat:run", method="POST"):
        response = api.post.__handler__(api, _ctx(AppMode.CHAT), app_id=_TEST_APP_ID, body=body)
        chunks = list(response.response)
    assert chunks[0] == message
    assert json.loads(chunks[1][len("data: ") :])["hints"] == [
        {
            "summary": "Reply in this conversation",
            "op": "console_app.chat.run",
            "input": {"app_id": _TEST_APP_ID, "conversation_id": "c1", "query": None, "inputs": {}},
        }
    ]
