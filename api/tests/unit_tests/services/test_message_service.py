from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest

from graphon.model_runtime.entities.model_entities import ModelType
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from models.enums import FeedbackFromSource, FeedbackRating
from models.model import App, AppMode, EndUser, Message
from services.errors.message import (
    FirstMessageNotExistsError,
    LastMessageNotExistsError,
    MessageNotExistsError,
    SuggestedQuestionsAfterAnswerDisabledError,
)
from services.message_service import MessageService, attach_message_extra_contents


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
    @patch("services.message_service._create_execution_extra_content_repository")
    @patch("services.message_service.db")
    @patch("services.message_service.ConversationService")
    def test_pagination_by_first_id_without_first_id_desc(
        self, mock_conversation_service, mock_db, mock_create_repo, factory
    ):
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

        mock_db.session.scalars.return_value.all.return_value = messages

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
    @patch("services.message_service._create_execution_extra_content_repository")
    @patch("services.message_service.db")
    @patch("services.message_service.ConversationService")
    def test_pagination_by_first_id_without_first_id_asc(
        self, mock_conversation_service, mock_db, mock_create_repo, factory
    ):
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

        mock_db.session.scalars.return_value.all.return_value = messages

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
    @patch("services.message_service._create_execution_extra_content_repository")
    @patch("services.message_service.db")
    @patch("services.message_service.ConversationService")
    def test_pagination_by_first_id_with_first_id(self, mock_conversation_service, mock_db, mock_create_repo, factory):
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

        mock_db.session.scalar.return_value = first_message
        mock_db.session.scalars.return_value.all.return_value = history_messages

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

        mock_db.session.scalar.return_value = None  # Message not found

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
    @patch("services.message_service._create_execution_extra_content_repository")
    @patch("services.message_service.db")
    @patch("services.message_service.ConversationService")
    def test_pagination_by_first_id_has_more_true(self, mock_conversation_service, mock_db, mock_create_repo, factory):
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

        mock_db.session.scalars.return_value.all.return_value = messages

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

        mock_db.session.scalars.return_value.all.return_value = []

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

        mock_db.session.scalars.return_value.all.return_value = messages

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

        mock_db.session.scalar.return_value = last_message
        mock_db.session.scalars.return_value.all.return_value = new_messages

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

        mock_db.session.scalar.return_value = None  # Message not found

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

        mock_db.session.scalars.return_value.all.return_value = messages

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

        mock_db.session.scalars.return_value.all.return_value = messages

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

        mock_db.session.scalars.return_value.all.return_value = messages

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


class TestMessageServiceUtilities:
    """Unit tests for MessageService module-level utility functions."""

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestMessageServiceFactory()

    # Test 16: attach_message_extra_contents with empty list
    def test_attach_message_extra_contents_empty(self):
        """Test attach_message_extra_contents with empty list does nothing."""
        # Act & Assert (should not raise error)
        attach_message_extra_contents([])

    # Test 17: attach_message_extra_contents with messages
    @patch("services.message_service._create_execution_extra_content_repository")
    def test_attach_message_extra_contents_with_messages(self, mock_create_repo, factory):
        """Test attach_message_extra_contents correctly attaches content."""
        # Arrange
        messages = [factory.create_message_mock(message_id="msg-1"), factory.create_message_mock(message_id="msg-2")]

        mock_repo = MagicMock()
        mock_create_repo.return_value = mock_repo

        # Mock extra content models
        mock_content1 = MagicMock()
        mock_content1.model_dump.return_value = {"key": "value1"}
        mock_content2 = MagicMock()
        mock_content2.model_dump.return_value = {"key": "value2"}

        mock_repo.get_by_message_ids.return_value = [[mock_content1], [mock_content2]]

        # Act
        attach_message_extra_contents(messages)

        # Assert
        mock_repo.get_by_message_ids.assert_called_once_with(["msg-1", "msg-2"])
        messages[0].set_extra_contents.assert_called_once_with([{"key": "value1"}])
        messages[1].set_extra_contents.assert_called_once_with([{"key": "value2"}])

    # Test 18: attach_message_extra_contents with index out of bounds
    @patch("services.message_service._create_execution_extra_content_repository")
    def test_attach_message_extra_contents_index_out_of_bounds(self, mock_create_repo, factory):
        """Test attach_message_extra_contents handles missing content lists."""
        # Arrange
        messages = [factory.create_message_mock(message_id="msg-1")]

        mock_repo = MagicMock()
        mock_create_repo.return_value = mock_repo
        mock_repo.get_by_message_ids.return_value = []  # Empty returned list

        # Act
        attach_message_extra_contents(messages)

        # Assert
        messages[0].set_extra_contents.assert_called_once_with([])

    # Test 19: _create_execution_extra_content_repository
    @patch("services.message_service.db")
    @patch("services.message_service.sessionmaker")
    @patch("services.message_service.SQLAlchemyExecutionExtraContentRepository")
    def test_create_execution_extra_content_repository(self, mock_repo_class, mock_sessionmaker, mock_db):
        """Test _create_execution_extra_content_repository creates expected repository."""
        from services.message_service import _create_execution_extra_content_repository

        # Act
        _create_execution_extra_content_repository()

        # Assert
        mock_sessionmaker.assert_called_once()
        mock_repo_class.assert_called_once()


class TestMessageServiceGetMessage:
    """Unit tests for MessageService.get_message method."""

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestMessageServiceFactory()

    # Test 20: get_message success for EndUser
    @patch("services.message_service.db")
    def test_get_message_end_user_success(self, mock_db, factory):
        """Test get_message returns message for EndUser."""
        # Arrange
        app = factory.create_app_mock()
        user = factory.create_end_user_mock(user_id="end-user-123")
        message = factory.create_message_mock()

        mock_db.session.scalar.return_value = message

        # Act
        result = MessageService.get_message(app_model=app, user=user, message_id="msg-123")

        # Assert
        assert result == message

    # Test 21: get_message success for Account (Admin)
    @patch("services.message_service.db")
    def test_get_message_account_success(self, mock_db, factory):
        """Test get_message returns message for Account."""
        # Arrange
        from models import Account

        app = factory.create_app_mock()
        user = MagicMock(spec=Account)
        user.id = "account-123"
        message = factory.create_message_mock()

        mock_db.session.scalar.return_value = message

        # Act
        result = MessageService.get_message(app_model=app, user=user, message_id="msg-123")

        # Assert
        assert result == message

    # Test 22: get_message not found
    @patch("services.message_service.db")
    def test_get_message_not_found(self, mock_db, factory):
        """Test get_message raises MessageNotExistsError when not found."""
        # Arrange
        app = factory.create_app_mock()
        user = factory.create_end_user_mock()

        mock_db.session.scalar.return_value = None

        # Act & Assert
        with pytest.raises(MessageNotExistsError):
            MessageService.get_message(app_model=app, user=user, message_id="msg-123")


class TestMessageServiceFeedback:
    """Unit tests for MessageService feedback-related methods."""

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestMessageServiceFactory()

    # Test 23: create_feedback - new feedback for EndUser
    @patch("services.message_service.db")
    @patch.object(MessageService, "get_message")
    def test_create_feedback_new_end_user(self, mock_get_message, mock_db, factory):
        """Test creating new feedback for an end user."""
        # Arrange
        app = factory.create_app_mock()
        user = factory.create_end_user_mock()
        message = factory.create_message_mock()
        message.user_feedback = None
        mock_get_message.return_value = message

        # Act
        result = MessageService.create_feedback(
            app_model=app,
            message_id="msg-123",
            user=user,
            rating=FeedbackRating.LIKE,
            content="Good answer",
        )

        # Assert
        assert result.rating == FeedbackRating.LIKE
        assert result.content == "Good answer"
        assert result.from_source == FeedbackFromSource.USER
        mock_db.session.add.assert_called_once()
        mock_db.session.commit.assert_called_once()

    # Test 24: create_feedback - update feedback for Account
    @patch("services.message_service.db")
    @patch.object(MessageService, "get_message")
    def test_create_feedback_update_account(self, mock_get_message, mock_db, factory):
        """Test updating existing feedback for an account."""
        # Arrange
        from models import Account, MessageFeedback

        app = factory.create_app_mock()
        user = MagicMock(spec=Account)
        user.id = "account-123"
        message = factory.create_message_mock()
        feedback = MagicMock(spec=MessageFeedback)
        message.admin_feedback = feedback
        mock_get_message.return_value = message

        # Act
        result = MessageService.create_feedback(
            app_model=app,
            message_id="msg-123",
            user=user,
            rating=FeedbackRating.DISLIKE,
            content="Bad answer",
        )

        # Assert
        assert result == feedback
        assert feedback.rating == FeedbackRating.DISLIKE
        assert feedback.content == "Bad answer"
        mock_db.session.commit.assert_called_once()

    # Test 25: create_feedback - delete feedback (rating is None)
    @patch("services.message_service.db")
    @patch.object(MessageService, "get_message")
    def test_create_feedback_delete(self, mock_get_message, mock_db, factory):
        """Test deleting feedback by passing rating=None."""
        # Arrange
        app = factory.create_app_mock()
        user = factory.create_end_user_mock()
        message = factory.create_message_mock()
        feedback = MagicMock()
        message.user_feedback = feedback
        mock_get_message.return_value = message

        # Act
        result = MessageService.create_feedback(
            app_model=app,
            message_id="msg-123",
            user=user,
            rating=None,
            content=None,
        )

        # Assert
        assert result == feedback
        mock_db.session.delete.assert_called_once_with(feedback)
        mock_db.session.commit.assert_called_once()

    # Test 26: get_all_messages_feedbacks
    @patch("services.message_service.db")
    def test_get_all_messages_feedbacks(self, mock_db, factory):
        """Test get_all_messages_feedbacks returns list of dicts."""
        # Arrange
        app = factory.create_app_mock()
        feedback = MagicMock()
        feedback.to_dict.return_value = {"id": "fb-1"}

        mock_db.session.scalars.return_value.all.return_value = [feedback]

        # Act
        result = MessageService.get_all_messages_feedbacks(app_model=app, page=1, limit=10)

        # Assert
        assert result == [{"id": "fb-1"}]


class TestMessageServiceSuggestedQuestions:
    """Unit tests for MessageService.get_suggested_questions_after_answer method."""

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestMessageServiceFactory()

    # Test 27: get_suggested_questions_after_answer - user is None
    def test_get_suggested_questions_user_none(self, factory):
        app = factory.create_app_mock()
        with pytest.raises(ValueError, match="user cannot be None"):
            MessageService.get_suggested_questions_after_answer(
                app_model=app, user=None, message_id="msg-123", invoke_from=MagicMock()
            )

    # Test 28: get_suggested_questions_after_answer - Advanced Chat success
    @patch("services.message_service.ModelManager.for_tenant")
    @patch("services.message_service.WorkflowService")
    @patch("services.message_service.AdvancedChatAppConfigManager")
    @patch("services.message_service.TokenBufferMemory")
    @patch("services.message_service.LLMGenerator")
    @patch("services.message_service.TraceQueueManager")
    @patch.object(MessageService, "get_message")
    @patch("services.message_service.ConversationService")
    def test_get_suggested_questions_advanced_chat_success(
        self,
        mock_conversation_service,
        mock_get_message,
        mock_trace_manager,
        mock_llm_gen,
        mock_memory,
        mock_config_manager,
        mock_workflow_service,
        mock_model_manager,
        factory,
    ):
        """Test successful suggested questions generation in Advanced Chat mode."""
        from core.app.entities.app_invoke_entities import InvokeFrom

        # Arrange
        app = factory.create_app_mock(mode=AppMode.ADVANCED_CHAT.value)
        user = factory.create_end_user_mock()
        message = factory.create_message_mock()
        mock_get_message.return_value = message

        workflow = MagicMock()
        mock_workflow_service.return_value.get_published_workflow.return_value = workflow

        app_config = MagicMock()
        app_config.additional_features.suggested_questions_after_answer = True
        mock_config_manager.get_app_config.return_value = app_config

        mock_llm_gen.generate_suggested_questions_after_answer.return_value = ["Q1?"]

        # Act
        result = MessageService.get_suggested_questions_after_answer(
            app_model=app, user=user, message_id="msg-123", invoke_from=InvokeFrom.WEB_APP
        )

        # Assert
        assert result == ["Q1?"]
        mock_workflow_service.return_value.get_published_workflow.assert_called_once()
        mock_llm_gen.generate_suggested_questions_after_answer.assert_called_once()

    # Test 29: get_suggested_questions_after_answer - Chat app success (no override)
    @patch("services.message_service.db")
    @patch("services.message_service.ModelManager.for_tenant")
    @patch("services.message_service.TokenBufferMemory")
    @patch("services.message_service.LLMGenerator")
    @patch("services.message_service.TraceQueueManager")
    @patch.object(MessageService, "get_message")
    @patch("services.message_service.ConversationService")
    def test_get_suggested_questions_chat_app_success(
        self,
        mock_conversation_service,
        mock_get_message,
        mock_trace_manager,
        mock_llm_gen,
        mock_memory,
        mock_model_manager,
        mock_db,
        factory,
    ):
        """Test successful suggested questions generation in basic Chat mode."""
        # Arrange
        app = factory.create_app_mock(mode=AppMode.CHAT)
        user = factory.create_end_user_mock()
        message = factory.create_message_mock()
        mock_get_message.return_value = message

        conversation = MagicMock()
        conversation.override_model_configs = None
        mock_conversation_service.get_conversation.return_value = conversation

        app_model_config = MagicMock()
        app_model_config.suggested_questions_after_answer_dict = {"enabled": True}
        app_model_config.model_dict = {"provider": "openai", "name": "gpt-4"}

        mock_db.session.scalar.return_value = app_model_config

        mock_llm_gen.generate_suggested_questions_after_answer.return_value = ["Q1?"]

        # Act
        result = MessageService.get_suggested_questions_after_answer(
            app_model=app, user=user, message_id="msg-123", invoke_from=MagicMock()
        )

        # Assert
        assert result == ["Q1?"]
        mock_llm_gen.generate_suggested_questions_after_answer.assert_called_once()

    @patch("services.message_service.db")
    @patch("services.message_service.ModelManager.for_tenant")
    @patch("services.message_service.TokenBufferMemory")
    @patch("services.message_service.LLMGenerator")
    @patch("services.message_service.TraceQueueManager")
    @patch.object(MessageService, "get_message")
    @patch("services.message_service.ConversationService")
    def test_get_suggested_questions_chat_app_uses_frontend_model_and_prompt(
        self,
        mock_conversation_service,
        mock_get_message,
        mock_trace_manager,
        mock_llm_gen,
        mock_memory,
        mock_model_manager,
        mock_db,
        factory,
    ):
        """Test suggested question generation uses frontend configured model and prompt."""
        from core.app.entities.app_invoke_entities import InvokeFrom

        app = factory.create_app_mock(mode=AppMode.CHAT)
        app.tenant_id = "tenant-123"
        user = factory.create_end_user_mock()
        message = factory.create_message_mock()
        mock_get_message.return_value = message

        conversation = MagicMock()
        conversation.override_model_configs = None
        mock_conversation_service.get_conversation.return_value = conversation

        app_model_config = MagicMock()
        app_model_config.suggested_questions_after_answer_dict = {
            "enabled": True,
            "prompt": "custom prompt",
            "model": {
                "provider": "openai",
                "name": "gpt-4o-mini",
                "completion_params": {"max_tokens": 2048, "temperature": 0.1},
            },
        }
        mock_db.session.scalar.return_value = app_model_config

        mock_memory.return_value.get_history_prompt_text.return_value = "histories"
        mock_llm_gen.generate_suggested_questions_after_answer.return_value = ["Q1?"]

        result = MessageService.get_suggested_questions_after_answer(
            app_model=app,
            user=user,
            message_id="msg-123",
            invoke_from=InvokeFrom.WEB_APP,
        )

        assert result == ["Q1?"]
        mock_model_manager.return_value.get_default_model_instance.assert_called_once_with(
            tenant_id="tenant-123",
            model_type=ModelType.LLM,
        )
        mock_memory.assert_called_once_with(
            conversation=conversation,
            model_instance=mock_model_manager.return_value.get_default_model_instance.return_value,
        )
        mock_llm_gen.generate_suggested_questions_after_answer.assert_called_once_with(
            tenant_id="tenant-123",
            histories="histories",
            instruction_prompt="custom prompt",
            model_config={
                "provider": "openai",
                "name": "gpt-4o-mini",
                "completion_params": {"max_tokens": 2048, "temperature": 0.1},
            },
        )

    @patch("services.message_service.db")
    @patch("services.message_service.ModelManager.for_tenant")
    @patch("services.message_service.TokenBufferMemory")
    @patch("services.message_service.LLMGenerator")
    @patch("services.message_service.TraceQueueManager")
    @patch.object(MessageService, "get_message")
    @patch("services.message_service.ConversationService")
    def test_get_suggested_questions_chat_app_invalid_frontend_model_fallback_to_default(
        self,
        mock_conversation_service,
        mock_get_message,
        mock_trace_manager,
        mock_llm_gen,
        mock_memory,
        mock_model_manager,
        mock_db,
        factory,
    ):
        """Test invalid frontend configured model falls back to tenant default model."""
        app = factory.create_app_mock(mode=AppMode.CHAT)
        app.tenant_id = "tenant-123"
        user = factory.create_end_user_mock()
        message = factory.create_message_mock()
        mock_get_message.return_value = message

        conversation = MagicMock()
        conversation.override_model_configs = None
        mock_conversation_service.get_conversation.return_value = conversation

        app_model_config = MagicMock()
        app_model_config.suggested_questions_after_answer_dict = {
            "enabled": True,
            "model": {"provider": "openai", "name": "invalid-model"},
        }
        mock_db.session.scalar.return_value = app_model_config

        mock_model_manager.return_value.get_model_instance.side_effect = ValueError("invalid model")
        mock_memory.return_value.get_history_prompt_text.return_value = "histories"
        mock_llm_gen.generate_suggested_questions_after_answer.return_value = ["Q1?"]

        result = MessageService.get_suggested_questions_after_answer(
            app_model=app, user=user, message_id="msg-123", invoke_from=MagicMock()
        )

        assert result == ["Q1?"]
        mock_model_manager.return_value.get_default_model_instance.assert_called_once_with(
            tenant_id="tenant-123",
            model_type=ModelType.LLM,
        )
        mock_model_manager.return_value.get_model_instance.assert_not_called()

    # Test 30: get_suggested_questions_after_answer - Disabled Error
    @patch("services.message_service.WorkflowService")
    @patch("services.message_service.AdvancedChatAppConfigManager")
    @patch.object(MessageService, "get_message")
    @patch("services.message_service.ConversationService")
    def test_get_suggested_questions_disabled_error(
        self, mock_conversation_service, mock_get_message, mock_config_manager, mock_workflow_service, factory
    ):
        """Test SuggestedQuestionsAfterAnswerDisabledError is raised when feature is disabled."""
        # Arrange
        app = factory.create_app_mock(mode=AppMode.ADVANCED_CHAT.value)
        user = factory.create_end_user_mock()
        mock_get_message.return_value = factory.create_message_mock()

        workflow = MagicMock()
        mock_workflow_service.return_value.get_published_workflow.return_value = workflow

        app_config = MagicMock()
        app_config.additional_features.suggested_questions_after_answer = False
        mock_config_manager.get_app_config.return_value = app_config

        # Act & Assert
        with pytest.raises(SuggestedQuestionsAfterAnswerDisabledError):
            MessageService.get_suggested_questions_after_answer(
                app_model=app, user=user, message_id="msg-123", invoke_from=MagicMock()
            )
