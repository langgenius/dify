from unittest.mock import MagicMock, patch

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from models.model import App, DefaultEndUserSessionID, EndUser
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


class TestEndUserServiceGetOrCreateEndUser:
    """
    Unit tests for EndUserService.get_or_create_end_user method.

    This test suite covers:
    - Creating new end users
    - Retrieving existing end users
    - Default session ID handling
    - Anonymous user creation
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestEndUserServiceFactory()

    # Test 01: Get or create with custom user_id
    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_get_or_create_end_user_with_custom_user_id(self, mock_db, mock_session_class, factory):
        """Test getting or creating end user with custom user_id."""
        # Arrange
        app = factory.create_app_mock()
        user_id = "custom-user-123"

        mock_session = MagicMock()
        mock_session_class.return_value.__enter__.return_value = mock_session

        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.first.return_value = None  # No existing user

        # Act
        result = EndUserService.get_or_create_end_user(app_model=app, user_id=user_id)

        # Assert
        mock_session.add.assert_called_once()
        mock_session.commit.assert_called_once()
        # Verify the created user has correct attributes
        added_user = mock_session.add.call_args[0][0]
        assert added_user.tenant_id == app.tenant_id
        assert added_user.app_id == app.id
        assert added_user.session_id == user_id
        assert added_user.type == InvokeFrom.SERVICE_API
        assert added_user.is_anonymous is False

    # Test 02: Get or create without user_id (default session)
    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_get_or_create_end_user_without_user_id(self, mock_db, mock_session_class, factory):
        """Test getting or creating end user without user_id uses default session."""
        # Arrange
        app = factory.create_app_mock()

        mock_session = MagicMock()
        mock_session_class.return_value.__enter__.return_value = mock_session

        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.first.return_value = None  # No existing user

        # Act
        result = EndUserService.get_or_create_end_user(app_model=app, user_id=None)

        # Assert
        mock_session.add.assert_called_once()
        added_user = mock_session.add.call_args[0][0]
        assert added_user.session_id == DefaultEndUserSessionID.DEFAULT_SESSION_ID
        # Verify _is_anonymous is set correctly (property always returns False)
        assert added_user._is_anonymous is True

    # Test 03: Get existing end user
    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_get_existing_end_user(self, mock_db, mock_session_class, factory):
        """Test retrieving an existing end user."""
        # Arrange
        app = factory.create_app_mock()
        user_id = "existing-user-123"
        existing_user = factory.create_end_user_mock(
            tenant_id=app.tenant_id,
            app_id=app.id,
            session_id=user_id,
            type=InvokeFrom.SERVICE_API,
        )

        mock_session = MagicMock()
        mock_session_class.return_value.__enter__.return_value = mock_session

        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.first.return_value = existing_user

        # Act
        result = EndUserService.get_or_create_end_user(app_model=app, user_id=user_id)

        # Assert
        assert result == existing_user
        mock_session.add.assert_not_called()  # Should not create new user


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

    # Test 04: Create new end user with SERVICE_API type
    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_create_end_user_service_api_type(self, mock_db, mock_session_class, factory):
        """Test creating new end user with SERVICE_API type."""
        # Arrange
        tenant_id = "tenant-123"
        app_id = "app-456"
        user_id = "user-789"

        mock_session = MagicMock()
        mock_session_class.return_value.__enter__.return_value = mock_session

        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.first.return_value = None

        # Act
        result = EndUserService.get_or_create_end_user_by_type(
            type=InvokeFrom.SERVICE_API,
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=user_id,
        )

        # Assert
        mock_session.add.assert_called_once()
        mock_session.commit.assert_called_once()
        added_user = mock_session.add.call_args[0][0]
        assert added_user.type == InvokeFrom.SERVICE_API
        assert added_user.tenant_id == tenant_id
        assert added_user.app_id == app_id
        assert added_user.session_id == user_id

    # Test 05: Create new end user with WEB_APP type
    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_create_end_user_web_app_type(self, mock_db, mock_session_class, factory):
        """Test creating new end user with WEB_APP type."""
        # Arrange
        tenant_id = "tenant-123"
        app_id = "app-456"
        user_id = "user-789"

        mock_session = MagicMock()
        mock_session_class.return_value.__enter__.return_value = mock_session

        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.first.return_value = None

        # Act
        result = EndUserService.get_or_create_end_user_by_type(
            type=InvokeFrom.WEB_APP,
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=user_id,
        )

        # Assert
        mock_session.add.assert_called_once()
        added_user = mock_session.add.call_args[0][0]
        assert added_user.type == InvokeFrom.WEB_APP

    # Test 06: Upgrade legacy end user type
    @patch("services.end_user_service.logger")
    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_upgrade_legacy_end_user_type(self, mock_db, mock_session_class, mock_logger, factory):
        """Test upgrading legacy end user with different type."""
        # Arrange
        tenant_id = "tenant-123"
        app_id = "app-456"
        user_id = "user-789"

        # Existing user with old type
        existing_user = factory.create_end_user_mock(
            tenant_id=tenant_id,
            app_id=app_id,
            session_id=user_id,
            type=InvokeFrom.SERVICE_API,
        )

        mock_session = MagicMock()
        mock_session_class.return_value.__enter__.return_value = mock_session

        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.first.return_value = existing_user

        # Act - Request with different type
        result = EndUserService.get_or_create_end_user_by_type(
            type=InvokeFrom.WEB_APP,
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=user_id,
        )

        # Assert
        assert result == existing_user
        assert existing_user.type == InvokeFrom.WEB_APP  # Type should be updated
        mock_session.commit.assert_called_once()
        mock_logger.info.assert_called_once()
        # Verify log message contains upgrade info
        log_call = mock_logger.info.call_args[0][0]
        assert "Upgrading legacy EndUser" in log_call

    # Test 07: Get existing end user with matching type (no upgrade needed)
    @patch("services.end_user_service.logger")
    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_get_existing_end_user_matching_type(self, mock_db, mock_session_class, mock_logger, factory):
        """Test retrieving existing end user with matching type."""
        # Arrange
        tenant_id = "tenant-123"
        app_id = "app-456"
        user_id = "user-789"

        existing_user = factory.create_end_user_mock(
            tenant_id=tenant_id,
            app_id=app_id,
            session_id=user_id,
            type=InvokeFrom.SERVICE_API,
        )

        mock_session = MagicMock()
        mock_session_class.return_value.__enter__.return_value = mock_session

        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.first.return_value = existing_user

        # Act - Request with same type
        result = EndUserService.get_or_create_end_user_by_type(
            type=InvokeFrom.SERVICE_API,
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=user_id,
        )

        # Assert
        assert result == existing_user
        assert existing_user.type == InvokeFrom.SERVICE_API
        # No commit should be called (no type update needed)
        mock_session.commit.assert_not_called()
        mock_logger.info.assert_not_called()

    # Test 08: Create anonymous user with default session ID
    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_create_anonymous_user_with_default_session(self, mock_db, mock_session_class, factory):
        """Test creating anonymous user when user_id is None."""
        # Arrange
        tenant_id = "tenant-123"
        app_id = "app-456"

        mock_session = MagicMock()
        mock_session_class.return_value.__enter__.return_value = mock_session

        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.first.return_value = None

        # Act
        result = EndUserService.get_or_create_end_user_by_type(
            type=InvokeFrom.SERVICE_API,
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=None,
        )

        # Assert
        mock_session.add.assert_called_once()
        added_user = mock_session.add.call_args[0][0]
        assert added_user.session_id == DefaultEndUserSessionID.DEFAULT_SESSION_ID
        # Verify _is_anonymous is set correctly (property always returns False)
        assert added_user._is_anonymous is True
        assert added_user.external_user_id == DefaultEndUserSessionID.DEFAULT_SESSION_ID

    # Test 09: Query ordering prioritizes matching type
    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_query_ordering_prioritizes_matching_type(self, mock_db, mock_session_class, factory):
        """Test that query ordering prioritizes records with matching type."""
        # Arrange
        tenant_id = "tenant-123"
        app_id = "app-456"
        user_id = "user-789"

        mock_session = MagicMock()
        mock_session_class.return_value.__enter__.return_value = mock_session

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
        # Verify order_by was called (for type prioritization)
        mock_query.order_by.assert_called_once()

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

    # Test 11: External user ID matches session ID
    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_external_user_id_matches_session_id(self, mock_db, mock_session_class, factory):
        """Test that external_user_id is set to match session_id."""
        # Arrange
        tenant_id = "tenant-123"
        app_id = "app-456"
        user_id = "custom-external-id"

        mock_session = MagicMock()
        mock_session_class.return_value.__enter__.return_value = mock_session

        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.first.return_value = None

        # Act
        result = EndUserService.get_or_create_end_user_by_type(
            type=InvokeFrom.SERVICE_API,
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=user_id,
        )

        # Assert
        added_user = mock_session.add.call_args[0][0]
        assert added_user.external_user_id == user_id
        assert added_user.session_id == user_id

    # Test 12: Different InvokeFrom types
    @pytest.mark.parametrize(
        "invoke_type",
        [
            InvokeFrom.SERVICE_API,
            InvokeFrom.WEB_APP,
            InvokeFrom.EXPLORE,
            InvokeFrom.DEBUGGER,
        ],
    )
    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_create_end_user_with_different_invoke_types(self, mock_db, mock_session_class, invoke_type, factory):
        """Test creating end users with different InvokeFrom types."""
        # Arrange
        tenant_id = "tenant-123"
        app_id = "app-456"
        user_id = "user-789"

        mock_session = MagicMock()
        mock_session_class.return_value.__enter__.return_value = mock_session

        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.first.return_value = None

        # Act
        result = EndUserService.get_or_create_end_user_by_type(
            type=invoke_type,
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=user_id,
        )

        # Assert
        added_user = mock_session.add.call_args[0][0]
        assert added_user.type == invoke_type
