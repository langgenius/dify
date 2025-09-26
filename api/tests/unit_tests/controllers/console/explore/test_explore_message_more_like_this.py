import inspect
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask

from controllers.console.explore.error import NotCompletionAppError
from controllers.console.explore.message import MessageMoreLikeThisApi
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


class TestConsoleExploreMessageMoreLikeThisApi:
    def test_post_generates_with_blocking_default(self, flask_app, account_user, monkeypatch):
        installed_app = SimpleNamespace(app=SimpleNamespace(mode="completion"))
        response_payload = {"answer": "ok"}
        generate_mock = MagicMock(return_value=object())
        compact_mock = MagicMock(return_value=response_payload)

        monkeypatch.setattr(
            "controllers.console.explore.message.current_user",
            account_user,
            raising=False,
        )
        monkeypatch.setattr(
            "controllers.console.explore.message.AppGenerateService.generate_more_like_this",
            generate_mock,
            raising=False,
        )
        monkeypatch.setattr(
            "controllers.console.explore.message.helper.compact_generate_response",
            compact_mock,
            raising=False,
        )

        handler = inspect.unwrap(MessageMoreLikeThisApi.post)
        controller = MessageMoreLikeThisApi()
        message_id = uuid.uuid4()

        with flask_app.test_request_context(
            f"/messages/{message_id}/more-like-this",
            method="POST",
            json={},
        ):
            result = handler(controller, installed_app, message_id)

        assert result == response_payload
        generate_mock.assert_called_once()
        call_kwargs = generate_mock.call_args.kwargs
        assert call_kwargs["streaming"] is False
        assert call_kwargs["invoke_from"] == InvokeFrom.EXPLORE
        assert call_kwargs["message_id"] == str(message_id)
        compact_mock.assert_called_once_with(generate_mock.return_value)

    def test_post_allows_streaming_mode(self, flask_app, account_user, monkeypatch):
        installed_app = SimpleNamespace(app=SimpleNamespace(mode="completion"))
        generate_mock = MagicMock(return_value=object())

        monkeypatch.setattr(
            "controllers.console.explore.message.current_user",
            account_user,
            raising=False,
        )
        monkeypatch.setattr(
            "controllers.console.explore.message.AppGenerateService.generate_more_like_this",
            generate_mock,
            raising=False,
        )
        monkeypatch.setattr(
            "controllers.console.explore.message.helper.compact_generate_response",
            MagicMock(return_value={}),
            raising=False,
        )

        handler = inspect.unwrap(MessageMoreLikeThisApi.post)
        controller = MessageMoreLikeThisApi()
        message_id = uuid.uuid4()

        with flask_app.test_request_context(
            f"/messages/{message_id}/more-like-this",
            method="POST",
            json={"response_mode": "streaming"},
        ):
            handler(controller, installed_app, message_id)

        generate_mock.assert_called_once()
        assert generate_mock.call_args.kwargs["streaming"] is True

    def test_non_completion_app_raises(self, flask_app, account_user, monkeypatch):
        installed_app = SimpleNamespace(app=SimpleNamespace(mode="chat"))

        monkeypatch.setattr(
            "controllers.console.explore.message.current_user",
            account_user,
            raising=False,
        )

        handler = inspect.unwrap(MessageMoreLikeThisApi.post)
        controller = MessageMoreLikeThisApi()
        message_id = uuid.uuid4()

        with flask_app.test_request_context(
            f"/messages/{message_id}/more-like-this",
            method="POST",
            json={},
        ):
            with pytest.raises(NotCompletionAppError):
                handler(controller, installed_app, message_id)
