"""Unit tests for controllers.web.message — feedback, more-like-this, suggested questions."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound

from controllers.web.error import (
    AppMoreLikeThisDisabledError,
    NotCompletionAppError,
)
from controllers.web.message import (
    MessageFeedbackApi,
    MessageMoreLikeThisApi,
    MessageSuggestedQuestionApi,
)
from services.errors.app import MoreLikeThisDisabledError
from services.errors.message import MessageNotExistsError


def _chat_app() -> SimpleNamespace:
    return SimpleNamespace(id="app-1", mode="chat")


def _completion_app() -> SimpleNamespace:
    return SimpleNamespace(id="app-1", mode="completion")


def _end_user() -> SimpleNamespace:
    return SimpleNamespace(id="eu-1")


# ---------------------------------------------------------------------------
# MessageFeedbackApi
# ---------------------------------------------------------------------------
class TestMessageFeedbackApi:
    @patch("controllers.web.message.MessageService.create_feedback")
    @patch("controllers.web.message.web_ns")
    def test_feedback_success(self, mock_ns: MagicMock, mock_create: MagicMock, app: Flask) -> None:
        mock_ns.payload = {"rating": "like", "content": "great"}
        msg_id = uuid4()

        with app.test_request_context(f"/messages/{msg_id}/feedbacks", method="POST"):
            result = MessageFeedbackApi().post(_chat_app(), _end_user(), msg_id)

        assert result == {"result": "success"}
        mock_create.assert_called_once()

    @patch("controllers.web.message.MessageService.create_feedback")
    @patch("controllers.web.message.web_ns")
    def test_feedback_null_rating(self, mock_ns: MagicMock, mock_create: MagicMock, app: Flask) -> None:
        mock_ns.payload = {"rating": None}
        msg_id = uuid4()

        with app.test_request_context(f"/messages/{msg_id}/feedbacks", method="POST"):
            result = MessageFeedbackApi().post(_chat_app(), _end_user(), msg_id)

        assert result == {"result": "success"}

    @patch(
        "controllers.web.message.MessageService.create_feedback",
        side_effect=MessageNotExistsError(),
    )
    @patch("controllers.web.message.web_ns")
    def test_feedback_message_not_found(self, mock_ns: MagicMock, mock_create: MagicMock, app: Flask) -> None:
        mock_ns.payload = {"rating": "dislike"}
        msg_id = uuid4()

        with app.test_request_context(f"/messages/{msg_id}/feedbacks", method="POST"):
            with pytest.raises(NotFound, match="Message Not Exists"):
                MessageFeedbackApi().post(_chat_app(), _end_user(), msg_id)


# ---------------------------------------------------------------------------
# MessageMoreLikeThisApi
# ---------------------------------------------------------------------------
class TestMessageMoreLikeThisApi:
    def test_wrong_mode_raises(self, app: Flask) -> None:
        msg_id = uuid4()
        with app.test_request_context(f"/messages/{msg_id}/more-like-this?response_mode=blocking"):
            with pytest.raises(NotCompletionAppError):
                MessageMoreLikeThisApi().get(_chat_app(), _end_user(), msg_id)

    @patch("controllers.web.message.helper.compact_generate_response", return_value={"answer": "similar"})
    @patch("controllers.web.message.AppGenerateService.generate_more_like_this")
    def test_happy_path(self, mock_gen: MagicMock, mock_compact: MagicMock, app: Flask) -> None:
        msg_id = uuid4()
        mock_gen.return_value = "response"

        with app.test_request_context(f"/messages/{msg_id}/more-like-this?response_mode=blocking"):
            result = MessageMoreLikeThisApi().get(_completion_app(), _end_user(), msg_id)

        assert result == {"answer": "similar"}

    @patch(
        "controllers.web.message.AppGenerateService.generate_more_like_this",
        side_effect=MessageNotExistsError(),
    )
    def test_message_not_found(self, mock_gen: MagicMock, app: Flask) -> None:
        msg_id = uuid4()
        with app.test_request_context(f"/messages/{msg_id}/more-like-this?response_mode=blocking"):
            with pytest.raises(NotFound, match="Message Not Exists"):
                MessageMoreLikeThisApi().get(_completion_app(), _end_user(), msg_id)

    @patch(
        "controllers.web.message.AppGenerateService.generate_more_like_this",
        side_effect=MoreLikeThisDisabledError(),
    )
    def test_feature_disabled(self, mock_gen: MagicMock, app: Flask) -> None:
        msg_id = uuid4()
        with app.test_request_context(f"/messages/{msg_id}/more-like-this?response_mode=blocking"):
            with pytest.raises(AppMoreLikeThisDisabledError):
                MessageMoreLikeThisApi().get(_completion_app(), _end_user(), msg_id)


# ---------------------------------------------------------------------------
# MessageSuggestedQuestionApi
# ---------------------------------------------------------------------------
class TestMessageSuggestedQuestionApi:
    def test_wrong_mode_raises(self, app: Flask) -> None:
        msg_id = uuid4()
        with app.test_request_context(f"/messages/{msg_id}/suggested-questions"):
            with pytest.raises(NotCompletionAppError):
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
