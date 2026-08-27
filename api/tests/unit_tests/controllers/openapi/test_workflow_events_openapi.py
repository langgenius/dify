"""Tests for the OpenAPI workflow-events reconnect endpoint.

The controller constructs a repository session factory, so every case binds
that real SQLAlchemy factory to an isolated SQLite engine. Repository behavior
remains mocked because these tests focus on run ownership and SSE responses.

Auth is not exercised here: `@endpoint` resolves the `Context` before the handler
runs, and the allow/deny answers live in `test_auth_matrix.py`.
"""

from __future__ import annotations

import sys
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound

from controllers.openapi.auth.data import CallerKind
from controllers.openapi.workflow_events import OpenApiWorkflowEventsApi
from core.db.session_factory import session_factory
from graphon.enums import WorkflowExecutionStatus
from models.account import Account
from models.enums import CreatorUserRole, EndUserType, WorkflowRunTriggeredFrom
from models.model import App, AppMode, EndUser
from models.workflow import WorkflowRun, WorkflowType


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


def _context(caller: Account | EndUser, caller_kind: CallerKind) -> _SealableContext:
    return _SealableContext(
        app=_make_app(),
        caller=caller,
        subject=SimpleNamespace(caller_kind=caller_kind),
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
        id="wf-run-1",
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


def test_transaction_boundary_matches_the_pre_migration_decorator():
    """`stream` carried no `@with_session`: its repository opens sessions of its
    own, and a router commit would outlive the request anyway because the response
    body is still being generated. The allow/deny matrix cannot see this — it
    observes admission before the view body runs.
    """
    assert OpenApiWorkflowEventsApi.get.__spec__.write is False


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
        generator_mock = Mock()
        generator_mock.convert_to_event_stream.return_value = iter([])
        monkeypatch.setattr(module, "WorkflowAppGenerator", lambda: generator_mock)
        msg_gen_mock = Mock()
        msg_gen_mock.retrieve_events.return_value = iter([])
        monkeypatch.setattr(module, "MessageGenerator", lambda: msg_gen_mock)

    def test_not_found_when_run_missing(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        factory_mock = self._bind_repo(monkeypatch, None)

        api = OpenApiWorkflowEventsApi()
        with app.test_request_context("/openapi/v1/apps/app-1/tasks/wf-run-1/events"):
            with pytest.raises(NotFound):
                api.get.__handler__(
                    api,
                    _context(_make_account(), CallerKind.ACCOUNT),
                    app_id="app-1",
                    task_id="wf-run-1",
                )

        # The stream outlives the guard's session, so the repository gets the guard's
        # own maker rather than a fresh one bound straight to the engine.
        session_maker = factory_mock.create_api_workflow_run_repository.call_args.args[0]
        assert session_maker is session_factory.get_session_maker()

    def test_not_found_when_run_belongs_to_different_app(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        self._bind_repo(monkeypatch, _make_workflow_run(app_id="other-app"))

        api = OpenApiWorkflowEventsApi()
        with app.test_request_context("/openapi/v1/apps/app-1/tasks/wf-run-1/events"):
            with pytest.raises(NotFound):
                api.get.__handler__(
                    api,
                    _context(_make_account(), CallerKind.ACCOUNT),
                    app_id="app-1",
                    task_id="wf-run-1",
                )

    def test_account_caller_checks_created_by_account(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        """Account caller must match created_by == caller.id and role == ACCOUNT."""
        module = sys.modules["controllers.openapi.workflow_events"]
        self._bind_repo(monkeypatch, _make_workflow_run(created_by_role=CreatorUserRole.ACCOUNT, created_by="acct-1"))
        self._bind_generators(monkeypatch)
        monkeypatch.setattr(module, "build_workflow_event_stream", Mock(return_value=iter([])))

        api = OpenApiWorkflowEventsApi()
        with app.test_request_context("/openapi/v1/apps/app-1/tasks/wf-run-1/events"):
            # Should not raise NotFound for matching caller
            resp = api.get.__handler__(
                api,
                _context(_make_account(), CallerKind.ACCOUNT),
                app_id="app-1",
                task_id="wf-run-1",
            )
        assert resp.mimetype == "text/event-stream"

    def test_account_caller_rejected_for_end_user_run(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        self._bind_repo(monkeypatch, _make_workflow_run(created_by_role=CreatorUserRole.END_USER, created_by="eu-1"))

        api = OpenApiWorkflowEventsApi()
        with app.test_request_context("/openapi/v1/apps/app-1/tasks/wf-run-1/events"):
            with pytest.raises(NotFound):
                api.get.__handler__(
                    api,
                    _context(_make_account(), CallerKind.ACCOUNT),
                    app_id="app-1",
                    task_id="wf-run-1",
                )

    def test_end_user_caller_checks_created_by_end_user(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        """End-user caller must match created_by == caller.id and role == END_USER."""
        self._bind_repo(monkeypatch, _make_workflow_run(created_by_role=CreatorUserRole.END_USER, created_by="eu-1"))
        self._bind_generators(monkeypatch)

        api = OpenApiWorkflowEventsApi()
        with app.test_request_context("/openapi/v1/apps/app-1/tasks/wf-run-1/events"):
            resp = api.get.__handler__(
                api,
                _context(_make_end_user(), CallerKind.END_USER),
                app_id="app-1",
                task_id="wf-run-1",
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

    def test_finished_run_returns_single_sse_event(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        """A finished run returns a single done-event SSE response without streaming."""
        self._bind_finished_run(monkeypatch)

        api = OpenApiWorkflowEventsApi()
        with app.test_request_context("/openapi/v1/apps/app-1/tasks/wf-run-1/events"):
            resp = api.get.__handler__(
                api,
                _context(_make_account(), CallerKind.ACCOUNT),
                app_id="app-1",
                task_id="wf-run-1",
            )
        assert resp.mimetype == "text/event-stream"
        chunks = list(resp.response)
        data = b"".join(c if isinstance(c, bytes) else c.encode() for c in chunks).decode()
        assert "workflow_finished" in data

    def test_finished_run_reads_everything_off_the_context_before_streaming(
        self, app: Flask, monkeypatch: pytest.MonkeyPatch
    ):
        """The finished branch's body is a real generator, so it runs entirely after
        the handler has returned and the router's session is gone.
        """
        self._bind_finished_run(monkeypatch)

        ctx = _context(_make_account(), CallerKind.ACCOUNT)
        api = OpenApiWorkflowEventsApi()
        with app.test_request_context("/openapi/v1/apps/app-1/tasks/wf-run-1/events"):
            resp = api.get.__handler__(api, ctx, app_id="app-1", task_id="wf-run-1")
            ctx.seal()
            body = "".join(resp.response)

        assert "workflow_finished" in body

    @pytest.mark.parametrize("include_state_snapshot", [False, True], ids=["events", "snapshot"])
    def test_stream_reads_everything_off_the_context_before_streaming(
        self, app: Flask, monkeypatch: pytest.MonkeyPatch, include_state_snapshot: bool
    ):
        """Both stream shapes must be fully resolved before the handler returns.

        The snapshot branch is the one that used to read `app_model.tenant_id` and
        `app_model.id` from inside the generator, which the router's closed session
        can no longer answer.
        """
        module = sys.modules["controllers.openapi.workflow_events"]
        self._bind_repo(monkeypatch, _make_workflow_run(created_by_role=CreatorUserRole.ACCOUNT, created_by="acct-1"))

        generator_mock = Mock()
        generator_mock.convert_to_event_stream.return_value = iter(["event: a\n\n", "event: b\n\n"])
        monkeypatch.setattr(module, "WorkflowAppGenerator", lambda: generator_mock)
        msg_gen_mock = Mock()
        msg_gen_mock.retrieve_events.return_value = iter([])
        monkeypatch.setattr(module, "MessageGenerator", lambda: msg_gen_mock)
        monkeypatch.setattr(module, "build_workflow_event_stream", Mock(return_value=iter([])))

        ctx = _context(_make_account(), CallerKind.ACCOUNT)
        api = OpenApiWorkflowEventsApi()
        query = "?include_state_snapshot=true" if include_state_snapshot else ""
        with app.test_request_context(f"/openapi/v1/apps/app-1/tasks/wf-run-1/events{query}"):
            resp = api.get.__handler__(api, ctx, app_id="app-1", task_id="wf-run-1")
            ctx.seal()
            body = "".join(resp.response)

        assert body == "event: a\n\nevent: b\n\n"
