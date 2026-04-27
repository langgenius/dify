"""Unit tests for controllers.web.workflow_events endpoints."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.web.error import NotFoundError
from controllers.web.workflow_events import WorkflowEventsApi
from models.enums import CreatorUserRole
from models.model import App, EndUser
from models.workflow import WorkflowRun


def _workflow_app() -> App:
    app = MagicMock(spec=App)
    app.id = "app-1"
    app.tenant_id = "tenant-1"
    app.mode = "workflow"
    return app


def _end_user() -> EndUser:
    end_user = MagicMock(spec=EndUser)
    end_user.id = "eu-1"
    return end_user


def _workflow_run(**overrides: object) -> WorkflowRun:
    run = MagicMock(spec=WorkflowRun)
    run.id = "run-1"
    run.app_id = "app-1"
    run.created_by_role = CreatorUserRole.END_USER
    run.created_by = "eu-1"
    run.finished_at = None
    for key, value in overrides.items():
        setattr(run, key, value)
    return run


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
        from datetime import datetime

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
