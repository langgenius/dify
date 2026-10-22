"""Tests for the /openapi/v1 run routes: per-mode bodies and handlers, task stop."""

from __future__ import annotations

import json
import sys
import uuid
from dataclasses import replace
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import Flask
from pydantic import BaseModel, ValidationError
from sqlalchemy import event
from sqlalchemy.orm import Session
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import NotFound

from constants.oauth_bearer import TokenType
from controllers.openapi import app_run
from controllers.openapi._errors import AppModeMismatch, RunNotFound, RunNotStoppable
from controllers.openapi._models import (
    AdvancedChatRunPayload,
    ChatRunPayload,
    CompletionRunPayload,
    TaskStopResponse,
    WorkflowRunPayload,
)
from controllers.openapi.app_run import AdvancedChatRunApi, AppRunStopApi, AppTaskStopApi, ChatRunApi, CompletionRunApi
from controllers.openapi.auth.subjects import Subject, subject_from_auth
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_application_services import ApplicationServices
from graphon.enums import WorkflowExecutionStatus, WorkflowType
from graphon.file import FileType
from libs.oauth_bearer import AuthContext
from models import Account
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.model import App, AppMode, EndUser, UploadFile
from models.workflow import WorkflowRun
from services.app_task_service import AppTaskControlService
from tests.unit_tests.model_factories import make_upload_file
from tests.unit_tests.services.test_app_task_service import _StopRedis

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


def _subject(token_type: TokenType = TokenType.OAUTH_ACCOUNT) -> Subject:
    return subject_from_auth(
        AuthContext(
            token_type=token_type,
            subject_email="sso@example.com" if token_type == TokenType.OAUTH_EXTERNAL_SSO else None,
            subject_issuer=None,
            account_id=uuid.UUID(_TEST_ACCOUNT_ID) if token_type == TokenType.OAUTH_ACCOUNT else None,
            client_id=None,
            token_id=uuid.uuid4(),
            expires_at=None,
        )
    )


@pytest.mark.parametrize(
    ("model", "payload"),
    [
        pytest.param(ChatRunPayload, {"inputs": {}, "query": "   "}, id="chat.blank_query"),
        pytest.param(WorkflowRunPayload, {"inputs": {}, "query": "x"}, id="workflow.query_is_foreign"),
        pytest.param(CompletionRunPayload, {"inputs": {}, "conversation_id": "x"}, id="completion.conversation_id"),
        pytest.param(ChatRunPayload, {"inputs": {}, "query": "hi", "response_mode": "blocking"}, id="chat.foreign"),
        pytest.param(ChatRunPayload, {"inputs": {}, "query": "hi", "conversation_id": "not-a-uuid"}, id="chat.bad_cid"),
    ],
)
def test_per_mode_payloads_reject_what_the_mode_does_not_take(model: type[BaseModel], payload: dict):
    with pytest.raises(ValidationError):
        model.model_validate(payload)


def test_chat_payload_normalizes_conversation_id():
    assert ChatRunPayload(inputs={}, query="hi", conversation_id="   ").conversation_id is None
    cid = str(uuid.uuid4())
    assert ChatRunPayload(inputs={}, query="hi", conversation_id=cid).conversation_id == cid


def _stop_services(
    monkeypatch: pytest.MonkeyPatch,
    account_application_services: ApplicationServices,
    sqlite_session: Session,
    redis: _StopRedis,
) -> None:
    import services.app_task_service as task_module

    monkeypatch.setattr(type(task_module.db), "engine", property(lambda _: sqlite_session.get_bind()))
    monkeypatch.setattr(
        sys.modules["controllers.openapi.app_run"],
        "application_services",
        lambda: replace(account_application_services, app_tasks=AppTaskControlService(redis_client=redis)),
    )


def _stop_run(
    sqlite_session: Session, mode: AppMode, *, task_id: str, status: WorkflowExecutionStatus, owner_id: str = "user-1"
) -> WorkflowRun:
    run = WorkflowRun(
        id=str(uuid.uuid4()),
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        task_id=task_id,
        type=WorkflowType.CHAT if mode == AppMode.ADVANCED_CHAT else WorkflowType.WORKFLOW,
        version="1",
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        status=status,
        created_by_role=CreatorUserRole.END_USER,
        created_by=owner_id,
    )
    sqlite_session.add(run)
    sqlite_session.commit()
    return run


@pytest.mark.parametrize("mode", [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
def test_stop_run_answers_by_outcome(
    app: Flask,
    account_application_services: ApplicationServices,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    mode: AppMode,
):
    task_id = str(uuid.uuid4())
    running = _stop_run(sqlite_session, mode, task_id=task_id, status=WorkflowExecutionStatus.RUNNING)
    finished = _stop_run(sqlite_session, mode, task_id=str(uuid.uuid4()), status=WorkflowExecutionStatus.SUCCEEDED)
    redis = _StopRedis()
    _stop_services(monkeypatch, account_application_services, sqlite_session, redis)
    ctx = _SealableContext(
        subject=_subject(), caller=_make_account(), app=App(id="app-1", tenant_id="tenant-1", mode=mode)
    )
    api = AppRunStopApi()
    with app.test_request_context("/openapi/v1/apps/app-1/runs/x:stop", method="POST"):
        with pytest.raises(RunNotFound):
            api.post.__handler__(api, ctx, app_id="app-1", run_id=str(uuid.uuid4()))
        with pytest.raises(RunNotStoppable):
            api.post.__handler__(api, ctx, app_id="app-1", run_id=finished.id)
        assert redis.operations == []
        assert api.post.__handler__(api, ctx, app_id="app-1", run_id=running.id) == TaskStopResponse(result="success")
    assert redis.values[f"generate_task_stopped:{task_id}"] == b"1"


def test_stop_run_rejects_a_non_uuid_run_id(
    app: Flask,
    account_application_services: ApplicationServices,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
):
    redis = _StopRedis()
    _stop_services(monkeypatch, account_application_services, sqlite_session, redis)
    ctx = _SealableContext(
        subject=_subject(),
        caller=_make_account(),
        app=App(id="app-1", tenant_id="tenant-1", mode=AppMode.WORKFLOW),
    )
    api = AppRunStopApi()
    with app.test_request_context("/openapi/v1/apps/app-1/runs/abc:stop", method="POST"):
        with pytest.raises(RunNotFound):
            api.post.__handler__(api, ctx, app_id="app-1", run_id="abc")
    assert redis.operations == []


@pytest.mark.parametrize(
    "token_type", [TokenType.OAUTH_ACCOUNT, TokenType.OAUTH_EXTERNAL_SSO, TokenType.RESOURCE_ACCESS]
)
@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.COMPLETION])
@pytest.mark.parametrize("owns_task", [False, True])
def test_stop_task_enforces_resolved_caller_ownership(
    app: Flask,
    account_application_services: ApplicationServices,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    token_type: TokenType,
    mode: AppMode,
    owns_task: bool,
):
    subject = _subject(token_type)
    caller = _make_account() if subject.caller_role == CreatorUserRole.ACCOUNT else EndUser(id="user-1")
    owner_id = caller.id if owns_task else "another-user"
    task_id = str(uuid.uuid4())
    redis = _StopRedis(values={f"generate_task_belong:{task_id}": f"end-user-{owner_id}".encode()})
    _stop_services(monkeypatch, account_application_services, sqlite_session, redis)
    ctx = _SealableContext(
        subject=subject,
        caller=caller,
        app=App(id="app-1", tenant_id="tenant-1", mode=mode),
    )
    api = AppTaskStopApi()
    allowed = owns_task or subject.caller_role == CreatorUserRole.ACCOUNT
    with app.test_request_context(f"/openapi/v1/apps/app-1/tasks/{task_id}:stop", method="POST"):
        if allowed:
            assert api.post.__handler__(api, ctx, app_id="app-1", task_id=task_id) == TaskStopResponse(result="success")
        else:
            with pytest.raises(NotFound, match="Task not found"):
                api.post.__handler__(api, ctx, app_id="app-1", task_id=task_id)
    if allowed:
        assert redis.values[f"generate_task_stopped:{task_id}"] == b"1"
    else:
        assert redis.operations == []
    assert redis.commands == {}


@pytest.mark.parametrize(
    ("resource", "mode", "kwargs"),
    [
        (AppRunStopApi, AppMode.CHAT, {"run_id": str(uuid.uuid4())}),
        (AppRunStopApi, AppMode.COMPLETION, {"run_id": str(uuid.uuid4())}),
        (AppTaskStopApi, AppMode.WORKFLOW, {"task_id": str(uuid.uuid4())}),
        (AppTaskStopApi, AppMode.ADVANCED_CHAT, {"task_id": str(uuid.uuid4())}),
    ],
)
def test_stop_routes_refuse_the_other_id_kind(app: Flask, resource: type, mode: AppMode, kwargs: dict[str, str]):
    ctx = _SealableContext(
        subject=_subject(), caller=_make_account(), app=App(id="app-1", tenant_id="tenant-1", mode=mode)
    )
    api = resource()
    with app.test_request_context("/openapi/v1/apps/app-1/stop", method="POST"):
        with pytest.raises(AppModeMismatch):
            api.post.__handler__(api, ctx, app_id="app-1", **kwargs)


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


def _ctx(mode: AppMode, session: Session | Mock | None = None) -> _SealableContext:
    app_model = _make_app()
    app_model.mode = mode
    return _SealableContext(
        app=app_model,
        caller=_make_account(),
        session=session or Session(),
        subject=_subject(),
    )


def test_run_reads_everything_off_the_context_before_streaming(app: Flask, monkeypatch: pytest.MonkeyPatch):
    generate_mock = _generate_stub(monkeypatch, ["event: a\n\n", "event: b\n\n"])
    session = Mock()
    ctx = _ctx(AppMode.ADVANCED_CHAT, session)
    api = AdvancedChatRunApi()
    body = AdvancedChatRunPayload(inputs={}, query="hi")
    with app.test_request_context(f"/openapi/v1/apps/{_TEST_APP_ID}/advanced-chat:run", method="POST"):
        response = api.post.__handler__(api, ctx, app_id=_TEST_APP_ID, body=body)
        ctx.seal()
        body = "".join(response.response)

    assert body == "event: a\n\nevent: b\n\n"
    assert generate_mock.call_args.kwargs["streaming"] is True
    session.commit.assert_not_called()


def test_per_mode_route_refuses_an_app_of_another_mode(app: Flask, monkeypatch: pytest.MonkeyPatch):
    generate_mock = _generate_stub(monkeypatch, [])
    api = ChatRunApi()
    body = ChatRunPayload(inputs={}, query="hi")
    with app.test_request_context(f"/openapi/v1/apps/{_TEST_APP_ID}/chat:run", method="POST"):
        with pytest.raises(AppModeMismatch):
            api.post.__handler__(api, _ctx(AppMode.WORKFLOW), app_id=_TEST_APP_ID, body=body)
    generate_mock.assert_not_called()


def test_run_hands_the_generator_file_mappings_for_inputs_and_attachments(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    generate_mock = _generate_stub(monkeypatch, [])
    upload_service = Mock()
    operations: list[str] = []
    sqlite_session.begin()
    event.listen(sqlite_session, "after_commit", lambda _session: operations.append("commit"))

    def upload_file(*, filename: str, content: bytes, mimetype: str, user: Account) -> UploadFile:
        assert not sqlite_session.in_transaction()
        operations.append("upload")
        return make_upload_file(
            file_id=f"uf-{filename}",
            extension=filename.rsplit(".", 1)[-1],
            mime_type=mimetype,
        )

    upload_service.upload_file.side_effect = upload_file
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
        api.post.__handler__(api, _ctx(AppMode.COMPLETION, sqlite_session), app_id=_TEST_APP_ID, body=body)

    # The read transaction ends before the first object-storage write (api/AGENTS.md).
    assert operations == ["commit", "upload", "upload"]
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
            "op": "run.console_app.chat",
            "input": {"app_id": _TEST_APP_ID, "conversation_id": "c1", "query": None, "inputs": {}},
        }
    ]


def test_chat_route_passes_a_message_end_without_conversation_through(app: Flask, monkeypatch: pytest.MonkeyPatch):
    end = 'data: {"event": "message_end", "message_id": "m1", "created_at": 1, "id": "m1", "task_id": "t1"}\n\n'
    _generate_stub(monkeypatch, [end])
    api = ChatRunApi()
    body = ChatRunPayload(inputs={}, query="hi")
    with app.test_request_context(f"/openapi/v1/apps/{_TEST_APP_ID}/chat:run", method="POST"):
        response = api.post.__handler__(api, _ctx(AppMode.CHAT), app_id=_TEST_APP_ID, body=body)
        assert list(response.response) == [end]


def test_draft_runs_do_not_hint_the_form_submit_op() -> None:
    """A draft run's human-input form is a debugger form; the submit op only takes web-app
    forms, so hinting it would send the agent straight into a 403."""
    draft_routes = [route for route in app_run._RUN_ROUTES if route.invoke_from == InvokeFrom.DEBUGGER]
    assert draft_routes
    for route in draft_routes:
        assert app_run._form_layer not in route.hints
        assert "cannot be resumed over openapi" in route.summary
