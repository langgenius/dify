import inspect
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask

from controllers.console.explore.error import NotChatAppError
from controllers.console.explore.message import MessageSuggestedQuestionApi
from core.app.entities.app_invoke_entities import InvokeFrom
from models.account import Account
from models.model import AppMode


@pytest.fixture
def flask_app():
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


@pytest.fixture
def account_user():
    user = Account(name="Tester", email="tester@example.com")
    user.id = "user-id"
    return user


class TestConsoleExploreMessageSuggestedQuestionApi:
    def test_post_returns_questions(self, flask_app, account_user, monkeypatch):
        installed_app = SimpleNamespace(app=SimpleNamespace(mode=AppMode.CHAT.value))
        questions = ["q1"]
        service_mock = MagicMock(return_value=questions)

        monkeypatch.setattr(
            "controllers.console.explore.message.current_user",
            account_user,
            raising=False,
        )
        monkeypatch.setattr(
            "controllers.console.explore.message.MessageService.get_suggested_questions_after_answer",
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
            result = handler(controller, installed_app, message_id)

        assert result == {"data": questions}
        service_mock.assert_called_once_with(
            app_model=installed_app.app,
            user=account_user,
            message_id=str(message_id),
            invoke_from=InvokeFrom.EXPLORE,
        )

    def test_non_chat_app_raises(self, flask_app, account_user, monkeypatch):
        installed_app = SimpleNamespace(app=SimpleNamespace(mode=AppMode.COMPLETION.value))
        monkeypatch.setattr(
            "controllers.console.explore.message.current_user",
            account_user,
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
            with pytest.raises(NotChatAppError):
                handler(controller, installed_app, message_id)
