"""Unit tests for Service API workflow event stream endpoints."""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import Flask
from sqlalchemy.engine import Engine
from werkzeug.exceptions import NotFound

from controllers.service_api.app.error import NotWorkflowAppError
from controllers.service_api.app.workflow_events import WorkflowEventsApi
from graphon.enums import WorkflowExecutionStatus
from models.enums import CreatorUserRole, EndUserType, WorkflowRunTriggeredFrom
from models.model import App, AppMode, EndUser
from models.workflow import WorkflowRun, WorkflowType


def _app(*, mode: AppMode = AppMode.WORKFLOW) -> App:
    return App(
        id="app-1",
        tenant_id="tenant-1",
        name="Service API app",
        description="",
        mode=mode,
        enable_site=True,
        enable_api=True,
        max_active_requests=0,
    )


def _end_user() -> EndUser:
    return EndUser(
        id="end-user-1",
        tenant_id="tenant-1",
        app_id="app-1",
        type=EndUserType.SERVICE_API,
        external_user_id="external-user-1",
        name="Service API user",
        session_id="session-1",
    )


def _workflow_run(*, created_by_role: CreatorUserRole = CreatorUserRole.END_USER) -> WorkflowRun:
    return WorkflowRun(
        id="run-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        graph=None,
        inputs="{}",
        status=WorkflowExecutionStatus.RUNNING,
        outputs="{}",
        error=None,
        elapsed_time=0,
        total_tokens=0,
        total_steps=0,
        created_by_role=created_by_role,
        created_by="end-user-1" if created_by_role == CreatorUserRole.END_USER else "account-1",
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
    )


def _mock_repo_for_run(monkeypatch: pytest.MonkeyPatch, workflow_run, sqlite_engine: Engine):
    workflow_events_module = sys.modules["controllers.service_api.app.workflow_events"]
    repo = SimpleNamespace(get_workflow_run_by_id_and_tenant_id=lambda **_kwargs: workflow_run)
    monkeypatch.setattr(
        workflow_events_module.DifyAPIRepositoryFactory,
        "create_api_workflow_run_repository",
        lambda *_args, **_kwargs: repo,
    )
    monkeypatch.setattr(workflow_events_module, "db", SimpleNamespace(engine=sqlite_engine))
    return workflow_events_module


class TestWorkflowEventsApi:
    def test_wrong_app_mode(self, app: Flask) -> None:
        api = WorkflowEventsApi()
        handler = unwrap(api.get)
        app_model = _app(mode=AppMode.CHAT)
        end_user = _end_user()

        with app.test_request_context("/workflow/run-1/events?user=u1", method="GET"):
            with pytest.raises(NotWorkflowAppError):
                handler(api, app_model=app_model, end_user=end_user, workflow_run_id="run-1")

    def test_workflow_run_not_found(self, app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine) -> None:
        _mock_repo_for_run(monkeypatch, workflow_run=None, sqlite_engine=sqlite_engine)
        api = WorkflowEventsApi()
        handler = unwrap(api.get)
        app_model = _app()
        end_user = _end_user()

        with app.test_request_context("/workflow/run-1/events?user=u1", method="GET"):
            with pytest.raises(NotFound):
                handler(api, app_model=app_model, end_user=end_user, workflow_run_id="run-1")

    def test_workflow_run_permission_denied(
        self, app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
    ) -> None:
        workflow_run = _workflow_run(created_by_role=CreatorUserRole.ACCOUNT)
        _mock_repo_for_run(monkeypatch, workflow_run=workflow_run, sqlite_engine=sqlite_engine)
        api = WorkflowEventsApi()
        handler = unwrap(api.get)
        app_model = _app()
        end_user = _end_user()

        with app.test_request_context("/workflow/run-1/events?user=u1", method="GET"):
            with pytest.raises(NotFound):
                handler(api, app_model=app_model, end_user=end_user, workflow_run_id="run-1")

    def test_finished_run_returns_sse(self, app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine) -> None:
        workflow_run = _workflow_run()
        workflow_run.finished_at = datetime(2099, 1, 1, tzinfo=UTC)
        workflow_events_module = _mock_repo_for_run(monkeypatch, workflow_run=workflow_run, sqlite_engine=sqlite_engine)
        monkeypatch.setattr(
            workflow_events_module.WorkflowResponseConverter,
            "workflow_run_result_to_finish_response",
            lambda **_kwargs: SimpleNamespace(
                model_dump=lambda mode="json": {"task_id": "run-1", "status": "succeeded"},
                event=SimpleNamespace(value="workflow_finished"),
            ),
        )

        api = WorkflowEventsApi()
        handler = unwrap(api.get)
        app_model = _app()
        end_user = _end_user()

        with app.test_request_context("/workflow/run-1/events?user=u1", method="GET"):
            response = handler(api, app_model=app_model, end_user=end_user, workflow_run_id="run-1")

        assert response.mimetype == "text/event-stream"
        body = response.get_data(as_text=True).strip()
        assert body.startswith("data: ")
        payload = json.loads(body[len("data: ") :])
        assert payload["task_id"] == "run-1"
        assert payload["event"] == "workflow_finished"

    def test_running_run_streams_events(
        self, app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
    ) -> None:
        workflow_run = _workflow_run()
        workflow_events_module = _mock_repo_for_run(monkeypatch, workflow_run=workflow_run, sqlite_engine=sqlite_engine)
        msg_generator = Mock()
        msg_generator.retrieve_events.return_value = ["raw-event"]
        workflow_generator = Mock()
        workflow_generator.convert_to_event_stream.return_value = iter(["data: streamed\n\n"])
        monkeypatch.setattr(workflow_events_module, "MessageGenerator", lambda: msg_generator)
        monkeypatch.setattr(workflow_events_module, "WorkflowAppGenerator", lambda: workflow_generator)

        api = WorkflowEventsApi()
        handler = unwrap(api.get)
        app_model = _app()
        end_user = _end_user()

        with app.test_request_context("/workflow/run-1/events?user=u1", method="GET"):
            response = handler(api, app_model=app_model, end_user=end_user, workflow_run_id="run-1")

        assert response.get_data(as_text=True) == "data: streamed\n\n"
        msg_generator.retrieve_events.assert_called_once_with(
            AppMode.WORKFLOW,
            "run-1",
            terminal_events=None,
        )
        workflow_generator.convert_to_event_stream.assert_called_once_with(["raw-event"])

    def test_running_run_with_snapshot(
        self, app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
    ) -> None:
        workflow_run = _workflow_run()
        workflow_events_module = _mock_repo_for_run(monkeypatch, workflow_run=workflow_run, sqlite_engine=sqlite_engine)
        msg_generator = Mock()
        workflow_generator = Mock()
        workflow_generator.convert_to_event_stream.return_value = iter(["data: snapshot\n\n"])
        snapshot_builder = Mock(return_value=["snapshot-events"])
        monkeypatch.setattr(workflow_events_module, "MessageGenerator", lambda: msg_generator)
        monkeypatch.setattr(workflow_events_module, "WorkflowAppGenerator", lambda: workflow_generator)
        monkeypatch.setattr(workflow_events_module, "build_workflow_event_stream", snapshot_builder)

        api = WorkflowEventsApi()
        handler = unwrap(api.get)
        app_model = _app()
        end_user = _end_user()

        with app.test_request_context("/workflow/run-1/events?user=u1&include_state_snapshot=true", method="GET"):
            response = handler(api, app_model=app_model, end_user=end_user, workflow_run_id="run-1")

        assert response.get_data(as_text=True) == "data: snapshot\n\n"
        msg_generator.retrieve_events.assert_not_called()
        snapshot_builder.assert_called_once()
        workflow_generator.convert_to_event_stream.assert_called_once_with(["snapshot-events"])
