from unittest.mock import MagicMock, patch

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from models.model import App, EndUser
from services.end_user_service import EndUserService


class TestEndUserServiceFactory:
    """Factory class for creating test data and mock objects for end user service tests."""

    @staticmethod
    def create_app_mock(
        app_id: str = "app-123",
        tenant_id: str = "tenant-456",
        name: str = "Test App",
    ) -> MagicMock:
        """Create a mock App object."""
        app = MagicMock(spec=App)
        app.id = app_id
        app.tenant_id = tenant_id
        app.name = name
        return app

    @staticmethod
    def create_end_user_mock(
        user_id: str = "user-789",
        tenant_id: str = "tenant-456",
        app_id: str = "app-123",
        session_id: str = "session-001",
        type: InvokeFrom = InvokeFrom.SERVICE_API,
        is_anonymous: bool = False,
    ) -> MagicMock:
        """Create a mock EndUser object."""
        end_user = MagicMock(spec=EndUser)
        end_user.id = user_id
        end_user.tenant_id = tenant_id
        end_user.app_id = app_id
        end_user.session_id = session_id
        end_user.type = type
        end_user.is_anonymous = is_anonymous
        end_user.external_user_id = session_id
        return end_user


class TestEndUserServiceGetOrCreateEndUserByType:
    """
    Unit tests for EndUserService.get_or_create_end_user_by_type method.

    This test suite covers:
    - Creating end users with different InvokeFrom types
    - Type migration for legacy users
    - Query ordering and prioritization
    - Session management
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestEndUserServiceFactory()

    # Test 10: Session context manager properly closes
    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_session_context_manager_closes(self, mock_db, mock_session_class, factory):
        """Test that Session context manager is properly used."""
        # Arrange
        tenant_id = "tenant-123"
        app_id = "app-456"
        user_id = "user-789"

        mock_session = MagicMock()
        mock_context = MagicMock()
        mock_context.__enter__.return_value = mock_session
        mock_session_class.return_value = mock_context

        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.first.return_value = None

        # Act
        EndUserService.get_or_create_end_user_by_type(
            type=InvokeFrom.SERVICE_API,
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=user_id,
        )

        # Assert
        # Verify context manager was entered and exited
        mock_context.__enter__.assert_called_once()
        mock_context.__exit__.assert_called_once()
