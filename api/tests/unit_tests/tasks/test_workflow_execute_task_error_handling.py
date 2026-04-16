"""
Unit tests for error handling in workflow_based_app_execution_task.

Covers:
  - _mark_workflow_run_failed  (marks scheduled/running as failed, skips terminal states, handles missing run)
  - workflow_based_app_execution_task  (catches runner exceptions, marks run as failed)
"""

from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest

from models.workflow import WorkflowExecutionStatus


# ---------------------------------------------------------------------------
# _mark_workflow_run_failed
# ---------------------------------------------------------------------------
class TestMarkWorkflowRunFailed:
    """Tests for the _mark_workflow_run_failed safety-net helper."""

    @pytest.fixture(autouse=True)
    def _setup(self):
        """Import the function under test (avoids top-level import issues with Flask app context)."""
        from tasks.app_generate.workflow_execute_task import _mark_workflow_run_failed

        self.mark_failed = _mark_workflow_run_failed

    def _make_workflow_run(self, *, status: WorkflowExecutionStatus, created_at: datetime | None = None):
        run = MagicMock()
        run.status = status
        run.created_at = created_at or datetime(2025, 1, 1, 12, 0, 0)
        run.error = None
        run.finished_at = None
        run.elapsed_time = 0
        return run

    def test_marks_scheduled_run_as_failed(self):
        run = self._make_workflow_run(status=WorkflowExecutionStatus.SCHEDULED)
        mock_engine = MagicMock()
        mock_session = MagicMock()
        mock_session.get.return_value = run
        mock_session.__enter__ = MagicMock(return_value=mock_session)
        mock_session.__exit__ = MagicMock(return_value=False)

        with patch("tasks.app_generate.workflow_execute_task.Session") as MockSession:
            ctx = MagicMock()
            ctx.__enter__ = MagicMock(return_value=mock_session)
            ctx.__exit__ = MagicMock(return_value=False)
            MockSession.return_value = ctx
            # session.begin() context manager
            begin_ctx = MagicMock()
            begin_ctx.__enter__ = MagicMock(return_value=None)
            begin_ctx.__exit__ = MagicMock(return_value=False)
            mock_session.begin.return_value = begin_ctx

            self.mark_failed("run-123", mock_engine)

        assert run.status == WorkflowExecutionStatus.FAILED
        assert run.error is not None
        assert run.finished_at is not None
        assert run.elapsed_time > 0

    def test_marks_running_run_as_failed(self):
        run = self._make_workflow_run(status=WorkflowExecutionStatus.RUNNING)
        mock_engine = MagicMock()
        mock_session = MagicMock()
        mock_session.get.return_value = run

        with patch("tasks.app_generate.workflow_execute_task.Session") as MockSession:
            ctx = MagicMock()
            ctx.__enter__ = MagicMock(return_value=mock_session)
            ctx.__exit__ = MagicMock(return_value=False)
            MockSession.return_value = ctx
            begin_ctx = MagicMock()
            begin_ctx.__enter__ = MagicMock(return_value=None)
            begin_ctx.__exit__ = MagicMock(return_value=False)
            mock_session.begin.return_value = begin_ctx

            self.mark_failed("run-456", mock_engine)

        assert run.status == WorkflowExecutionStatus.FAILED
        assert run.finished_at is not None

    def test_skips_already_succeeded_run(self):
        run = self._make_workflow_run(status=WorkflowExecutionStatus.SUCCEEDED)
        mock_engine = MagicMock()
        mock_session = MagicMock()
        mock_session.get.return_value = run

        with patch("tasks.app_generate.workflow_execute_task.Session") as MockSession:
            ctx = MagicMock()
            ctx.__enter__ = MagicMock(return_value=mock_session)
            ctx.__exit__ = MagicMock(return_value=False)
            MockSession.return_value = ctx
            begin_ctx = MagicMock()
            begin_ctx.__enter__ = MagicMock(return_value=None)
            begin_ctx.__exit__ = MagicMock(return_value=False)
            mock_session.begin.return_value = begin_ctx

            self.mark_failed("run-789", mock_engine)

        # Status should remain unchanged
        assert run.status == WorkflowExecutionStatus.SUCCEEDED
        assert run.error is None

    def test_skips_already_failed_run(self):
        run = self._make_workflow_run(status=WorkflowExecutionStatus.FAILED)
        run.error = "previous error"
        mock_engine = MagicMock()
        mock_session = MagicMock()
        mock_session.get.return_value = run

        with patch("tasks.app_generate.workflow_execute_task.Session") as MockSession:
            ctx = MagicMock()
            ctx.__enter__ = MagicMock(return_value=mock_session)
            ctx.__exit__ = MagicMock(return_value=False)
            MockSession.return_value = ctx
            begin_ctx = MagicMock()
            begin_ctx.__enter__ = MagicMock(return_value=None)
            begin_ctx.__exit__ = MagicMock(return_value=False)
            mock_session.begin.return_value = begin_ctx

            self.mark_failed("run-000", mock_engine)

        assert run.error == "previous error"

    def test_handles_missing_workflow_run(self):
        mock_engine = MagicMock()
        mock_session = MagicMock()
        mock_session.get.return_value = None

        with patch("tasks.app_generate.workflow_execute_task.Session") as MockSession:
            ctx = MagicMock()
            ctx.__enter__ = MagicMock(return_value=mock_session)
            ctx.__exit__ = MagicMock(return_value=False)
            MockSession.return_value = ctx
            begin_ctx = MagicMock()
            begin_ctx.__enter__ = MagicMock(return_value=None)
            begin_ctx.__exit__ = MagicMock(return_value=False)
            mock_session.begin.return_value = begin_ctx

            # Should not raise
            self.mark_failed("nonexistent-id", mock_engine)

    def test_handles_db_exception_gracefully(self):
        mock_engine = MagicMock()

        with patch("tasks.app_generate.workflow_execute_task.Session", side_effect=RuntimeError("DB down")):
            # Should not raise - the function catches all exceptions
            self.mark_failed("run-123", mock_engine)


# ---------------------------------------------------------------------------
# workflow_based_app_execution_task error handling
# ---------------------------------------------------------------------------
class TestWorkflowExecutionTaskErrorHandling:
    """Tests that the Celery task catches exceptions and marks the run as failed."""

    def test_runner_exception_marks_run_failed(self, mocker):
        mock_engine = MagicMock()
        mocker.patch("tasks.app_generate.workflow_execute_task.db", engine=mock_engine)

        # Mock _AppRunner to raise during run()
        mock_runner = MagicMock()
        mock_runner.run.side_effect = ValueError("question is required in input form")
        mocker.patch("tasks.app_generate.workflow_execute_task._AppRunner", return_value=mock_runner)

        mark_spy = mocker.patch("tasks.app_generate.workflow_execute_task._mark_workflow_run_failed")

        # Build a minimal valid payload
        payload_dict = {
            "app_id": "app-123",
            "workflow_id": "wf-123",
            "tenant_id": "tenant-123",
            "app_mode": "workflow",
            "user": {"TYPE": "end_user", "end_user_id": "eu-123"},
            "args": {"inputs": {}},
            "invoke_from": "service-api",
            "streaming": True,
            "workflow_run_id": "wfr-test-123",
        }

        import json

        from tasks.app_generate.workflow_execute_task import workflow_based_app_execution_task

        result = workflow_based_app_execution_task(json.dumps(payload_dict))

        assert result is None
        mark_spy.assert_called_once_with("wfr-test-123", mock_engine)

    def test_runner_success_does_not_call_mark_failed(self, mocker):
        mock_engine = MagicMock()
        mocker.patch("tasks.app_generate.workflow_execute_task.db", engine=mock_engine)

        mock_runner = MagicMock()
        mock_runner.run.return_value = {"result": "ok"}
        mocker.patch("tasks.app_generate.workflow_execute_task._AppRunner", return_value=mock_runner)

        mark_spy = mocker.patch("tasks.app_generate.workflow_execute_task._mark_workflow_run_failed")

        payload_dict = {
            "app_id": "app-123",
            "workflow_id": "wf-123",
            "tenant_id": "tenant-123",
            "app_mode": "workflow",
            "user": {"TYPE": "end_user", "end_user_id": "eu-123"},
            "args": {"inputs": {}},
            "invoke_from": "service-api",
            "streaming": True,
            "workflow_run_id": "wfr-test-456",
        }

        import json

        from tasks.app_generate.workflow_execute_task import workflow_based_app_execution_task

        result = workflow_based_app_execution_task(json.dumps(payload_dict))

        assert result == {"result": "ok"}
        mark_spy.assert_not_called()
