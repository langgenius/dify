"""Unit tests for controllers.web.workflow_events endpoints."""

from __future__ import annotations

from datetime import datetime
from unittest.mock import ANY, MagicMock, Mock, patch

import pytest
from flask import Flask

from controllers.common.errors import NotFoundError
from controllers.web.workflow_events import WorkflowEventsApi
from graphon.enums import WorkflowExecutionStatus
from models.enums import CreatorUserRole, EndUserType, WorkflowRunTriggeredFrom
from models.model import App, AppMode, EndUser
from models.workflow import WorkflowRun, WorkflowType


def _workflow_app() -> App:
    return App(id="app-1", tenant_id="tenant-1", mode=AppMode.WORKFLOW)


def _end_user() -> EndUser:
    return EndUser(
        id="eu-1",
        tenant_id="tenant-1",
        type=EndUserType.BROWSER,
        session_id="session-1",
    )


def _workflow_run(
    *,
    app_id: str = "app-1",
    created_by_role: CreatorUserRole = CreatorUserRole.END_USER,
    created_by: str = "eu-1",
    finished_at: datetime | None = None,
) -> WorkflowRun:
    return WorkflowRun(
        id="run-1",
        tenant_id="tenant-1",
        app_id=app_id,
        workflow_id="workflow-1",
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        graph='{"nodes": [], "edges": []}',
        inputs="{}",
        status=WorkflowExecutionStatus.SUCCEEDED if finished_at else WorkflowExecutionStatus.RUNNING,
        outputs="{}",
        error=None,
        elapsed_time=0,
        total_tokens=0,
        total_steps=0,
        created_by_role=created_by_role,
        created_by=created_by,
        created_at=datetime(2024, 1, 1),
        finished_at=finished_at,
    )


# ---------------------------------------------------------------------------
# WorkflowEventsApi
# ---------------------------------------------------------------------------
class TestWorkflowEventsApi:
    @patch("controllers.web.workflow_events.DifyAPIRepositoryFactory")
    @patch("controllers.web.workflow_events.db")
    def test_workflow_run_not_found(self, mock_db: MagicMock, mock_factory: MagicMock, app: Flask) -> None:
        mock_db.engine = "engine"
        mock_repo = MagicMock()
        mock_repo.get_workflow_run_by_id_and_tenant_id.return_value = None
        mock_factory.create_api_workflow_run_repository.return_value = mock_repo

        with app.test_request_context("/workflow/run-1/events"):
            with pytest.raises(NotFoundError):
                WorkflowEventsApi().get(_workflow_app(), _end_user(), "run-1")

    @patch("controllers.web.workflow_events.DifyAPIRepositoryFactory")
    @patch("controllers.web.workflow_events.db")
    def test_workflow_run_wrong_app(self, mock_db: MagicMock, mock_factory: MagicMock, app: Flask) -> None:
        mock_db.engine = "engine"
        run = _workflow_run(app_id="other-app")
        mock_repo = MagicMock()
        mock_repo.get_workflow_run_by_id_and_tenant_id.return_value = run
        mock_factory.create_api_workflow_run_repository.return_value = mock_repo

        with app.test_request_context("/workflow/run-1/events"):
            with pytest.raises(NotFoundError):
                WorkflowEventsApi().get(_workflow_app(), _end_user(), "run-1")

    @patch("controllers.web.workflow_events.DifyAPIRepositoryFactory")
    @patch("controllers.web.workflow_events.db")
    def test_workflow_run_not_created_by_end_user(
        self, mock_db: MagicMock, mock_factory: MagicMock, app: Flask
    ) -> None:
        mock_db.engine = "engine"
        run = _workflow_run(created_by_role=CreatorUserRole.ACCOUNT)
        mock_repo = MagicMock()
        mock_repo.get_workflow_run_by_id_and_tenant_id.return_value = run
        mock_factory.create_api_workflow_run_repository.return_value = mock_repo

        with app.test_request_context("/workflow/run-1/events"):
            with pytest.raises(NotFoundError):
                WorkflowEventsApi().get(_workflow_app(), _end_user(), "run-1")

    @patch("controllers.web.workflow_events.DifyAPIRepositoryFactory")
    @patch("controllers.web.workflow_events.db")
    def test_workflow_run_wrong_end_user(self, mock_db: MagicMock, mock_factory: MagicMock, app: Flask) -> None:
        mock_db.engine = "engine"
        run = _workflow_run(created_by="other-user")
        mock_repo = MagicMock()
        mock_repo.get_workflow_run_by_id_and_tenant_id.return_value = run
        mock_factory.create_api_workflow_run_repository.return_value = mock_repo

        with app.test_request_context("/workflow/run-1/events"):
            with pytest.raises(NotFoundError):
                WorkflowEventsApi().get(_workflow_app(), _end_user(), "run-1")

    @patch("controllers.web.workflow_events.WorkflowResponseConverter")
    @patch("controllers.web.workflow_events.DifyAPIRepositoryFactory")
    @patch("controllers.web.workflow_events.db")
    def test_finished_run_returns_sse_response(
        self, mock_db: MagicMock, mock_factory: MagicMock, mock_converter: MagicMock, app: Flask
    ) -> None:
        mock_db.engine = "engine"
        run = _workflow_run(finished_at=datetime(2024, 1, 1))
        mock_repo = MagicMock()
        mock_repo.get_workflow_run_by_id_and_tenant_id.return_value = run
        mock_factory.create_api_workflow_run_repository.return_value = mock_repo

        finish_response = MagicMock()
        finish_response.model_dump.return_value = {"task_id": "run-1"}
        finish_response.event.value = "workflow_finished"
        mock_converter.workflow_run_result_to_finish_response.return_value = finish_response

        with app.test_request_context("/workflow/run-1/events"):
            response = WorkflowEventsApi().get(_workflow_app(), _end_user(), "run-1")

        assert response.mimetype == "text/event-stream"

    @patch("controllers.web.workflow_events.DifyAPIRepositoryFactory")
    @patch("controllers.web.workflow_events.db")
    def test_snapshot_stream_can_continue_across_pauses(
        self, mock_db: MagicMock, mock_factory: MagicMock, app: Flask, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        mock_db.engine = "engine"
        run = _workflow_run()
        mock_repo = MagicMock()
        mock_repo.get_workflow_run_by_id_and_tenant_id.return_value = run
        mock_factory.create_api_workflow_run_repository.return_value = mock_repo

        workflow_generator = Mock()
        workflow_generator.convert_to_event_stream.return_value = iter(["data: snapshot\n\n"])
        snapshot_builder = Mock(return_value=["snapshot-events"])
        monkeypatch.setattr("controllers.web.workflow_events.WorkflowAppGenerator", lambda: workflow_generator)
        monkeypatch.setattr("controllers.web.workflow_events.build_workflow_event_stream", snapshot_builder)

        with app.test_request_context("/workflow/run-1/events?include_state_snapshot=true&continue_on_pause=true"):
            response = WorkflowEventsApi().get(_workflow_app(), _end_user(), "run-1")

        assert response.get_data(as_text=True) == "data: snapshot\n\n"
        snapshot_builder.assert_called_once_with(
            app_mode=AppMode.WORKFLOW,
            workflow_run=run,
            tenant_id="tenant-1",
            app_id="app-1",
            session_maker=ANY,
            close_on_pause=False,
        )
