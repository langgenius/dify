"""Tests: openapi /run always streams; response_mode removed from AppRunRequest."""

from __future__ import annotations

import sys
import uuid
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import Flask
from werkzeug.datastructures import FileStorage

from controllers.openapi._models import AppRunRequest, TaskStopResponse
from controllers.openapi.app_run import AppRunApi, AppRunTaskStopApi
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
    """The SSE body runs after the router's session is gone, and the generator
    is always asked to stream.
    """
    generate_mock = Mock(return_value=iter(["event: a\n\n", "event: b\n\n"]))

    class GenerateService:
        generate = generate_mock

    monkeypatch.setattr(sys.modules["controllers.openapi.app_run"], "AppGenerateService", GenerateService)
    monkeypatch.setattr(
        sys.modules["controllers.openapi._files"], "resolve_app_config", lambda _app, **_kwargs: ({}, [])
    )

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
    assert generate_mock.call_args.kwargs["streaming"] is True


def test_run_hands_the_generator_the_file_mapping_built_from_the_uploaded_part(
    app: Flask, monkeypatch: pytest.MonkeyPatch
):
    """The whole file wiring in one pass: a `files[doc]` part is uploaded, merged
    into `inputs` as a mapping the core file factory accepts, and a workflow app
    grows no vision `files` list.
    """
    generate_mock = Mock(return_value=iter([]))

    class GenerateService:
        generate = generate_mock

    monkeypatch.setattr(sys.modules["controllers.openapi.app_run"], "AppGenerateService", GenerateService)
    files_module = sys.modules["controllers.openapi._files"]
    monkeypatch.setattr(
        files_module, "resolve_app_config", lambda _app, **_kwargs: ({}, [{"file": {"variable": "doc"}}])
    )
    upload_service = Mock()
    upload_service.upload_file.side_effect = lambda **kw: SimpleNamespace(
        id="uf-1", extension="pdf", mime_type=kw["mimetype"]
    )
    monkeypatch.setattr(files_module, "application_services", lambda: SimpleNamespace(files=upload_service))

    workflow_app = _make_app()
    workflow_app.mode = AppMode.WORKFLOW
    ctx = _SealableContext(
        app=workflow_app,
        caller=_make_account(),
        session=Mock(),
        subject=SimpleNamespace(caller_role=CreatorUserRole.ACCOUNT),
    )
    body = AppRunRequest(
        inputs={},
        files={"doc": FileStorage(stream=BytesIO(b"pdf"), filename="r.pdf", content_type="application/pdf")},
    )

    api = AppRunApi()
    with app.test_request_context(f"/openapi/v1/apps/{_TEST_APP_ID}:run", method="POST"):
        api.post.__handler__(api, ctx, app_id=_TEST_APP_ID, body=body)

    args = generate_mock.call_args.kwargs["args"]
    assert args["inputs"]["doc"] == {
        "transfer_method": "local_file",
        "upload_file_id": "uf-1",
        "type": FileType.DOCUMENT,
    }
    assert "files" not in args
