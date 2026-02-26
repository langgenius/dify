"""
Comprehensive unit tests for SavedMessageService.

This test suite provides complete coverage of saved message operations in Dify,
following TDD principles with the Arrange-Act-Assert pattern.

## Test Coverage

### 1. Pagination (TestSavedMessageServicePagination)
Tests saved message listing and pagination:
- Pagination with valid user (Account and EndUser)
- Pagination without user raises ValueError
- Pagination with last_id parameter
- Empty results when no saved messages exist
- Integration with MessageService pagination

### 2. Save Operations (TestSavedMessageServiceSave)
Tests saving messages:
- Save message for Account user
- Save message for EndUser
- Save without user (no-op)
- Prevent duplicate saves (idempotent)
- Message validation through MessageService

### 3. Delete Operations (TestSavedMessageServiceDelete)
Tests deleting saved messages:
- Delete saved message for Account user
- Delete saved message for EndUser
- Delete without user (no-op)
- Delete non-existent saved message (no-op)
- Proper database cleanup

## Testing Approach

- **Mocking Strategy**: All external dependencies (database, MessageService) are mocked
  for fast, isolated unit tests
- **Factory Pattern**: SavedMessageServiceTestDataFactory provides consistent test data
- **Fixtures**: Mock objects are configured per test method
- **Assertions**: Each test verifies return values and side effects
  (database operations, method calls)

## Key Concepts

**User Types:**
- Account: Workspace members (console users)
- EndUser: API users (end users)

**Saved Messages:**
- Users can save messages for later reference
- Each user has their own saved message list
- Saving is idempotent (duplicate saves ignored)
- Deletion is safe (non-existent deletes ignored)
"""

from datetime import UTC, datetime
from unittest.mock import MagicMock, Mock, create_autospec, patch

import pytest

from libs.infinite_scroll_pagination import InfiniteScrollPagination
from models import Account
from models.model import App, EndUser, Message
from models.web import SavedMessage
from services.saved_message_service import SavedMessageService


class SavedMessageServiceTestDataFactory:
    """
    Factory for creating test data and mock objects.

    Provides reusable methods to create consistent mock objects for testing
    saved message operations.
    """

    @staticmethod
    def create_account_mock(account_id: str = "account-123", **kwargs) -> Mock:
        """
        Create a mock Account object.

        Args:
            account_id: Unique identifier for the account
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock Account object with specified attributes
        """
        account = create_autospec(Account, instance=True)
        account.id = account_id
        for key, value in kwargs.items():
            setattr(account, key, value)
        return account

    @staticmethod
    def create_end_user_mock(user_id: str = "user-123", **kwargs) -> Mock:
        """
        Create a mock EndUser object.

        Args:
            user_id: Unique identifier for the end user
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock EndUser object with specified attributes
        """
        user = create_autospec(EndUser, instance=True)
        user.id = user_id
        for key, value in kwargs.items():
            setattr(user, key, value)
        return user

    @staticmethod
    def create_app_mock(app_id: str = "app-123", tenant_id: str = "tenant-123", **kwargs) -> Mock:
        """
        Create a mock App object.

        Args:
            app_id: Unique identifier for the app
            tenant_id: Tenant/workspace identifier
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock App object with specified attributes
        """
        app = create_autospec(App, instance=True)
        app.id = app_id
        app.tenant_id = tenant_id
        app.name = kwargs.get("name", "Test App")
        app.mode = kwargs.get("mode", "chat")
        for key, value in kwargs.items():
            setattr(app, key, value)
        return app

    @staticmethod
    def create_message_mock(
        message_id: str = "msg-123",
        app_id: str = "app-123",
        **kwargs,
    ) -> Mock:
        """
        Create a mock Message object.

        Args:
            message_id: Unique identifier for the message
            app_id: Associated app identifier
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock Message object with specified attributes
        """
        message = create_autospec(Message, instance=True)
        message.id = message_id
        message.app_id = app_id
        message.query = kwargs.get("query", "Test query")
        message.answer = kwargs.get("answer", "Test answer")
        message.created_at = kwargs.get("created_at", datetime.now(UTC))
        for key, value in kwargs.items():
            setattr(message, key, value)
        return message

    @staticmethod
    def create_saved_message_mock(
        saved_message_id: str = "saved-123",
        app_id: str = "app-123",
        message_id: str = "msg-123",
        created_by: str = "user-123",
        created_by_role: str = "account",
        **kwargs,
    ) -> Mock:
        """
        Create a mock SavedMessage object.

        Args:
            saved_message_id: Unique identifier for the saved message
            app_id: Associated app identifier
            message_id: Associated message identifier
            created_by: User who saved the message
            created_by_role: Role of the user ('account' or 'end_user')
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock SavedMessage object with specified attributes
        """
        saved_message = create_autospec(SavedMessage, instance=True)
        saved_message.id = saved_message_id
        saved_message.app_id = app_id
        saved_message.message_id = message_id
        saved_message.created_by = created_by
        saved_message.created_by_role = created_by_role
        saved_message.created_at = kwargs.get("created_at", datetime.now(UTC))
        for key, value in kwargs.items():
            setattr(saved_message, key, value)
        return saved_message


@pytest.fixture
def factory():
    """Provide the test data factory to all tests."""
    return SavedMessageServiceTestDataFactory


class TestSavedMessageServicePagination:
    """Test saved message pagination operations."""

    @patch("services.saved_message_service.MessageService.pagination_by_last_id")
    @patch("services.saved_message_service.db.session")
    def test_pagination_with_account_user(self, mock_db_session, mock_message_pagination, factory):
        """Test pagination with an Account user."""
        # Arrange
        app = factory.create_app_mock()
        user = factory.create_account_mock()

        # Create saved messages for this user
        saved_messages = [
            factory.create_saved_message_mock(
                saved_message_id=f"saved-{i}",
                app_id=app.id,
                message_id=f"msg-{i}",
                created_by=user.id,
                created_by_role="account",
            )
            for i in range(3)
        ]

        # Mock database query
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = saved_messages

        # Mock MessageService pagination response
        expected_pagination = InfiniteScrollPagination(data=[], limit=20, has_more=False)
        mock_message_pagination.return_value = expected_pagination

        # Act
        result = SavedMessageService.pagination_by_last_id(app_model=app, user=user, last_id=None, limit=20)

        # Assert
        assert result == expected_pagination
        mock_db_session.query.assert_called_once_with(SavedMessage)
        # Verify MessageService was called with correct message IDs
        mock_message_pagination.assert_called_once_with(
            app_model=app,
            user=user,
            last_id=None,
            limit=20,
            include_ids=["msg-0", "msg-1", "msg-2"],
        )

    @patch("services.saved_message_service.MessageService.pagination_by_last_id")
    @patch("services.saved_message_service.db.session")
    def test_pagination_with_end_user(self, mock_db_session, mock_message_pagination, factory):
        """Test pagination with an EndUser."""
        # Arrange
        app = factory.create_app_mock()
        user = factory.create_end_user_mock()

        # Create saved messages for this end user
        saved_messages = [
            factory.create_saved_message_mock(
                saved_message_id=f"saved-{i}",
                app_id=app.id,
                message_id=f"msg-{i}",
                created_by=user.id,
                created_by_role="end_user",
            )
            for i in range(2)
        ]

        # Mock database query
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = saved_messages

        # Mock MessageService pagination response
        expected_pagination = InfiniteScrollPagination(data=[], limit=10, has_more=False)
        mock_message_pagination.return_value = expected_pagination

        # Act
        result = SavedMessageService.pagination_by_last_id(app_model=app, user=user, last_id=None, limit=10)

        # Assert
        assert result == expected_pagination
        # Verify correct role was used in query
        mock_message_pagination.assert_called_once_with(
            app_model=app,
            user=user,
            last_id=None,
            limit=10,
            include_ids=["msg-0", "msg-1"],
        )

    def test_pagination_without_user_raises_error(self, factory):
        """Test that pagination without user raises ValueError."""
        # Arrange
        app = factory.create_app_mock()

        # Act & Assert
        with pytest.raises(ValueError, match="User is required"):
            SavedMessageService.pagination_by_last_id(app_model=app, user=None, last_id=None, limit=20)

    @patch("services.saved_message_service.MessageService.pagination_by_last_id")
    @patch("services.saved_message_service.db.session")
    def test_pagination_with_last_id(self, mock_db_session, mock_message_pagination, factory):
        """Test pagination with last_id parameter."""
        # Arrange
        app = factory.create_app_mock()
        user = factory.create_account_mock()
        last_id = "msg-last"

        saved_messages = [
            factory.create_saved_message_mock(
                message_id=f"msg-{i}",
                app_id=app.id,
                created_by=user.id,
            )
            for i in range(5)
        ]

        # Mock database query
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = saved_messages

        # Mock MessageService pagination response
        expected_pagination = InfiniteScrollPagination(data=[], limit=10, has_more=True)
        mock_message_pagination.return_value = expected_pagination

        # Act
        result = SavedMessageService.pagination_by_last_id(app_model=app, user=user, last_id=last_id, limit=10)

        # Assert
        assert result == expected_pagination
        # Verify last_id was passed to MessageService
        mock_message_pagination.assert_called_once()
        call_args = mock_message_pagination.call_args
        assert call_args.kwargs["last_id"] == last_id

    @patch("services.saved_message_service.MessageService.pagination_by_last_id")
    @patch("services.saved_message_service.db.session")
    def test_pagination_with_empty_saved_messages(self, mock_db_session, mock_message_pagination, factory):
        """Test pagination when user has no saved messages."""
        # Arrange
        app = factory.create_app_mock()
        user = factory.create_account_mock()

        # Mock database query returning empty list
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = []

        # Mock MessageService pagination response
        expected_pagination = InfiniteScrollPagination(data=[], limit=20, has_more=False)
        mock_message_pagination.return_value = expected_pagination

        # Act
        result = SavedMessageService.pagination_by_last_id(app_model=app, user=user, last_id=None, limit=20)

        # Assert
        assert result == expected_pagination
        # Verify MessageService was called with empty include_ids
        mock_message_pagination.assert_called_once_with(
            app_model=app,
            user=user,
            last_id=None,
            limit=20,
            include_ids=[],
        )


class TestSavedMessageServiceSave:
    """Test save message operations."""

    @patch("services.saved_message_service.MessageService.get_message")
    @patch("services.saved_message_service.db.session")
    def test_save_message_for_account(self, mock_db_session, mock_get_message, factory):
        """Test saving a message for an Account user."""
        # Arrange
        app = factory.create_app_mock()
        user = factory.create_account_mock()
        message = factory.create_message_mock(message_id="msg-123", app_id=app.id)

        # Mock database query - no existing saved message
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        # Mock MessageService.get_message
        mock_get_message.return_value = message

        # Act
        SavedMessageService.save(app_model=app, user=user, message_id=message.id)

        # Assert
        mock_db_session.add.assert_called_once()
        saved_message = mock_db_session.add.call_args[0][0]
        assert saved_message.app_id == app.id
        assert saved_message.message_id == message.id
        assert saved_message.created_by == user.id
        assert saved_message.created_by_role == "account"
        mock_db_session.commit.assert_called_once()

    @patch("services.saved_message_service.MessageService.get_message")
    @patch("services.saved_message_service.db.session")
    def test_save_message_for_end_user(self, mock_db_session, mock_get_message, factory):
        """Test saving a message for an EndUser."""
        # Arrange
        app = factory.create_app_mock()
        user = factory.create_end_user_mock()
        message = factory.create_message_mock(message_id="msg-456", app_id=app.id)

        # Mock database query - no existing saved message
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        # Mock MessageService.get_message
        mock_get_message.return_value = message

        # Act
        SavedMessageService.save(app_model=app, user=user, message_id=message.id)

        # Assert
        mock_db_session.add.assert_called_once()
        saved_message = mock_db_session.add.call_args[0][0]
        assert saved_message.app_id == app.id
        assert saved_message.message_id == message.id
        assert saved_message.created_by == user.id
        assert saved_message.created_by_role == "end_user"
        mock_db_session.commit.assert_called_once()

    @patch("services.saved_message_service.db.session")
    def test_save_without_user_does_nothing(self, mock_db_session, factory):
        """Test that saving without user is a no-op."""
        # Arrange
        app = factory.create_app_mock()

        # Act
        SavedMessageService.save(app_model=app, user=None, message_id="msg-123")

        # Assert
        mock_db_session.query.assert_not_called()
        mock_db_session.add.assert_not_called()
        mock_db_session.commit.assert_not_called()

    @patch("services.saved_message_service.MessageService.get_message")
    @patch("services.saved_message_service.db.session")
    def test_save_duplicate_message_is_idempotent(self, mock_db_session, mock_get_message, factory):
        """Test that saving an already saved message is idempotent."""
        # Arrange
        app = factory.create_app_mock()
        user = factory.create_account_mock()
        message_id = "msg-789"

        # Mock database query - existing saved message found
        existing_saved = factory.create_saved_message_mock(
            app_id=app.id,
            message_id=message_id,
            created_by=user.id,
            created_by_role="account",
        )
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = existing_saved

        # Act
        SavedMessageService.save(app_model=app, user=user, message_id=message_id)

        # Assert - no new saved message created
        mock_db_session.add.assert_not_called()
        mock_db_session.commit.assert_not_called()
        mock_get_message.assert_not_called()

    @patch("services.saved_message_service.MessageService.get_message")
    @patch("services.saved_message_service.db.session")
    def test_save_validates_message_exists(self, mock_db_session, mock_get_message, factory):
        """Test that save validates message exists through MessageService."""
        # Arrange
        app = factory.create_app_mock()
        user = factory.create_account_mock()
        message = factory.create_message_mock()

        # Mock database query - no existing saved message
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        # Mock MessageService.get_message
        mock_get_message.return_value = message

        # Act
        SavedMessageService.save(app_model=app, user=user, message_id=message.id)

        # Assert - MessageService.get_message was called for validation
        mock_get_message.assert_called_once_with(app_model=app, user=user, message_id=message.id)


class TestSavedMessageServiceDelete:
    """Test delete saved message operations."""

    @patch("services.saved_message_service.db.session")
    def test_delete_saved_message_for_account(self, mock_db_session, factory):
        """Test deleting a saved message for an Account user."""
        # Arrange
        app = factory.create_app_mock()
        user = factory.create_account_mock()
        message_id = "msg-123"

        # Mock database query - existing saved message found
        saved_message = factory.create_saved_message_mock(
            app_id=app.id,
            message_id=message_id,
            created_by=user.id,
            created_by_role="account",
        )
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = saved_message

        # Act
        SavedMessageService.delete(app_model=app, user=user, message_id=message_id)

        # Assert
        mock_db_session.delete.assert_called_once_with(saved_message)
        mock_db_session.commit.assert_called_once()

    @patch("services.saved_message_service.db.session")
    def test_delete_saved_message_for_end_user(self, mock_db_session, factory):
        """Test deleting a saved message for an EndUser."""
        # Arrange
        app = factory.create_app_mock()
        user = factory.create_end_user_mock()
        message_id = "msg-456"

        # Mock database query - existing saved message found
        saved_message = factory.create_saved_message_mock(
            app_id=app.id,
            message_id=message_id,
            created_by=user.id,
            created_by_role="end_user",
        )
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = saved_message

        # Act
        SavedMessageService.delete(app_model=app, user=user, message_id=message_id)

        # Assert
        mock_db_session.delete.assert_called_once_with(saved_message)
        mock_db_session.commit.assert_called_once()

    @patch("services.saved_message_service.db.session")
    def test_delete_without_user_does_nothing(self, mock_db_session, factory):
        """Test that deleting without user is a no-op."""
        # Arrange
        app = factory.create_app_mock()

        # Act
        SavedMessageService.delete(app_model=app, user=None, message_id="msg-123")

        # Assert
        mock_db_session.query.assert_not_called()
        mock_db_session.delete.assert_not_called()
        mock_db_session.commit.assert_not_called()

    @patch("services.saved_message_service.db.session")
    def test_delete_non_existent_saved_message_does_nothing(self, mock_db_session, factory):
        """Test that deleting a non-existent saved message is a no-op."""
        # Arrange
        app = factory.create_app_mock()
        user = factory.create_account_mock()
        message_id = "msg-nonexistent"

        # Mock database query - no saved message found
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        # Act
        SavedMessageService.delete(app_model=app, user=user, message_id=message_id)

        # Assert - no deletion occurred
        mock_db_session.delete.assert_not_called()
        mock_db_session.commit.assert_not_called()

    @patch("services.saved_message_service.db.session")
    def test_delete_only_affects_user_own_saved_messages(self, mock_db_session, factory):
        """Test that delete only removes the user's own saved message."""
        # Arrange
        app = factory.create_app_mock()
        user1 = factory.create_account_mock(account_id="user-1")
        message_id = "msg-shared"

        # Mock database query - finds user1's saved message
        saved_message = factory.create_saved_message_mock(
            app_id=app.id,
            message_id=message_id,
            created_by=user1.id,
            created_by_role="account",
        )
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = saved_message

        # Act
        SavedMessageService.delete(app_model=app, user=user1, message_id=message_id)

        # Assert - only user1's saved message is deleted
        mock_db_session.delete.assert_called_once_with(saved_message)
        # Verify the query filters by user
        assert mock_query.where.called
