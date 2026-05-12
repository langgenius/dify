from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest

from graphon.enums import WorkflowExecutionStatus
from models import Account, App, EndUser, TenantAccountJoin, WorkflowAppLog, WorkflowArchiveLog, WorkflowRun
from models.enums import AppTriggerType, CreatorUserRole
from models.trigger import WorkflowTriggerLog
from services.workflow_app_service import LogView, WorkflowAppService

TEST_TENANT_ID = "test_tenant_123"
TEST_APP_ID = "test_app_456"
TEST_WORKFLOW_RUN_ID = "test_run_789"
TEST_ACCOUNT_ID = "test_account_001"
TEST_END_USER_ID = "test_end_user_002"
TEST_SESSION_ID = "test_session_111"
TEST_EMAIL = "test@example.com"
TEST_KEYWORD = "test keyword"
TEST_INVALID_KEYWORD = "invalid"
TEST_UUID_KEYWORD = "550e8400-e29b-41d4-a716-446655440000"
TEST_TRIGGER_METADATA_JSON = '{"type":"trigger-plugin","icon_filename":"icon.png","icon_dark_filename":"icon_dark.png"}'
TEST_TRIGGER_METADATA_DICT = {
    "type": "trigger-plugin",
    "icon_filename": "icon.png",
    "icon_dark_filename": "icon_dark.png",
}
TEST_INVALID_JSON = "{invalid json"
TEST_ICON_URL = "https://test-plugin-icon.com/icon.png"
TEST_ICON_DARK_URL = "https://test-plugin-icon.com/icon_dark.png"


class TestWorkflowAppServiceFactory:
    """Factory for creating test models and mocks."""

    @staticmethod
    def create_app_mock() -> MagicMock:
        """Create a mock App model instance."""
        app = MagicMock(spec=App)
        app.tenant_id = TEST_TENANT_ID
        app.id = TEST_APP_ID
        app.trigger_type = AppTriggerType.TRIGGER_PLUGIN
        return app

    @staticmethod
    def create_workflow_app_log_mock() -> MagicMock:
        """Create a mock WorkflowAppLog model instance."""
        log = MagicMock(spec=WorkflowAppLog)
        log.tenant_id = TEST_TENANT_ID
        log.app_id = TEST_APP_ID
        log.workflow_run_id = TEST_WORKFLOW_RUN_ID
        log.created_by = TEST_ACCOUNT_ID
        log.created_by_role = CreatorUserRole.ACCOUNT
        log.created_at = datetime.now(UTC)
        return log

    @staticmethod
    def create_workflow_trigger_log_mock() -> MagicMock:
        """Create a mock WorkflowTriggerLog model instance."""
        trigger_log = MagicMock(spec=WorkflowTriggerLog)
        trigger_log.tenant_id = TEST_TENANT_ID
        trigger_log.app_id = TEST_APP_ID
        trigger_log.workflow_run_id = TEST_WORKFLOW_RUN_ID
        trigger_log.trigger_metadata = TEST_TRIGGER_METADATA_JSON
        return trigger_log

    @staticmethod
    def create_workflow_run_mock() -> MagicMock:
        """Create a mock WorkflowRun model instance."""
        run = MagicMock(spec=WorkflowRun)
        run.id = TEST_WORKFLOW_RUN_ID
        run.inputs = '{"test": "input"}'
        run.outputs = '{"test": "output"}'
        run.created_by = TEST_END_USER_ID
        run.created_by_role = CreatorUserRole.END_USER
        run.status = WorkflowExecutionStatus.SUCCEEDED
        return run

    @staticmethod
    def create_end_user_mock() -> MagicMock:
        """Create a mock EndUser model instance."""
        user = MagicMock(spec=EndUser)
        user.id = TEST_END_USER_ID
        user.session_id = TEST_SESSION_ID
        return user

    @staticmethod
    def create_account_mock() -> MagicMock:
        """Create a mock Account model instance."""
        account = MagicMock(spec=Account)
        account.id = TEST_ACCOUNT_ID
        account.email = TEST_EMAIL
        return account

    @staticmethod
    def create_tenant_account_join_mock() -> MagicMock:
        """Create a mock TenantAccountJoin model instance."""
        join = MagicMock(spec=TenantAccountJoin)
        join.tenant_id = TEST_TENANT_ID
        join.account_id = TEST_ACCOUNT_ID
        return join

    @staticmethod
    def create_workflow_archive_log_mock() -> MagicMock:
        """Create a mock WorkflowArchiveLog model instance."""
        log = MagicMock(spec=WorkflowArchiveLog)
        log.tenant_id = TEST_TENANT_ID
        log.app_id = TEST_APP_ID
        log.log_id = "test_log_id"
        log.created_by = TEST_ACCOUNT_ID
        log.created_by_role = CreatorUserRole.ACCOUNT
        log.run_created_at = datetime.now(UTC)
        log.log_created_at = datetime.now(UTC)
        log.trigger_metadata = TEST_TRIGGER_METADATA_JSON
        log.workflow_run_summary = {"test": "summary"}
        return log


class TestLogView:
    """
    Unit tests for LogView wrapper class.

    This test suite covers:
    - Initialization of LogView with log and details
    - Attribute proxying to the underlying log model
    """

    @pytest.fixture
    def factory(self):
        return TestWorkflowAppServiceFactory()

    def test_log_view_initialization(self, factory):
        """Test LogView initializes correctly with log and details."""
        # Arrange
        log = factory.create_workflow_app_log_mock()
        details = {"trigger_metadata": {}}

        # Act
        log_view = LogView(log, details)

        # Assert
        assert log_view.log == log
        assert log_view.details == details
        assert log_view.details_ == details

    def test_log_view_attribute_proxy(self, factory):
        """Test LogView proxies attributes to underlying log."""
        # Arrange
        log = factory.create_workflow_app_log_mock()
        log_view = LogView(log, None)

        # Act & Assert
        assert log_view.tenant_id == TEST_TENANT_ID
        assert log_view.app_id == TEST_APP_ID
        assert log_view.workflow_run_id == TEST_WORKFLOW_RUN_ID


class TestWorkflowAppService:
    """
    Unit tests for WorkflowAppService.

    This test suite covers:
    - _safe_json_loads method for various input scenarios
    - _safe_parse_uuid method for valid and invalid UUID strings
    - handle_trigger_metadata method for different trigger metadata inputs
    - get_paginate_workflow_app_logs method for various filtering and pagination scenarios
    - get_paginate_workflow_archive_logs method for pagination and user filtering
    """

    @pytest.fixture
    def service(self):
        """Fixture to create an instance of WorkflowAppService."""
        return WorkflowAppService()

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestWorkflowAppServiceFactory()

    def test_safe_json_loads_none(self, service):
        """Test _safe_json_loads returns None for None input."""
        # Act & Assert
        assert service._safe_json_loads(None) is None

    def test_safe_json_loads_valid_json(self, service):
        """Test _safe_json_loads parses valid JSON correctly."""
        # Act
        result = service._safe_json_loads('{"key": "value"}')

        # Assert
        assert result == {"key": "value"}

    def test_safe_json_loads_invalid_json(self, service):
        """Test _safe_json_loads returns None for invalid JSON."""
        # Act & Assert
        assert service._safe_json_loads(TEST_INVALID_JSON) is None

    def test_safe_json_loads_dict(self, service):
        """Test _safe_json_loads returns dict directly if input is dict."""
        # Act & Assert
        test_dict = {"key": "value"}
        assert service._safe_json_loads(test_dict) == test_dict

    def test_safe_parse_uuid_invalid_length(self, service):
        """Test _safe_parse_uuid returns None for short string."""
        # Act & Assert
        assert service._safe_parse_uuid("short") is None

    def test_safe_parse_uuid_valid(self, service):
        """Test _safe_parse_uuid parses valid UUID."""
        # Act
        result = service._safe_parse_uuid(TEST_UUID_KEYWORD)

        # Assert
        assert str(result) == TEST_UUID_KEYWORD

    def test_safe_parse_uuid_invalid_format(self, service):
        """Test _safe_parse_uuid returns None for invalid UUID format."""
        # Act & Assert
        assert service._safe_parse_uuid("invalid-uuid-format-xxxxxxxxxxxx") is None

    @patch("services.workflow_app_service.PluginService.get_plugin_icon_url")
    def test_handle_trigger_metadata_plugin(self, mock_icon_url, service):
        """Test handle_trigger_metadata processes plugin trigger type correctly."""
        # Arrange
        mock_icon_url.side_effect = [TEST_ICON_URL, TEST_ICON_DARK_URL]

        # Act
        result = service.handle_trigger_metadata(TEST_TENANT_ID, TEST_TRIGGER_METADATA_JSON)

        # Assert
        assert result["icon"] == TEST_ICON_URL
        assert result["icon_dark"] == TEST_ICON_DARK_URL
        assert mock_icon_url.call_count == 2

    def test_handle_trigger_metadata_empty(self, service):
        """Test handle_trigger_metadata returns empty dict for None input."""
        # Act & Assert
        assert service.handle_trigger_metadata(TEST_TENANT_ID, None) == {}

    def test_handle_trigger_metadata_other_type(self, service):
        """Test handle_trigger_metadata returns original data for non-plugin types."""
        metadata = '{"type": "trigger-webhook"}'

        # Act
        result = service.handle_trigger_metadata(TEST_TENANT_ID, metadata)

        # Assert
        assert result == {"type": "trigger-webhook"}

    @patch("services.workflow_app_service.Session")
    def test_get_logs_basic(self, mock_session, service, factory):
        """Test get_paginate_workflow_app_logs basic pagination without filters."""
        # Arrange
        app = factory.create_app_mock()
        log = factory.create_workflow_app_log_mock()
        mock_session.scalars.return_value.all.return_value = [log]
        mock_session.scalar.return_value = 1

        # Act
        result = service.get_paginate_workflow_app_logs(
            session=mock_session, app_model=app, page=1, limit=20, detail=False
        )

        # Assert
        assert result["page"] == 1
        assert result["limit"] == 20
        assert result["total"] == 1
        assert len(result["data"]) == 1
        assert isinstance(result["data"][0], LogView)

    @patch("services.workflow_app_service.Session")
    def test_get_logs_with_detail(self, mock_session, service, factory):
        """Test get_paginate_workflow_app_logs with detail=True and trigger metadata."""
        # Arrange
        app = factory.create_app_mock()
        log = factory.create_workflow_app_log_mock()
        mock_session.execute.return_value.all.return_value = [(log, TEST_TRIGGER_METADATA_JSON)]
        mock_session.scalar.return_value = 1

        # Act
        result = service.get_paginate_workflow_app_logs(session=mock_session, app_model=app, detail=True)

        # Assert
        assert len(result["data"]) == 1
        assert result["data"][0].details["trigger_metadata"] is not None

    @patch("services.workflow_app_service.Session")
    def test_get_logs_with_keyword(self, mock_session, service, factory):
        """Test get_paginate_workflow_app_logs with keyword search."""
        # Arrange
        app = factory.create_app_mock()
        log = factory.create_workflow_app_log_mock()
        mock_session.scalars.return_value.all.return_value = [log]
        mock_session.scalar.return_value = 1

        # Act
        result = service.get_paginate_workflow_app_logs(session=mock_session, app_model=app, keyword=TEST_KEYWORD)

        # Assert
        assert result["total"] == 1

    @patch("services.workflow_app_service.Session")
    def test_get_logs_with_uuid_keyword(self, mock_session, service, factory):
        """Test get_paginate_workflow_app_logs with UUID keyword."""
        # Arrange
        app = factory.create_app_mock()
        log = factory.create_workflow_app_log_mock()
        mock_session.scalars.return_value.all.return_value = [log]
        mock_session.scalar.return_value = 1

        # Act
        result = service.get_paginate_workflow_app_logs(session=mock_session, app_model=app, keyword=TEST_UUID_KEYWORD)

        # Assert
        assert result["total"] == 1

    @patch("services.workflow_app_service.Session")
    def test_get_logs_with_status(self, mock_session, service, factory):
        """Test get_paginate_workflow_app_logs with status filter."""
        # Arrange
        app = factory.create_app_mock()
        log = factory.create_workflow_app_log_mock()
        mock_session.scalars.return_value.all.return_value = [log]
        mock_session.scalar.return_value = 1

        # Act
        result = service.get_paginate_workflow_app_logs(
            session=mock_session, app_model=app, status=WorkflowExecutionStatus.SUCCEEDED
        )

        # Assert
        assert result["total"] == 1

    @patch("services.workflow_app_service.Session")
    def test_get_logs_with_time_filter(self, mock_session, service, factory):
        """Test get_paginate_workflow_app_logs with time range filters."""
        # Arrange
        app = factory.create_app_mock()
        log = factory.create_workflow_app_log_mock()
        mock_session.scalars.return_value.all.return_value = [log]
        mock_session.scalar.return_value = 1
        now = datetime.now(UTC)

        # Act
        result = service.get_paginate_workflow_app_logs(
            session=mock_session, app_model=app, created_at_after=now, created_at_before=now
        )

        # Assert
        assert result["total"] == 1

    @patch("services.workflow_app_service.Session")
    def test_get_logs_with_end_user_session(self, mock_session, service, factory):
        """Test get_paginate_workflow_app_logs filtered by end user session ID."""
        # Arrange
        app = factory.create_app_mock()
        log = factory.create_workflow_app_log_mock()
        mock_session.scalars.return_value.all.return_value = [log]
        mock_session.scalar.return_value = 1

        # Act
        result = service.get_paginate_workflow_app_logs(
            session=mock_session, app_model=app, created_by_end_user_session_id=TEST_SESSION_ID
        )

        # Assert
        assert result["total"] == 1

    @patch("services.workflow_app_service.Session")
    def test_get_logs_with_account(self, mock_session, service, factory):
        """Test get_paginate_workflow_app_logs filtered by account email."""
        # Arrange
        app = factory.create_app_mock()
        log = factory.create_workflow_app_log_mock()
        account = factory.create_account_mock()
        mock_session.scalar.side_effect = [account, 1]
        mock_session.scalars.return_value.all.return_value = [log]

        # Act
        result = service.get_paginate_workflow_app_logs(
            session=mock_session, app_model=app, created_by_account=TEST_EMAIL
        )

        # Assert
        assert result["total"] == 1

    @patch("services.workflow_app_service.Session")
    def test_get_logs_account_not_found(self, mock_session, service, factory):
        """Test get_paginate_workflow_app_logs raises error when account not found."""
        # Arrange
        app = factory.create_app_mock()
        mock_session.scalar.return_value = None

        # Act & Assert
        with pytest.raises(ValueError, match=f"Account not found: {TEST_EMAIL}"):
            service.get_paginate_workflow_app_logs(session=mock_session, app_model=app, created_by_account=TEST_EMAIL)

    @patch("services.workflow_app_service.Session")
    def test_get_archive_logs_basic(self, mock_session, service, factory):
        """Test get_paginate_workflow_archive_logs basic pagination."""
        # Arrange
        app = factory.create_app_mock()
        log = factory.create_workflow_archive_log_mock()
        mock_session.scalars.return_value.all.return_value = [log]
        mock_session.scalar.return_value = 1

        # Act
        result = service.get_paginate_workflow_archive_logs(session=mock_session, app_model=app, page=1, limit=20)

        # Assert
        assert result["page"] == 1
        assert result["limit"] == 20
        assert result["total"] == 1
        assert len(result["data"]) == 1

    @patch("services.workflow_app_service.Session")
    def test_get_archive_logs_with_users(self, mock_session, service, factory):
        """Test get_paginate_workflow_archive_logs with account and end user joins."""
        # Arrange
        app = factory.create_app_mock()
        end_user_log = factory.create_workflow_archive_log_mock()
        end_user_log.created_by = TEST_END_USER_ID
        end_user_log.created_by_role = CreatorUserRole.END_USER
        other_log = factory.create_workflow_archive_log_mock()
        other_log.created_by = "other_user"
        other_log.created_by_role = "other_role"

        mock_session.scalars.return_value.all.return_value = [end_user_log, other_log]
        mock_session.scalar.return_value = 2

        # Act
        result = service.get_paginate_workflow_archive_logs(session=mock_session, app_model=app)

        # Assert
        assert len(result["data"]) == 2
        assert result["total"] == 2
