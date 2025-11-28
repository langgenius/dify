"""
Comprehensive unit tests for MessageService.

This test suite covers:
- Message pagination by first_id and last_id
- Message feedback creation and management
- Message retrieval operations
- Suggested questions after answer functionality
- Edge cases and error handling
"""

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from libs.infinite_scroll_pagination import InfiniteScrollPagination
from services.errors.message import (
    FirstMessageNotExistsError,
    LastMessageNotExistsError,
    MessageNotExistsError,
)


class TestMessageServicePaginationByFirstId:
    """Test suite for MessageService.pagination_by_first_id method."""

    def test_pagination_returns_empty_when_user_is_none(self):
        """Test returns empty pagination when user is None."""
        # Arrange
        mock_app = MagicMock()
        conversation_id = str(uuid4())

        from services.message_service import MessageService

        # Act
        result = MessageService.pagination_by_first_id(
            app_model=mock_app,
            user=None,
            conversation_id=conversation_id,
            first_id=None,
            limit=10,
        )

        # Assert
        assert isinstance(result, InfiniteScrollPagination)
        assert result.data == []
        assert result.has_more is False

    def test_pagination_returns_empty_when_conversation_id_empty(self):
        """Test returns empty pagination when conversation_id is empty."""
        # Arrange
        mock_app = MagicMock()
        mock_user = MagicMock()

        from services.message_service import MessageService

        # Act
        result = MessageService.pagination_by_first_id(
            app_model=mock_app,
            user=mock_user,
            conversation_id="",
            first_id=None,
            limit=10,
        )

        # Assert
        assert isinstance(result, InfiniteScrollPagination)
        assert result.data == []
        assert result.has_more is False

    def test_pagination_raises_error_when_first_message_not_found(self):
        """Test raises FirstMessageNotExistsError when first_id message not found."""
        # Arrange
        mock_app = MagicMock()
        mock_user = MagicMock()
        conversation_id = str(uuid4())
        first_id = str(uuid4())

        mock_conversation = MagicMock()
        mock_conversation.id = conversation_id

        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        with (
            patch("services.message_service.ConversationService.get_conversation", return_value=mock_conversation),
            patch("services.message_service.db.session.query", return_value=mock_query),
        ):
            from services.message_service import MessageService

            # Act & Assert
            with pytest.raises(FirstMessageNotExistsError):
                MessageService.pagination_by_first_id(
                    app_model=mock_app,
                    user=mock_user,
                    conversation_id=conversation_id,
                    first_id=first_id,
                    limit=10,
                )

    def test_pagination_returns_messages_without_first_id(self):
        """Test returns messages when first_id is not provided."""
        # Arrange
        mock_app = MagicMock()
        mock_user = MagicMock()
        conversation_id = str(uuid4())

        mock_conversation = MagicMock()
        mock_conversation.id = conversation_id

        mock_message = MagicMock()
        mock_messages = [mock_message]

        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.all.return_value = mock_messages

        with (
            patch("services.message_service.ConversationService.get_conversation", return_value=mock_conversation),
            patch("services.message_service.db.session.query", return_value=mock_query),
        ):
            from services.message_service import MessageService

            # Act
            result = MessageService.pagination_by_first_id(
                app_model=mock_app,
                user=mock_user,
                conversation_id=conversation_id,
                first_id=None,
                limit=10,
            )

            # Assert
            assert isinstance(result, InfiniteScrollPagination)
            assert len(result.data) == 1

    def test_pagination_sets_has_more_when_exceeds_limit(self):
        """Test sets has_more=True when results exceed limit."""
        # Arrange
        mock_app = MagicMock()
        mock_user = MagicMock()
        conversation_id = str(uuid4())

        mock_conversation = MagicMock()
        mock_conversation.id = conversation_id

        # Return limit + 1 messages to trigger has_more
        mock_messages = [MagicMock() for _ in range(11)]

        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.all.return_value = mock_messages

        with (
            patch("services.message_service.ConversationService.get_conversation", return_value=mock_conversation),
            patch("services.message_service.db.session.query", return_value=mock_query),
        ):
            from services.message_service import MessageService

            # Act
            result = MessageService.pagination_by_first_id(
                app_model=mock_app,
                user=mock_user,
                conversation_id=conversation_id,
                first_id=None,
                limit=10,
            )

            # Assert
            assert result.has_more is True
            assert len(result.data) == 10


class TestMessageServicePaginationByLastId:
    """Test suite for MessageService.pagination_by_last_id method."""

    def test_pagination_returns_empty_when_user_is_none(self):
        """Test returns empty pagination when user is None."""
        # Arrange
        mock_app = MagicMock()

        from services.message_service import MessageService

        # Act
        result = MessageService.pagination_by_last_id(
            app_model=mock_app,
            user=None,
            last_id=None,
            limit=10,
        )

        # Assert
        assert isinstance(result, InfiniteScrollPagination)
        assert result.data == []
        assert result.has_more is False

    def test_pagination_returns_empty_when_include_ids_empty(self):
        """Test returns empty pagination when include_ids is empty list."""
        # Arrange
        mock_app = MagicMock()
        mock_user = MagicMock()

        from services.message_service import MessageService

        # Act
        result = MessageService.pagination_by_last_id(
            app_model=mock_app,
            user=mock_user,
            last_id=None,
            limit=10,
            include_ids=[],
        )

        # Assert
        assert isinstance(result, InfiniteScrollPagination)
        assert result.data == []

    def test_pagination_raises_error_when_last_message_not_found(self):
        """Test raises LastMessageNotExistsError when last_id message not found."""
        # Arrange
        mock_app = MagicMock()
        mock_user = MagicMock()
        last_id = str(uuid4())

        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        with patch("services.message_service.db.session.query", return_value=mock_query):
            from services.message_service import MessageService

            # Act & Assert
            with pytest.raises(LastMessageNotExistsError):
                MessageService.pagination_by_last_id(
                    app_model=mock_app,
                    user=mock_user,
                    last_id=last_id,
                    limit=10,
                )

    def test_pagination_returns_messages_with_conversation_filter(self):
        """Test returns messages filtered by conversation_id."""
        # Arrange
        mock_app = MagicMock()
        mock_user = MagicMock()
        conversation_id = str(uuid4())

        mock_conversation = MagicMock()
        mock_conversation.id = conversation_id

        mock_message = MagicMock()
        mock_messages = [mock_message]

        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.all.return_value = mock_messages

        with (
            patch("services.message_service.ConversationService.get_conversation", return_value=mock_conversation),
            patch("services.message_service.db.session.query", return_value=mock_query),
        ):
            from services.message_service import MessageService

            # Act
            result = MessageService.pagination_by_last_id(
                app_model=mock_app,
                user=mock_user,
                last_id=None,
                limit=10,
                conversation_id=conversation_id,
            )

            # Assert
            assert isinstance(result, InfiniteScrollPagination)
            assert len(result.data) == 1


class TestMessageServiceCreateFeedback:
    """Test suite for MessageService.create_feedback method."""

    def test_create_feedback_raises_error_when_user_is_none(self):
        """Test raises ValueError when user is None."""
        # Arrange
        mock_app = MagicMock()
        message_id = str(uuid4())

        from services.message_service import MessageService

        # Act & Assert
        with pytest.raises(ValueError, match="user cannot be None"):
            MessageService.create_feedback(
                app_model=mock_app,
                message_id=message_id,
                user=None,
                rating="like",
                content="Great response!",
            )

    def test_create_feedback_raises_error_when_no_rating_and_no_feedback(self):
        """Test raises ValueError when rating is None and no existing feedback."""
        # Arrange
        mock_app = MagicMock()
        mock_user = MagicMock()
        message_id = str(uuid4())

        mock_message = MagicMock()
        mock_message.user_feedback = None
        mock_message.admin_feedback = None

        with patch("services.message_service.MessageService.get_message", return_value=mock_message):
            from models import EndUser
            from services.message_service import MessageService

            # Make user an EndUser instance
            mock_user.__class__ = EndUser

            # Act & Assert
            with pytest.raises(ValueError, match="rating cannot be None"):
                MessageService.create_feedback(
                    app_model=mock_app,
                    message_id=message_id,
                    user=mock_user,
                    rating=None,
                    content=None,
                )


class TestMessageServiceGetMessage:
    """Test suite for MessageService.get_message method."""

    def test_get_message_raises_error_when_not_found(self):
        """Test raises MessageNotExistsError when message not found."""
        # Arrange
        mock_app = MagicMock()
        mock_app.id = str(uuid4())
        mock_user = MagicMock()
        mock_user.id = str(uuid4())
        message_id = str(uuid4())

        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        with patch("services.message_service.db.session.query", return_value=mock_query):
            from services.message_service import MessageService

            # Act & Assert
            with pytest.raises(MessageNotExistsError):
                MessageService.get_message(
                    app_model=mock_app,
                    user=mock_user,
                    message_id=message_id,
                )

    def test_get_message_returns_message_when_found(self):
        """Test returns message when found."""
        # Arrange
        mock_app = MagicMock()
        mock_app.id = str(uuid4())
        mock_user = MagicMock()
        mock_user.id = str(uuid4())
        message_id = str(uuid4())

        mock_message = MagicMock()
        mock_message.id = message_id

        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = mock_message

        with patch("services.message_service.db.session.query", return_value=mock_query):
            from services.message_service import MessageService

            # Act
            result = MessageService.get_message(
                app_model=mock_app,
                user=mock_user,
                message_id=message_id,
            )

            # Assert
            assert result.id == message_id


class TestMessageServiceGetAllFeedbacks:
    """Test suite for MessageService.get_all_messages_feedbacks method."""

    def test_get_all_feedbacks_returns_empty_list_when_no_feedbacks(self):
        """Test returns empty list when no feedbacks exist."""
        # Arrange
        mock_app = MagicMock()
        mock_app.id = str(uuid4())

        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.offset.return_value = mock_query
        mock_query.all.return_value = []

        with patch("services.message_service.db.session.query", return_value=mock_query):
            from services.message_service import MessageService

            # Act
            result = MessageService.get_all_messages_feedbacks(
                app_model=mock_app,
                page=1,
                limit=10,
            )

            # Assert
            assert result == []

    def test_get_all_feedbacks_returns_feedback_dicts(self):
        """Test returns list of feedback dictionaries."""
        # Arrange
        mock_app = MagicMock()
        mock_app.id = str(uuid4())

        mock_feedback = MagicMock()
        mock_feedback.to_dict.return_value = {"id": str(uuid4()), "rating": "like"}

        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.offset.return_value = mock_query
        mock_query.all.return_value = [mock_feedback]

        with patch("services.message_service.db.session.query", return_value=mock_query):
            from services.message_service import MessageService

            # Act
            result = MessageService.get_all_messages_feedbacks(
                app_model=mock_app,
                page=1,
                limit=10,
            )

            # Assert
            assert len(result) == 1
            assert result[0]["rating"] == "like"

    def test_get_all_feedbacks_applies_pagination(self):
        """Test applies correct pagination offset."""
        # Arrange
        mock_app = MagicMock()
        mock_app.id = str(uuid4())

        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.offset.return_value = mock_query
        mock_query.all.return_value = []

        with patch("services.message_service.db.session.query", return_value=mock_query):
            from services.message_service import MessageService

            # Act
            MessageService.get_all_messages_feedbacks(
                app_model=mock_app,
                page=3,
                limit=10,
            )

            # Assert - page 3 with limit 10 should have offset 20
            mock_query.offset.assert_called_with(20)


class TestMessageServiceSuggestedQuestions:
    """Test suite for get_suggested_questions_after_answer method."""

    def test_suggested_questions_raises_error_when_user_is_none(self):
        """Test raises ValueError when user is None."""
        # Arrange
        mock_app = MagicMock()
        message_id = str(uuid4())

        from core.app.entities.app_invoke_entities import InvokeFrom
        from services.message_service import MessageService

        # Act & Assert
        with pytest.raises(ValueError, match="user cannot be None"):
            MessageService.get_suggested_questions_after_answer(
                app_model=mock_app,
                user=None,
                message_id=message_id,
                invoke_from=InvokeFrom.WEB_APP,
            )
