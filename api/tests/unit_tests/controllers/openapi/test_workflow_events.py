"""Tests for the OpenAPI workflow-events reconnect endpoint.

The controller constructs a repository session factory, so every case binds
that real SQLAlchemy factory to an isolated SQLite engine. Repository behavior
remains mocked because these tests focus on run ownership and SSE responses.

Handler-level tests start after `@endpoint` resolves the `Context`; the
allow/deny answers live in `test_auth_matrix.py`. The unsupported-mode regression
uses the admitted bearer fixture to check the final HTTP error response.
"""

from __future__ import annotations

import sys
from collections.abc import Iterator
from dataclasses import dataclass
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import Flask
from sqlalchemy.orm import Session

from controllers.common.errors import NotFoundError
from controllers.openapi.workflow_events import OpenApiWorkflowEventsApi, WorkflowEventsQuery
from core.db.session_factory import session_factory
from graphon.enums import WorkflowExecutionStatus
from models.account import Account
from models.enums import CreatorUserRole, EndUserType, WorkflowRunTriggeredFrom
from models.model import App, AppMode, EndUser
from models.workflow import WorkflowRun, WorkflowType
from tests.unit_tests.controllers.openapi.conftest import AdmittedWorld


@dataclass
class _ToolProvidersStub:
    pass


@dataclass
class _ToolsServiceStub:
    tool_providers: object


@dataclass
class _AppServicesStub:
    tools: _ToolsServiceStub


_RUN_ID = "11111111-1111-1111-1111-111111111111"


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.COMPLETION, AppMode.AGENT_CHAT])
def test_unsupported_mode_preserves_invalid_param_wire_error(
    admitted_bearer: AdmittedWorld, sqlite_session: Session, mode: AppMode
) -> None:
    """An admitted request for a non-workflow App returns the established 422 invalid_param body."""
    app_model = sqlite_session.get(App, admitted_bearer.app_id)
    assert app_model is not None
    app_model.mode = mode
    sqlite_session.commit()

    response = admitted_bearer.client.get(
        f"/openapi/v1/apps/{admitted_bearer.app_id}/runs/{_RUN_ID}/events",
        headers=admitted_bearer.headers,
    )

    assert response.status_code == 422
    assert response.get_json() == {
        "code": "invalid_param",
        "message": "mode_not_supported_for_event_reconnect",
        "status": 422,
    }


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
        monkeypatch.setattr(module, "WorkflowEventStream", msg_gen_mock)

    def test_not_found_when_run_missing(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        factory_mock = self._bind_repo(monkeypatch, None)

        api = OpenApiWorkflowEventsApi()
        with app.test_request_context(f"/openapi/v1/apps/app-1/runs/{_RUN_ID}/events"):
            with pytest.raises(NotFoundError):
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
            with pytest.raises(NotFoundError):
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
            with pytest.raises(NotFoundError):
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
        monkeypatch.setattr(module, "WorkflowEventStream", msg_gen_mock)
        snapshot_calls: list[dict[str, object]] = []

        def snapshot_builder(**kwargs: object) -> Iterator[str]:
            snapshot_calls.append(kwargs)
            return iter(["a", "b"])

        monkeypatch.setattr(module, "build_workflow_event_stream", snapshot_builder)
        tool_providers = _ToolProvidersStub()
        monkeypatch.setattr(
            module,
            "application_services",
            lambda: _AppServicesStub(tools=_ToolsServiceStub(tool_providers=tool_providers)),
        )

        ctx = _context(_make_account(), CreatorUserRole.ACCOUNT)
        api = OpenApiWorkflowEventsApi()
        query = WorkflowEventsQuery(include_state_snapshot=include_state_snapshot)
        with app.test_request_context(f"/openapi/v1/apps/app-1/runs/{_RUN_ID}/events"):
            resp = api.get.__handler__(api, ctx, app_id="app-1", run_id=_RUN_ID, query=query)
            ctx.seal()
            body = "".join(resp.response)

        assert resp.mimetype == "text/event-stream"
        assert body == "event: a\n\nevent: b\n\n"
        if include_state_snapshot:
            assert snapshot_calls[0]["tool_providers"] is tool_providers
        else:
            assert snapshot_calls == []

    @pytest.mark.parametrize("continue_on_pause", [False, True], ids=["close", "keep_open"])
    def test_continue_on_pause_comes_off_the_declared_query_model(
        self, app: Flask, monkeypatch: pytest.MonkeyPatch, continue_on_pause: bool
    ):
        module = sys.modules["controllers.openapi.workflow_events"]
        self._bind_repo(monkeypatch, _make_workflow_run(created_by_role=CreatorUserRole.ACCOUNT, created_by="acct-1"))
        msg_gen_mock = Mock()
        msg_gen_mock.retrieve_events.return_value = iter([])
        monkeypatch.setattr(module, "WorkflowEventStream", msg_gen_mock)

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
