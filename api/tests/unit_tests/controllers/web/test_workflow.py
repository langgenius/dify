"""Unit tests for controllers.web.workflow endpoints."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.web.error import (
    NotWorkflowAppError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.web.workflow import WorkflowRunApi, WorkflowTaskStopApi
from core.errors.error import ProviderTokenNotInitError, QuotaExceededError


def _workflow_app() -> SimpleNamespace:
    return SimpleNamespace(id="app-1", mode="workflow")


def _chat_app() -> SimpleNamespace:
    return SimpleNamespace(id="app-1", mode="chat")


def _end_user() -> SimpleNamespace:
    return SimpleNamespace(id="eu-1")


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

    @patch("controllers.web.workflow.GraphEngineManager.send_stop_command")
    @patch("controllers.web.workflow.AppQueueManager.set_stop_flag_no_user_check")
    def test_stop_calls_both_mechanisms(self, mock_legacy: MagicMock, mock_graph: MagicMock, app: Flask) -> None:
        with app.test_request_context("/workflows/tasks/task-1/stop", method="POST"):
            result = WorkflowTaskStopApi().post(_workflow_app(), _end_user(), "task-1")

        assert result == {"result": "success"}
        mock_legacy.assert_called_once_with("task-1")
        mock_graph.assert_called_once_with("task-1")
