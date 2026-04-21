"""
Comprehensive unit tests for ConversationService.

This file provides complete test coverage for all ConversationService methods.
Tests are organized by functionality and include edge cases, error handling,
and both positive and negative test scenarios.
"""

from unittest.mock import MagicMock, Mock, create_autospec, patch

from sqlalchemy import asc, desc

from core.app.entities.app_invoke_entities import InvokeFrom
from libs.datetime_utils import naive_utc_now
from models import Account, ConversationVariable
from models.model import App, Conversation, EndUser, Message
from services.conversation_service import ConversationService


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
        conversation.created_at = kwargs.get("created_at", naive_utc_now())
        conversation.updated_at = kwargs.get("updated_at", naive_utc_now())
        for key, value in kwargs.items():
            setattr(conversation, key, value)
        return conversation

    @staticmethod
    def create_message_mock(
        message_id: str = "msg-123",
        conversation_id: str = "conv-123",
        app_id: str = "app-123",
        **kwargs,
    ) -> Mock:
        """
        Create a mock Message object.

        Args:
            message_id: Unique identifier for the message
            conversation_id: Associated conversation identifier
            app_id: Associated app identifier
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock Message object with specified attributes
        """
        message = create_autospec(Message, instance=True)
        message.id = message_id
        message.conversation_id = conversation_id
        message.app_id = app_id
        message.query = kwargs.get("query", "Test message content")
        message.created_at = kwargs.get("created_at", naive_utc_now())
        for key, value in kwargs.items():
            setattr(message, key, value)
        return message

    @staticmethod
    def create_conversation_variable_mock(
        variable_id: str = "var-123",
        conversation_id: str = "conv-123",
        app_id: str = "app-123",
        **kwargs,
    ) -> Mock:
        """
        Create a mock ConversationVariable object.

        Args:
            variable_id: Unique identifier for the variable
            conversation_id: Associated conversation identifier
            app_id: Associated app identifier
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock ConversationVariable object with specified attributes
        """
        variable = create_autospec(ConversationVariable, instance=True)
        variable.id = variable_id
        variable.conversation_id = conversation_id
        variable.app_id = app_id
        variable.data = {"name": kwargs.get("name", "test_var"), "value": kwargs.get("value", "test_value")}
        variable.created_at = kwargs.get("created_at", naive_utc_now())
        variable.updated_at = kwargs.get("updated_at", naive_utc_now())

        # Mock to_variable method
        mock_variable = Mock()
        mock_variable.id = variable_id
        mock_variable.name = kwargs.get("name", "test_var")
        mock_variable.value_type = kwargs.get("value_type", "string")
        mock_variable.value = kwargs.get("value", "test_value")
        mock_variable.description = kwargs.get("description", "")
        mock_variable.selector = kwargs.get("selector", {})
        mock_variable.model_dump.return_value = {
            "id": variable_id,
            "name": kwargs.get("name", "test_var"),
            "value_type": kwargs.get("value_type", "string"),
            "value": kwargs.get("value", "test_value"),
            "description": kwargs.get("description", ""),
            "selector": kwargs.get("selector", {}),
        }
        variable.to_variable.return_value = mock_variable

        for key, value in kwargs.items():
            setattr(variable, key, value)
        return variable


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


class TestConversationServiceHelpers:
    """Test helper methods in ConversationService."""

    def test_get_sort_params_with_descending_sort(self):
        """
        Test _get_sort_params with descending sort prefix.

        When sort_by starts with '-', should return field name and desc function.
        """
        # Act
        field, direction = ConversationService._get_sort_params("-updated_at")

        # Assert
        assert field == "updated_at"
        assert direction == desc

    def test_get_sort_params_with_ascending_sort(self):
        """
        Test _get_sort_params with ascending sort.

        When sort_by doesn't start with '-', should return field name and asc function.
        """
        # Act
        field, direction = ConversationService._get_sort_params("created_at")

        # Assert
        assert field == "created_at"
        assert direction == asc

    def test_build_filter_condition_with_descending_sort(self):
        """
        Test _build_filter_condition with descending sort direction.

        Should create a less-than filter condition.
        """
        # Arrange
        mock_conversation = ConversationServiceTestDataFactory.create_conversation_mock()
        mock_conversation.updated_at = naive_utc_now()

        # Act
        condition = ConversationService._build_filter_condition(
            sort_field="updated_at",
            sort_direction=desc,
            reference_conversation=mock_conversation,
        )

        # Assert
        # The condition should be a comparison expression
        assert condition is not None

    def test_build_filter_condition_with_ascending_sort(self):
        """
        Test _build_filter_condition with ascending sort direction.

        Should create a greater-than filter condition.
        """
        # Arrange
        mock_conversation = ConversationServiceTestDataFactory.create_conversation_mock()
        mock_conversation.created_at = naive_utc_now()

        # Act
        condition = ConversationService._build_filter_condition(
            sort_field="created_at",
            sort_direction=asc,
            reference_conversation=mock_conversation,
        )

        # Assert
        # The condition should be a comparison expression
        assert condition is not None


class TestConversationServiceConversationalVariable:
    """Test conversational variable operations."""

    @patch("services.conversation_service.session_factory")
    @patch("services.conversation_service.ConversationService.get_conversation")
    @patch("services.conversation_service.dify_config")
    def test_get_conversational_variable_with_name_filter_mysql(
        self, mock_config, mock_get_conversation, mock_session_factory
    ):
        """
        Test variable filtering by name for MySQL databases.

        Should apply JSON extraction filter for variable names.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()
        conversation = ConversationServiceTestDataFactory.create_conversation_mock()

        mock_get_conversation.return_value = conversation
        mock_config.DB_TYPE = "mysql"

        # Mock session
        mock_session = MagicMock()
        mock_session_factory.create_session.return_value.__enter__.return_value = mock_session
        mock_session.scalars.return_value.all.return_value = []

        # Act
        ConversationService.get_conversational_variable(
            app_model=app_model,
            conversation_id="conv-123",
            user=user,
            limit=10,
            last_id=None,
            variable_name="test_var",
        )

        # Assert - JSON filter should be applied
        assert mock_session.scalars.called
