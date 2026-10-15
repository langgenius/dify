"""Unit tests for controllers.web.message feedback."""

from __future__ import annotations

import inspect
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask

from controllers.common.controller_schemas import MessageFeedbackPayload
from controllers.common.errors import NotFoundError
from controllers.web.message import MessageFeedbackApi
from models.model import App, AppMode, EndUser
from services.errors.message import MessageNotExistsError
from tests.unit_tests.model_factories import make_end_user


def _chat_app() -> App:
    return App(id="app-1", tenant_id="tenant-1", mode=AppMode.CHAT)


def _end_user() -> EndUser:
    return make_end_user(end_user_id="eu-1")


# The @model_validate decorator wraps the handler; tests call the undecorated
# function so they can pass a pydantic payload directly.
_feedback_post = inspect.unwrap(MessageFeedbackApi.post)


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
            with pytest.raises(NotFoundError, match="Message Not Exists"):
                _feedback_post(MessageFeedbackApi(), payload, _chat_app(), _end_user(), msg_id)
