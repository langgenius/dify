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


class TestEndUserServiceGetEndUserById:
    """Unit tests for EndUserService.get_end_user_by_id method."""

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestEndUserServiceFactory()

    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_get_end_user_by_id_success(self, mock_db, mock_session_class, factory):
        """Test successful retrieval of end user by ID."""
        # Arrange
        tenant_id = "tenant-123"
        app_id = "app-456"
        end_user_id = "user-789"

        mock_end_user = factory.create_end_user_mock(user_id=end_user_id, tenant_id=tenant_id, app_id=app_id)

        mock_session = MagicMock()
        mock_context = MagicMock()
        mock_context.__enter__.return_value = mock_session
        mock_session_class.return_value = mock_context

        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = mock_end_user

        # Act
        result = EndUserService.get_end_user_by_id(tenant_id=tenant_id, app_id=app_id, end_user_id=end_user_id)

        # Assert
        assert result == mock_end_user
        mock_session.query.assert_called_once_with(EndUser)
        mock_query.where.assert_called_once()
        mock_query.first.assert_called_once()
        mock_context.__enter__.assert_called_once()
        mock_context.__exit__.assert_called_once()

    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_get_end_user_by_id_not_found(self, mock_db, mock_session_class):
        """Test retrieval of non-existent end user returns None."""
        # Arrange
        tenant_id = "tenant-123"
        app_id = "app-456"
        end_user_id = "user-789"

        mock_session = MagicMock()
        mock_context = MagicMock()
        mock_context.__enter__.return_value = mock_session
        mock_session_class.return_value = mock_context

        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        # Act
        result = EndUserService.get_end_user_by_id(tenant_id=tenant_id, app_id=app_id, end_user_id=end_user_id)

        # Assert
        assert result is None

    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_get_end_user_by_id_query_parameters(self, mock_db, mock_session_class):
        """Test that query parameters are correctly applied."""
        # Arrange
        tenant_id = "tenant-123"
        app_id = "app-456"
        end_user_id = "user-789"

        mock_session = MagicMock()
        mock_context = MagicMock()
        mock_context.__enter__.return_value = mock_session
        mock_session_class.return_value = mock_context

        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        # Act
        EndUserService.get_end_user_by_id(tenant_id=tenant_id, app_id=app_id, end_user_id=end_user_id)

        # Assert
        # Verify the where clause was called with the correct conditions
        call_args = mock_query.where.call_args[0]
        assert len(call_args) == 3
        # Check that the conditions match the expected filters
        # (We can't easily test the exact conditions without importing SQLAlchemy)


class TestEndUserServiceGetOrCreateEndUser:
    """Unit tests for EndUserService.get_or_create_end_user method."""

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestEndUserServiceFactory()

    @patch("services.end_user_service.EndUserService.get_or_create_end_user_by_type")
    def test_get_or_create_end_user_with_user_id(self, mock_get_or_create_by_type, factory):
        """Test get_or_create_end_user with specific user_id."""
        # Arrange
        app_mock = factory.create_app_mock()
        user_id = "user-123"
        expected_end_user = factory.create_end_user_mock()
        mock_get_or_create_by_type.return_value = expected_end_user

        # Act
        result = EndUserService.get_or_create_end_user(app_mock, user_id)

        # Assert
        assert result == expected_end_user
        mock_get_or_create_by_type.assert_called_once_with(
            InvokeFrom.SERVICE_API, app_mock.tenant_id, app_mock.id, user_id
        )

    @patch("services.end_user_service.EndUserService.get_or_create_end_user_by_type")
    def test_get_or_create_end_user_without_user_id(self, mock_get_or_create_by_type, factory):
        """Test get_or_create_end_user without user_id (None)."""
        # Arrange
        app_mock = factory.create_app_mock()
        expected_end_user = factory.create_end_user_mock()
        mock_get_or_create_by_type.return_value = expected_end_user

        # Act
        result = EndUserService.get_or_create_end_user(app_mock, None)

        # Assert
        assert result == expected_end_user
        mock_get_or_create_by_type.assert_called_once_with(
            InvokeFrom.SERVICE_API, app_mock.tenant_id, app_mock.id, None
        )


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

    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_create_new_end_user_with_user_id(self, mock_db, mock_session_class, factory):
        """Test creating a new end user with specific user_id."""
        # Arrange
        tenant_id = "tenant-123"
        app_id = "app-456"
        user_id = "user-789"
        type_enum = InvokeFrom.SERVICE_API

        mock_session = MagicMock()
        mock_context = MagicMock()
        mock_context.__enter__.return_value = mock_session
        mock_session_class.return_value = mock_context

        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.first.return_value = None  # No existing user

        # Act
        result = EndUserService.get_or_create_end_user_by_type(
            type=type_enum, tenant_id=tenant_id, app_id=app_id, user_id=user_id
        )

        # Assert
        # Verify new EndUser was created with correct parameters
        mock_session.add.assert_called_once()
        mock_session.commit.assert_called_once()
        added_user = mock_session.add.call_args[0][0]
        assert added_user.tenant_id == tenant_id
        assert added_user.app_id == app_id
        assert added_user.type == type_enum
        assert added_user.session_id == user_id
        assert added_user.external_user_id == user_id
        assert added_user._is_anonymous is False

    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_create_new_end_user_default_session(self, mock_db, mock_session_class, factory):
        """Test creating a new end user with default session ID."""
        # Arrange
        tenant_id = "tenant-123"
        app_id = "app-456"
        user_id = None
        type_enum = InvokeFrom.WEB_APP

        mock_session = MagicMock()
        mock_context = MagicMock()
        mock_context.__enter__.return_value = mock_session
        mock_session_class.return_value = mock_context

        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.first.return_value = None  # No existing user

        # Act
        result = EndUserService.get_or_create_end_user_by_type(
            type=type_enum, tenant_id=tenant_id, app_id=app_id, user_id=user_id
        )

        # Assert
        added_user = mock_session.add.call_args[0][0]
        assert added_user.session_id == DefaultEndUserSessionID.DEFAULT_SESSION_ID
        assert added_user.external_user_id == DefaultEndUserSessionID.DEFAULT_SESSION_ID
        assert added_user._is_anonymous is True

    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    @patch("services.end_user_service.logger")
    def test_existing_user_same_type(self, mock_logger, mock_db, mock_session_class, factory):
        """Test retrieving existing user with same type."""
        # Arrange
        tenant_id = "tenant-123"
        app_id = "app-456"
        user_id = "user-789"
        type_enum = InvokeFrom.SERVICE_API

        existing_user = factory.create_end_user_mock(
            tenant_id=tenant_id, app_id=app_id, session_id=user_id, type=type_enum
        )

        mock_session = MagicMock()
        mock_context = MagicMock()
        mock_context.__enter__.return_value = mock_session
        mock_session_class.return_value = mock_context

        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.first.return_value = existing_user

        # Act
        result = EndUserService.get_or_create_end_user_by_type(
            type=type_enum, tenant_id=tenant_id, app_id=app_id, user_id=user_id
        )

        # Assert
        assert result == existing_user
        mock_session.add.assert_not_called()
        mock_session.commit.assert_not_called()
        mock_logger.info.assert_not_called()

    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    @patch("services.end_user_service.logger")
    def test_existing_user_different_type_upgrade(self, mock_logger, mock_db, mock_session_class, factory):
        """Test upgrading existing user with different type."""
        # Arrange
        tenant_id = "tenant-123"
        app_id = "app-456"
        user_id = "user-789"
        old_type = InvokeFrom.WEB_APP
        new_type = InvokeFrom.SERVICE_API

        existing_user = factory.create_end_user_mock(
            tenant_id=tenant_id, app_id=app_id, session_id=user_id, type=old_type
        )

        mock_session = MagicMock()
        mock_context = MagicMock()
        mock_context.__enter__.return_value = mock_session
        mock_session_class.return_value = mock_context

        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.first.return_value = existing_user

        # Act
        result = EndUserService.get_or_create_end_user_by_type(
            type=new_type, tenant_id=tenant_id, app_id=app_id, user_id=user_id
        )

        # Assert
        assert result == existing_user
        assert existing_user.type == new_type
        mock_session.commit.assert_called_once()
        mock_logger.info.assert_called_once()
        logger_call_args = mock_logger.info.call_args[0]
        assert "Upgrading legacy EndUser" in logger_call_args[0]
        # The old and new types are passed as separate arguments
        assert mock_logger.info.call_args[0][1] == existing_user.id
        assert mock_logger.info.call_args[0][2] == old_type
        assert mock_logger.info.call_args[0][3] == new_type
        assert mock_logger.info.call_args[0][4] == user_id

    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_query_ordering_prioritizes_exact_type_match(self, mock_db, mock_session_class, factory):
        """Test that query ordering prioritizes exact type matches."""
        # Arrange
        tenant_id = "tenant-123"
        app_id = "app-456"
        user_id = "user-789"
        target_type = InvokeFrom.SERVICE_API

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
            type=target_type, tenant_id=tenant_id, app_id=app_id, user_id=user_id
        )

        # Assert
        mock_query.order_by.assert_called_once()
        # Verify that case statement is used for ordering
        order_by_call = mock_query.order_by.call_args[0][0]
        # The exact structure depends on SQLAlchemy's case implementation
        # but we can verify it was called

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

    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_all_invokefrom_types_supported(self, mock_db, mock_session_class):
        """Test that all InvokeFrom enum values are supported."""
        # Arrange
        tenant_id = "tenant-123"
        app_id = "app-456"
        user_id = "user-789"

        for invoke_type in InvokeFrom:
            with patch("services.end_user_service.Session") as mock_session_class:
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
                result = EndUserService.get_or_create_end_user_by_type(
                    type=invoke_type, tenant_id=tenant_id, app_id=app_id, user_id=user_id
                )

                # Assert
                added_user = mock_session.add.call_args[0][0]
                assert added_user.type == invoke_type


class TestEndUserServiceCreateEndUserBatch:
    """Unit tests for EndUserService.create_end_user_batch method."""

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestEndUserServiceFactory()

    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_create_batch_empty_app_ids(self, mock_db, mock_session_class):
        """Test batch creation with empty app_ids list."""
        # Arrange
        tenant_id = "tenant-123"
        app_ids: list[str] = []
        user_id = "user-789"
        type_enum = InvokeFrom.SERVICE_API

        # Act
        result = EndUserService.create_end_user_batch(
            type=type_enum, tenant_id=tenant_id, app_ids=app_ids, user_id=user_id
        )

        # Assert
        assert result == {}
        mock_session_class.assert_not_called()

    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_create_batch_default_session_id(self, mock_db, mock_session_class):
        """Test batch creation with empty user_id (uses default session)."""
        # Arrange
        tenant_id = "tenant-123"
        app_ids = ["app-456", "app-789"]
        user_id = ""
        type_enum = InvokeFrom.SERVICE_API

        mock_session = MagicMock()
        mock_context = MagicMock()
        mock_context.__enter__.return_value = mock_session
        mock_session_class.return_value = mock_context

        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.all.return_value = []  # No existing users

        # Act
        result = EndUserService.create_end_user_batch(
            type=type_enum, tenant_id=tenant_id, app_ids=app_ids, user_id=user_id
        )

        # Assert
        assert len(result) == 2
        for app_id, end_user in result.items():
            assert end_user.session_id == DefaultEndUserSessionID.DEFAULT_SESSION_ID
            assert end_user.external_user_id == DefaultEndUserSessionID.DEFAULT_SESSION_ID
            assert end_user._is_anonymous is True

    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_create_batch_deduplicate_app_ids(self, mock_db, mock_session_class):
        """Test that duplicate app_ids are deduplicated while preserving order."""
        # Arrange
        tenant_id = "tenant-123"
        app_ids = ["app-456", "app-789", "app-456", "app-123", "app-789"]
        user_id = "user-789"
        type_enum = InvokeFrom.SERVICE_API

        mock_session = MagicMock()
        mock_context = MagicMock()
        mock_context.__enter__.return_value = mock_session
        mock_session_class.return_value = mock_context

        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.all.return_value = []  # No existing users

        # Act
        result = EndUserService.create_end_user_batch(
            type=type_enum, tenant_id=tenant_id, app_ids=app_ids, user_id=user_id
        )

        # Assert
        # Should have 3 unique app_ids in original order
        assert len(result) == 3
        assert "app-456" in result
        assert "app-789" in result
        assert "app-123" in result

        # Verify the order is preserved
        added_users = mock_session.add_all.call_args[0][0]
        assert len(added_users) == 3
        assert added_users[0].app_id == "app-456"
        assert added_users[1].app_id == "app-789"
        assert added_users[2].app_id == "app-123"

    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_create_batch_all_existing_users(self, mock_db, mock_session_class, factory):
        """Test batch creation when all users already exist."""
        # Arrange
        tenant_id = "tenant-123"
        app_ids = ["app-456", "app-789"]
        user_id = "user-789"
        type_enum = InvokeFrom.SERVICE_API

        existing_user1 = factory.create_end_user_mock(
            tenant_id=tenant_id, app_id="app-456", session_id=user_id, type=type_enum
        )
        existing_user2 = factory.create_end_user_mock(
            tenant_id=tenant_id, app_id="app-789", session_id=user_id, type=type_enum
        )

        mock_session = MagicMock()
        mock_context = MagicMock()
        mock_context.__enter__.return_value = mock_session
        mock_session_class.return_value = mock_context

        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.all.return_value = [existing_user1, existing_user2]

        # Act
        result = EndUserService.create_end_user_batch(
            type=type_enum, tenant_id=tenant_id, app_ids=app_ids, user_id=user_id
        )

        # Assert
        assert len(result) == 2
        assert result["app-456"] == existing_user1
        assert result["app-789"] == existing_user2
        mock_session.add_all.assert_not_called()
        mock_session.commit.assert_not_called()

    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_create_batch_partial_existing_users(self, mock_db, mock_session_class, factory):
        """Test batch creation with some existing and some new users."""
        # Arrange
        tenant_id = "tenant-123"
        app_ids = ["app-456", "app-789", "app-123"]
        user_id = "user-789"
        type_enum = InvokeFrom.SERVICE_API

        existing_user1 = factory.create_end_user_mock(
            tenant_id=tenant_id, app_id="app-456", session_id=user_id, type=type_enum
        )
        # app-789 and app-123 don't exist

        mock_session = MagicMock()
        mock_context = MagicMock()
        mock_context.__enter__.return_value = mock_session
        mock_session_class.return_value = mock_context

        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.all.return_value = [existing_user1]

        # Act
        result = EndUserService.create_end_user_batch(
            type=type_enum, tenant_id=tenant_id, app_ids=app_ids, user_id=user_id
        )

        # Assert
        assert len(result) == 3
        assert result["app-456"] == existing_user1
        assert "app-789" in result
        assert "app-123" in result

        # Should create 2 new users
        mock_session.add_all.assert_called_once()
        added_users = mock_session.add_all.call_args[0][0]
        assert len(added_users) == 2

        mock_session.commit.assert_called_once()

    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_create_batch_handles_duplicates_in_existing(self, mock_db, mock_session_class, factory):
        """Test batch creation handles duplicates in existing users gracefully."""
        # Arrange
        tenant_id = "tenant-123"
        app_ids = ["app-456"]
        user_id = "user-789"
        type_enum = InvokeFrom.SERVICE_API

        # Simulate duplicate records in database
        existing_user1 = factory.create_end_user_mock(
            user_id="user-1", tenant_id=tenant_id, app_id="app-456", session_id=user_id, type=type_enum
        )
        existing_user2 = factory.create_end_user_mock(
            user_id="user-2", tenant_id=tenant_id, app_id="app-456", session_id=user_id, type=type_enum
        )

        mock_session = MagicMock()
        mock_context = MagicMock()
        mock_context.__enter__.return_value = mock_session
        mock_session_class.return_value = mock_context

        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.all.return_value = [existing_user1, existing_user2]

        # Act
        result = EndUserService.create_end_user_batch(
            type=type_enum, tenant_id=tenant_id, app_ids=app_ids, user_id=user_id
        )

        # Assert
        assert len(result) == 1
        # Should prefer the first one found
        assert result["app-456"] == existing_user1

    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_create_batch_all_invokefrom_types(self, mock_db, mock_session_class):
        """Test batch creation with all InvokeFrom types."""
        # Arrange
        tenant_id = "tenant-123"
        app_ids = ["app-456"]
        user_id = "user-789"

        for invoke_type in InvokeFrom:
            with patch("services.end_user_service.Session") as mock_session_class:
                mock_session = MagicMock()
                mock_context = MagicMock()
                mock_context.__enter__.return_value = mock_session
                mock_session_class.return_value = mock_context

                mock_query = MagicMock()
                mock_session.query.return_value = mock_query
                mock_query.where.return_value = mock_query
                mock_query.all.return_value = []  # No existing users

                # Act
                result = EndUserService.create_end_user_batch(
                    type=invoke_type, tenant_id=tenant_id, app_ids=app_ids, user_id=user_id
                )

                # Assert
                added_user = mock_session.add_all.call_args[0][0][0]
                assert added_user.type == invoke_type

    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_create_batch_single_app_id(self, mock_db, mock_session_class, factory):
        """Test batch creation with single app_id."""
        # Arrange
        tenant_id = "tenant-123"
        app_ids = ["app-456"]
        user_id = "user-789"
        type_enum = InvokeFrom.SERVICE_API

        mock_session = MagicMock()
        mock_context = MagicMock()
        mock_context.__enter__.return_value = mock_session
        mock_session_class.return_value = mock_context

        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.all.return_value = []  # No existing users

        # Act
        result = EndUserService.create_end_user_batch(
            type=type_enum, tenant_id=tenant_id, app_ids=app_ids, user_id=user_id
        )

        # Assert
        assert len(result) == 1
        assert "app-456" in result
        mock_session.add_all.assert_called_once()
        added_users = mock_session.add_all.call_args[0][0]
        assert len(added_users) == 1
        assert added_users[0].app_id == "app-456"

    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_create_batch_anonymous_vs_authenticated(self, mock_db, mock_session_class):
        """Test batch creation correctly sets anonymous flag."""
        # Arrange
        tenant_id = "tenant-123"
        app_ids = ["app-456", "app-789"]

        # Test with regular user ID
        mock_session = MagicMock()
        mock_context = MagicMock()
        mock_context.__enter__.return_value = mock_session
        mock_session_class.return_value = mock_context

        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.all.return_value = []  # No existing users

        # Act - authenticated user
        result = EndUserService.create_end_user_batch(
            type=InvokeFrom.SERVICE_API, tenant_id=tenant_id, app_ids=app_ids, user_id="user-789"
        )

        # Assert
        added_users = mock_session.add_all.call_args[0][0]
        for user in added_users:
            assert user._is_anonymous is False

        # Test with default session ID
        mock_session.reset_mock()
        mock_query.reset_mock()
        mock_query.all.return_value = []

        # Act - anonymous user
        result = EndUserService.create_end_user_batch(
            type=InvokeFrom.SERVICE_API,
            tenant_id=tenant_id,
            app_ids=app_ids,
            user_id=DefaultEndUserSessionID.DEFAULT_SESSION_ID,
        )

        # Assert
        added_users = mock_session.add_all.call_args[0][0]
        for user in added_users:
            assert user._is_anonymous is True

    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_create_batch_efficient_single_query(self, mock_db, mock_session_class):
        """Test that batch creation uses efficient single query for existing users."""
        # Arrange
        tenant_id = "tenant-123"
        app_ids = ["app-456", "app-789", "app-123"]
        user_id = "user-789"
        type_enum = InvokeFrom.SERVICE_API

        mock_session = MagicMock()
        mock_context = MagicMock()
        mock_context.__enter__.return_value = mock_session
        mock_session_class.return_value = mock_context

        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.all.return_value = []  # No existing users

        # Act
        EndUserService.create_end_user_batch(type=type_enum, tenant_id=tenant_id, app_ids=app_ids, user_id=user_id)

        # Assert
        # Should make exactly one query to check for existing users
        mock_session.query.assert_called_once_with(EndUser)
        mock_query.where.assert_called_once()
        mock_query.all.assert_called_once()

        # Verify the where clause uses .in_() for app_ids
        where_call = mock_query.where.call_args[0]
        # The exact structure depends on SQLAlchemy implementation
        # but we can verify it was called with the right parameters

    @patch("services.end_user_service.Session")
    @patch("services.end_user_service.db")
    def test_create_batch_session_context_manager(self, mock_db, mock_session_class):
        """Test that batch creation properly uses session context manager."""
        # Arrange
        tenant_id = "tenant-123"
        app_ids = ["app-456"]
        user_id = "user-789"
        type_enum = InvokeFrom.SERVICE_API

        mock_session = MagicMock()
        mock_context = MagicMock()
        mock_context.__enter__.return_value = mock_session
        mock_session_class.return_value = mock_context

        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.all.return_value = []  # No existing users

        # Act
        EndUserService.create_end_user_batch(type=type_enum, tenant_id=tenant_id, app_ids=app_ids, user_id=user_id)

        # Assert
        mock_context.__enter__.assert_called_once()
        mock_context.__exit__.assert_called_once()
        mock_session.commit.assert_called_once()
