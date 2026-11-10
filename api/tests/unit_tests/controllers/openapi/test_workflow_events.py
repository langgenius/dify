"""Tests for the OpenAPI workflow-events reconnect endpoint.

The controller constructs a repository session factory, so every case binds
that real SQLAlchemy factory to an isolated SQLite engine. Repository behavior
remains mocked because these tests focus on run ownership and SSE responses.

Auth is not exercised here: `@endpoint` resolves the `Context` before the handler
runs, and the allow/deny answers live in `test_auth_matrix.py`.
"""

from __future__ import annotations

import json
import sys
import uuid
from collections.abc import Iterator
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from constants.oauth_bearer import TokenType
from controllers.openapi.auth.subjects import AccountSubject
from controllers.openapi.human_input_form import FormVersion
from controllers.openapi.workflow_events import OpenApiWorkflowEventsApi, WorkflowEventsQuery
from core.app.entities.task_entities import HumanInputRequiredResponse
from core.db.session_factory import session_factory
from core.workflow.nodes.human_input import UserActionConfig
from graphon.enums import WorkflowExecutionStatus
from libs.oauth_bearer import AuthContext
from models.account import Account
from models.enums import CreatorUserRole, EndUserType, WorkflowRunTriggeredFrom
from models.human_input import RecipientType
from models.model import App, AppMode, EndUser
from models.workflow import WorkflowRun, WorkflowType
from tests.helpers.unit.services.human_input_v1_forms import persist_v1_form_token

_RUN_ID = "11111111-1111-1111-1111-111111111111"


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


def _context(caller: Account | EndUser, caller_role: CreatorUserRole) -> _SealableContext:
    return _SealableContext(
        app=_make_app(),
        caller=caller,
        subject=SimpleNamespace(caller_role=caller_role),
    )


def _make_workflow_run(
    *,
    app_id="app-1",
    tenant_id="tenant-1",
    created_by_role=CreatorUserRole.ACCOUNT,
    created_by="acct-1",
    finished_at=None,
) -> WorkflowRun:
    return WorkflowRun(
        id=_RUN_ID,
        app_id=app_id,
        tenant_id=tenant_id,
        workflow_id="workflow-1",
        type=WorkflowType.CHAT,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        graph="{}",
        inputs="{}",
        status=WorkflowExecutionStatus.SUCCEEDED,
        created_by_role=created_by_role,
        created_by=created_by,
        finished_at=finished_at,
    )


def _make_app() -> App:
    return App(
        id="app-1",
        tenant_id="tenant-1",
        name="Workflow events app",
        mode=AppMode.WORKFLOW,
        enable_site=True,
        enable_api=True,
    )


def _make_account() -> Account:
    account = Account(name="Workflow Events User", email="events@example.com")
    account.id = "acct-1"
    return account


def _make_end_user() -> EndUser:
    return EndUser(
        id="eu-1",
        tenant_id="tenant-1",
        app_id="app-1",
        type=EndUserType.OPENAPI,
        session_id="session-1",
    )


class _ReplayedEvents:
    """A `MessageGenerator` whose replay is a fixed list of stream events."""

    def __init__(self, events: list[dict[str, object]]) -> None:
        self._events = events

    def retrieve_events(self, *_args: object, **_kwargs: object) -> Iterator[dict[str, object]]:
        return iter(self._events)


def _account_subject() -> AccountSubject:
    return AccountSubject(
        AuthContext(
            token_type=TokenType.OAUTH_ACCOUNT,
            subject_email=None,
            subject_issuer=None,
            account_id=uuid.UUID("22222222-2222-2222-2222-222222222222"),
            client_id=None,
            token_id=uuid.uuid4(),
            expires_at=None,
        )
    )


def _paused(version: FormVersion, form_token: str) -> dict[str, object]:
    response = HumanInputRequiredResponse(
        task_id="t1",
        workflow_run_id=_RUN_ID,
        data=HumanInputRequiredResponse.Data(
            form_version=version.value,
            form_id=f"form-{form_token}",
            node_id="n1",
            node_title="Review",
            form_content="",
            actions=[UserActionConfig(id="approve", title="Approve")],
            form_token=form_token,
            expiration_time=4102444800,
        ),
    )
    return response.model_dump(mode="json")


class TestOpenApiWorkflowEventsApi:
    def _bind_repo(self, monkeypatch: pytest.MonkeyPatch, workflow_run: WorkflowRun | None) -> Mock:
        module = sys.modules["controllers.openapi.workflow_events"]
        repo_mock = Mock()
        repo_mock.get_workflow_run_by_id_and_tenant_id.return_value = workflow_run
        factory_mock = Mock()
        factory_mock.create_api_workflow_run_repository.return_value = repo_mock
        monkeypatch.setattr(module, "DifyAPIRepositoryFactory", factory_mock)
        return factory_mock

    def _bind_generators(self, monkeypatch: pytest.MonkeyPatch) -> None:
        module = sys.modules["controllers.openapi.workflow_events"]
        msg_gen_mock = Mock()
        msg_gen_mock.retrieve_events.return_value = iter([])
        monkeypatch.setattr(module, "MessageGenerator", lambda: msg_gen_mock)

    def test_not_found_when_run_missing(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        factory_mock = self._bind_repo(monkeypatch, None)

        api = OpenApiWorkflowEventsApi()
        with app.test_request_context(f"/openapi/v1/apps/app-1/runs/{_RUN_ID}/events"):
            with pytest.raises(NotFound):
                api.get.__handler__(
                    api,
                    _context(_make_account(), CreatorUserRole.ACCOUNT),
                    app_id="app-1",
                    run_id=_RUN_ID,
                    query=WorkflowEventsQuery(),
                )

        # The stream outlives the guard's session, so the repository gets the guard's
        # own maker rather than a fresh one bound straight to the engine.
        session_maker = factory_mock.create_api_workflow_run_repository.call_args.args[0]
        assert session_maker is session_factory.get_session_maker()

    def test_not_found_when_run_belongs_to_different_app(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        self._bind_repo(monkeypatch, _make_workflow_run(app_id="other-app"))

        api = OpenApiWorkflowEventsApi()
        with app.test_request_context(f"/openapi/v1/apps/app-1/runs/{_RUN_ID}/events"):
            with pytest.raises(NotFound):
                api.get.__handler__(
                    api,
                    _context(_make_account(), CreatorUserRole.ACCOUNT),
                    app_id="app-1",
                    run_id=_RUN_ID,
                    query=WorkflowEventsQuery(),
                )

    def test_account_caller_rejected_for_end_user_run(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        self._bind_repo(monkeypatch, _make_workflow_run(created_by_role=CreatorUserRole.END_USER, created_by="eu-1"))

        api = OpenApiWorkflowEventsApi()
        with app.test_request_context(f"/openapi/v1/apps/app-1/runs/{_RUN_ID}/events"):
            with pytest.raises(NotFound):
                api.get.__handler__(
                    api,
                    _context(_make_account(), CreatorUserRole.ACCOUNT),
                    app_id="app-1",
                    run_id=_RUN_ID,
                    query=WorkflowEventsQuery(),
                )

    def test_end_user_caller_checks_created_by_end_user(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        """End-user caller must match created_by == caller.id and role == END_USER."""
        self._bind_repo(monkeypatch, _make_workflow_run(created_by_role=CreatorUserRole.END_USER, created_by="eu-1"))
        self._bind_generators(monkeypatch)

        api = OpenApiWorkflowEventsApi()
        with app.test_request_context(f"/openapi/v1/apps/app-1/runs/{_RUN_ID}/events"):
            resp = api.get.__handler__(
                api,
                _context(_make_end_user(), CreatorUserRole.END_USER),
                app_id="app-1",
                run_id=_RUN_ID,
                query=WorkflowEventsQuery(),
            )
        assert resp.mimetype == "text/event-stream"

    def _bind_finished_run(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from datetime import UTC, datetime

        module = sys.modules["controllers.openapi.workflow_events"]
        self._bind_repo(
            monkeypatch,
            _make_workflow_run(
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by="acct-1",
                finished_at=datetime(2024, 1, 1, tzinfo=UTC),
            ),
        )

        finish_response = SimpleNamespace(
            event=SimpleNamespace(value="workflow_finished"),
            model_dump=lambda mode=None: {"task_id": "wf-run-1", "status": "succeeded"},
        )
        converter_mock = Mock()
        converter_mock.workflow_run_result_to_finish_response.return_value = finish_response
        monkeypatch.setattr(module, "WorkflowResponseConverter", converter_mock)

    def test_finished_run_reads_everything_off_the_context_before_streaming(
        self, app: Flask, monkeypatch: pytest.MonkeyPatch
    ):
        """A finished run answers a single done event without streaming. Its body
        is a real generator, so it runs entirely after the handler has returned
        and the router's session is gone.
        """
        self._bind_finished_run(monkeypatch)

        ctx = _context(_make_account(), CreatorUserRole.ACCOUNT)
        api = OpenApiWorkflowEventsApi()
        with app.test_request_context(f"/openapi/v1/apps/app-1/runs/{_RUN_ID}/events"):
            resp = api.get.__handler__(api, ctx, app_id="app-1", run_id=_RUN_ID, query=WorkflowEventsQuery())
            ctx.seal()
            body = "".join(resp.response)

        assert resp.mimetype == "text/event-stream"
        assert "workflow_finished" in body

    @pytest.mark.parametrize("include_state_snapshot", [False, True], ids=["events", "snapshot"])
    def test_stream_reads_everything_off_the_context_before_streaming(
        self, app: Flask, monkeypatch: pytest.MonkeyPatch, include_state_snapshot: bool
    ):
        """Both stream shapes must be fully resolved before the handler returns,
        and an account caller whose id and role match `created_by` is admitted.

        The snapshot branch is the one that used to read `app_model.tenant_id` and
        `app_model.id` from inside the generator, which the router's closed session
        can no longer answer.
        """
        module = sys.modules["controllers.openapi.workflow_events"]
        self._bind_repo(monkeypatch, _make_workflow_run(created_by_role=CreatorUserRole.ACCOUNT, created_by="acct-1"))

        msg_gen_mock = Mock()
        msg_gen_mock.retrieve_events.return_value = iter(["a", "b"])
        monkeypatch.setattr(module, "MessageGenerator", lambda: msg_gen_mock)
        monkeypatch.setattr(module, "build_workflow_event_stream", lambda **_kwargs: iter(["a", "b"]))

        ctx = _context(_make_account(), CreatorUserRole.ACCOUNT)
        api = OpenApiWorkflowEventsApi()
        query = WorkflowEventsQuery(include_state_snapshot=include_state_snapshot)
        with app.test_request_context(f"/openapi/v1/apps/app-1/runs/{_RUN_ID}/events"):
            resp = api.get.__handler__(api, ctx, app_id="app-1", run_id=_RUN_ID, query=query)
            ctx.seal()
            body = "".join(resp.response)

        assert resp.mimetype == "text/event-stream"
        assert body == "event: a\n\nevent: b\n\n"

    @pytest.mark.parametrize("continue_on_pause", [False, True], ids=["close", "keep_open"])
    def test_continue_on_pause_comes_off_the_declared_query_model(
        self, app: Flask, monkeypatch: pytest.MonkeyPatch, continue_on_pause: bool
    ):
        module = sys.modules["controllers.openapi.workflow_events"]
        self._bind_repo(monkeypatch, _make_workflow_run(created_by_role=CreatorUserRole.ACCOUNT, created_by="acct-1"))
        msg_gen_mock = Mock()
        msg_gen_mock.retrieve_events.return_value = iter([])
        monkeypatch.setattr(module, "MessageGenerator", lambda: msg_gen_mock)

        api = OpenApiWorkflowEventsApi()
        with app.test_request_context(f"/openapi/v1/apps/app-1/runs/{_RUN_ID}/events"):
            resp = api.get.__handler__(
                api,
                _context(_make_account(), CreatorUserRole.ACCOUNT),
                app_id="app-1",
                run_id=_RUN_ID,
                query=WorkflowEventsQuery(continue_on_pause=continue_on_pause),
            )
            "".join(resp.response)

        terminal_events = msg_gen_mock.retrieve_events.call_args.kwargs["terminal_events"]
        assert terminal_events == ([] if continue_on_pause else None)

    def test_a_replay_hints_only_the_tokens_the_submit_op_accepts(
        self, app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
    ) -> None:
        """Without a snapshot the replay carries each v1 form's console-preferred token, which the
        submit op refuses; a web app token and a v2 initiator token it accepts."""
        module = sys.modules["controllers.openapi.workflow_events"]
        self._bind_repo(monkeypatch, _make_workflow_run())
        console_token = persist_v1_form_token(sqlite_session, RecipientType.CONSOLE)
        web_app_token = persist_v1_form_token(sqlite_session, RecipientType.STANDALONE_WEB_APP)
        replay = _ReplayedEvents(
            [
                _paused(FormVersion.V1, console_token),
                _paused(FormVersion.V1, web_app_token),
                _paused(FormVersion.V2, "v2-initiator-token"),
            ]
        )
        monkeypatch.setattr(module, "MessageGenerator", lambda: replay)
        ctx = _SealableContext(app=_make_app(), caller=_make_account(), subject=_account_subject())

        api = OpenApiWorkflowEventsApi()
        with app.test_request_context(f"/openapi/v1/apps/app-1/runs/{_RUN_ID}/events"):
            resp = api.get.__handler__(api, ctx, app_id="app-1", run_id=_RUN_ID, query=WorkflowEventsQuery())
            ctx.seal()
            frames = [json.loads(chunk[len("data: ") :]) for chunk in resp.response]

        hinted = [hint["input"]["form_token"] for frame in frames for hint in frame.get("hints", [])]
        assert hinted == [web_app_token, "v2-initiator-token"]
