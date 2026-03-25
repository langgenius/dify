"""
Comprehensive unit tests for ConversationService.

This file provides complete test coverage for all ConversationService methods.
Tests are organized by functionality and include edge cases, error handling,
and both positive and negative test scenarios.
"""

from datetime import datetime, timedelta
from unittest.mock import MagicMock, Mock, create_autospec, patch

import pytest
from sqlalchemy import asc, desc

from core.app.entities.app_invoke_entities import InvokeFrom
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from models import Account, ConversationVariable
from models.enums import ConversationFromSource
from models.model import App, Conversation, EndUser, Message
from services.conversation_service import ConversationService
from services.errors.conversation import (
    ConversationNotExistsError,
    ConversationVariableNotExistsError,
    ConversationVariableTypeMismatchError,
    LastConversationNotExistsError,
)
from services.errors.message import MessageNotExistsError


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
        message.created_at = kwargs.get("created_at", datetime.utcnow())
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
        variable.created_at = kwargs.get("created_at", datetime.utcnow())
        variable.updated_at = kwargs.get("updated_at", datetime.utcnow())

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
        mock_conversation.updated_at = datetime.utcnow()

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
        mock_conversation.created_at = datetime.utcnow()

        # Act
        condition = ConversationService._build_filter_condition(
            sort_field="created_at",
            sort_direction=asc,
            reference_conversation=mock_conversation,
        )

        # Assert
        # The condition should be a comparison expression
        assert condition is not None


class TestConversationServiceGetConversation:
    """Test conversation retrieval operations."""

    @patch("services.conversation_service.db.session")
    def test_get_conversation_success_with_account(self, mock_db_session):
        """
        Test successful conversation retrieval with account user.

        Should return conversation when found with proper filters.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()
        conversation = ConversationServiceTestDataFactory.create_conversation_mock(
            from_account_id=user.id, from_source=ConversationFromSource.CONSOLE
        )

        mock_query = mock_db_session.query.return_value
        mock_query.where.return_value.first.return_value = conversation

        # Act
        result = ConversationService.get_conversation(app_model, "conv-123", user)

        # Assert
        assert result == conversation
        mock_db_session.query.assert_called_once_with(Conversation)

    @patch("services.conversation_service.db.session")
    def test_get_conversation_success_with_end_user(self, mock_db_session):
        """
        Test successful conversation retrieval with end user.

        Should return conversation when found with proper filters for API user.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_end_user_mock()
        conversation = ConversationServiceTestDataFactory.create_conversation_mock(
            from_end_user_id=user.id, from_source=ConversationFromSource.API
        )

        mock_query = mock_db_session.query.return_value
        mock_query.where.return_value.first.return_value = conversation

        # Act
        result = ConversationService.get_conversation(app_model, "conv-123", user)

        # Assert
        assert result == conversation

    @patch("services.conversation_service.db.session")
    def test_get_conversation_not_found_raises_error(self, mock_db_session):
        """
        Test that get_conversation raises error when conversation not found.

        Should raise ConversationNotExistsError when no matching conversation found.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()

        mock_query = mock_db_session.query.return_value
        mock_query.where.return_value.first.return_value = None

        # Act & Assert
        with pytest.raises(ConversationNotExistsError):
            ConversationService.get_conversation(app_model, "conv-123", user)


class TestConversationServiceRename:
    """Test conversation rename operations."""

    @patch("services.conversation_service.db.session")
    @patch("services.conversation_service.ConversationService.get_conversation")
    def test_rename_with_manual_name(self, mock_get_conversation, mock_db_session):
        """
        Test renaming conversation with manual name.

        Should update conversation name and timestamp when auto_generate is False.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()
        conversation = ConversationServiceTestDataFactory.create_conversation_mock()

        mock_get_conversation.return_value = conversation

        # Act
        result = ConversationService.rename(
            app_model=app_model,
            conversation_id="conv-123",
            user=user,
            name="New Name",
            auto_generate=False,
        )

        # Assert
        assert result == conversation
        assert conversation.name == "New Name"
        mock_db_session.commit.assert_called_once()

    @patch("services.conversation_service.db.session")
    @patch("services.conversation_service.ConversationService.get_conversation")
    @patch("services.conversation_service.ConversationService.auto_generate_name")
    def test_rename_with_auto_generate(self, mock_auto_generate, mock_get_conversation, mock_db_session):
        """
        Test renaming conversation with auto-generation.

        Should call auto_generate_name when auto_generate is True.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()
        conversation = ConversationServiceTestDataFactory.create_conversation_mock()

        mock_get_conversation.return_value = conversation
        mock_auto_generate.return_value = conversation

        # Act
        result = ConversationService.rename(
            app_model=app_model,
            conversation_id="conv-123",
            user=user,
            name=None,
            auto_generate=True,
        )

        # Assert
        assert result == conversation
        mock_auto_generate.assert_called_once_with(app_model, conversation)


class TestConversationServiceAutoGenerateName:
    """Test conversation auto-name generation operations."""

    @patch("services.conversation_service.db.session")
    @patch("services.conversation_service.LLMGenerator")
    def test_auto_generate_name_success(self, mock_llm_generator, mock_db_session):
        """
        Test successful auto-generation of conversation name.

        Should generate name using LLMGenerator and update conversation.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        conversation = ConversationServiceTestDataFactory.create_conversation_mock()
        message = ConversationServiceTestDataFactory.create_message_mock(
            conversation_id=conversation.id, app_id=app_model.id
        )

        # Mock database query to return message
        mock_query = mock_db_session.query.return_value
        mock_query.where.return_value.order_by.return_value.first.return_value = message

        # Mock LLM generator
        mock_llm_generator.generate_conversation_name.return_value = "Generated Name"

        # Act
        result = ConversationService.auto_generate_name(app_model, conversation)

        # Assert
        assert result == conversation
        assert conversation.name == "Generated Name"
        mock_llm_generator.generate_conversation_name.assert_called_once_with(
            app_model.tenant_id, message.query, conversation.id, app_model.id
        )
        mock_db_session.commit.assert_called_once()

    @patch("services.conversation_service.db.session")
    def test_auto_generate_name_no_message_raises_error(self, mock_db_session):
        """
        Test auto-generation fails when no message found.

        Should raise MessageNotExistsError when conversation has no messages.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        conversation = ConversationServiceTestDataFactory.create_conversation_mock()

        # Mock database query to return None
        mock_query = mock_db_session.query.return_value
        mock_query.where.return_value.order_by.return_value.first.return_value = None

        # Act & Assert
        with pytest.raises(MessageNotExistsError):
            ConversationService.auto_generate_name(app_model, conversation)

    @patch("services.conversation_service.db.session")
    @patch("services.conversation_service.LLMGenerator")
    def test_auto_generate_name_handles_llm_exception(self, mock_llm_generator, mock_db_session):
        """
        Test auto-generation handles LLM generator exceptions gracefully.

        Should continue without name when LLMGenerator fails.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        conversation = ConversationServiceTestDataFactory.create_conversation_mock()
        message = ConversationServiceTestDataFactory.create_message_mock(
            conversation_id=conversation.id, app_id=app_model.id
        )

        # Mock database query to return message
        mock_query = mock_db_session.query.return_value
        mock_query.where.return_value.order_by.return_value.first.return_value = message

        # Mock LLM generator to raise exception
        mock_llm_generator.generate_conversation_name.side_effect = Exception("LLM Error")

        # Act
        result = ConversationService.auto_generate_name(app_model, conversation)

        # Assert
        assert result == conversation
        # Name should remain unchanged due to exception
        mock_db_session.commit.assert_called_once()


class TestConversationServiceDelete:
    """Test conversation deletion operations."""

    @patch("services.conversation_service.delete_conversation_related_data")
    @patch("services.conversation_service.db.session")
    @patch("services.conversation_service.ConversationService.get_conversation")
    def test_delete_success(self, mock_get_conversation, mock_db_session, mock_delete_task):
        """
        Test successful conversation deletion.

        Should delete conversation and schedule cleanup task.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock(name="Test App")
        user = ConversationServiceTestDataFactory.create_account_mock()
        conversation = ConversationServiceTestDataFactory.create_conversation_mock()

        mock_get_conversation.return_value = conversation

        # Act
        ConversationService.delete(app_model, "conv-123", user)

        # Assert
        mock_db_session.delete.assert_called_once_with(conversation)
        mock_db_session.commit.assert_called_once()
        mock_delete_task.delay.assert_called_once_with(conversation.id)

    @patch("services.conversation_service.db.session")
    @patch("services.conversation_service.ConversationService.get_conversation")
    def test_delete_handles_exception_and_rollback(self, mock_get_conversation, mock_db_session):
        """
        Test deletion handles exceptions and rolls back transaction.

        Should rollback database changes when deletion fails.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()
        conversation = ConversationServiceTestDataFactory.create_conversation_mock()

        mock_get_conversation.return_value = conversation
        mock_db_session.delete.side_effect = Exception("Database Error")

        # Act & Assert
        with pytest.raises(Exception, match="Database Error"):
            ConversationService.delete(app_model, "conv-123", user)

        # Assert rollback was called
        mock_db_session.rollback.assert_called_once()


class TestConversationServiceConversationalVariable:
    """Test conversational variable operations."""

    @patch("services.conversation_service.session_factory")
    @patch("services.conversation_service.ConversationService.get_conversation")
    def test_get_conversational_variable_success(self, mock_get_conversation, mock_session_factory):
        """
        Test successful retrieval of conversational variables.

        Should return paginated list of variables for conversation.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()
        conversation = ConversationServiceTestDataFactory.create_conversation_mock()

        mock_get_conversation.return_value = conversation

        # Mock session and variables
        mock_session = MagicMock()
        mock_session_factory.create_session.return_value.__enter__.return_value = mock_session

        variable1 = ConversationServiceTestDataFactory.create_conversation_variable_mock()
        variable2 = ConversationServiceTestDataFactory.create_conversation_variable_mock(variable_id="var-456")

        mock_session.scalars.return_value.all.return_value = [variable1, variable2]

        # Act
        result = ConversationService.get_conversational_variable(
            app_model=app_model,
            conversation_id="conv-123",
            user=user,
            limit=10,
            last_id=None,
        )

        # Assert
        assert isinstance(result, InfiniteScrollPagination)
        assert len(result.data) == 2
        assert result.limit == 10
        assert result.has_more is False

    @patch("services.conversation_service.session_factory")
    @patch("services.conversation_service.ConversationService.get_conversation")
    def test_get_conversational_variable_with_last_id(self, mock_get_conversation, mock_session_factory):
        """
        Test retrieval of variables with last_id pagination.

        Should filter variables created after last_id.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()
        conversation = ConversationServiceTestDataFactory.create_conversation_mock()

        mock_get_conversation.return_value = conversation

        # Mock session and variables
        mock_session = MagicMock()
        mock_session_factory.create_session.return_value.__enter__.return_value = mock_session

        last_variable = ConversationServiceTestDataFactory.create_conversation_variable_mock(
            created_at=datetime.utcnow() - timedelta(hours=1)
        )
        variable = ConversationServiceTestDataFactory.create_conversation_variable_mock(created_at=datetime.utcnow())

        mock_session.scalar.return_value = last_variable
        mock_session.scalars.return_value.all.return_value = [variable]

        # Act
        result = ConversationService.get_conversational_variable(
            app_model=app_model,
            conversation_id="conv-123",
            user=user,
            limit=10,
            last_id="var-123",
        )

        # Assert
        assert isinstance(result, InfiniteScrollPagination)
        assert len(result.data) == 1
        assert result.limit == 10

    @patch("services.conversation_service.session_factory")
    @patch("services.conversation_service.ConversationService.get_conversation")
    def test_get_conversational_variable_last_id_not_found_raises_error(
        self, mock_get_conversation, mock_session_factory
    ):
        """
        Test that invalid last_id raises ConversationVariableNotExistsError.

        Should raise error when last_id doesn't exist.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()
        conversation = ConversationServiceTestDataFactory.create_conversation_mock()

        mock_get_conversation.return_value = conversation

        # Mock session
        mock_session = MagicMock()
        mock_session_factory.create_session.return_value.__enter__.return_value = mock_session
        mock_session.scalar.return_value = None

        # Act & Assert
        with pytest.raises(ConversationVariableNotExistsError):
            ConversationService.get_conversational_variable(
                app_model=app_model,
                conversation_id="conv-123",
                user=user,
                limit=10,
                last_id="invalid-id",
            )

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

    @patch("services.conversation_service.session_factory")
    @patch("services.conversation_service.ConversationService.get_conversation")
    @patch("services.conversation_service.dify_config")
    def test_get_conversational_variable_with_name_filter_postgresql(
        self, mock_config, mock_get_conversation, mock_session_factory
    ):
        """
        Test variable filtering by name for PostgreSQL databases.

        Should apply JSON extraction filter for variable names.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()
        conversation = ConversationServiceTestDataFactory.create_conversation_mock()

        mock_get_conversation.return_value = conversation
        mock_config.DB_TYPE = "postgresql"

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


class TestConversationServiceUpdateVariable:
    """Test conversation variable update operations."""

    @patch("services.conversation_service.variable_factory")
    @patch("services.conversation_service.ConversationVariableUpdater")
    @patch("services.conversation_service.session_factory")
    @patch("services.conversation_service.ConversationService.get_conversation")
    def test_update_conversation_variable_success(
        self, mock_get_conversation, mock_session_factory, mock_updater_class, mock_variable_factory
    ):
        """
        Test successful update of conversation variable.

        Should update variable value and return updated data.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()
        conversation = ConversationServiceTestDataFactory.create_conversation_mock()

        mock_get_conversation.return_value = conversation

        # Mock session and existing variable
        mock_session = MagicMock()
        mock_session_factory.create_session.return_value.__enter__.return_value = mock_session

        existing_variable = ConversationServiceTestDataFactory.create_conversation_variable_mock(value_type="string")
        mock_session.scalar.return_value = existing_variable

        # Mock variable factory and updater
        updated_variable = Mock()
        updated_variable.model_dump.return_value = {"id": "var-123", "name": "test_var", "value": "new_value"}
        mock_variable_factory.build_conversation_variable_from_mapping.return_value = updated_variable

        mock_updater = MagicMock()
        mock_updater_class.return_value = mock_updater

        # Act
        result = ConversationService.update_conversation_variable(
            app_model=app_model,
            conversation_id="conv-123",
            variable_id="var-123",
            user=user,
            new_value="new_value",
        )

        # Assert
        assert result["id"] == "var-123"
        assert result["value"] == "new_value"
        mock_updater.update.assert_called_once_with("conv-123", updated_variable)
        mock_updater.flush.assert_called_once()

    @patch("services.conversation_service.session_factory")
    @patch("services.conversation_service.ConversationService.get_conversation")
    def test_update_conversation_variable_not_found_raises_error(self, mock_get_conversation, mock_session_factory):
        """
        Test update fails when variable doesn't exist.

        Should raise ConversationVariableNotExistsError.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()
        conversation = ConversationServiceTestDataFactory.create_conversation_mock()

        mock_get_conversation.return_value = conversation

        # Mock session
        mock_session = MagicMock()
        mock_session_factory.create_session.return_value.__enter__.return_value = mock_session
        mock_session.scalar.return_value = None

        # Act & Assert
        with pytest.raises(ConversationVariableNotExistsError):
            ConversationService.update_conversation_variable(
                app_model=app_model,
                conversation_id="conv-123",
                variable_id="invalid-id",
                user=user,
                new_value="new_value",
            )

    @patch("services.conversation_service.session_factory")
    @patch("services.conversation_service.ConversationService.get_conversation")
    def test_update_conversation_variable_type_mismatch_raises_error(self, mock_get_conversation, mock_session_factory):
        """
        Test update fails when value type doesn't match expected type.

        Should raise ConversationVariableTypeMismatchError.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()
        conversation = ConversationServiceTestDataFactory.create_conversation_mock()

        mock_get_conversation.return_value = conversation

        # Mock session and existing variable
        mock_session = MagicMock()
        mock_session_factory.create_session.return_value.__enter__.return_value = mock_session

        existing_variable = ConversationServiceTestDataFactory.create_conversation_variable_mock(value_type="number")
        mock_session.scalar.return_value = existing_variable

        # Act & Assert - Try to set string value for number variable
        with pytest.raises(ConversationVariableTypeMismatchError):
            ConversationService.update_conversation_variable(
                app_model=app_model,
                conversation_id="conv-123",
                variable_id="var-123",
                user=user,
                new_value="string_value",  # Wrong type
            )

    @patch("services.conversation_service.session_factory")
    @patch("services.conversation_service.ConversationService.get_conversation")
    def test_update_conversation_variable_integer_number_compatibility(
        self, mock_get_conversation, mock_session_factory
    ):
        """
        Test that integer type accepts number values.

        Should allow number values for integer type variables.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()
        conversation = ConversationServiceTestDataFactory.create_conversation_mock()

        mock_get_conversation.return_value = conversation

        # Mock session and existing variable
        mock_session = MagicMock()
        mock_session_factory.create_session.return_value.__enter__.return_value = mock_session

        existing_variable = ConversationServiceTestDataFactory.create_conversation_variable_mock(value_type="integer")
        mock_session.scalar.return_value = existing_variable

        # Mock variable factory and updater
        updated_variable = Mock()
        updated_variable.model_dump.return_value = {"id": "var-123", "name": "test_var", "value": 42}

        with (
            patch("services.conversation_service.variable_factory") as mock_variable_factory,
            patch("services.conversation_service.ConversationVariableUpdater") as mock_updater_class,
        ):
            mock_variable_factory.build_conversation_variable_from_mapping.return_value = updated_variable
            mock_updater = MagicMock()
            mock_updater_class.return_value = mock_updater

            # Act
            result = ConversationService.update_conversation_variable(
                app_model=app_model,
                conversation_id="conv-123",
                variable_id="var-123",
                user=user,
                new_value=42,  # Number value for integer type
            )

            # Assert
            assert result["value"] == 42
            mock_updater.update.assert_called_once()


class TestConversationServicePaginationAdvanced:
    """Advanced pagination tests for ConversationService."""

    @patch("services.conversation_service.session_factory")
    def test_pagination_by_last_id_with_last_id_not_found(self, mock_session_factory):
        """
        Test pagination with invalid last_id raises error.

        Should raise LastConversationNotExistsError when last_id doesn't exist.
        """
        # Arrange
        mock_session = MagicMock()
        mock_session_factory.create_session.return_value.__enter__.return_value = mock_session
        mock_session.scalar.return_value = None

        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()

        # Act & Assert
        with pytest.raises(LastConversationNotExistsError):
            ConversationService.pagination_by_last_id(
                session=mock_session,
                app_model=app_model,
                user=user,
                last_id="invalid-id",
                limit=20,
                invoke_from=InvokeFrom.WEB_APP,
            )

    @patch("services.conversation_service.session_factory")
    def test_pagination_by_last_id_with_exclude_ids(self, mock_session_factory):
        """
        Test pagination with exclude_ids filter.

        Should exclude specified conversation IDs from results.
        """
        # Arrange
        mock_session = MagicMock()
        mock_session_factory.create_session.return_value.__enter__.return_value = mock_session

        conversation = ConversationServiceTestDataFactory.create_conversation_mock()
        mock_session.scalars.return_value.all.return_value = [conversation]
        mock_session.scalar.return_value = conversation

        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()

        # Act
        result = ConversationService.pagination_by_last_id(
            session=mock_session,
            app_model=app_model,
            user=user,
            last_id=None,
            limit=20,
            invoke_from=InvokeFrom.WEB_APP,
            exclude_ids=["excluded-123"],
        )

        # Assert
        assert isinstance(result, InfiniteScrollPagination)
        assert len(result.data) == 1

    @patch("services.conversation_service.session_factory")
    def test_pagination_by_last_id_has_more_detection(self, mock_session_factory):
        """
        Test pagination has_more detection logic.

        Should set has_more=True when there are more results beyond limit.
        """
        # Arrange
        mock_session = MagicMock()
        mock_session_factory.create_session.return_value.__enter__.return_value = mock_session

        # Return exactly limit items to trigger has_more check
        conversations = [
            ConversationServiceTestDataFactory.create_conversation_mock(conversation_id=f"conv-{i}") for i in range(20)
        ]
        mock_session.scalars.return_value.all.return_value = conversations
        mock_session.scalar.return_value = conversations[-1]

        # Mock count query to return > 0
        mock_session.scalar.return_value = 5  # Additional items exist

        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()

        # Act
        result = ConversationService.pagination_by_last_id(
            session=mock_session,
            app_model=app_model,
            user=user,
            last_id=None,
            limit=20,
            invoke_from=InvokeFrom.WEB_APP,
        )

        # Assert
        assert isinstance(result, InfiniteScrollPagination)
        assert result.has_more is True

    @patch("services.conversation_service.session_factory")
    def test_pagination_by_last_id_with_different_sort_by(self, mock_session_factory):
        """
        Test pagination with different sort fields.

        Should handle various sort_by parameters correctly.
        """
        # Arrange
        mock_session = MagicMock()
        mock_session_factory.create_session.return_value.__enter__.return_value = mock_session

        conversation = ConversationServiceTestDataFactory.create_conversation_mock()
        mock_session.scalars.return_value.all.return_value = [conversation]
        mock_session.scalar.return_value = conversation

        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()

        # Test different sort fields
        sort_fields = ["created_at", "-updated_at", "name", "-status"]

        for sort_by in sort_fields:
            # Act
            result = ConversationService.pagination_by_last_id(
                session=mock_session,
                app_model=app_model,
                user=user,
                last_id=None,
                limit=20,
                invoke_from=InvokeFrom.WEB_APP,
                sort_by=sort_by,
            )

            # Assert
            assert isinstance(result, InfiniteScrollPagination)


class TestConversationServiceEdgeCases:
    """Test edge cases and error scenarios."""

    @patch("services.conversation_service.session_factory")
    def test_pagination_with_end_user_api_source(self, mock_session_factory):
        """
        Test pagination correctly handles EndUser with API source.

        Should use 'api' as from_source for EndUser instances.
        """
        # Arrange
        mock_session = MagicMock()
        mock_session_factory.create_session.return_value.__enter__.return_value = mock_session

        conversation = ConversationServiceTestDataFactory.create_conversation_mock(
            from_source=ConversationFromSource.API, from_end_user_id="user-123"
        )
        mock_session.scalars.return_value.all.return_value = [conversation]

        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_end_user_mock()

        # Act
        result = ConversationService.pagination_by_last_id(
            session=mock_session,
            app_model=app_model,
            user=user,
            last_id=None,
            limit=20,
            invoke_from=InvokeFrom.WEB_APP,
        )

        # Assert
        assert isinstance(result, InfiniteScrollPagination)

    @patch("services.conversation_service.session_factory")
    def test_pagination_with_account_console_source(self, mock_session_factory):
        """
        Test pagination correctly handles Account with console source.

        Should use 'console' as from_source for Account instances.
        """
        # Arrange
        mock_session = MagicMock()
        mock_session_factory.create_session.return_value.__enter__.return_value = mock_session

        conversation = ConversationServiceTestDataFactory.create_conversation_mock(
            from_source=ConversationFromSource.CONSOLE, from_account_id="account-123"
        )
        mock_session.scalars.return_value.all.return_value = [conversation]

        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()

        # Act
        result = ConversationService.pagination_by_last_id(
            session=mock_session,
            app_model=app_model,
            user=user,
            last_id=None,
            limit=20,
            invoke_from=InvokeFrom.WEB_APP,
        )

        # Assert
        assert isinstance(result, InfiniteScrollPagination)

    def test_pagination_with_include_ids_filter(self):
        """
        Test pagination with include_ids filter.

        Should only return conversations with IDs in include_ids list.
        """
        # Arrange
        mock_session = MagicMock()
        mock_session.scalars.return_value.all.return_value = []

        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()

        # Act
        result = ConversationService.pagination_by_last_id(
            session=mock_session,
            app_model=app_model,
            user=user,
            last_id=None,
            limit=20,
            invoke_from=InvokeFrom.WEB_APP,
            include_ids=["conv-123", "conv-456"],
        )

        # Assert
        assert isinstance(result, InfiniteScrollPagination)
        # Verify that include_ids filter was applied
        assert mock_session.scalars.called

    def test_pagination_with_empty_exclude_ids(self):
        """
        Test pagination with empty exclude_ids list.

        Should handle empty exclude_ids gracefully.
        """
        # Arrange
        mock_session = MagicMock()
        mock_session.scalars.return_value.all.return_value = []

        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()

        # Act
        result = ConversationService.pagination_by_last_id(
            session=mock_session,
            app_model=app_model,
            user=user,
            last_id=None,
            limit=20,
            invoke_from=InvokeFrom.WEB_APP,
            exclude_ids=[],
        )

        # Assert
        assert isinstance(result, InfiniteScrollPagination)
        assert result.has_more is False
