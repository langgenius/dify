"""Unit tests for controllers.web.message — feedback, more-like-this, suggested questions."""

from __future__ import annotations

import inspect
from dataclasses import dataclass, field
from typing import Literal
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask

from controllers.common.controller_schemas import MessageFeedbackPayload
from controllers.common.errors import NotFoundError
from controllers.web import message as message_module
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
from models.enums import FeedbackRating
from models.model import App, AppMode, EndUser
from services.entities.message_entities import MessageActor
from services.errors.app import MoreLikeThisDisabledError
from services.errors.message import MessageNotExistsError
from services.message_more_like_this_service import MoreLikeThisResponse
from tests.helpers.unit.model_factories import make_end_user


@dataclass
class _MessageFeedbacksFake:
    error: Exception | None = None
    calls: list[str] = field(default_factory=list)

    def set_feedback(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        actor: MessageActor,
        message_id: str,
        rating: FeedbackRating | None,
        content: str | None,
    ) -> None:
        self.calls.append(message_id)
        if self.error is not None:
            raise self.error


@dataclass
class _MessageMoreLikeThisFake:
    response: MoreLikeThisResponse = field(default_factory=lambda: {"answer": "similar"})
    error: Exception | None = None
    calls: list[str] = field(default_factory=list)

    def generate(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        actor: MessageActor,
        message_id: str,
        streaming: bool,
    ) -> MoreLikeThisResponse:
        self.calls.append(message_id)
        if self.error is not None:
            raise self.error
        return self.response


@dataclass
class _MessageSuggestedQuestionsFake:
    response: list[str] = field(default_factory=list)
    error: Exception | None = None
    calls: list[str] = field(default_factory=list)

    def get_suggested_questions(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        expected_app_mode: str,
        actor: MessageActor,
        invoke_from: Literal["explore", "debugger", "web-app", "service-api"],
        message_id: str,
    ) -> list[str]:
        self.calls.append(message_id)
        if self.error is not None:
            raise self.error
        return self.response


@dataclass(frozen=True, slots=True)
class _ApplicationServicesStub:
    message_feedbacks: _MessageFeedbacksFake
    message_more_like_this: _MessageMoreLikeThisFake
    message_suggested_questions: _MessageSuggestedQuestionsFake


@pytest.fixture(autouse=True)
def message_services(monkeypatch: pytest.MonkeyPatch) -> _ApplicationServicesStub:
    services = _ApplicationServicesStub(
        message_feedbacks=_MessageFeedbacksFake(),
        message_more_like_this=_MessageMoreLikeThisFake(),
        message_suggested_questions=_MessageSuggestedQuestionsFake(),
    )
    monkeypatch.setattr(message_module, "application_services", lambda: services)
    return services


def _chat_app() -> App:
    return App(id="app-1", tenant_id="tenant-1", mode=AppMode.CHAT)


def _completion_app() -> App:
    return App(id="app-1", tenant_id="tenant-1", mode=AppMode.COMPLETION)


def _end_user() -> EndUser:
    return make_end_user(end_user_id="eu-1")


# The @model_validate and @with_session decorators wrap the handlers; tests
# call the undecorated function so they can pass a pydantic payload / a fake
# session directly.
_feedback_post = inspect.unwrap(MessageFeedbackApi.post)
_more_like_this_get = inspect.unwrap(MessageMoreLikeThisApi.get)


# ---------------------------------------------------------------------------
# MessageFeedbackApi
# ---------------------------------------------------------------------------
class TestMessageFeedbackApi:
    def test_feedback_success(self, message_services: _ApplicationServicesStub, app: Flask) -> None:
        payload = MessageFeedbackPayload.model_validate({"rating": "like", "content": "great"})
        msg_id = uuid4()

        with app.test_request_context(f"/messages/{msg_id}/feedbacks", method="POST"):
            result = _feedback_post(MessageFeedbackApi(), payload, _chat_app(), _end_user(), msg_id)

        assert result == {"result": "success"}
        assert message_services.message_feedbacks.calls == [str(msg_id)]

    def test_feedback_null_rating(self, app: Flask) -> None:
        payload = MessageFeedbackPayload.model_validate({"rating": None})
        msg_id = uuid4()

        with app.test_request_context(f"/messages/{msg_id}/feedbacks", method="POST"):
            result = _feedback_post(MessageFeedbackApi(), payload, _chat_app(), _end_user(), msg_id)

        assert result == {"result": "success"}

    def test_feedback_message_not_found(self, message_services: _ApplicationServicesStub, app: Flask) -> None:
        payload = MessageFeedbackPayload.model_validate({"rating": "dislike"})
        msg_id = uuid4()
        message_services.message_feedbacks.error = MessageNotExistsError()

        with app.test_request_context(f"/messages/{msg_id}/feedbacks", method="POST"):
            with pytest.raises(NotFoundError, match="Message Not Exists"):
                _feedback_post(MessageFeedbackApi(), payload, _chat_app(), _end_user(), msg_id)


# ---------------------------------------------------------------------------
# MessageMoreLikeThisApi
# ---------------------------------------------------------------------------
class TestMessageMoreLikeThisApi:
    def test_wrong_mode_raises(self, app: Flask) -> None:
        msg_id = uuid4()
        query = MessageMoreLikeThisQuery.model_validate({"response_mode": "blocking"})
        with app.test_request_context(f"/messages/{msg_id}/more-like-this?response_mode=blocking"):
            with pytest.raises(NotCompletionAppError):
                _more_like_this_get(MessageMoreLikeThisApi(), query, _chat_app(), _end_user(), msg_id)

    @patch("controllers.web.message.helper.compact_generate_response", return_value={"answer": "similar"})
    def test_happy_path(
        self,
        mock_compact: MagicMock,
        message_services: _ApplicationServicesStub,
        app: Flask,
    ) -> None:
        msg_id = uuid4()
        query = MessageMoreLikeThisQuery.model_validate({"response_mode": "blocking"})

        with app.test_request_context(f"/messages/{msg_id}/more-like-this?response_mode=blocking"):
            result = _more_like_this_get(MessageMoreLikeThisApi(), query, _completion_app(), _end_user(), msg_id)

        assert result == {"answer": "similar"}
        assert message_services.message_more_like_this.calls == [str(msg_id)]

    def test_message_not_found(self, message_services: _ApplicationServicesStub, app: Flask) -> None:
        msg_id = uuid4()
        query = MessageMoreLikeThisQuery.model_validate({"response_mode": "blocking"})
        message_services.message_more_like_this.error = MessageNotExistsError()
        with app.test_request_context(f"/messages/{msg_id}/more-like-this?response_mode=blocking"):
            with pytest.raises(NotFoundError, match="Message Not Exists"):
                _more_like_this_get(MessageMoreLikeThisApi(), query, _completion_app(), _end_user(), msg_id)

    def test_feature_disabled(self, message_services: _ApplicationServicesStub, app: Flask) -> None:
        msg_id = uuid4()
        query = MessageMoreLikeThisQuery.model_validate({"response_mode": "blocking"})
        message_services.message_more_like_this.error = MoreLikeThisDisabledError()
        with app.test_request_context(f"/messages/{msg_id}/more-like-this?response_mode=blocking"):
            with pytest.raises(AppMoreLikeThisDisabledError):
                _more_like_this_get(MessageMoreLikeThisApi(), query, _completion_app(), _end_user(), msg_id)


# ---------------------------------------------------------------------------
# MessageSuggestedQuestionApi
# ---------------------------------------------------------------------------
class TestMessageSuggestedQuestionApi:
    def test_wrong_mode_raises(self, app: Flask) -> None:
        msg_id = uuid4()
        with app.test_request_context(f"/messages/{msg_id}/suggested-questions"):
            with pytest.raises(NotChatAppError):
                MessageSuggestedQuestionApi().get(_completion_app(), _end_user(), msg_id)

    def test_happy_path(self, message_services: _ApplicationServicesStub, app: Flask) -> None:
        msg_id = uuid4()
        message_services.message_suggested_questions.response = ["What about X?", "Tell me more about Y."]

        with app.test_request_context(f"/messages/{msg_id}/suggested-questions"):
            result = MessageSuggestedQuestionApi().get(_chat_app(), _end_user(), msg_id)

        assert result["data"] == ["What about X?", "Tell me more about Y."]

    def test_message_not_found(self, message_services: _ApplicationServicesStub, app: Flask) -> None:
        msg_id = uuid4()
        message_services.message_suggested_questions.error = MessageNotExistsError()
        with app.test_request_context(f"/messages/{msg_id}/suggested-questions"):
            with pytest.raises(NotFoundError, match="Message not found"):
                MessageSuggestedQuestionApi().get(_chat_app(), _end_user(), msg_id)
