"""Unit tests for controllers.web.message — feedback, more-like-this, suggested questions."""

from __future__ import annotations

import inspect
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound

from controllers.common.controller_schemas import MessageFeedbackPayload
from controllers.web.error import (
    AppMoreLikeThisDisabledError,
    NotChatAppError,
    NotCompletionAppError,
)
from controllers.web.message import (
    MessageFeedbackApi,
    MessageMoreLikeThisApi,
    MessageMoreLikeThisQuery,
    MessageSuggestedQuestionApi,
)
from models.enums import EndUserType
from models.model import App, AppMode, EndUser
from services.errors.app import MoreLikeThisDisabledError
from services.errors.message import MessageNotExistsError


def _chat_app() -> App:
    return App(id="app-1", tenant_id="tenant-1", mode=AppMode.CHAT)


def _completion_app() -> App:
    return App(id="app-1", tenant_id="tenant-1", mode=AppMode.COMPLETION)


def _end_user() -> EndUser:
    return EndUser(
        id="eu-1",
        tenant_id="tenant-1",
        type=EndUserType.BROWSER,
        session_id="session-1",
    )


# The @model_validate and @with_session decorators wrap the handlers; tests
# call the undecorated function so they can pass a pydantic payload / a fake
# session directly.
_feedback_post = inspect.unwrap(MessageFeedbackApi.post)
_more_like_this_get = inspect.unwrap(MessageMoreLikeThisApi.get)


# ---------------------------------------------------------------------------
# MessageFeedbackApi
# ---------------------------------------------------------------------------
class TestMessageFeedbackApi:
    @patch("controllers.web.message.MessageService.create_feedback")
    def test_feedback_success(self, mock_create: MagicMock, app: Flask) -> None:
        payload = MessageFeedbackPayload.model_validate({"rating": "like", "content": "great"})
        msg_id = uuid4()

        with app.test_request_context(f"/messages/{msg_id}/feedbacks", method="POST"):
            result = _feedback_post(MessageFeedbackApi(), payload, _chat_app(), _end_user(), msg_id)

        assert result == {"result": "success"}
        mock_create.assert_called_once()

    @patch("controllers.web.message.MessageService.create_feedback")
    def test_feedback_null_rating(self, mock_create: MagicMock, app: Flask) -> None:
        payload = MessageFeedbackPayload.model_validate({"rating": None})
        msg_id = uuid4()

        with app.test_request_context(f"/messages/{msg_id}/feedbacks", method="POST"):
            result = _feedback_post(MessageFeedbackApi(), payload, _chat_app(), _end_user(), msg_id)

        assert result == {"result": "success"}

    @patch(
        "controllers.web.message.MessageService.create_feedback",
        side_effect=MessageNotExistsError(),
    )
    def test_feedback_message_not_found(self, mock_create: MagicMock, app: Flask) -> None:
        payload = MessageFeedbackPayload.model_validate({"rating": "dislike"})
        msg_id = uuid4()

        with app.test_request_context(f"/messages/{msg_id}/feedbacks", method="POST"):
            with pytest.raises(NotFound, match="Message Not Exists"):
                _feedback_post(MessageFeedbackApi(), payload, _chat_app(), _end_user(), msg_id)


# ---------------------------------------------------------------------------
# MessageMoreLikeThisApi
# ---------------------------------------------------------------------------
class TestMessageMoreLikeThisApi:
    def test_wrong_mode_raises(self, app: Flask) -> None:
        msg_id = uuid4()
        query = MessageMoreLikeThisQuery.model_validate({"response_mode": "blocking"})
        session = MagicMock()
        with app.test_request_context(f"/messages/{msg_id}/more-like-this?response_mode=blocking"):
            with pytest.raises(NotCompletionAppError):
                _more_like_this_get(MessageMoreLikeThisApi(), query, session, _chat_app(), _end_user(), msg_id)

    @patch("controllers.web.message.helper.compact_generate_response", return_value={"answer": "similar"})
    @patch("controllers.web.message.AppGenerateService.generate_more_like_this")
    def test_happy_path(self, mock_gen: MagicMock, mock_compact: MagicMock, app: Flask) -> None:
        msg_id = uuid4()
        mock_gen.return_value = "response"
        query = MessageMoreLikeThisQuery.model_validate({"response_mode": "blocking"})
        session = MagicMock()

        with app.test_request_context(f"/messages/{msg_id}/more-like-this?response_mode=blocking"):
            result = _more_like_this_get(
                MessageMoreLikeThisApi(), query, session, _completion_app(), _end_user(), msg_id
            )

        assert result == {"answer": "similar"}

    @patch(
        "controllers.web.message.AppGenerateService.generate_more_like_this",
        side_effect=MessageNotExistsError(),
    )
    def test_message_not_found(self, mock_gen: MagicMock, app: Flask) -> None:
        msg_id = uuid4()
        query = MessageMoreLikeThisQuery.model_validate({"response_mode": "blocking"})
        session = MagicMock()
        with app.test_request_context(f"/messages/{msg_id}/more-like-this?response_mode=blocking"):
            with pytest.raises(NotFound, match="Message Not Exists"):
                _more_like_this_get(MessageMoreLikeThisApi(), query, session, _completion_app(), _end_user(), msg_id)

    @patch(
        "controllers.web.message.AppGenerateService.generate_more_like_this",
        side_effect=MoreLikeThisDisabledError(),
    )
    def test_feature_disabled(self, mock_gen: MagicMock, app: Flask) -> None:
        msg_id = uuid4()
        query = MessageMoreLikeThisQuery.model_validate({"response_mode": "blocking"})
        session = MagicMock()
        with app.test_request_context(f"/messages/{msg_id}/more-like-this?response_mode=blocking"):
            with pytest.raises(AppMoreLikeThisDisabledError):
                _more_like_this_get(MessageMoreLikeThisApi(), query, session, _completion_app(), _end_user(), msg_id)


# ---------------------------------------------------------------------------
# MessageSuggestedQuestionApi
# ---------------------------------------------------------------------------
class TestMessageSuggestedQuestionApi:
    def test_wrong_mode_raises(self, app: Flask) -> None:
        msg_id = uuid4()
        with app.test_request_context(f"/messages/{msg_id}/suggested-questions"):
            with pytest.raises(NotChatAppError):
                MessageSuggestedQuestionApi().get(_completion_app(), _end_user(), msg_id)

    @patch("controllers.web.message.MessageService.get_suggested_questions_after_answer")
    def test_happy_path(self, mock_suggest: MagicMock, app: Flask) -> None:
        msg_id = uuid4()
        mock_suggest.return_value = ["What about X?", "Tell me more about Y."]

        with app.test_request_context(f"/messages/{msg_id}/suggested-questions"):
            result = MessageSuggestedQuestionApi().get(_chat_app(), _end_user(), msg_id)

        assert result["data"] == ["What about X?", "Tell me more about Y."]

    @patch(
        "controllers.web.message.MessageService.get_suggested_questions_after_answer",
        side_effect=MessageNotExistsError(),
    )
    def test_message_not_found(self, mock_suggest: MagicMock, app: Flask) -> None:
        msg_id = uuid4()
        with app.test_request_context(f"/messages/{msg_id}/suggested-questions"):
            with pytest.raises(NotFound, match="Message not found"):
                MessageSuggestedQuestionApi().get(_chat_app(), _end_user(), msg_id)
