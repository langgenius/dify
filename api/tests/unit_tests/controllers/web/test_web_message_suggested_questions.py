import inspect
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask

from controllers.web.error import NotCompletionAppError
from controllers.web.message import MessageSuggestedQuestionApi
from core.app.entities.app_invoke_entities import InvokeFrom
from models.model import AppMode


@pytest.fixture
def flask_app():
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


class TestWebMessageSuggestedQuestionApi:
    def test_post_returns_questions(self, flask_app, monkeypatch):
        app_model = SimpleNamespace(mode=AppMode.CHAT.value)
        end_user = SimpleNamespace()
        questions = ["Q1", "Q2"]

        service_mock = MagicMock(return_value=questions)
        monkeypatch.setattr(
            "controllers.web.message.MessageService.get_suggested_questions_after_answer",
            service_mock,
            raising=False,
        )

        handler = inspect.unwrap(MessageSuggestedQuestionApi.post)
        controller = MessageSuggestedQuestionApi()
        message_id = uuid.uuid4()

        with flask_app.test_request_context(
            f"/messages/{message_id}/suggested-questions",
            method="POST",
            json={},
        ):
            result = handler(controller, app_model, end_user, message_id)

        assert result == {"data": questions}
        service_mock.assert_called_once_with(
            app_model=app_model,
            user=end_user,
            message_id=str(message_id),
            invoke_from=InvokeFrom.WEB_APP,
        )

    def test_non_chat_app_raises(self, flask_app):
        app_model = SimpleNamespace(mode=AppMode.COMPLETION.value)
        end_user = SimpleNamespace()
        handler = inspect.unwrap(MessageSuggestedQuestionApi.post)
        controller = MessageSuggestedQuestionApi()
        message_id = uuid.uuid4()

        with flask_app.test_request_context(
            f"/messages/{message_id}/suggested-questions",
            method="POST",
            json={},
        ):
            with pytest.raises(NotCompletionAppError):
                handler(controller, app_model, end_user, message_id)
