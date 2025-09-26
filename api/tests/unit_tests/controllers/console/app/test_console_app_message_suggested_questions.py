import inspect
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask

from controllers.console.app import message as console_message_module
from controllers.console.app.message import MessageSuggestedQuestionApi
from core.app.entities.app_invoke_entities import InvokeFrom
from models.account import Account


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


class TestConsoleAppMessageSuggestedQuestionApi:
    def test_post_forwards_to_service(self, flask_app, account_user, monkeypatch):
        app_model = SimpleNamespace(id="app-id", mode="chat")
        questions = ["a", "b"]
        service_mock = MagicMock(return_value=questions)

        monkeypatch.setattr(console_message_module, "current_user", account_user, raising=False)
        monkeypatch.setattr(
            console_message_module.MessageService,
            "get_suggested_questions_after_answer",
            service_mock,
            raising=False,
        )

        handler = inspect.unwrap(MessageSuggestedQuestionApi.post)
        controller = MessageSuggestedQuestionApi()
        message_id = uuid.uuid4()

        with flask_app.test_request_context(
            f"/apps/{app_model.id}/chat-messages/{message_id}/suggested-questions",
            method="POST",
            json={},
        ):
            result = handler(controller, app_model, message_id)

        assert result == {"data": questions}
        service_mock.assert_called_once_with(
            app_model=app_model,
            message_id=str(message_id),
            user=account_user,
            invoke_from=InvokeFrom.DEBUGGER,
        )
