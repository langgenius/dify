import uuid
from inspect import unwrap
from unittest.mock import MagicMock, PropertyMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import InternalServerError

import controllers.console.explore.completion as completion_module
from controllers.console.app.error import (
    ConversationCompletedError,
)
from controllers.console.explore.error import NotChatAppError, NotCompletionAppError
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from models import Account
from models.model import AppMode
from services.errors.llm import InvokeRateLimitError


@pytest.fixture
def user():
    account = Account(name="User", email="user.com")
    account.id = "uid"
    return account


@pytest.fixture
def completion_app():
    return MagicMock(app=MagicMock(mode=AppMode.COMPLETION))


@pytest.fixture
def chat_app():
    return MagicMock(app=MagicMock(mode=AppMode.CHAT))


@pytest.fixture
def payload_data():
    return {"inputs": {}, "query": "hi"}


@pytest.fixture
def payload_patch(payload_data):
    return patch.object(
        type(completion_module.console_ns),
        "payload",
        new_callable=PropertyMock,
        return_value=payload_data,
    )


class TestCompletionApi:
    def test_post_success(self, app: Flask, completion_app, user, payload_patch):
        api = completion_module.CompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                return_value={"ok": True},
            ),
            patch.object(
                completion_module.helper,
                "compact_generate_response",
                return_value=("ok", 200),
            ),
        ):
            result = method(api, MagicMock(), user, completion_app)

        assert result == ("ok", 200)

    def test_post_wrong_app_mode(self, user):
        api = completion_module.CompletionApi()
        method = unwrap(api.post)

        installed_app = MagicMock(app=MagicMock(mode=AppMode.CHAT))

        with pytest.raises(NotCompletionAppError):
            method(api, MagicMock(), user, installed_app)

    def test_conversation_completed(self, app: Flask, completion_app, user, payload_patch):
        api = completion_module.CompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=completion_module.services.errors.conversation.ConversationCompletedError(),
            ),
        ):
            with pytest.raises(ConversationCompletedError):
                method(api, MagicMock(), user, completion_app)

    def test_internal_error(self, app: Flask, completion_app, user, payload_patch):
        api = completion_module.CompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=Exception("boom"),
            ),
        ):
            with pytest.raises(InternalServerError):
                method(api, MagicMock(), user, completion_app)

    def test_conversation_not_exists(self, app: Flask, completion_app, user, payload_patch):
        api = completion_module.CompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=completion_module.services.errors.conversation.ConversationNotExistsError(),
            ),
        ):
            with pytest.raises(completion_module.NotFound):
                method(api, MagicMock(), user, completion_app)

    def test_app_unavailable(self, app: Flask, completion_app, user, payload_patch):
        api = completion_module.CompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=completion_module.services.errors.app_model_config.AppModelConfigBrokenError(),
            ),
        ):
            with pytest.raises(completion_module.AppUnavailableError):
                method(api, MagicMock(), user, completion_app)

    def test_provider_not_initialized(self, app: Flask, completion_app, user, payload_patch):
        api = completion_module.CompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=completion_module.ProviderTokenNotInitError("not init"),
            ),
        ):
            with pytest.raises(completion_module.ProviderNotInitializeError):
                method(api, MagicMock(), user, completion_app)

    def test_quota_exceeded(self, app: Flask, completion_app, user, payload_patch):
        api = completion_module.CompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=completion_module.QuotaExceededError(),
            ),
        ):
            with pytest.raises(completion_module.ProviderQuotaExceededError):
                method(api, MagicMock(), user, completion_app)

    def test_model_not_supported(self, app: Flask, completion_app, user, payload_patch):
        api = completion_module.CompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=completion_module.ModelCurrentlyNotSupportError(),
            ),
        ):
            with pytest.raises(completion_module.ProviderModelCurrentlyNotSupportError):
                method(api, MagicMock(), user, completion_app)

    def test_invoke_error(self, app: Flask, completion_app, user, payload_patch):
        api = completion_module.CompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=completion_module.InvokeError("invoke failed"),
            ),
        ):
            with pytest.raises(completion_module.CompletionRequestError):
                method(api, MagicMock(), user, completion_app)


class TestCompletionStopApi:
    def test_stop_success(self, completion_app):
        api = completion_module.CompletionStopApi()
        method = unwrap(api.post)

        with patch.object(completion_module.AppTaskService, "stop_task"):
            resp, status = method(api, "u1", completion_app, "task-1")

        assert status == 200
        assert resp == {"result": "success"}

    def test_stop_wrong_app_mode(self):
        api = completion_module.CompletionStopApi()
        method = unwrap(api.post)

        installed_app = MagicMock(app=MagicMock(mode=AppMode.CHAT))

        with pytest.raises(NotCompletionAppError):
            method(api, "u1", installed_app, "task")


class TestChatApi:
    def test_post_success(self, app: Flask, chat_app, user, payload_patch):
        api = completion_module.ChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                return_value={"ok": True},
            ),
            patch.object(
                completion_module.helper,
                "compact_generate_response",
                return_value=("ok", 200),
            ),
        ):
            result = method(api, MagicMock(), user, chat_app)

        assert result == ("ok", 200)

    def test_post_not_chat_app(self, user):
        api = completion_module.ChatApi()
        method = unwrap(api.post)

        installed_app = MagicMock(app=MagicMock(mode=AppMode.COMPLETION))

        with pytest.raises(NotChatAppError):
            method(api, MagicMock(), user, installed_app)

    def test_rate_limit_error(self, app: Flask, chat_app, user, payload_patch):
        api = completion_module.ChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=InvokeRateLimitError("limit"),
            ),
        ):
            with pytest.raises(InvokeRateLimitHttpError):
                method(api, MagicMock(), user, chat_app)

    def test_conversation_completed_chat(self, app: Flask, chat_app, user, payload_patch):
        api = completion_module.ChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=completion_module.services.errors.conversation.ConversationCompletedError(),
            ),
        ):
            with pytest.raises(ConversationCompletedError):
                method(api, MagicMock(), user, chat_app)

    def test_conversation_not_exists_chat(self, app: Flask, chat_app, user, payload_patch):
        api = completion_module.ChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=completion_module.services.errors.conversation.ConversationNotExistsError(),
            ),
        ):
            with pytest.raises(completion_module.NotFound):
                method(api, MagicMock(), user, chat_app)

    def test_invalid_conversation_id_fails_fast_as_not_found(self, app: Flask, chat_app, user) -> None:
        # A nonexistent conversation_id must fail fast as 404, before the streaming
        # generator is created. Previously the lookup only ran inside the generator,
        # so an invalid id surfaced as a hang instead of a clean error.
        payload_patch = patch.object(
            type(completion_module.console_ns),
            "payload",
            new_callable=PropertyMock,
            return_value={"inputs": {}, "query": "hi", "conversation_id": str(uuid.uuid4())},
        )
        generate_mock = MagicMock(return_value={"ok": True})

        api = completion_module.ChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(
                completion_module.ConversationService,
                "get_conversation",
                side_effect=completion_module.services.errors.conversation.ConversationNotExistsError(),
            ),
            patch.object(completion_module.AppGenerateService, "generate", generate_mock),
        ):
            with pytest.raises(completion_module.NotFound):
                method(api, MagicMock(), user, chat_app)

        # The lookup must run before generation, so the generator is never started.
        generate_mock.assert_not_called()

    def test_app_unavailable_chat(self, app: Flask, chat_app, user, payload_patch):
        api = completion_module.ChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=completion_module.services.errors.app_model_config.AppModelConfigBrokenError(),
            ),
        ):
            with pytest.raises(completion_module.AppUnavailableError):
                method(api, MagicMock(), user, chat_app)

    def test_provider_not_initialized_chat(self, app: Flask, chat_app, user, payload_patch):
        api = completion_module.ChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=completion_module.ProviderTokenNotInitError("not init"),
            ),
        ):
            with pytest.raises(completion_module.ProviderNotInitializeError):
                method(api, MagicMock(), user, chat_app)

    def test_quota_exceeded_chat(self, app: Flask, chat_app, user, payload_patch):
        api = completion_module.ChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=completion_module.QuotaExceededError(),
            ),
        ):
            with pytest.raises(completion_module.ProviderQuotaExceededError):
                method(api, MagicMock(), user, chat_app)

    def test_model_not_supported_chat(self, app: Flask, chat_app, user, payload_patch):
        api = completion_module.ChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=completion_module.ModelCurrentlyNotSupportError(),
            ),
        ):
            with pytest.raises(completion_module.ProviderModelCurrentlyNotSupportError):
                method(api, MagicMock(), user, chat_app)

    def test_invoke_error_chat(self, app: Flask, chat_app, user, payload_patch):
        api = completion_module.ChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=completion_module.InvokeError("invoke failed"),
            ),
        ):
            with pytest.raises(completion_module.CompletionRequestError):
                method(api, MagicMock(), user, chat_app)

    def test_internal_error_chat(self, app: Flask, chat_app, user, payload_patch):
        api = completion_module.ChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=Exception("boom"),
            ),
        ):
            with pytest.raises(InternalServerError):
                method(api, MagicMock(), user, chat_app)


class TestChatStopApi:
    def test_stop_success(self, chat_app):
        api = completion_module.ChatStopApi()
        method = unwrap(api.post)
        with patch.object(completion_module.AppTaskService, "stop_task"):
            resp, status = method(api, "u1", chat_app, "task-1")

        assert status == 200
        assert resp == {"result": "success"}

    def test_stop_not_chat_app(self):
        api = completion_module.ChatStopApi()
        method = unwrap(api.post)

        installed_app = MagicMock(app=MagicMock(mode=AppMode.COMPLETION))

        with pytest.raises(NotChatAppError):
            method(api, "u1", installed_app, "task")
