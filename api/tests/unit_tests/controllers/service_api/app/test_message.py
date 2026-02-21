"""
Unit tests for Service API Message controllers.

Tests coverage for:
- MessageListQuery, MessageFeedbackPayload, FeedbackListQuery Pydantic models
- App mode validation for message endpoints
- MessageService integration
- Error handling for message operations

Focus on:
- Pydantic model validation
- UUID normalization
- Error type mappings
- Service method interfaces
"""

import uuid
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from werkzeug.exceptions import BadRequest, InternalServerError, NotFound

from controllers.service_api.app.error import NotChatAppError
from controllers.service_api.app.message import (
    AppGetFeedbacksApi,
    FeedbackListQuery,
    MessageFeedbackApi,
    MessageFeedbackPayload,
    MessageListApi,
    MessageListQuery,
    MessageSuggestedApi,
)
from models.model import App, AppMode, EndUser
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import (
    FirstMessageNotExistsError,
    MessageNotExistsError,
    SuggestedQuestionsAfterAnswerDisabledError,
)
from services.message_service import MessageService


def _unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


class TestMessageListQuery:
    """Test suite for MessageListQuery Pydantic model."""

    def test_query_requires_conversation_id(self):
        """Test conversation_id is required."""
        conversation_id = str(uuid.uuid4())
        query = MessageListQuery(conversation_id=conversation_id)
        assert str(query.conversation_id) == conversation_id

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
            MessageListQuery(conversation_id=conversation_id, limit=0)

    def test_query_rejects_limit_above_maximum(self):
        """Test query rejects limit > 100."""
        conversation_id = str(uuid.uuid4())
        with pytest.raises(ValueError):
            MessageListQuery(conversation_id=conversation_id, limit=101)


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
            FeedbackListQuery(page=0)

    def test_query_limit_boundaries(self):
        """Test query limit boundaries."""
        query_min = FeedbackListQuery(limit=1)
        assert query_min.limit == 1

        query_max = FeedbackListQuery(limit=101)
        assert query_max.limit == 101  # Max is 101

    def test_query_rejects_limit_below_minimum(self):
        """Test query rejects limit < 1."""
        with pytest.raises(ValueError):
            FeedbackListQuery(limit=0)

    def test_query_rejects_limit_above_maximum(self):
        """Test query rejects limit > 101."""
        with pytest.raises(ValueError):
            FeedbackListQuery(limit=102)


class TestMessageAppModeValidation:
    """Test app mode validation for message endpoints."""

    def test_chat_modes_are_valid_for_message_endpoints(self):
        """Test that all chat modes are valid."""
        valid_modes = {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}
        for mode in valid_modes:
            assert mode in valid_modes

    def test_completion_mode_is_invalid_for_message_endpoints(self):
        """Test that COMPLETION mode is invalid."""
        chat_modes = {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}
        assert AppMode.COMPLETION not in chat_modes

    def test_workflow_mode_is_invalid_for_message_endpoints(self):
        """Test that WORKFLOW mode is invalid."""
        chat_modes = {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}
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


class TestMessageService:
    """Test MessageService interface and methods."""

    def test_pagination_by_first_id_method_exists(self):
        """Test MessageService.pagination_by_first_id exists."""
        assert hasattr(MessageService, "pagination_by_first_id")
        assert callable(MessageService.pagination_by_first_id)

    def test_create_feedback_method_exists(self):
        """Test MessageService.create_feedback exists."""
        assert hasattr(MessageService, "create_feedback")
        assert callable(MessageService.create_feedback)

    def test_get_all_messages_feedbacks_method_exists(self):
        """Test MessageService.get_all_messages_feedbacks exists."""
        assert hasattr(MessageService, "get_all_messages_feedbacks")
        assert callable(MessageService.get_all_messages_feedbacks)

    def test_get_suggested_questions_after_answer_method_exists(self):
        """Test MessageService.get_suggested_questions_after_answer exists."""
        assert hasattr(MessageService, "get_suggested_questions_after_answer")
        assert callable(MessageService.get_suggested_questions_after_answer)

    @patch.object(MessageService, "pagination_by_first_id")
    def test_pagination_by_first_id_returns_pagination_result(self, mock_pagination):
        """Test pagination_by_first_id returns expected format."""
        mock_result = Mock()
        mock_result.data = []
        mock_result.limit = 20
        mock_result.has_more = False
        mock_pagination.return_value = mock_result

        result = MessageService.pagination_by_first_id(
            app_model=Mock(spec=App),
            user=Mock(spec=EndUser),
            conversation_id=str(uuid.uuid4()),
            first_id=None,
            limit=20,
        )

        assert hasattr(result, "data")
        assert hasattr(result, "limit")
        assert hasattr(result, "has_more")

    @patch.object(MessageService, "pagination_by_first_id")
    def test_pagination_raises_conversation_not_exists_error(self, mock_pagination):
        """Test pagination raises ConversationNotExistsError."""
        import services.errors.conversation

        mock_pagination.side_effect = services.errors.conversation.ConversationNotExistsError()

        with pytest.raises(services.errors.conversation.ConversationNotExistsError):
            MessageService.pagination_by_first_id(
                app_model=Mock(spec=App), user=Mock(spec=EndUser), conversation_id="invalid_id", first_id=None, limit=20
            )

    @patch.object(MessageService, "pagination_by_first_id")
    def test_pagination_raises_first_message_not_exists_error(self, mock_pagination):
        """Test pagination raises FirstMessageNotExistsError."""
        mock_pagination.side_effect = FirstMessageNotExistsError()

        with pytest.raises(FirstMessageNotExistsError):
            MessageService.pagination_by_first_id(
                app_model=Mock(spec=App),
                user=Mock(spec=EndUser),
                conversation_id=str(uuid.uuid4()),
                first_id="invalid_first_id",
                limit=20,
            )

    @patch.object(MessageService, "create_feedback")
    def test_create_feedback_with_rating_and_content(self, mock_create_feedback):
        """Test create_feedback with rating and content."""
        mock_create_feedback.return_value = None

        MessageService.create_feedback(
            app_model=Mock(spec=App),
            message_id=str(uuid.uuid4()),
            user=Mock(spec=EndUser),
            rating="like",
            content="Great response!",
        )

        mock_create_feedback.assert_called_once()

    @patch.object(MessageService, "create_feedback")
    def test_create_feedback_raises_message_not_exists_error(self, mock_create_feedback):
        """Test create_feedback raises MessageNotExistsError."""
        mock_create_feedback.side_effect = MessageNotExistsError()

        with pytest.raises(MessageNotExistsError):
            MessageService.create_feedback(
                app_model=Mock(spec=App),
                message_id="invalid_message_id",
                user=Mock(spec=EndUser),
                rating="like",
                content=None,
            )

    @patch.object(MessageService, "get_all_messages_feedbacks")
    def test_get_all_messages_feedbacks_returns_list(self, mock_get_feedbacks):
        """Test get_all_messages_feedbacks returns list of feedbacks."""
        mock_feedbacks = [
            {"message_id": str(uuid.uuid4()), "rating": "like"},
            {"message_id": str(uuid.uuid4()), "rating": "dislike"},
        ]
        mock_get_feedbacks.return_value = mock_feedbacks

        result = MessageService.get_all_messages_feedbacks(app_model=Mock(spec=App), page=1, limit=20)

        assert len(result) == 2
        assert result[0]["rating"] == "like"

    @patch.object(MessageService, "get_suggested_questions_after_answer")
    def test_get_suggested_questions_returns_questions_list(self, mock_get_questions):
        """Test get_suggested_questions_after_answer returns list of questions."""
        mock_questions = ["What about this aspect?", "Can you elaborate on that?", "How does this relate to...?"]
        mock_get_questions.return_value = mock_questions

        result = MessageService.get_suggested_questions_after_answer(
            app_model=Mock(spec=App), user=Mock(spec=EndUser), message_id=str(uuid.uuid4()), invoke_from=Mock()
        )

        assert len(result) == 3
        assert isinstance(result[0], str)

    @patch.object(MessageService, "get_suggested_questions_after_answer")
    def test_get_suggested_questions_raises_disabled_error(self, mock_get_questions):
        """Test get_suggested_questions_after_answer raises SuggestedQuestionsAfterAnswerDisabledError."""
        mock_get_questions.side_effect = SuggestedQuestionsAfterAnswerDisabledError()

        with pytest.raises(SuggestedQuestionsAfterAnswerDisabledError):
            MessageService.get_suggested_questions_after_answer(
                app_model=Mock(spec=App), user=Mock(spec=EndUser), message_id=str(uuid.uuid4()), invoke_from=Mock()
            )

    @patch.object(MessageService, "get_suggested_questions_after_answer")
    def test_get_suggested_questions_raises_message_not_exists_error(self, mock_get_questions):
        """Test get_suggested_questions_after_answer raises MessageNotExistsError."""
        mock_get_questions.side_effect = MessageNotExistsError()

        with pytest.raises(MessageNotExistsError):
            MessageService.get_suggested_questions_after_answer(
                app_model=Mock(spec=App), user=Mock(spec=EndUser), message_id="invalid_message_id", invoke_from=Mock()
            )


class TestMessageListApi:
    def test_not_chat_app(self, app) -> None:
        api = MessageListApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace(mode=AppMode.COMPLETION.value)
        end_user = SimpleNamespace()

        with app.test_request_context("/messages?conversation_id=cid", method="GET"):
            with pytest.raises(NotChatAppError):
                handler(api, app_model=app_model, end_user=end_user)

    def test_conversation_not_found(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            MessageService,
            "pagination_by_first_id",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(ConversationNotExistsError()),
        )

        api = MessageListApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace(mode=AppMode.CHAT.value)
        end_user = SimpleNamespace()

        with app.test_request_context(
            "/messages?conversation_id=00000000-0000-0000-0000-000000000001",
            method="GET",
        ):
            with pytest.raises(NotFound):
                handler(api, app_model=app_model, end_user=end_user)

    def test_first_message_not_found(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            MessageService,
            "pagination_by_first_id",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(FirstMessageNotExistsError()),
        )

        api = MessageListApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace(mode=AppMode.CHAT.value)
        end_user = SimpleNamespace()

        with app.test_request_context(
            "/messages?conversation_id=00000000-0000-0000-0000-000000000001&first_id=00000000-0000-0000-0000-000000000002",
            method="GET",
        ):
            with pytest.raises(NotFound):
                handler(api, app_model=app_model, end_user=end_user)


class TestMessageFeedbackApi:
    def test_not_found(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            MessageService,
            "create_feedback",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(MessageNotExistsError()),
        )

        api = MessageFeedbackApi()
        handler = _unwrap(api.post)
        app_model = SimpleNamespace()
        end_user = SimpleNamespace()

        with app.test_request_context(
            "/messages/m1/feedbacks",
            method="POST",
            json={"rating": "like", "content": "ok"},
        ):
            with pytest.raises(NotFound):
                handler(api, app_model=app_model, end_user=end_user, message_id="m1")


class TestAppGetFeedbacksApi:
    def test_success(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(MessageService, "get_all_messages_feedbacks", lambda *_args, **_kwargs: ["f1"])

        api = AppGetFeedbacksApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace()

        with app.test_request_context("/app/feedbacks?page=1&limit=20", method="GET"):
            response = handler(api, app_model=app_model)

        assert response == {"data": ["f1"]}


class TestMessageSuggestedApi:
    def test_not_chat(self, app) -> None:
        api = MessageSuggestedApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace(mode=AppMode.COMPLETION.value)
        end_user = SimpleNamespace()

        with app.test_request_context("/messages/m1/suggested", method="GET"):
            with pytest.raises(NotChatAppError):
                handler(api, app_model=app_model, end_user=end_user, message_id="m1")

    def test_not_found(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            MessageService,
            "get_suggested_questions_after_answer",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(MessageNotExistsError()),
        )

        api = MessageSuggestedApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace(mode=AppMode.CHAT.value)
        end_user = SimpleNamespace()

        with app.test_request_context("/messages/m1/suggested", method="GET"):
            with pytest.raises(NotFound):
                handler(api, app_model=app_model, end_user=end_user, message_id="m1")

    def test_disabled(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            MessageService,
            "get_suggested_questions_after_answer",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(SuggestedQuestionsAfterAnswerDisabledError()),
        )

        api = MessageSuggestedApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace(mode=AppMode.CHAT.value)
        end_user = SimpleNamespace()

        with app.test_request_context("/messages/m1/suggested", method="GET"):
            with pytest.raises(BadRequest):
                handler(api, app_model=app_model, end_user=end_user, message_id="m1")

    def test_internal_error(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            MessageService,
            "get_suggested_questions_after_answer",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("boom")),
        )

        api = MessageSuggestedApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace(mode=AppMode.CHAT.value)
        end_user = SimpleNamespace()

        with app.test_request_context("/messages/m1/suggested", method="GET"):
            with pytest.raises(InternalServerError):
                handler(api, app_model=app_model, end_user=end_user, message_id="m1")

    def test_success(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            MessageService,
            "get_suggested_questions_after_answer",
            lambda *_args, **_kwargs: ["q1"],
        )

        api = MessageSuggestedApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace(mode=AppMode.CHAT.value)
        end_user = SimpleNamespace()

        with app.test_request_context("/messages/m1/suggested", method="GET"):
            response = handler(api, app_model=app_model, end_user=end_user, message_id="m1")

        assert response == {"result": "success", "data": ["q1"]}
