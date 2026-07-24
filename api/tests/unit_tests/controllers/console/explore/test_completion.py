from unittest.mock import MagicMock, PropertyMock, patch

import pytest
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


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


@pytest.fixture
def user():
    return MagicMock(spec=Account)


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
    def test_post_success(self, app, completion_app, user, payload_patch):
        api = completion_module.CompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(completion_module, "current_user", user),
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
            result = method(completion_app)

        assert result == ("ok", 200)

    def test_post_wrong_app_mode(self):
        api = completion_module.CompletionApi()
        method = unwrap(api.post)

        installed_app = MagicMock(app=MagicMock(mode=AppMode.CHAT))

        with pytest.raises(NotCompletionAppError):
            method(installed_app)

    def test_conversation_completed(self, app, completion_app, user, payload_patch):
        api = completion_module.CompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(completion_module, "current_user", user),
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=completion_module.services.errors.conversation.ConversationCompletedError(),
            ),
        ):
            with pytest.raises(ConversationCompletedError):
                method(completion_app)

    def test_internal_error(self, app, completion_app, user, payload_patch):
        api = completion_module.CompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(completion_module, "current_user", user),
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=Exception("boom"),
            ),
        ):
            with pytest.raises(InternalServerError):
                method(completion_app)

    def test_conversation_not_exists(self, app, completion_app, user, payload_patch):
        api = completion_module.CompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(completion_module, "current_user", user),
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=completion_module.services.errors.conversation.ConversationNotExistsError(),
            ),
        ):
            with pytest.raises(completion_module.NotFound):
                method(completion_app)

    def test_app_unavailable(self, app, completion_app, user, payload_patch):
        api = completion_module.CompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(completion_module, "current_user", user),
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=completion_module.services.errors.app_model_config.AppModelConfigBrokenError(),
            ),
        ):
            with pytest.raises(completion_module.AppUnavailableError):
                method(completion_app)

    def test_provider_not_initialized(self, app, completion_app, user, payload_patch):
        api = completion_module.CompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(completion_module, "current_user", user),
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=completion_module.ProviderTokenNotInitError("not init"),
            ),
        ):
            with pytest.raises(completion_module.ProviderNotInitializeError):
                method(completion_app)

    def test_quota_exceeded(self, app, completion_app, user, payload_patch):
        api = completion_module.CompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(completion_module, "current_user", user),
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=completion_module.QuotaExceededError(),
            ),
        ):
            with pytest.raises(completion_module.ProviderQuotaExceededError):
                method(completion_app)

    def test_model_not_supported(self, app, completion_app, user, payload_patch):
        api = completion_module.CompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(completion_module, "current_user", user),
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=completion_module.ModelCurrentlyNotSupportError(),
            ),
        ):
            with pytest.raises(completion_module.ProviderModelCurrentlyNotSupportError):
                method(completion_app)

    def test_invoke_error(self, app, completion_app, user, payload_patch):
        api = completion_module.CompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(completion_module, "current_user", user),
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=completion_module.InvokeError("invoke failed"),
            ),
        ):
            with pytest.raises(completion_module.CompletionRequestError):
                method(completion_app)


class TestCompletionStopApi:
    def test_stop_success(self, completion_app, user):
        api = completion_module.CompletionStopApi()
        method = unwrap(api.post)

        user.id = "u1"

        with (
            patch.object(completion_module, "current_user", user),
            patch.object(completion_module.AppTaskService, "stop_task"),
        ):
            resp, status = method(completion_app, "task-1")

        assert status == 200
        assert resp == {"result": "success"}

    def test_stop_wrong_app_mode(self):
        api = completion_module.CompletionStopApi()
        method = unwrap(api.post)

        installed_app = MagicMock(app=MagicMock(mode=AppMode.CHAT))

        with pytest.raises(NotCompletionAppError):
            method(installed_app, "task")


class TestChatApi:
    def test_post_success(self, app, chat_app, user, payload_patch):
        api = completion_module.ChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(completion_module, "current_user", user),
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
            result = method(chat_app)

        assert result == ("ok", 200)

    def test_post_not_chat_app(self):
        api = completion_module.ChatApi()
        method = unwrap(api.post)

        installed_app = MagicMock(app=MagicMock(mode=AppMode.COMPLETION))

        with pytest.raises(NotChatAppError):
            method(installed_app)

    def test_rate_limit_error(self, app, chat_app, user, payload_patch):
        api = completion_module.ChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(completion_module, "current_user", user),
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=InvokeRateLimitError("limit"),
            ),
        ):
            with pytest.raises(InvokeRateLimitHttpError):
                method(chat_app)

    def test_conversation_completed_chat(self, app, chat_app, user, payload_patch):
        api = completion_module.ChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(completion_module, "current_user", user),
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=completion_module.services.errors.conversation.ConversationCompletedError(),
            ),
        ):
            with pytest.raises(ConversationCompletedError):
                method(chat_app)

    def test_conversation_not_exists_chat(self, app, chat_app, user, payload_patch):
        api = completion_module.ChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(completion_module, "current_user", user),
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=completion_module.services.errors.conversation.ConversationNotExistsError(),
            ),
        ):
            with pytest.raises(completion_module.NotFound):
                method(chat_app)

    def test_app_unavailable_chat(self, app, chat_app, user, payload_patch):
        api = completion_module.ChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(completion_module, "current_user", user),
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=completion_module.services.errors.app_model_config.AppModelConfigBrokenError(),
            ),
        ):
            with pytest.raises(completion_module.AppUnavailableError):
                method(chat_app)

    def test_provider_not_initialized_chat(self, app, chat_app, user, payload_patch):
        api = completion_module.ChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(completion_module, "current_user", user),
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=completion_module.ProviderTokenNotInitError("not init"),
            ),
        ):
            with pytest.raises(completion_module.ProviderNotInitializeError):
                method(chat_app)

    def test_quota_exceeded_chat(self, app, chat_app, user, payload_patch):
        api = completion_module.ChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(completion_module, "current_user", user),
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=completion_module.QuotaExceededError(),
            ),
        ):
            with pytest.raises(completion_module.ProviderQuotaExceededError):
                method(chat_app)

    def test_model_not_supported_chat(self, app, chat_app, user, payload_patch):
        api = completion_module.ChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(completion_module, "current_user", user),
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=completion_module.ModelCurrentlyNotSupportError(),
            ),
        ):
            with pytest.raises(completion_module.ProviderModelCurrentlyNotSupportError):
                method(chat_app)

    def test_invoke_error_chat(self, app, chat_app, user, payload_patch):
        api = completion_module.ChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(completion_module, "current_user", user),
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=completion_module.InvokeError("invoke failed"),
            ),
        ):
            with pytest.raises(completion_module.CompletionRequestError):
                method(chat_app)

    def test_internal_error_chat(self, app, chat_app, user, payload_patch):
        api = completion_module.ChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(completion_module, "current_user", user),
            patch.object(
                completion_module.AppGenerateService,
                "generate",
                side_effect=Exception("boom"),
            ),
        ):
            with pytest.raises(InternalServerError):
                method(chat_app)


class TestChatStopApi:
    def test_stop_success(self, chat_app, user):
        api = completion_module.ChatStopApi()
        method = unwrap(api.post)

        user.id = "u1"

        with (
            patch.object(completion_module, "current_user", user),
            patch.object(completion_module.AppTaskService, "stop_task"),
        ):
            resp, status = method(chat_app, "task-1")

        assert status == 200
        assert resp == {"result": "success"}

    def test_stop_not_chat_app(self):
        api = completion_module.ChatStopApi()
        method = unwrap(api.post)

        installed_app = MagicMock(app=MagicMock(mode=AppMode.COMPLETION))

        with pytest.raises(NotChatAppError):
            method(installed_app, "task")
