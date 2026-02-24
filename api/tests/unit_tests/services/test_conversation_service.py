"""
Comprehensive unit tests for ConversationService.

This file keeps non-SQL guard/unit tests.
SQL-related tests were migrated to testcontainers integration tests.
"""

from datetime import datetime
from unittest.mock import MagicMock, Mock, create_autospec, patch

from core.app.entities.app_invoke_entities import InvokeFrom
from models import Account
from models.model import App, Conversation, EndUser
from services.conversation_service import ConversationService
from services.message_service import MessageService


class ConversationServiceTestDataFactory:
    """
    Factory for creating test data and mock objects.

    Provides reusable methods to create consistent mock objects for testing
    conversation-related operations.
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
        app.status = kwargs.get("status", "normal")
        for key, value in kwargs.items():
            setattr(app, key, value)
        return app

    @staticmethod
    def create_conversation_mock(
        conversation_id: str = "conv-123",
        app_id: str = "app-123",
        from_source: str = "console",
        **kwargs,
    ) -> Mock:
        """
        Create a mock Conversation object.

        Args:
            conversation_id: Unique identifier for the conversation
            app_id: Associated app identifier
            from_source: Source of conversation ('console' or 'api')
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock Conversation object with specified attributes
        """
        conversation = create_autospec(Conversation, instance=True)
        conversation.id = conversation_id
        conversation.app_id = app_id
        conversation.from_source = from_source
        conversation.from_end_user_id = kwargs.get("from_end_user_id")
        conversation.from_account_id = kwargs.get("from_account_id")
        conversation.is_deleted = kwargs.get("is_deleted", False)
        conversation.name = kwargs.get("name", "Test Conversation")
        conversation.status = kwargs.get("status", "normal")
        conversation.created_at = kwargs.get("created_at", datetime.utcnow())
        conversation.updated_at = kwargs.get("updated_at", datetime.utcnow())
        for key, value in kwargs.items():
            setattr(conversation, key, value)
        return conversation


class TestConversationServicePagination:
    """Test conversation pagination operations."""

    def test_pagination_with_empty_include_ids(self):
        """
        Test that empty include_ids returns empty result.

        When include_ids is an empty list, the service should short-circuit
        and return empty results without querying the database.
        """
        # Arrange - Set up test data
        mock_session = MagicMock()  # Mock database session
        mock_app_model = ConversationServiceTestDataFactory.create_app_mock()
        mock_user = ConversationServiceTestDataFactory.create_account_mock()

        # Act - Call the service method with empty include_ids
        result = ConversationService.pagination_by_last_id(
            session=mock_session,
            app_model=mock_app_model,
            user=mock_user,
            last_id=None,
            limit=20,
            invoke_from=InvokeFrom.WEB_APP,
            include_ids=[],  # Empty list should trigger early return
            exclude_ids=None,
        )

        # Assert - Verify empty result without database query
        assert result.data == []  # No conversations returned
        assert result.has_more is False  # No more pages available
        assert result.limit == 20  # Limit preserved in response

    def test_pagination_returns_empty_when_user_is_none(self):
        """
        Test that pagination returns empty result when user is None.

        This ensures proper handling of unauthenticated requests.
        """
        # Arrange
        mock_session = MagicMock()
        mock_app_model = ConversationServiceTestDataFactory.create_app_mock()

        # Act
        result = ConversationService.pagination_by_last_id(
            session=mock_session,
            app_model=mock_app_model,
            user=None,  # No user provided
            last_id=None,
            limit=20,
            invoke_from=InvokeFrom.WEB_APP,
        )

        # Assert - should return empty result without querying database
        assert result.data == []
        assert result.has_more is False
        assert result.limit == 20


class TestConversationServiceMessageCreation:
    """
    Test message creation and pagination.

    Tests MessageService operations for creating and retrieving messages
    within conversations.
    """

    def test_pagination_returns_empty_when_no_user(self):
        """
        Test that pagination returns empty result when user is None.

        This ensures proper handling of unauthenticated requests.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()

        # Act
        result = MessageService.pagination_by_first_id(
            app_model=app_model,
            user=None,
            conversation_id="conv-123",
            first_id=None,
            limit=10,
        )

        # Assert
        assert result.data == []
        assert result.has_more is False

    def test_pagination_returns_empty_when_no_conversation_id(self):
        """
        Test that pagination returns empty result when conversation_id is None.

        This ensures proper handling of invalid requests.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()

        # Act
        result = MessageService.pagination_by_first_id(
            app_model=app_model,
            user=user,
            conversation_id="",
            first_id=None,
            limit=10,
        )

        # Assert
        assert result.data == []
        assert result.has_more is False


class TestConversationServiceSummarization:
    """
    Test conversation summarization (auto-generated names).

    Tests the auto_generate_name functionality that creates conversation
    titles based on the first message.
    """

    @patch("services.conversation_service.db.session")
    @patch("services.conversation_service.ConversationService.get_conversation")
    @patch("services.conversation_service.ConversationService.auto_generate_name")
    def test_rename_with_auto_generate(self, mock_auto_generate, mock_get_conversation, mock_db_session):
        """
        Test renaming conversation with auto-generation enabled.

        When auto_generate is True, the service should call the auto_generate_name
        method to generate a new name for the conversation.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()
        conversation = ConversationServiceTestDataFactory.create_conversation_mock()
        conversation.name = "Auto-generated Name"

        # Mock the conversation lookup to return our test conversation
        mock_get_conversation.return_value = conversation

        # Mock the auto_generate_name method to return the conversation
        mock_auto_generate.return_value = conversation

        # Act
        result = ConversationService.rename(
            app_model=app_model,
            conversation_id=conversation.id,
            user=user,
            name="",
            auto_generate=True,
        )

        # Assert
        mock_auto_generate.assert_called_once_with(app_model, conversation)
        assert result == conversation
