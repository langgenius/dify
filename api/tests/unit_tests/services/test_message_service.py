from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest

from libs.infinite_scroll_pagination import InfiniteScrollPagination
from models.model import App, AppMode, EndUser, Message
from services.errors.message import FirstMessageNotExistsError, LastMessageNotExistsError
from services.message_service import MessageService


class TestMessageServiceFactory:
    """Factory class for creating test data and mock objects for message service tests."""

    @staticmethod
    def create_app_mock(
        app_id: str = "app-123",
        mode: str = AppMode.ADVANCED_CHAT.value,
        name: str = "Test App",
    ) -> MagicMock:
        """Create a mock App object."""
        app = MagicMock(spec=App)
        app.id = app_id
        app.mode = mode
        app.name = name
        return app

    @staticmethod
    def create_end_user_mock(
        user_id: str = "user-456",
        session_id: str = "session-789",
    ) -> MagicMock:
        """Create a mock EndUser object."""
        user = MagicMock(spec=EndUser)
        user.id = user_id
        user.session_id = session_id
        return user

    @staticmethod
    def create_conversation_mock(
        conversation_id: str = "conv-001",
        app_id: str = "app-123",
    ) -> MagicMock:
        """Create a mock Conversation object."""
        conversation = MagicMock()
        conversation.id = conversation_id
        conversation.app_id = app_id
        return conversation

    @staticmethod
    def create_message_mock(
        message_id: str = "msg-001",
        conversation_id: str = "conv-001",
        query: str = "What is AI?",
        answer: str = "AI stands for Artificial Intelligence.",
        created_at: datetime | None = None,
    ) -> MagicMock:
        """Create a mock Message object."""
        message = MagicMock(spec=Message)
        message.id = message_id
        message.conversation_id = conversation_id
        message.query = query
        message.answer = answer
        message.created_at = created_at or datetime.now()
        return message


class TestMessageServicePaginationByFirstId:
    """
    Unit tests for MessageService.pagination_by_first_id method.

    This test suite covers:
    - Basic pagination with and without first_id
    - Order handling (asc/desc)
    - Edge cases (no user, no conversation, invalid first_id)
    - Has_more flag logic
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestMessageServiceFactory()

    # Test 01: No user provided
    def test_pagination_by_first_id_no_user(self, factory):
        """Test pagination returns empty result when no user is provided."""
        # Arrange
        app = factory.create_app_mock()

        # Act
        result = MessageService.pagination_by_first_id(
            app_model=app,
            user=None,
            conversation_id="conv-001",
            first_id=None,
            limit=10,
        )

        # Assert
        assert isinstance(result, InfiniteScrollPagination)
        assert result.data == []
        assert result.limit == 10
        assert result.has_more is False

    # Test 02: No conversation_id provided
    def test_pagination_by_first_id_no_conversation(self, factory):
        """Test pagination returns empty result when no conversation_id is provided."""
        # Arrange
        app = factory.create_app_mock()
        user = factory.create_end_user_mock()

        # Act
        result = MessageService.pagination_by_first_id(
            app_model=app,
            user=user,
            conversation_id="",
            first_id=None,
            limit=10,
        )

        # Assert
        assert isinstance(result, InfiniteScrollPagination)
        assert result.data == []
        assert result.limit == 10
        assert result.has_more is False

    # Test 03: Basic pagination without first_id (desc order)
    @patch("services.message_service.db")
    @patch("services.message_service.ConversationService")
    def test_pagination_by_first_id_without_first_id_desc(self, mock_conversation_service, mock_db, factory):
        """Test basic pagination without first_id in descending order."""
        # Arrange
        app = factory.create_app_mock()
        user = factory.create_end_user_mock()
        conversation = factory.create_conversation_mock()

        mock_conversation_service.get_conversation.return_value = conversation

        # Create 5 messages
        messages = [
            factory.create_message_mock(
                message_id=f"msg-{i:03d}",
                created_at=datetime(2024, 1, 1, 12, i),
            )
            for i in range(5)
        ]

        mock_query = MagicMock()
        mock_db.session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.all.return_value = messages

        # Act
        result = MessageService.pagination_by_first_id(
            app_model=app,
            user=user,
            conversation_id="conv-001",
            first_id=None,
            limit=10,
            order="desc",
        )

        # Assert
        assert len(result.data) == 5
        assert result.has_more is False
        assert result.limit == 10
        # Messages should remain in desc order (not reversed)
        assert result.data[0].id == "msg-000"

    # Test 04: Basic pagination without first_id (asc order)
    @patch("services.message_service.db")
    @patch("services.message_service.ConversationService")
    def test_pagination_by_first_id_without_first_id_asc(self, mock_conversation_service, mock_db, factory):
        """Test basic pagination without first_id in ascending order."""
        # Arrange
        app = factory.create_app_mock()
        user = factory.create_end_user_mock()
        conversation = factory.create_conversation_mock()

        mock_conversation_service.get_conversation.return_value = conversation

        # Create 5 messages (returned in desc order from DB)
        messages = [
            factory.create_message_mock(
                message_id=f"msg-{i:03d}",
                created_at=datetime(2024, 1, 1, 12, 4 - i),  # Descending timestamps
            )
            for i in range(5)
        ]

        mock_query = MagicMock()
        mock_db.session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.all.return_value = messages

        # Act
        result = MessageService.pagination_by_first_id(
            app_model=app,
            user=user,
            conversation_id="conv-001",
            first_id=None,
            limit=10,
            order="asc",
        )

        # Assert
        assert len(result.data) == 5
        assert result.has_more is False
        # Messages should be reversed to asc order
        assert result.data[0].id == "msg-004"
        assert result.data[4].id == "msg-000"

    # Test 05: Pagination with first_id
    @patch("services.message_service.db")
    @patch("services.message_service.ConversationService")
    def test_pagination_by_first_id_with_first_id(self, mock_conversation_service, mock_db, factory):
        """Test pagination with first_id to get messages before a specific message."""
        # Arrange
        app = factory.create_app_mock()
        user = factory.create_end_user_mock()
        conversation = factory.create_conversation_mock()

        mock_conversation_service.get_conversation.return_value = conversation

        first_message = factory.create_message_mock(
            message_id="msg-005",
            created_at=datetime(2024, 1, 1, 12, 5),
        )

        # Messages before first_message
        history_messages = [
            factory.create_message_mock(
                message_id=f"msg-{i:03d}",
                created_at=datetime(2024, 1, 1, 12, i),
            )
            for i in range(5)
        ]

        # Setup query mocks
        mock_query_first = MagicMock()
        mock_query_history = MagicMock()

        def query_side_effect(*args):
            if args[0] == Message:
                # First call returns mock for first_message query
                if not hasattr(query_side_effect, "call_count"):
                    query_side_effect.call_count = 0
                query_side_effect.call_count += 1

                if query_side_effect.call_count == 1:
                    return mock_query_first
                else:
                    return mock_query_history

        mock_db.session.query.side_effect = [mock_query_first, mock_query_history]

        # Setup first message query
        mock_query_first.where.return_value = mock_query_first
        mock_query_first.first.return_value = first_message

        # Setup history messages query
        mock_query_history.where.return_value = mock_query_history
        mock_query_history.order_by.return_value = mock_query_history
        mock_query_history.limit.return_value = mock_query_history
        mock_query_history.all.return_value = history_messages

        # Act
        result = MessageService.pagination_by_first_id(
            app_model=app,
            user=user,
            conversation_id="conv-001",
            first_id="msg-005",
            limit=10,
            order="desc",
        )

        # Assert
        assert len(result.data) == 5
        assert result.has_more is False
        mock_query_first.where.assert_called_once()
        mock_query_history.where.assert_called_once()

    # Test 06: First message not found
    @patch("services.message_service.db")
    @patch("services.message_service.ConversationService")
    def test_pagination_by_first_id_first_message_not_exists(self, mock_conversation_service, mock_db, factory):
        """Test error handling when first_id doesn't exist."""
        # Arrange
        app = factory.create_app_mock()
        user = factory.create_end_user_mock()
        conversation = factory.create_conversation_mock()

        mock_conversation_service.get_conversation.return_value = conversation

        mock_query = MagicMock()
        mock_db.session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None  # Message not found

        # Act & Assert
        with pytest.raises(FirstMessageNotExistsError):
            MessageService.pagination_by_first_id(
                app_model=app,
                user=user,
                conversation_id="conv-001",
                first_id="nonexistent-msg",
                limit=10,
            )

    # Test 07: Has_more flag when results exceed limit
    @patch("services.message_service.db")
    @patch("services.message_service.ConversationService")
    def test_pagination_by_first_id_has_more_true(self, mock_conversation_service, mock_db, factory):
        """Test has_more flag is True when results exceed limit."""
        # Arrange
        app = factory.create_app_mock()
        user = factory.create_end_user_mock()
        conversation = factory.create_conversation_mock()

        mock_conversation_service.get_conversation.return_value = conversation

        # Create limit+1 messages (11 messages for limit=10)
        messages = [
            factory.create_message_mock(
                message_id=f"msg-{i:03d}",
                created_at=datetime(2024, 1, 1, 12, i),
            )
            for i in range(11)
        ]

        mock_query = MagicMock()
        mock_db.session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.all.return_value = messages

        # Act
        result = MessageService.pagination_by_first_id(
            app_model=app,
            user=user,
            conversation_id="conv-001",
            first_id=None,
            limit=10,
        )

        # Assert
        assert len(result.data) == 10  # Last message trimmed
        assert result.has_more is True
        assert result.limit == 10

    # Test 08: Empty conversation
    @patch("services.message_service.db")
    @patch("services.message_service.ConversationService")
    def test_pagination_by_first_id_empty_conversation(self, mock_conversation_service, mock_db, factory):
        """Test pagination with conversation that has no messages."""
        # Arrange
        app = factory.create_app_mock()
        user = factory.create_end_user_mock()
        conversation = factory.create_conversation_mock()

        mock_conversation_service.get_conversation.return_value = conversation

        mock_query = MagicMock()
        mock_db.session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.all.return_value = []

        # Act
        result = MessageService.pagination_by_first_id(
            app_model=app,
            user=user,
            conversation_id="conv-001",
            first_id=None,
            limit=10,
        )

        # Assert
        assert len(result.data) == 0
        assert result.has_more is False
        assert result.limit == 10


class TestMessageServicePaginationByLastId:
    """
    Unit tests for MessageService.pagination_by_last_id method.

    This test suite covers:
    - Basic pagination with and without last_id
    - Conversation filtering
    - Include_ids filtering
    - Edge cases (no user, invalid last_id)
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestMessageServiceFactory()

    # Test 09: No user provided
    def test_pagination_by_last_id_no_user(self, factory):
        """Test pagination returns empty result when no user is provided."""
        # Arrange
        app = factory.create_app_mock()

        # Act
        result = MessageService.pagination_by_last_id(
            app_model=app,
            user=None,
            last_id=None,
            limit=10,
        )

        # Assert
        assert isinstance(result, InfiniteScrollPagination)
        assert result.data == []
        assert result.limit == 10
        assert result.has_more is False

    # Test 10: Basic pagination without last_id
    @patch("services.message_service.db")
    def test_pagination_by_last_id_without_last_id(self, mock_db, factory):
        """Test basic pagination without last_id."""
        # Arrange
        app = factory.create_app_mock()
        user = factory.create_end_user_mock()

        messages = [
            factory.create_message_mock(
                message_id=f"msg-{i:03d}",
                created_at=datetime(2024, 1, 1, 12, i),
            )
            for i in range(5)
        ]

        mock_query = MagicMock()
        mock_db.session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.all.return_value = messages

        # Act
        result = MessageService.pagination_by_last_id(
            app_model=app,
            user=user,
            last_id=None,
            limit=10,
        )

        # Assert
        assert len(result.data) == 5
        assert result.has_more is False
        assert result.limit == 10

    # Test 11: Pagination with last_id
    @patch("services.message_service.db")
    def test_pagination_by_last_id_with_last_id(self, mock_db, factory):
        """Test pagination with last_id to get messages after a specific message."""
        # Arrange
        app = factory.create_app_mock()
        user = factory.create_end_user_mock()

        last_message = factory.create_message_mock(
            message_id="msg-005",
            created_at=datetime(2024, 1, 1, 12, 5),
        )

        # Messages after last_message
        new_messages = [
            factory.create_message_mock(
                message_id=f"msg-{i:03d}",
                created_at=datetime(2024, 1, 1, 12, i),
            )
            for i in range(6, 10)
        ]

        # Setup base query mock that returns itself for chaining
        mock_base_query = MagicMock()
        mock_db.session.query.return_value = mock_base_query

        # First where() call for last_id lookup
        mock_query_last = MagicMock()
        mock_query_last.first.return_value = last_message

        # Second where() call for history messages
        mock_query_history = MagicMock()
        mock_query_history.order_by.return_value = mock_query_history
        mock_query_history.limit.return_value = mock_query_history
        mock_query_history.all.return_value = new_messages

        # Setup where() to return different mocks on consecutive calls
        mock_base_query.where.side_effect = [mock_query_last, mock_query_history]

        # Act
        result = MessageService.pagination_by_last_id(
            app_model=app,
            user=user,
            last_id="msg-005",
            limit=10,
        )

        # Assert
        assert len(result.data) == 4
        assert result.has_more is False

    # Test 12: Last message not found
    @patch("services.message_service.db")
    def test_pagination_by_last_id_last_message_not_exists(self, mock_db, factory):
        """Test error handling when last_id doesn't exist."""
        # Arrange
        app = factory.create_app_mock()
        user = factory.create_end_user_mock()

        mock_query = MagicMock()
        mock_db.session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None  # Message not found

        # Act & Assert
        with pytest.raises(LastMessageNotExistsError):
            MessageService.pagination_by_last_id(
                app_model=app,
                user=user,
                last_id="nonexistent-msg",
                limit=10,
            )

    # Test 13: Pagination with conversation_id filter
    @patch("services.message_service.ConversationService")
    @patch("services.message_service.db")
    def test_pagination_by_last_id_with_conversation_filter(self, mock_db, mock_conversation_service, factory):
        """Test pagination filtered by conversation_id."""
        # Arrange
        app = factory.create_app_mock()
        user = factory.create_end_user_mock()
        conversation = factory.create_conversation_mock(conversation_id="conv-001")

        mock_conversation_service.get_conversation.return_value = conversation

        messages = [
            factory.create_message_mock(
                message_id=f"msg-{i:03d}",
                conversation_id="conv-001",
                created_at=datetime(2024, 1, 1, 12, i),
            )
            for i in range(5)
        ]

        mock_query = MagicMock()
        mock_db.session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.all.return_value = messages

        # Act
        result = MessageService.pagination_by_last_id(
            app_model=app,
            user=user,
            last_id=None,
            limit=10,
            conversation_id="conv-001",
        )

        # Assert
        assert len(result.data) == 5
        assert result.has_more is False
        # Verify conversation_id was used in query
        mock_query.where.assert_called()
        mock_conversation_service.get_conversation.assert_called_once()

    # Test 14: Pagination with include_ids filter
    @patch("services.message_service.db")
    def test_pagination_by_last_id_with_include_ids(self, mock_db, factory):
        """Test pagination filtered by include_ids."""
        # Arrange
        app = factory.create_app_mock()
        user = factory.create_end_user_mock()

        # Only messages with IDs in include_ids should be returned
        messages = [
            factory.create_message_mock(message_id="msg-001"),
            factory.create_message_mock(message_id="msg-003"),
        ]

        mock_query = MagicMock()
        mock_db.session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.all.return_value = messages

        # Act
        result = MessageService.pagination_by_last_id(
            app_model=app,
            user=user,
            last_id=None,
            limit=10,
            include_ids=["msg-001", "msg-003"],
        )

        # Assert
        assert len(result.data) == 2
        assert result.data[0].id == "msg-001"
        assert result.data[1].id == "msg-003"

    # Test 15: Has_more flag when results exceed limit
    @patch("services.message_service.db")
    def test_pagination_by_last_id_has_more_true(self, mock_db, factory):
        """Test has_more flag is True when results exceed limit."""
        # Arrange
        app = factory.create_app_mock()
        user = factory.create_end_user_mock()

        # Create limit+1 messages (11 messages for limit=10)
        messages = [
            factory.create_message_mock(
                message_id=f"msg-{i:03d}",
                created_at=datetime(2024, 1, 1, 12, i),
            )
            for i in range(11)
        ]

        mock_query = MagicMock()
        mock_db.session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.all.return_value = messages

        # Act
        result = MessageService.pagination_by_last_id(
            app_model=app,
            user=user,
            last_id=None,
            limit=10,
        )

        # Assert
        assert len(result.data) == 10  # Last message trimmed
        assert result.has_more is True
        assert result.limit == 10
