import inspect
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask

from controllers.web.error import NotCompletionAppError
from controllers.web.message import MessageMoreLikeThisApi
from core.app.entities.app_invoke_entities import InvokeFrom


@pytest.fixture
def flask_app():
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


class TestWebMessageMoreLikeThisApi:
    def test_post_uses_blocking_by_default(self, flask_app, monkeypatch):
        app_model = SimpleNamespace(mode="completion")
        end_user = SimpleNamespace()
        response_payload = {"answer": "ok"}

        generate_mock = MagicMock(return_value=object())
        compact_mock = MagicMock(return_value=response_payload)

        monkeypatch.setattr(
            "controllers.web.message.AppGenerateService.generate_more_like_this",
            generate_mock,
            raising=False,
        )
        monkeypatch.setattr(
            "controllers.web.message.helper.compact_generate_response",
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
            result = handler(controller, app_model, end_user, message_id)

        assert result == response_payload
        generate_mock.assert_called_once()
        call_kwargs = generate_mock.call_args.kwargs
        assert call_kwargs["streaming"] is False
        assert call_kwargs["invoke_from"] == InvokeFrom.WEB_APP
        assert call_kwargs["message_id"] == str(message_id)
        compact_mock.assert_called_once_with(generate_mock.return_value)

    def test_post_allows_streaming_mode(self, flask_app, monkeypatch):
        app_model = SimpleNamespace(mode="completion")
        end_user = SimpleNamespace()

        generate_mock = MagicMock(return_value=object())
        monkeypatch.setattr(
            "controllers.web.message.AppGenerateService.generate_more_like_this",
            generate_mock,
            raising=False,
        )
        monkeypatch.setattr(
            "controllers.web.message.helper.compact_generate_response",
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
            handler(controller, app_model, end_user, message_id)

        generate_mock.assert_called_once()
        assert generate_mock.call_args.kwargs["streaming"] is True

    def test_non_completion_app_raises(self, flask_app):
        app_model = SimpleNamespace(mode="chat")
        end_user = SimpleNamespace()
        handler = inspect.unwrap(MessageMoreLikeThisApi.post)
        controller = MessageMoreLikeThisApi()
        message_id = uuid.uuid4()

        with flask_app.test_request_context(
            f"/messages/{message_id}/more-like-this",
            method="POST",
            json={},
        ):
            with pytest.raises(NotCompletionAppError):
                handler(controller, app_model, end_user, message_id)
