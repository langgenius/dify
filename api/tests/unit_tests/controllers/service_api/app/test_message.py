"""Request model and error-type validation for Service API message endpoints."""

import uuid

import pytest

from controllers.service_api.app.error import NotChatAppError
from controllers.service_api.app.message import (
    FeedbackListQuery,
    MessageFeedbackPayload,
    MessageListQuery,
)
from models.model import AppMode
from services.errors.message import (
    FirstMessageNotExistsError,
    MessageNotExistsError,
    SuggestedQuestionsAfterAnswerDisabledError,
)


class TestMessageListQuery:
    """Test suite for MessageListQuery Pydantic model."""

    def test_query_requires_conversation_id(self):
        """Test conversation_id is required."""
        conversation_id = str(uuid.uuid4())
        query = MessageListQuery(conversation_id=conversation_id)
        assert query.conversation_id == conversation_id

    def test_query_with_defaults(self):
        """Test query with default values."""
        conversation_id = str(uuid.uuid4())
        query = MessageListQuery(conversation_id=conversation_id)
        assert query.first_id is None
        assert query.limit == 20

    def test_query_with_first_id(self):
        """Test query with first_id for pagination."""
        conversation_id = str(uuid.uuid4())
        first_id = str(uuid.uuid4())
        query = MessageListQuery(conversation_id=conversation_id, first_id=first_id)
        assert str(query.first_id) == first_id

    def test_query_with_custom_limit(self):
        """Test query with custom limit."""
        conversation_id = str(uuid.uuid4())
        query = MessageListQuery(conversation_id=conversation_id, limit=50)
        assert query.limit == 50

    def test_query_limit_boundaries(self):
        """Test query respects limit boundaries."""
        conversation_id = str(uuid.uuid4())

        query_min = MessageListQuery(conversation_id=conversation_id, limit=1)
        assert query_min.limit == 1

        query_max = MessageListQuery(conversation_id=conversation_id, limit=100)
        assert query_max.limit == 100

    def test_query_rejects_limit_below_minimum(self):
        """Test query rejects limit < 1."""
        conversation_id = str(uuid.uuid4())
        with pytest.raises(ValueError):
            MessageListQuery(conversation_id=conversation_id, limit=0)  # pyrefly: ignore[bad-argument-type]

    def test_query_rejects_limit_above_maximum(self):
        """Test query rejects limit > 100."""
        conversation_id = str(uuid.uuid4())
        with pytest.raises(ValueError):
            MessageListQuery(conversation_id=conversation_id, limit=101)  # pyrefly: ignore[bad-argument-type]


class TestMessageFeedbackPayload:
    """Test suite for MessageFeedbackPayload Pydantic model."""

    def test_payload_with_defaults(self):
        """Test payload with default values."""
        payload = MessageFeedbackPayload()
        assert payload.rating is None
        assert payload.content is None

    def test_payload_with_like_rating(self):
        """Test payload with like rating."""
        payload = MessageFeedbackPayload(rating="like")
        assert payload.rating == "like"

    def test_payload_with_dislike_rating(self):
        """Test payload with dislike rating."""
        payload = MessageFeedbackPayload(rating="dislike")
        assert payload.rating == "dislike"

    def test_payload_with_content_only(self):
        """Test payload with content but no rating."""
        payload = MessageFeedbackPayload(content="This response was helpful")
        assert payload.content == "This response was helpful"
        assert payload.rating is None

    def test_payload_with_rating_and_content(self):
        """Test payload with both rating and content."""
        payload = MessageFeedbackPayload(rating="like", content="Great answer, very detailed!")
        assert payload.rating == "like"
        assert payload.content == "Great answer, very detailed!"

    def test_payload_with_long_content(self):
        """Test payload with long feedback content."""
        long_content = "A" * 1000
        payload = MessageFeedbackPayload(content=long_content)
        assert payload.content is not None
        assert len(payload.content) == 1000

    def test_payload_with_unicode_content(self):
        """Test payload with unicode characters."""
        unicode_content = "很好的回答 👍 Отличный ответ"
        payload = MessageFeedbackPayload(content=unicode_content)
        assert payload.content == unicode_content


class TestFeedbackListQuery:
    """Test suite for FeedbackListQuery Pydantic model."""

    def test_query_with_defaults(self):
        """Test query with default values."""
        query = FeedbackListQuery()
        assert query.page == 1
        assert query.limit == 20

    def test_query_with_custom_pagination(self):
        """Test query with custom page and limit."""
        query = FeedbackListQuery(page=3, limit=50)
        assert query.page == 3
        assert query.limit == 50

    def test_query_page_minimum(self):
        """Test query page minimum validation."""
        query = FeedbackListQuery(page=1)
        assert query.page == 1

    def test_query_rejects_page_below_minimum(self):
        """Test query rejects page < 1."""
        with pytest.raises(ValueError):
            FeedbackListQuery(page=0)  # pyrefly: ignore[bad-argument-type]

    def test_query_limit_boundaries(self):
        """Test query limit boundaries."""
        query_min = FeedbackListQuery(limit=1)
        assert query_min.limit == 1

        query_max = FeedbackListQuery(limit=101)
        assert query_max.limit == 101  # Max is 101

    def test_query_rejects_limit_below_minimum(self):
        """Test query rejects limit < 1."""
        with pytest.raises(ValueError):
            FeedbackListQuery(limit=0)  # pyrefly: ignore[bad-argument-type]

    def test_query_rejects_limit_above_maximum(self):
        """Test query rejects limit > 101."""
        with pytest.raises(ValueError):
            FeedbackListQuery(limit=102)  # pyrefly: ignore[bad-argument-type]


class TestMessageAppModeValidation:
    """Test app mode validation for message endpoints."""

    def test_chat_modes_are_valid_for_message_endpoints(self):
        """Test that all chat modes are valid."""
        valid_modes = {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT}
        for mode in valid_modes:
            assert mode in valid_modes

    def test_completion_mode_is_invalid_for_message_endpoints(self):
        """Test that COMPLETION mode is invalid."""
        chat_modes = {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT}
        assert AppMode.COMPLETION not in chat_modes

    def test_workflow_mode_is_invalid_for_message_endpoints(self):
        """Test that WORKFLOW mode is invalid."""
        chat_modes = {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT}
        assert AppMode.WORKFLOW not in chat_modes

    def test_not_chat_app_error_can_be_raised(self):
        """Test NotChatAppError can be raised."""
        error = NotChatAppError()
        assert error is not None


class TestMessageErrorTypes:
    """Test message-related error types."""

    def test_message_not_exists_error_can_be_raised(self):
        """Test MessageNotExistsError can be raised."""
        error = MessageNotExistsError()
        assert isinstance(error, MessageNotExistsError)

    def test_first_message_not_exists_error_can_be_raised(self):
        """Test FirstMessageNotExistsError can be raised."""
        error = FirstMessageNotExistsError()
        assert isinstance(error, FirstMessageNotExistsError)

    def test_suggested_questions_after_answer_disabled_error_can_be_raised(self):
        """Test SuggestedQuestionsAfterAnswerDisabledError can be raised."""
        error = SuggestedQuestionsAfterAnswerDisabledError()
        assert isinstance(error, SuggestedQuestionsAfterAnswerDisabledError)
