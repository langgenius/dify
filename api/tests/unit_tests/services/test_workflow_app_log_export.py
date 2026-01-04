"""
Unit tests for WorkflowAppService export_workflow_app_logs method.

This test suite covers:
- CSV export functionality
- NDJSON export functionality
- Filter parameter handling (status, keyword, date ranges)
- Empty result handling
- Error handling for invalid parameters
"""

import json
from datetime import datetime
from unittest.mock import MagicMock

import pytest
from flask import Response

from core.workflow.enums import WorkflowExecutionStatus
from models import Account, App, EndUser, WorkflowAppLog, WorkflowRun
from models.enums import CreatorUserRole
from models.model import AppMode
from services.workflow_app_service import WorkflowAppService


class TestWorkflowAppLogExportFactory:
    """Factory for creating test data for workflow app log export tests."""

    @staticmethod
    def create_app_mock(
        app_id: str = "test-app-id",
        tenant_id: str = "test-tenant-id",
        **kwargs,
    ) -> MagicMock:
        """Create a mock App with workflow mode."""
        app = MagicMock(spec=App)
        app.id = app_id
        app.tenant_id = tenant_id
        app.mode = AppMode.WORKFLOW.value
        for key, value in kwargs.items():
            setattr(app, key, value)
        return app

    @staticmethod
    def create_workflow_app_log_mock(
        log_id: str = "log-123",
        workflow_run_id: str = "run-456",
        app_id: str = "test-app-id",
        tenant_id: str = "test-tenant-id",
        created_from: str | None = "console",
        created_by: str | None = "user-123",
        created_by_role: str | None = CreatorUserRole.ACCOUNT.value,
        created_at: datetime | None = None,
        **kwargs,
    ) -> MagicMock:
        """Create a mock WorkflowAppLog."""
        log = MagicMock(spec=WorkflowAppLog)
        log.id = log_id
        log.workflow_run_id = workflow_run_id
        log.app_id = app_id
        log.tenant_id = tenant_id
        log.created_from = created_from
        log.created_by = created_by
        log.created_by_role = created_by_role
        log.created_at = created_at or datetime(2025, 1, 4, 12, 0, 0)
        for key, value in kwargs.items():
            setattr(log, key, value)
        return log

    @staticmethod
    def create_workflow_run_mock(
        run_id: str = "run-456",
        app_id: str = "test-app-id",
        status: str = WorkflowExecutionStatus.SUCCEEDED.value,
        inputs: dict | None = None,
        outputs: dict | None = None,
        error: str | None = None,
        total_tokens: int | None = 1000,
        total_steps: int | None = 5,
        elapsed_time: float | None = 2.5,
        **kwargs,
    ) -> MagicMock:
        """Create a mock WorkflowRun."""
        run = MagicMock(spec=WorkflowRun)
        run.id = run_id
        run.app_id = app_id
        run.status = status
        run.inputs = inputs or {"query": "test"}
        run.outputs = outputs or {"result": "success"}
        run.error = error
        run.total_tokens = total_tokens
        run.total_steps = total_steps
        run.elapsed_time = elapsed_time
        for key, value in kwargs.items():
            setattr(run, key, value)
        return run

    @staticmethod
    def create_account_mock(
        account_id: str = "user-123",
        email: str = "test@example.com",
        **kwargs,
    ) -> MagicMock:
        """Create a mock Account."""
        account = MagicMock(spec=Account)
        account.id = account_id
        account.email = email
        for key, value in kwargs.items():
            setattr(account, key, value)
        return account

    @staticmethod
    def create_end_user_mock(
        end_user_id: str = "end-user-456",
        session_id: str = "session-789",
        **kwargs,
    ) -> MagicMock:
        """Create a mock EndUser."""
        end_user = MagicMock(spec=EndUser)
        end_user.id = end_user_id
        end_user.session_id = session_id
        for key, value in kwargs.items():
            setattr(end_user, key, value)
        return end_user


class TestWorkflowAppLogExport:
    """Unit tests for WorkflowAppService.export_workflow_app_logs method."""

    @pytest.fixture
    def workflow_app_service(self):
        """Create a WorkflowAppService instance."""
        return WorkflowAppService()

    @pytest.fixture
    def mock_session(self):
        """Mock SQLAlchemy Session."""
        return MagicMock()

    @staticmethod
    def _create_mock_yield_per_result(
        logs: list[tuple[MagicMock, MagicMock, MagicMock | None, MagicMock | None]],
    ) -> MagicMock:
        """Create a mock result for session.execute().yield_per()."""
        # Create a mock that will be returned by execute()
        mock_execute_result = MagicMock()

        # Create a mock that will be returned by yield_per()
        mock_yield_result = MagicMock()
        mock_yield_result.__iter__ = lambda self: iter(logs)

        # Set up the yield_per method to return the iterable mock
        mock_execute_result.yield_per = MagicMock(return_value=mock_yield_result)

        return mock_execute_result

    # ==================== CSV Export Tests ====================

    def test_export_workflow_app_logs_to_csv_success(
        self, workflow_app_service, mock_session
    ):
        """Test successful CSV export of workflow app logs."""
        app = TestWorkflowAppLogExportFactory.create_app_mock()
        log = TestWorkflowAppLogExportFactory.create_workflow_app_log_mock()
        run = TestWorkflowAppLogExportFactory.create_workflow_run_mock()
        account = TestWorkflowAppLogExportFactory.create_account_mock()

        mock_result = self._create_mock_yield_per_result([(log, run, account, None)])
        mock_session.execute.return_value = mock_result

        response = workflow_app_service.export_workflow_app_logs(
            session=mock_session,
            app_model=app,
            format_type="csv",
        )

        assert isinstance(response, Response)
        assert response.mimetype == "text/csv"
        assert ".csv" in response.headers.get("Content-Disposition", "")
        csv_content = response.get_data(as_text=True)
        assert "log_id" in csv_content
        assert log.id in csv_content

    def test_export_workflow_app_logs_to_csv_with_filters(
        self, workflow_app_service, mock_session
    ):
        """Test CSV export with status and keyword filters."""
        app = TestWorkflowAppLogExportFactory.create_app_mock()
        log = TestWorkflowAppLogExportFactory.create_workflow_app_log_mock()
        run = TestWorkflowAppLogExportFactory.create_workflow_run_mock(
            status=WorkflowExecutionStatus.FAILED.value
        )
        account = TestWorkflowAppLogExportFactory.create_account_mock()

        mock_result = self._create_mock_yield_per_result([(log, run, account, None)])
        mock_session.execute.return_value = mock_result

        response = workflow_app_service.export_workflow_app_logs(
            session=mock_session,
            app_model=app,
            status=WorkflowExecutionStatus.FAILED,
            keyword="test",
            format_type="csv",
        )

        assert isinstance(response, Response)
        assert response.mimetype == "text/csv"

    def test_export_workflow_app_logs_to_csv_empty_results(
        self, workflow_app_service, mock_session
    ):
        """Test CSV export with no matching logs."""
        app = TestWorkflowAppLogExportFactory.create_app_mock()
        mock_result = self._create_mock_yield_per_result([])
        mock_session.execute.return_value = mock_result

        response = workflow_app_service.export_workflow_app_logs(
            session=mock_session,
            app_model=app,
            format_type="csv",
        )

        assert isinstance(response, Response)
        csv_content = response.get_data(as_text=True)
        lines = csv_content.strip().split("\n")
        assert len(lines) == 1  # Only header row

    # ==================== NDJSON Export Tests ====================

    def test_export_workflow_app_logs_to_ndjson_success(
        self, workflow_app_service, mock_session
    ):
        """Test successful NDJSON export of workflow app logs."""
        app = TestWorkflowAppLogExportFactory.create_app_mock()
        log = TestWorkflowAppLogExportFactory.create_workflow_app_log_mock()
        run = TestWorkflowAppLogExportFactory.create_workflow_run_mock()
        account = TestWorkflowAppLogExportFactory.create_account_mock()

        mock_result = self._create_mock_yield_per_result([(log, run, account, None)])
        mock_session.execute.return_value = mock_result

        response = workflow_app_service.export_workflow_app_logs(
            session=mock_session,
            app_model=app,
            format_type="json",
        )

        assert isinstance(response, Response)
        assert response.content_type == "application/x-ndjson; charset=utf-8"
        assert ".jsonl" in response.headers.get("Content-Disposition", "")

        ndjson_content = response.get_data(as_text=True)
        lines = ndjson_content.strip().split("\n")
        metadata = json.loads(lines[0])
        assert "export_info" in metadata
        log_data = json.loads(lines[1])
        assert "log_id" in log_data

    def test_export_workflow_app_logs_to_ndjson_with_multiple_logs(
        self, workflow_app_service, mock_session
    ):
        """Test NDJSON export with multiple workflow app logs."""
        app = TestWorkflowAppLogExportFactory.create_app_mock()
        log1 = TestWorkflowAppLogExportFactory.create_workflow_app_log_mock(log_id="log-1")
        log2 = TestWorkflowAppLogExportFactory.create_workflow_app_log_mock(log_id="log-2")
        run1 = TestWorkflowAppLogExportFactory.create_workflow_run_mock(status="succeeded")
        run2 = TestWorkflowAppLogExportFactory.create_workflow_run_mock(status="failed")
        account = TestWorkflowAppLogExportFactory.create_account_mock()

        logs = [(log1, run1, account, None), (log2, run2, account, None)]
        mock_result = self._create_mock_yield_per_result(logs)
        mock_session.execute.return_value = mock_result

        response = workflow_app_service.export_workflow_app_logs(
            session=mock_session,
            app_model=app,
            format_type="json",
        )

        ndjson_content = response.get_data(as_text=True)
        assert ".jsonl" in response.headers.get("Content-Disposition", "")
        lines = ndjson_content.strip().split("\n")
        assert len(lines) == 3  # metadata + 2 log entries

    # ==================== Error Handling Tests ====================

    def test_export_with_invalid_format_raises_error(
        self, workflow_app_service, mock_session
    ):
        """Test that invalid format raises ValueError."""
        app = TestWorkflowAppLogExportFactory.create_app_mock()

        with pytest.raises(ValueError, match="Unsupported format"):
            workflow_app_service.export_workflow_app_logs(
                session=mock_session,
                app_model=app,
                format_type="xml",
            )

    def test_export_with_nonexistent_account_raises_error(
        self, workflow_app_service, mock_session
    ):
        """Test that filtering by non-existent account raises ValueError."""
        app = TestWorkflowAppLogExportFactory.create_app_mock()
        mock_session.scalar.return_value = None

        with pytest.raises(ValueError, match="Account not found"):
            workflow_app_service.export_workflow_app_logs(
                session=mock_session,
                app_model=app,
                created_by_account="nonexistent@example.com",
                format_type="csv",
            )

    # ==================== Stream-Specific Tests ====================

    def test_csv_export_uses_yield_per(
        self, workflow_app_service, mock_session
    ):
        """Test that CSV export uses yield_per for batch fetching."""
        app = TestWorkflowAppLogExportFactory.create_app_mock()
        log = TestWorkflowAppLogExportFactory.create_workflow_app_log_mock()
        run = TestWorkflowAppLogExportFactory.create_workflow_run_mock()
        account = TestWorkflowAppLogExportFactory.create_account_mock()

        mock_result = self._create_mock_yield_per_result([(log, run, account, None)])
        mock_session.execute.return_value = mock_result

        response = workflow_app_service.export_workflow_app_logs(
            session=mock_session,
            app_model=app,
            format_type="csv",
        )

        # Consume the response to trigger generator execution
        _ = response.get_data(as_text=True)

        # Verify that execute was called
        assert mock_session.execute.called

        # Verify that yield_per was called on the result
        mock_result.yield_per.assert_called_once_with(1000)

    def test_ndjson_export_uses_yield_per(
        self, workflow_app_service, mock_session
    ):
        """Test that NDJSON export uses yield_per for batch fetching."""
        app = TestWorkflowAppLogExportFactory.create_app_mock()
        log = TestWorkflowAppLogExportFactory.create_workflow_app_log_mock()
        run = TestWorkflowAppLogExportFactory.create_workflow_run_mock()
        account = TestWorkflowAppLogExportFactory.create_account_mock()

        mock_result = self._create_mock_yield_per_result([(log, run, account, None)])
        mock_session.execute.return_value = mock_result

        response = workflow_app_service.export_workflow_app_logs(
            session=mock_session,
            app_model=app,
            format_type="json",
        )

        # Consume the response to trigger generator execution
        _ = response.get_data(as_text=True)

        # Verify that yield_per was called on the result
        mock_result.yield_per.assert_called_once_with(1000)
