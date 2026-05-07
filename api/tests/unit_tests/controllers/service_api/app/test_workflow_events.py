"""Unit tests for Service API workflow event stream endpoints."""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound

from controllers.service_api.app.error import NotWorkflowAppError
from controllers.service_api.app.workflow_events import WorkflowEventsApi
from models.enums import CreatorUserRole
from models.model import AppMode
from tests.unit_tests.controllers.service_api.conftest import _unwrap


def _mock_repo_for_run(monkeypatch: pytest.MonkeyPatch, workflow_run):
    workflow_events_module = sys.modules["controllers.service_api.app.workflow_events"]
    repo = SimpleNamespace(get_workflow_run_by_id_and_tenant_id=lambda **_kwargs: workflow_run)
    monkeypatch.setattr(
        workflow_events_module.DifyAPIRepositoryFactory,
        "create_api_workflow_run_repository",
        lambda *_args, **_kwargs: repo,
    )
    monkeypatch.setattr(workflow_events_module, "db", SimpleNamespace(engine=object()))
    return workflow_events_module


class TestWorkflowEventsApi:
    def test_wrong_app_mode(self, app) -> None:
        api = WorkflowEventsApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace(mode=AppMode.CHAT.value)
        end_user = SimpleNamespace(id="end-user-1")

        with app.test_request_context("/workflow/run-1/events?user=u1", method="GET"):
            with pytest.raises(NotWorkflowAppError):
                handler(api, app_model=app_model, end_user=end_user, task_id="run-1")

    def test_workflow_run_not_found(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        _mock_repo_for_run(monkeypatch, workflow_run=None)
        api = WorkflowEventsApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", mode=AppMode.WORKFLOW.value)
        end_user = SimpleNamespace(id="end-user-1")

        with app.test_request_context("/workflow/run-1/events?user=u1", method="GET"):
            with pytest.raises(NotFound):
                handler(api, app_model=app_model, end_user=end_user, task_id="run-1")

    def test_workflow_run_permission_denied(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        workflow_run = SimpleNamespace(
            id="run-1",
            app_id="app-1",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="another-user",
            finished_at=None,
        )
        _mock_repo_for_run(monkeypatch, workflow_run=workflow_run)
        api = WorkflowEventsApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", mode=AppMode.WORKFLOW.value)
        end_user = SimpleNamespace(id="end-user-1")

        with app.test_request_context("/workflow/run-1/events?user=u1", method="GET"):
            with pytest.raises(NotFound):
                handler(api, app_model=app_model, end_user=end_user, task_id="run-1")

    def test_finished_run_returns_sse(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        workflow_run = SimpleNamespace(
            id="run-1",
            app_id="app-1",
            created_by_role=CreatorUserRole.END_USER,
            created_by="end-user-1",
            finished_at=datetime(2099, 1, 1, tzinfo=UTC),
        )
        workflow_events_module = _mock_repo_for_run(monkeypatch, workflow_run=workflow_run)
        monkeypatch.setattr(
            workflow_events_module.WorkflowResponseConverter,
            "workflow_run_result_to_finish_response",
            lambda **_kwargs: SimpleNamespace(
                model_dump=lambda mode="json": {"task_id": "run-1", "status": "succeeded"},
                event=SimpleNamespace(value="workflow_finished"),
            ),
        )

        api = WorkflowEventsApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", mode=AppMode.WORKFLOW.value)
        end_user = SimpleNamespace(id="end-user-1")

        with app.test_request_context("/workflow/run-1/events?user=u1", method="GET"):
            response = handler(api, app_model=app_model, end_user=end_user, task_id="run-1")

        assert response.mimetype == "text/event-stream"
        body = response.get_data(as_text=True).strip()
        assert body.startswith("data: ")
        payload = json.loads(body[len("data: ") :])
        assert payload["task_id"] == "run-1"
        assert payload["event"] == "workflow_finished"

    def test_running_run_streams_events(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        workflow_run = SimpleNamespace(
            id="run-1",
            app_id="app-1",
            created_by_role=CreatorUserRole.END_USER,
            created_by="end-user-1",
            finished_at=None,
        )
        workflow_events_module = _mock_repo_for_run(monkeypatch, workflow_run=workflow_run)
        msg_generator = Mock()
        msg_generator.retrieve_events.return_value = ["raw-event"]
        workflow_generator = Mock()
        workflow_generator.convert_to_event_stream.return_value = iter(["data: streamed\n\n"])
        monkeypatch.setattr(workflow_events_module, "MessageGenerator", lambda: msg_generator)
        monkeypatch.setattr(workflow_events_module, "WorkflowAppGenerator", lambda: workflow_generator)

        api = WorkflowEventsApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", mode=AppMode.WORKFLOW.value)
        end_user = SimpleNamespace(id="end-user-1")

        with app.test_request_context("/workflow/run-1/events?user=u1", method="GET"):
            response = handler(api, app_model=app_model, end_user=end_user, task_id="run-1")

        assert response.get_data(as_text=True) == "data: streamed\n\n"
        msg_generator.retrieve_events.assert_called_once_with(
            AppMode.WORKFLOW,
            "run-1",
            terminal_events=None,
        )
        workflow_generator.convert_to_event_stream.assert_called_once_with(["raw-event"])

    def test_running_run_with_snapshot(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        workflow_run = SimpleNamespace(
            id="run-1",
            app_id="app-1",
            created_by_role=CreatorUserRole.END_USER,
            created_by="end-user-1",
            finished_at=None,
        )
        workflow_events_module = _mock_repo_for_run(monkeypatch, workflow_run=workflow_run)
        msg_generator = Mock()
        workflow_generator = Mock()
        workflow_generator.convert_to_event_stream.return_value = iter(["data: snapshot\n\n"])
        snapshot_builder = Mock(return_value=["snapshot-events"])
        monkeypatch.setattr(workflow_events_module, "MessageGenerator", lambda: msg_generator)
        monkeypatch.setattr(workflow_events_module, "WorkflowAppGenerator", lambda: workflow_generator)
        monkeypatch.setattr(workflow_events_module, "build_workflow_event_stream", snapshot_builder)

        api = WorkflowEventsApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", mode=AppMode.WORKFLOW.value)
        end_user = SimpleNamespace(id="end-user-1")

        with app.test_request_context("/workflow/run-1/events?user=u1&include_state_snapshot=true", method="GET"):
            response = handler(api, app_model=app_model, end_user=end_user, task_id="run-1")

        assert response.get_data(as_text=True) == "data: snapshot\n\n"
        msg_generator.retrieve_events.assert_not_called()
        snapshot_builder.assert_called_once()
        workflow_generator.convert_to_event_stream.assert_called_once_with(["snapshot-events"])
