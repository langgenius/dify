"""Unit tests for controllers.web.workflow endpoints."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.web.error import (
    NotWorkflowAppError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
    TriggerWorkflowServiceModeUnavailableError,
)
from controllers.web.workflow import WorkflowRunApi, WorkflowTaskStopApi
from core.errors.error import ProviderTokenNotInitError, QuotaExceededError
from models.model import App, AppMode, EndUser
from services.errors.app import (
    TriggerWorkflowServiceModeUnavailableError as TriggerWorkflowServiceModeUnavailableServiceError,
)
from tests.unit_tests.model_factories import make_end_user


def _workflow_app() -> App:
    return App(id="app-1", tenant_id="tenant-1", mode=AppMode.WORKFLOW)


def _chat_app() -> App:
    return App(id="app-1", tenant_id="tenant-1", mode=AppMode.CHAT)


def _end_user() -> EndUser:
    return make_end_user(end_user_id="eu-1")


# ---------------------------------------------------------------------------
# WorkflowRunApi
# ---------------------------------------------------------------------------
class TestWorkflowRunApi:
    def test_wrong_mode_raises(self, app: Flask) -> None:
        with app.test_request_context("/workflows/run", method="POST"):
            with pytest.raises(NotWorkflowAppError):
                WorkflowRunApi().post(_chat_app(), _end_user())

    @patch("controllers.web.workflow.helper.compact_generate_response", return_value={"result": "ok"})
    @patch("controllers.web.workflow.AppGenerateService.generate")
    @patch("controllers.web.workflow.web_ns")
    def test_happy_path(self, mock_ns: MagicMock, mock_gen: MagicMock, mock_compact: MagicMock, app: Flask) -> None:
        mock_ns.payload = {"inputs": {"key": "val"}}
        mock_gen.return_value = "response"

        with app.test_request_context("/workflows/run", method="POST"):
            result = WorkflowRunApi().post(_workflow_app(), _end_user())

        assert result == {"result": "ok"}

    @patch(
        "controllers.web.workflow.AppGenerateService.generate",
        side_effect=ProviderTokenNotInitError(description="not init"),
    )
    @patch("controllers.web.workflow.web_ns")
    def test_provider_not_init(self, mock_ns: MagicMock, mock_gen: MagicMock, app: Flask) -> None:
        mock_ns.payload = {"inputs": {}}

        with app.test_request_context("/workflows/run", method="POST"):
            with pytest.raises(ProviderNotInitializeError):
                WorkflowRunApi().post(_workflow_app(), _end_user())

    @patch(
        "controllers.web.workflow.AppGenerateService.generate",
        side_effect=TriggerWorkflowServiceModeUnavailableServiceError(),
    )
    @patch("controllers.web.workflow.web_ns")
    def test_trigger_workflow_returns_stable_unavailable_error(
        self,
        mock_ns: MagicMock,
        mock_gen: MagicMock,
        app: Flask,
    ) -> None:
        mock_ns.payload = {"inputs": {}}

        with app.test_request_context("/workflows/run", method="POST"):
            with pytest.raises(TriggerWorkflowServiceModeUnavailableError) as exc_info:
                WorkflowRunApi().post(_workflow_app(), _end_user())

        assert exc_info.value.code == 403
        assert exc_info.value.error_code == "trigger_workflow_service_mode_unavailable"

    @patch(
        "controllers.web.workflow.AppGenerateService.generate",
        side_effect=QuotaExceededError(),
    )
    @patch("controllers.web.workflow.web_ns")
    def test_quota_exceeded(self, mock_ns: MagicMock, mock_gen: MagicMock, app: Flask) -> None:
        mock_ns.payload = {"inputs": {}}

        with app.test_request_context("/workflows/run", method="POST"):
            with pytest.raises(ProviderQuotaExceededError):
                WorkflowRunApi().post(_workflow_app(), _end_user())


# ---------------------------------------------------------------------------
# WorkflowTaskStopApi
# ---------------------------------------------------------------------------
class TestWorkflowTaskStopApi:
    def test_wrong_mode_raises(self, app: Flask) -> None:
        with app.test_request_context("/workflows/tasks/task-1/stop", method="POST"):
            with pytest.raises(NotWorkflowAppError):
                WorkflowTaskStopApi().post(_chat_app(), _end_user(), "task-1")

    @patch("controllers.web.workflow.AppTaskService.stop_workflow_task")
    def test_stop_passes_app_scope(self, stop: MagicMock, app: Flask) -> None:
        with app.test_request_context("/workflows/tasks/task-1/stop", method="POST"):
            result = WorkflowTaskStopApi().post(_workflow_app(), _end_user(), "task-1")

        assert result == {"result": "success"}
        stop.assert_called_once_with(
            tenant_id="tenant-1", app_id="app-1", task_id="task-1", app_mode=AppMode.WORKFLOW, owner=None
        )
