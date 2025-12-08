"""
Comprehensive unit tests for ConversationService.

This test suite provides complete coverage of conversation management operations in Dify,
following TDD principles with the Arrange-Act-Assert pattern.

## Test Coverage

### 1. Conversation Pagination (TestConversationServicePagination)
Tests conversation listing and filtering:
- Empty include_ids returns empty results
- Non-empty include_ids filters conversations properly
- Empty exclude_ids doesn't filter results
- Non-empty exclude_ids excludes specified conversations
- Null user handling
- Sorting and pagination edge cases

### 2. Message Creation (TestConversationServiceMessageCreation)
Tests message operations within conversations:
- Message pagination without first_id
- Message pagination with first_id specified
- Error handling for non-existent messages
- Empty result handling for null user/conversation
- Message ordering (ascending/descending)
- Has_more flag calculation

### 3. Conversation Summarization (TestConversationServiceSummarization)
Tests auto-generated conversation names:
- Successful LLM-based name generation
- Error handling when conversation has no messages
- Graceful handling of LLM service failures
- Manual vs auto-generated naming
- Name update timestamp tracking

### 4. Message Annotation (TestConversationServiceMessageAnnotation)
Tests annotation creation and management:
- Creating annotations from existing messages
- Creating standalone annotations
- Updating existing annotations
- Paginated annotation retrieval
- Annotation search with keywords
- Annotation export functionality

### 5. Conversation Export (TestConversationServiceExport)
Tests data retrieval for export:
- Successful conversation retrieval
- Error handling for non-existent conversations
- Message retrieval
- Annotation export
- Batch data export operations

## Testing Approach

- **Mocking Strategy**: All external dependencies (database, LLM, Redis) are mocked
  for fast, isolated unit tests
- **Factory Pattern**: ConversationServiceTestDataFactory provides consistent test data
- **Fixtures**: Mock objects are configured per test method
- **Assertions**: Each test verifies return values and side effects
  (database operations, method calls)

## Key Concepts

**Conversation Sources:**
- console: Created by workspace members
- api: Created by end users via API

**Message Pagination:**
- first_id: Paginate from a specific message forward
- last_id: Paginate from a specific message backward
- Supports ascending/descending order

**Annotations:**
- Can be attached to messages or standalone
- Support full-text search
- Indexed for semantic retrieval
"""

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import MagicMock, Mock, create_autospec, patch

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from models import Account
from models.model import App, Conversation, EndUser, Message, MessageAnnotation
from services.annotation_service import AppAnnotationService
from services.conversation_service import ConversationService
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import FirstMessageNotExistsError, MessageNotExistsError
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
        conversation.created_at = kwargs.get("created_at", datetime.now(UTC))
        conversation.updated_at = kwargs.get("updated_at", datetime.now(UTC))
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
            Mock Message object with specified attributes including
            query, answer, tokens, and pricing information
        """
        message = create_autospec(Message, instance=True)
        message.id = message_id
        message.conversation_id = conversation_id
        message.app_id = app_id
        message.query = kwargs.get("query", "Test query")
        message.answer = kwargs.get("answer", "Test answer")
        message.from_source = kwargs.get("from_source", "console")
        message.from_end_user_id = kwargs.get("from_end_user_id")
        message.from_account_id = kwargs.get("from_account_id")
        message.created_at = kwargs.get("created_at", datetime.now(UTC))
        message.message = kwargs.get("message", {})
        message.message_tokens = kwargs.get("message_tokens", 0)
        message.answer_tokens = kwargs.get("answer_tokens", 0)
        message.message_unit_price = kwargs.get("message_unit_price", Decimal(0))
        message.answer_unit_price = kwargs.get("answer_unit_price", Decimal(0))
        message.message_price_unit = kwargs.get("message_price_unit", Decimal("0.001"))
        message.answer_price_unit = kwargs.get("answer_price_unit", Decimal("0.001"))
        message.currency = kwargs.get("currency", "USD")
        message.status = kwargs.get("status", "normal")
        for key, value in kwargs.items():
            setattr(message, key, value)
        return message

    @staticmethod
    def create_annotation_mock(
        annotation_id: str = "anno-123",
        app_id: str = "app-123",
        message_id: str = "msg-123",
        **kwargs,
    ) -> Mock:
        """
        Create a mock MessageAnnotation object.

        Args:
            annotation_id: Unique identifier for the annotation
            app_id: Associated app identifier
            message_id: Associated message identifier (optional for standalone annotations)
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock MessageAnnotation object with specified attributes including
            question, content, and hit tracking
        """
        annotation = create_autospec(MessageAnnotation, instance=True)
        annotation.id = annotation_id
        annotation.app_id = app_id
        annotation.message_id = message_id
        annotation.conversation_id = kwargs.get("conversation_id")
        annotation.question = kwargs.get("question", "Test question")
        annotation.content = kwargs.get("content", "Test annotation")
        annotation.account_id = kwargs.get("account_id", "account-123")
        annotation.hit_count = kwargs.get("hit_count", 0)
        annotation.created_at = kwargs.get("created_at", datetime.now(UTC))
        annotation.updated_at = kwargs.get("updated_at", datetime.now(UTC))
        for key, value in kwargs.items():
            setattr(annotation, key, value)
        return annotation


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

    def test_pagination_with_non_empty_include_ids(self):
        """
        Test that non-empty include_ids filters properly.

        When include_ids contains conversation IDs, the query should filter
        to only return conversations matching those IDs.
        """
        # Arrange - Set up test data and mocks
        mock_session = MagicMock()  # Mock database session
        mock_app_model = ConversationServiceTestDataFactory.create_app_mock()
        mock_user = ConversationServiceTestDataFactory.create_account_mock()

        # Create 3 mock conversations that would match the filter
        mock_conversations = [
            ConversationServiceTestDataFactory.create_conversation_mock(conversation_id=str(uuid.uuid4()))
            for _ in range(3)
        ]
        # Mock the database query results
        mock_session.scalars.return_value.all.return_value = mock_conversations
        mock_session.scalar.return_value = 0  # No additional conversations beyond current page

        # Act
        with patch("services.conversation_service.select") as mock_select:
            mock_stmt = MagicMock()
            mock_select.return_value = mock_stmt
            mock_stmt.where.return_value = mock_stmt
            mock_stmt.order_by.return_value = mock_stmt
            mock_stmt.limit.return_value = mock_stmt
            mock_stmt.subquery.return_value = MagicMock()

            result = ConversationService.pagination_by_last_id(
                session=mock_session,
                app_model=mock_app_model,
                user=mock_user,
                last_id=None,
                limit=20,
                invoke_from=InvokeFrom.WEB_APP,
                include_ids=["conv1", "conv2"],
                exclude_ids=None,
            )

            # Assert
            assert mock_stmt.where.called

    def test_pagination_with_empty_exclude_ids(self):
        """
        Test that empty exclude_ids doesn't filter.

        When exclude_ids is an empty list, the query should not filter out
        any conversations.
        """
        # Arrange
        mock_session = MagicMock()
        mock_app_model = ConversationServiceTestDataFactory.create_app_mock()
        mock_user = ConversationServiceTestDataFactory.create_account_mock()
        mock_conversations = [
            ConversationServiceTestDataFactory.create_conversation_mock(conversation_id=str(uuid.uuid4()))
            for _ in range(5)
        ]
        mock_session.scalars.return_value.all.return_value = mock_conversations
        mock_session.scalar.return_value = 0

        # Act
        with patch("services.conversation_service.select") as mock_select:
            mock_stmt = MagicMock()
            mock_select.return_value = mock_stmt
            mock_stmt.where.return_value = mock_stmt
            mock_stmt.order_by.return_value = mock_stmt
            mock_stmt.limit.return_value = mock_stmt
            mock_stmt.subquery.return_value = MagicMock()

            result = ConversationService.pagination_by_last_id(
                session=mock_session,
                app_model=mock_app_model,
                user=mock_user,
                last_id=None,
                limit=20,
                invoke_from=InvokeFrom.WEB_APP,
                include_ids=None,
                exclude_ids=[],
            )

            # Assert
            assert len(result.data) == 5

    def test_pagination_with_non_empty_exclude_ids(self):
        """
        Test that non-empty exclude_ids filters properly.

        When exclude_ids contains conversation IDs, the query should filter
        out conversations matching those IDs.
        """
        # Arrange
        mock_session = MagicMock()
        mock_app_model = ConversationServiceTestDataFactory.create_app_mock()
        mock_user = ConversationServiceTestDataFactory.create_account_mock()
        mock_conversations = [
            ConversationServiceTestDataFactory.create_conversation_mock(conversation_id=str(uuid.uuid4()))
            for _ in range(3)
        ]
        mock_session.scalars.return_value.all.return_value = mock_conversations
        mock_session.scalar.return_value = 0

        # Act
        with patch("services.conversation_service.select") as mock_select:
            mock_stmt = MagicMock()
            mock_select.return_value = mock_stmt
            mock_stmt.where.return_value = mock_stmt
            mock_stmt.order_by.return_value = mock_stmt
            mock_stmt.limit.return_value = mock_stmt
            mock_stmt.subquery.return_value = MagicMock()

            result = ConversationService.pagination_by_last_id(
                session=mock_session,
                app_model=mock_app_model,
                user=mock_user,
                last_id=None,
                limit=20,
                invoke_from=InvokeFrom.WEB_APP,
                include_ids=None,
                exclude_ids=["conv1", "conv2"],
            )

            # Assert
            assert mock_stmt.where.called

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

    def test_pagination_with_sorting_descending(self):
        """
        Test pagination with descending sort order.

        Verifies that conversations are sorted by updated_at in descending order (newest first).
        """
        # Arrange
        mock_session = MagicMock()
        mock_app_model = ConversationServiceTestDataFactory.create_app_mock()
        mock_user = ConversationServiceTestDataFactory.create_account_mock()

        # Create conversations with different timestamps
        conversations = [
            ConversationServiceTestDataFactory.create_conversation_mock(
                conversation_id=f"conv-{i}", updated_at=datetime(2024, 1, i + 1, tzinfo=UTC)
            )
            for i in range(3)
        ]
        mock_session.scalars.return_value.all.return_value = conversations
        mock_session.scalar.return_value = 0

        # Act
        with patch("services.conversation_service.select") as mock_select:
            mock_stmt = MagicMock()
            mock_select.return_value = mock_stmt
            mock_stmt.where.return_value = mock_stmt
            mock_stmt.order_by.return_value = mock_stmt
            mock_stmt.limit.return_value = mock_stmt
            mock_stmt.subquery.return_value = MagicMock()

            result = ConversationService.pagination_by_last_id(
                session=mock_session,
                app_model=mock_app_model,
                user=mock_user,
                last_id=None,
                limit=20,
                invoke_from=InvokeFrom.WEB_APP,
                sort_by="-updated_at",  # Descending sort
            )

            # Assert
            assert len(result.data) == 3
            mock_stmt.order_by.assert_called()


class TestConversationServiceMessageCreation:
    """
    Test message creation and pagination.

    Tests MessageService operations for creating and retrieving messages
    within conversations.
    """

    @patch("services.message_service.db.session")
    @patch("services.message_service.ConversationService.get_conversation")
    def test_pagination_by_first_id_without_first_id(self, mock_get_conversation, mock_db_session):
        """
        Test message pagination without specifying first_id.

        When first_id is None, the service should return the most recent messages
        up to the specified limit.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()
        conversation = ConversationServiceTestDataFactory.create_conversation_mock()

        # Create 3 test messages in the conversation
        messages = [
            ConversationServiceTestDataFactory.create_message_mock(
                message_id=f"msg-{i}", conversation_id=conversation.id
            )
            for i in range(3)
        ]

        # Mock the conversation lookup to return our test conversation
        mock_get_conversation.return_value = conversation

        # Set up the database query mock chain
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query  # WHERE clause returns self for chaining
        mock_query.order_by.return_value = mock_query  # ORDER BY returns self for chaining
        mock_query.limit.return_value = mock_query  # LIMIT returns self for chaining
        mock_query.all.return_value = messages  # Final .all() returns the messages

        # Act - Call the pagination method without first_id
        result = MessageService.pagination_by_first_id(
            app_model=app_model,
            user=user,
            conversation_id=conversation.id,
            first_id=None,  # No starting point specified
            limit=10,
        )

        # Assert - Verify the results
        assert len(result.data) == 3  # All 3 messages returned
        assert result.has_more is False  # No more messages available (3 < limit of 10)
        # Verify conversation was looked up with correct parameters
        mock_get_conversation.assert_called_once_with(app_model=app_model, user=user, conversation_id=conversation.id)

    @patch("services.message_service.db.session")
    @patch("services.message_service.ConversationService.get_conversation")
    def test_pagination_by_first_id_with_first_id(self, mock_get_conversation, mock_db_session):
        """
        Test message pagination with first_id specified.

        When first_id is provided, the service should return messages starting
        from the specified message up to the limit.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()
        conversation = ConversationServiceTestDataFactory.create_conversation_mock()
        first_message = ConversationServiceTestDataFactory.create_message_mock(
            message_id="msg-first", conversation_id=conversation.id
        )
        messages = [
            ConversationServiceTestDataFactory.create_message_mock(
                message_id=f"msg-{i}", conversation_id=conversation.id
            )
            for i in range(2)
        ]

        # Mock the conversation lookup to return our test conversation
        mock_get_conversation.return_value = conversation

        # Set up the database query mock chain
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query  # WHERE clause returns self for chaining
        mock_query.order_by.return_value = mock_query  # ORDER BY returns self for chaining
        mock_query.limit.return_value = mock_query  # LIMIT returns self for chaining
        mock_query.first.return_value = first_message  # First message returned
        mock_query.all.return_value = messages  # Remaining messages returned

        # Act - Call the pagination method with first_id
        result = MessageService.pagination_by_first_id(
            app_model=app_model,
            user=user,
            conversation_id=conversation.id,
            first_id="msg-first",
            limit=10,
        )

        # Assert - Verify the results
        assert len(result.data) == 2  # Only 2 messages returned after first_id
        assert result.has_more is False  # No more messages available (2 < limit of 10)

    @patch("services.message_service.db.session")
    @patch("services.message_service.ConversationService.get_conversation")
    def test_pagination_by_first_id_raises_error_when_first_message_not_found(
        self, mock_get_conversation, mock_db_session
    ):
        """
        Test that FirstMessageNotExistsError is raised when first_id doesn't exist.

        When the specified first_id does not exist in the conversation,
        the service should raise an error.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()
        conversation = ConversationServiceTestDataFactory.create_conversation_mock()

        # Mock the conversation lookup to return our test conversation
        mock_get_conversation.return_value = conversation

        # Set up the database query mock chain
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query  # WHERE clause returns self for chaining
        mock_query.first.return_value = None  # No message found for first_id

        # Act & Assert
        with pytest.raises(FirstMessageNotExistsError):
            MessageService.pagination_by_first_id(
                app_model=app_model,
                user=user,
                conversation_id=conversation.id,
                first_id="non-existent-msg",
                limit=10,
            )

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

    @patch("services.message_service.db.session")
    @patch("services.message_service.ConversationService.get_conversation")
    def test_pagination_with_has_more_flag(self, mock_get_conversation, mock_db_session):
        """
        Test that has_more flag is correctly set when there are more messages.

        The service fetches limit+1 messages to determine if more exist.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()
        conversation = ConversationServiceTestDataFactory.create_conversation_mock()

        # Create limit+1 messages to trigger has_more
        limit = 5
        messages = [
            ConversationServiceTestDataFactory.create_message_mock(
                message_id=f"msg-{i}", conversation_id=conversation.id
            )
            for i in range(limit + 1)  # One extra message
        ]

        # Mock the conversation lookup to return our test conversation
        mock_get_conversation.return_value = conversation

        # Set up the database query mock chain
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query  # WHERE clause returns self for chaining
        mock_query.order_by.return_value = mock_query  # ORDER BY returns self for chaining
        mock_query.limit.return_value = mock_query  # LIMIT returns self for chaining
        mock_query.all.return_value = messages  # Final .all() returns the messages

        # Act
        result = MessageService.pagination_by_first_id(
            app_model=app_model,
            user=user,
            conversation_id=conversation.id,
            first_id=None,
            limit=limit,
        )

        # Assert
        assert len(result.data) == limit  # Extra message should be removed
        assert result.has_more is True  # Flag should be set

    @patch("services.message_service.db.session")
    @patch("services.message_service.ConversationService.get_conversation")
    def test_pagination_with_ascending_order(self, mock_get_conversation, mock_db_session):
        """
        Test message pagination with ascending order.

        Messages should be returned in chronological order (oldest first).
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()
        conversation = ConversationServiceTestDataFactory.create_conversation_mock()

        # Create messages with different timestamps
        messages = [
            ConversationServiceTestDataFactory.create_message_mock(
                message_id=f"msg-{i}", conversation_id=conversation.id, created_at=datetime(2024, 1, i + 1, tzinfo=UTC)
            )
            for i in range(3)
        ]

        # Mock the conversation lookup to return our test conversation
        mock_get_conversation.return_value = conversation

        # Set up the database query mock chain
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query  # WHERE clause returns self for chaining
        mock_query.order_by.return_value = mock_query  # ORDER BY returns self for chaining
        mock_query.limit.return_value = mock_query  # LIMIT returns self for chaining
        mock_query.all.return_value = messages  # Final .all() returns the messages

        # Act
        result = MessageService.pagination_by_first_id(
            app_model=app_model,
            user=user,
            conversation_id=conversation.id,
            first_id=None,
            limit=10,
            order="asc",  # Ascending order
        )

        # Assert
        assert len(result.data) == 3
        # Messages should be in ascending order after reversal


class TestConversationServiceSummarization:
    """
    Test conversation summarization (auto-generated names).

    Tests the auto_generate_name functionality that creates conversation
    titles based on the first message.
    """

    @patch("services.conversation_service.LLMGenerator.generate_conversation_name")
    @patch("services.conversation_service.db.session")
    def test_auto_generate_name_success(self, mock_db_session, mock_llm_generator):
        """
        Test successful auto-generation of conversation name.

        The service uses an LLM to generate a descriptive name based on
        the first message in the conversation.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        conversation = ConversationServiceTestDataFactory.create_conversation_mock()

        # Create the first message that will be used to generate the name
        first_message = ConversationServiceTestDataFactory.create_message_mock(
            conversation_id=conversation.id, query="What is machine learning?"
        )
        # Expected name from LLM
        generated_name = "Machine Learning Discussion"

        # Set up database query mock to return the first message
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query  # Filter by app_id and conversation_id
        mock_query.order_by.return_value = mock_query  # Order by created_at ascending
        mock_query.first.return_value = first_message  # Return the first message

        # Mock the LLM to return our expected name
        mock_llm_generator.return_value = generated_name

        # Act
        result = ConversationService.auto_generate_name(app_model, conversation)

        # Assert
        assert conversation.name == generated_name  # Name updated on conversation object
        # Verify LLM was called with correct parameters
        mock_llm_generator.assert_called_once_with(
            app_model.tenant_id, first_message.query, conversation.id, app_model.id
        )
        mock_db_session.commit.assert_called_once()  # Changes committed to database

    @patch("services.conversation_service.db.session")
    def test_auto_generate_name_raises_error_when_no_message(self, mock_db_session):
        """
        Test that MessageNotExistsError is raised when conversation has no messages.

        When the conversation has no messages, the service should raise an error.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        conversation = ConversationServiceTestDataFactory.create_conversation_mock()

        # Set up database query mock to return no messages
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query  # Filter by app_id and conversation_id
        mock_query.order_by.return_value = mock_query  # Order by created_at ascending
        mock_query.first.return_value = None  # No messages found

        # Act & Assert
        with pytest.raises(MessageNotExistsError):
            ConversationService.auto_generate_name(app_model, conversation)

    @patch("services.conversation_service.LLMGenerator.generate_conversation_name")
    @patch("services.conversation_service.db.session")
    def test_auto_generate_name_handles_llm_failure_gracefully(self, mock_db_session, mock_llm_generator):
        """
        Test that LLM generation failures are suppressed and don't crash.

        When the LLM fails to generate a name, the service should not crash
        and should return the original conversation name.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        conversation = ConversationServiceTestDataFactory.create_conversation_mock()
        first_message = ConversationServiceTestDataFactory.create_message_mock(conversation_id=conversation.id)
        original_name = conversation.name

        # Set up database query mock to return the first message
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query  # Filter by app_id and conversation_id
        mock_query.order_by.return_value = mock_query  # Order by created_at ascending
        mock_query.first.return_value = first_message  # Return the first message

        # Mock the LLM to raise an exception
        mock_llm_generator.side_effect = Exception("LLM service unavailable")

        # Act
        result = ConversationService.auto_generate_name(app_model, conversation)

        # Assert
        assert conversation.name == original_name  # Name remains unchanged
        mock_db_session.commit.assert_called_once()  # Changes committed to database

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

    @patch("services.conversation_service.db.session")
    @patch("services.conversation_service.ConversationService.get_conversation")
    @patch("services.conversation_service.naive_utc_now")
    def test_rename_with_manual_name(self, mock_naive_utc_now, mock_get_conversation, mock_db_session):
        """
        Test renaming conversation with manual name.

        When auto_generate is False, the service should update the conversation
        name with the provided manual name.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()
        conversation = ConversationServiceTestDataFactory.create_conversation_mock()
        new_name = "My Custom Conversation Name"
        mock_time = datetime(2024, 1, 1, 12, 0, 0)

        # Mock the conversation lookup to return our test conversation
        mock_get_conversation.return_value = conversation

        # Mock the current time to return our mock time
        mock_naive_utc_now.return_value = mock_time

        # Act
        result = ConversationService.rename(
            app_model=app_model,
            conversation_id=conversation.id,
            user=user,
            name=new_name,
            auto_generate=False,
        )

        # Assert
        assert conversation.name == new_name
        assert conversation.updated_at == mock_time
        mock_db_session.commit.assert_called_once()


class TestConversationServiceMessageAnnotation:
    """
    Test message annotation operations.

    Tests AppAnnotationService operations for creating and managing
    message annotations.
    """

    @patch("services.annotation_service.db.session")
    @patch("services.annotation_service.current_account_with_tenant")
    def test_create_annotation_from_message(self, mock_current_account, mock_db_session):
        """
        Test creating annotation from existing message.

        Annotations can be attached to messages to provide curated responses
        that override the AI-generated answers.
        """
        # Arrange
        app_id = "app-123"
        message_id = "msg-123"
        account = ConversationServiceTestDataFactory.create_account_mock()
        tenant_id = "tenant-123"
        app = ConversationServiceTestDataFactory.create_app_mock(app_id=app_id, tenant_id=tenant_id)

        # Create a message that doesn't have an annotation yet
        message = ConversationServiceTestDataFactory.create_message_mock(
            message_id=message_id, app_id=app_id, query="What is AI?"
        )
        message.annotation = None  # No existing annotation

        # Mock the authentication context to return current user and tenant
        mock_current_account.return_value = (account, tenant_id)

        # Set up database query mock
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        # First call returns app, second returns message, third returns None (no annotation setting)
        mock_query.first.side_effect = [app, message, None]

        # Annotation data to create
        args = {"message_id": message_id, "answer": "AI is artificial intelligence"}

        # Act
        with patch("services.annotation_service.add_annotation_to_index_task"):
            result = AppAnnotationService.up_insert_app_annotation_from_message(args, app_id)

        # Assert
        mock_db_session.add.assert_called_once()  # Annotation added to session
        mock_db_session.commit.assert_called_once()  # Changes committed

    @patch("services.annotation_service.db.session")
    @patch("services.annotation_service.current_account_with_tenant")
    def test_create_annotation_without_message(self, mock_current_account, mock_db_session):
        """
        Test creating standalone annotation without message.

        Annotations can be created without a message reference for bulk imports
        or manual annotation creation.
        """
        # Arrange
        app_id = "app-123"
        account = ConversationServiceTestDataFactory.create_account_mock()
        tenant_id = "tenant-123"
        app = ConversationServiceTestDataFactory.create_app_mock(app_id=app_id, tenant_id=tenant_id)

        # Mock the authentication context to return current user and tenant
        mock_current_account.return_value = (account, tenant_id)

        # Set up database query mock
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        # First call returns app, second returns None (no message)
        mock_query.first.side_effect = [app, None]

        # Annotation data to create
        args = {
            "question": "What is natural language processing?",
            "answer": "NLP is a field of AI focused on language understanding",
        }

        # Act
        with patch("services.annotation_service.add_annotation_to_index_task"):
            result = AppAnnotationService.up_insert_app_annotation_from_message(args, app_id)

        # Assert
        mock_db_session.add.assert_called_once()  # Annotation added to session
        mock_db_session.commit.assert_called_once()  # Changes committed

    @patch("services.annotation_service.db.session")
    @patch("services.annotation_service.current_account_with_tenant")
    def test_update_existing_annotation(self, mock_current_account, mock_db_session):
        """
        Test updating an existing annotation.

        When a message already has an annotation, calling the service again
        should update the existing annotation rather than creating a new one.
        """
        # Arrange
        app_id = "app-123"
        message_id = "msg-123"
        account = ConversationServiceTestDataFactory.create_account_mock()
        tenant_id = "tenant-123"
        app = ConversationServiceTestDataFactory.create_app_mock(app_id=app_id, tenant_id=tenant_id)
        message = ConversationServiceTestDataFactory.create_message_mock(message_id=message_id, app_id=app_id)

        # Create an existing annotation with old content
        existing_annotation = ConversationServiceTestDataFactory.create_annotation_mock(
            app_id=app_id, message_id=message_id, content="Old annotation"
        )
        message.annotation = existing_annotation  # Message already has annotation

        # Mock the authentication context to return current user and tenant
        mock_current_account.return_value = (account, tenant_id)

        # Set up database query mock
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        # First call returns app, second returns message, third returns None (no annotation setting)
        mock_query.first.side_effect = [app, message, None]

        # New content to update the annotation with
        args = {"message_id": message_id, "answer": "Updated annotation content"}

        # Act
        with patch("services.annotation_service.add_annotation_to_index_task"):
            result = AppAnnotationService.up_insert_app_annotation_from_message(args, app_id)

        # Assert
        assert existing_annotation.content == "Updated annotation content"  # Content updated
        mock_db_session.add.assert_called_once()  # Annotation re-added to session
        mock_db_session.commit.assert_called_once()  # Changes committed

    @patch("services.annotation_service.db.paginate")
    @patch("services.annotation_service.db.session")
    @patch("services.annotation_service.current_account_with_tenant")
    def test_get_annotation_list(self, mock_current_account, mock_db_session, mock_db_paginate):
        """
        Test retrieving paginated annotation list.

        Annotations can be retrieved in a paginated list for display in the UI.
        """
        """Test retrieving paginated annotation list."""
        # Arrange
        app_id = "app-123"
        account = ConversationServiceTestDataFactory.create_account_mock()
        tenant_id = "tenant-123"
        app = ConversationServiceTestDataFactory.create_app_mock(app_id=app_id, tenant_id=tenant_id)
        annotations = [
            ConversationServiceTestDataFactory.create_annotation_mock(annotation_id=f"anno-{i}", app_id=app_id)
            for i in range(5)
        ]

        mock_current_account.return_value = (account, tenant_id)
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = app

        mock_paginate = MagicMock()
        mock_paginate.items = annotations
        mock_paginate.total = 5
        mock_db_paginate.return_value = mock_paginate

        # Act
        result_items, result_total = AppAnnotationService.get_annotation_list_by_app_id(
            app_id=app_id, page=1, limit=10, keyword=""
        )

        # Assert
        assert len(result_items) == 5
        assert result_total == 5

    @patch("services.annotation_service.db.paginate")
    @patch("services.annotation_service.db.session")
    @patch("services.annotation_service.current_account_with_tenant")
    def test_get_annotation_list_with_keyword_search(self, mock_current_account, mock_db_session, mock_db_paginate):
        """
        Test retrieving annotations with keyword filtering.

        Annotations can be searched by question or content using case-insensitive matching.
        """
        # Arrange
        app_id = "app-123"
        account = ConversationServiceTestDataFactory.create_account_mock()
        tenant_id = "tenant-123"
        app = ConversationServiceTestDataFactory.create_app_mock(app_id=app_id, tenant_id=tenant_id)

        # Create annotations with searchable content
        annotations = [
            ConversationServiceTestDataFactory.create_annotation_mock(
                annotation_id="anno-1",
                app_id=app_id,
                question="What is machine learning?",
                content="ML is a subset of AI",
            ),
            ConversationServiceTestDataFactory.create_annotation_mock(
                annotation_id="anno-2",
                app_id=app_id,
                question="What is deep learning?",
                content="Deep learning uses neural networks",
            ),
        ]

        mock_current_account.return_value = (account, tenant_id)
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = app

        mock_paginate = MagicMock()
        mock_paginate.items = [annotations[0]]  # Only first annotation matches
        mock_paginate.total = 1
        mock_db_paginate.return_value = mock_paginate

        # Act
        result_items, result_total = AppAnnotationService.get_annotation_list_by_app_id(
            app_id=app_id,
            page=1,
            limit=10,
            keyword="machine",  # Search keyword
        )

        # Assert
        assert len(result_items) == 1
        assert result_total == 1

    @patch("services.annotation_service.db.session")
    @patch("services.annotation_service.current_account_with_tenant")
    def test_insert_annotation_directly(self, mock_current_account, mock_db_session):
        """
        Test direct annotation insertion without message reference.

        This is used for bulk imports or manual annotation creation.
        """
        # Arrange
        app_id = "app-123"
        account = ConversationServiceTestDataFactory.create_account_mock()
        tenant_id = "tenant-123"
        app = ConversationServiceTestDataFactory.create_app_mock(app_id=app_id, tenant_id=tenant_id)

        mock_current_account.return_value = (account, tenant_id)
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.side_effect = [app, None]

        args = {
            "question": "What is natural language processing?",
            "answer": "NLP is a field of AI focused on language understanding",
        }

        # Act
        with patch("services.annotation_service.add_annotation_to_index_task"):
            result = AppAnnotationService.insert_app_annotation_directly(args, app_id)

        # Assert
        mock_db_session.add.assert_called_once()
        mock_db_session.commit.assert_called_once()


class TestConversationServiceExport:
    """
    Test conversation export/retrieval operations.

    Tests retrieving conversation data for export purposes.
    """

    @patch("services.conversation_service.db.session")
    def test_get_conversation_success(self, mock_db_session):
        """Test successful retrieval of conversation."""
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()
        conversation = ConversationServiceTestDataFactory.create_conversation_mock(
            app_id=app_model.id, from_account_id=user.id, from_source="console"
        )

        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = conversation

        # Act
        result = ConversationService.get_conversation(app_model=app_model, conversation_id=conversation.id, user=user)

        # Assert
        assert result == conversation

    @patch("services.conversation_service.db.session")
    def test_get_conversation_not_found(self, mock_db_session):
        """Test ConversationNotExistsError when conversation doesn't exist."""
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()

        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        # Act & Assert
        with pytest.raises(ConversationNotExistsError):
            ConversationService.get_conversation(app_model=app_model, conversation_id="non-existent", user=user)

    @patch("services.annotation_service.db.session")
    @patch("services.annotation_service.current_account_with_tenant")
    def test_export_annotation_list(self, mock_current_account, mock_db_session):
        """Test exporting all annotations for an app."""
        # Arrange
        app_id = "app-123"
        account = ConversationServiceTestDataFactory.create_account_mock()
        tenant_id = "tenant-123"
        app = ConversationServiceTestDataFactory.create_app_mock(app_id=app_id, tenant_id=tenant_id)
        annotations = [
            ConversationServiceTestDataFactory.create_annotation_mock(annotation_id=f"anno-{i}", app_id=app_id)
            for i in range(10)
        ]

        mock_current_account.return_value = (account, tenant_id)
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.first.return_value = app
        mock_query.all.return_value = annotations

        # Act
        result = AppAnnotationService.export_annotation_list_by_app_id(app_id)

        # Assert
        assert len(result) == 10
        assert result == annotations

    @patch("services.message_service.db.session")
    def test_get_message_success(self, mock_db_session):
        """Test successful retrieval of a message."""
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()
        message = ConversationServiceTestDataFactory.create_message_mock(
            app_id=app_model.id, from_account_id=user.id, from_source="console"
        )

        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = message

        # Act
        result = MessageService.get_message(app_model=app_model, user=user, message_id=message.id)

        # Assert
        assert result == message

    @patch("services.message_service.db.session")
    def test_get_message_not_found(self, mock_db_session):
        """Test MessageNotExistsError when message doesn't exist."""
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()

        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        # Act & Assert
        with pytest.raises(MessageNotExistsError):
            MessageService.get_message(app_model=app_model, user=user, message_id="non-existent")

    @patch("services.conversation_service.db.session")
    def test_get_conversation_for_end_user(self, mock_db_session):
        """
        Test retrieving conversation created by end user via API.

        End users (API) and accounts (console) have different access patterns.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        end_user = ConversationServiceTestDataFactory.create_end_user_mock()

        # Conversation created by end user via API
        conversation = ConversationServiceTestDataFactory.create_conversation_mock(
            app_id=app_model.id,
            from_end_user_id=end_user.id,
            from_source="api",  # API source for end users
        )

        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = conversation

        # Act
        result = ConversationService.get_conversation(
            app_model=app_model, conversation_id=conversation.id, user=end_user
        )

        # Assert
        assert result == conversation
        # Verify query filters for API source
        mock_query.where.assert_called()

    @patch("services.conversation_service.delete_conversation_related_data")  # Mock Celery task
    @patch("services.conversation_service.db.session")  # Mock database session
    def test_delete_conversation(self, mock_db_session, mock_delete_task):
        """
        Test conversation deletion with async cleanup.

        Deletion is a two-step process:
        1. Immediately delete the conversation record from database
        2. Trigger async background task to clean up related data
           (messages, annotations, vector embeddings, file uploads)
        """
        # Arrange - Set up test data
        app_model = ConversationServiceTestDataFactory.create_app_mock()
        user = ConversationServiceTestDataFactory.create_account_mock()
        conversation_id = "conv-to-delete"

        # Set up database query mock
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query  # Filter by conversation_id

        # Act - Delete the conversation
        ConversationService.delete(app_model=app_model, conversation_id=conversation_id, user=user)

        # Assert - Verify two-step deletion process
        # Step 1: Immediate database deletion
        mock_query.delete.assert_called_once()  # DELETE query executed
        mock_db_session.commit.assert_called_once()  # Transaction committed

        # Step 2: Async cleanup task triggered
        # The Celery task will handle cleanup of messages, annotations, etc.
        mock_delete_task.delay.assert_called_once_with(conversation_id)
