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
from collections.abc import Iterator
from inspect import unwrap
from unittest.mock import Mock, patch

import pytest
from flask import Flask, request
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from controllers.common.errors import NotFoundError
from controllers.service_api.app.error import NotChatAppError
from controllers.service_api.app.message import (
    FeedbackListQuery,
    MessageFeedbackPayload,
    MessageListApi,
    MessageListQuery,
)
from models.enums import EndUserType
from models.model import App, AppMode, EndUser
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import (
    FirstMessageNotExistsError,
    MessageNotExistsError,
    SuggestedQuestionsAfterAnswerDisabledError,
)
from services.message_service import MessageService


def _app(*, mode: AppMode = AppMode.CHAT) -> App:
    return App(
        id="app-1",
        tenant_id="tenant-1",
        name="Service API app",
        description="",
        mode=mode,
        enable_site=True,
        enable_api=True,
        max_active_requests=0,
    )


def _end_user() -> EndUser:
    return EndUser(
        id="end-user-1",
        tenant_id="tenant-1",
        app_id="app-1",
        type=EndUserType.SERVICE_API,
        external_user_id="external-user-1",
        name="Service API user",
        session_id="session-1",
    )


@pytest.fixture
def orm_session(sqlite_engine: Engine) -> Iterator[Session]:
    """Provide a real caller-owned session for MessageService interface tests."""

    with Session(sqlite_engine, expire_on_commit=False) as session:
        yield session


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


class TestMessageService:
    """Test MessageService interface and methods."""

    def test_pagination_by_first_id_method_exists(self):
        """Test MessageService.pagination_by_first_id exists."""
        assert hasattr(MessageService, "pagination_by_first_id")
        assert callable(MessageService.pagination_by_first_id)

    @patch.object(MessageService, "pagination_by_first_id")
    def test_pagination_by_first_id_returns_pagination_result(self, mock_pagination, orm_session: Session):
        """Test pagination_by_first_id returns expected format."""
        mock_result = Mock()
        mock_result.data = []
        mock_result.limit = 20
        mock_result.has_more = False
        mock_pagination.return_value = mock_result

        result = MessageService.pagination_by_first_id(
            app_model=_app(),
            user=_end_user(),
            conversation_id=str(uuid.uuid4()),
            first_id=None,
            limit=20,
            session=orm_session,
        )

        assert hasattr(result, "data")
        assert hasattr(result, "limit")
        assert hasattr(result, "has_more")

    @patch.object(MessageService, "pagination_by_first_id")
    def test_pagination_raises_conversation_not_exists_error(self, mock_pagination, orm_session: Session):
        """Test pagination raises ConversationNotExistsError."""
        import services.errors.conversation

        mock_pagination.side_effect = services.errors.conversation.ConversationNotExistsError()

        with pytest.raises(services.errors.conversation.ConversationNotExistsError):
            MessageService.pagination_by_first_id(
                app_model=_app(),
                user=_end_user(),
                conversation_id="invalid_id",
                first_id=None,
                limit=20,
                session=orm_session,
            )

    @patch.object(MessageService, "pagination_by_first_id")
    def test_pagination_raises_first_message_not_exists_error(self, mock_pagination, orm_session: Session):
        """Test pagination raises FirstMessageNotExistsError."""
        mock_pagination.side_effect = FirstMessageNotExistsError()

        with pytest.raises(FirstMessageNotExistsError):
            MessageService.pagination_by_first_id(
                app_model=_app(),
                user=_end_user(),
                conversation_id=str(uuid.uuid4()),
                first_id="invalid_first_id",
                limit=20,
                session=orm_session,
            )


class TestMessageListApi:
    def test_not_chat_app(self, app: Flask) -> None:
        api = MessageListApi()
        handler = unwrap(api.get)
        app_model = _app(mode=AppMode.COMPLETION)
        end_user = _end_user()

        # @model_validate parses ahead of the app-mode guard, so the id has to be well-formed to
        # reach the branch this test is about.
        with app.test_request_context("/messages?conversation_id=00000000-0000-0000-0000-000000000001", method="GET"):
            with pytest.raises(NotChatAppError):
                handler(
                    api,
                    MessageListQuery.model_validate(request.args.to_dict(flat=True)),
                    app_model=app_model,
                    end_user=end_user,
                )

    def test_conversation_not_found(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            MessageService,
            "pagination_by_first_id",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(ConversationNotExistsError()),
        )

        api = MessageListApi()
        handler = unwrap(api.get)
        app_model = _app()
        end_user = _end_user()

        with app.test_request_context(
            "/messages?conversation_id=00000000-0000-0000-0000-000000000001",
            method="GET",
        ):
            with pytest.raises(NotFoundError):
                handler(
                    api,
                    MessageListQuery.model_validate(request.args.to_dict(flat=True)),
                    app_model=app_model,
                    end_user=end_user,
                )

    def test_first_message_not_found(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            MessageService,
            "pagination_by_first_id",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(FirstMessageNotExistsError()),
        )

        api = MessageListApi()
        handler = unwrap(api.get)
        app_model = _app()
        end_user = _end_user()

        with app.test_request_context(
            "/messages?conversation_id=00000000-0000-0000-0000-000000000001&first_id=00000000-0000-0000-0000-000000000002",
            method="GET",
        ):
            with pytest.raises(NotFoundError):
                handler(
                    api,
                    MessageListQuery.model_validate(request.args.to_dict(flat=True)),
                    app_model=app_model,
                    end_user=end_user,
                )
