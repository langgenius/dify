import uuid
from inspect import unwrap
from unittest.mock import MagicMock, PropertyMock, patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session, object_session
from werkzeug.exceptions import InternalServerError

import controllers.console.explore.completion as completion_module
from controllers.console.app.error import (
    ConversationCompletedError,
)
from controllers.console.explore.error import NotChatAppError, NotCompletionAppError
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from models import Account
from models.model import App, AppMode, InstalledApp
from services.errors.llm import InvokeRateLimitError


@pytest.fixture
def user():
    account = Account(name="User", email="user.com")
    account.id = "uid"
    return account


@pytest.fixture(autouse=True)
def bind_database(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(completion_module.db, "session", sqlite_session)


@pytest.fixture
def completion_app(sqlite_session: Session) -> InstalledApp:
    return _installed_app(AppMode.COMPLETION, sqlite_session)


@pytest.fixture
def chat_app(sqlite_session: Session) -> InstalledApp:
    return _installed_app(AppMode.CHAT, sqlite_session)


def _installed_app(mode: AppMode, session: Session) -> InstalledApp:
    app = App(
        tenant_id="owner-tenant",
        name=f"{mode.value} App",
        mode=mode,
        enable_site=True,
        enable_api=False,
    )
    session.add(app)
    session.flush()
    installed_app = InstalledApp(
        tenant_id="viewer-tenant",
        app_id=app.id,
        app_owner_tenant_id=app.tenant_id,
        position=0,
        is_pinned=False,
        last_used_at=None,
    )
    session.add(installed_app)
    session.commit()
    return installed_app


def _session(installed_app: InstalledApp) -> Session:
    session = object_session(installed_app)
    assert session is not None
    return session


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
    def test_post_success(self, app: Flask, completion_app, user, payload_patch, payload_data):
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
            result = method(
                api,
                completion_module.CompletionMessageExplorePayload.model_validate(payload_data),
                _session(completion_app),
                user,
                completion_app,
            )

        assert result == ("ok", 200)

    def test_post_wrong_app_mode(self, user, sqlite_session: Session):
        api = completion_module.CompletionApi()
        method = unwrap(api.post)

        installed_app = _installed_app(AppMode.CHAT, sqlite_session)

        with pytest.raises(NotCompletionAppError):
            method(
                api,
                completion_module.CompletionMessageExplorePayload.model_validate({"inputs": {}, "query": "hi"}),
                sqlite_session,
                user,
                installed_app,
            )

    def test_conversation_completed(self, app: Flask, completion_app, user, payload_patch, payload_data):
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
                method(
                    api,
                    completion_module.CompletionMessageExplorePayload.model_validate(payload_data),
                    _session(completion_app),
                    user,
                    completion_app,
                )

    def test_internal_error(self, app: Flask, completion_app, user, payload_patch, payload_data):
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
                method(
                    api,
                    completion_module.CompletionMessageExplorePayload.model_validate(payload_data),
                    _session(completion_app),
                    user,
                    completion_app,
                )

    def test_conversation_not_exists(self, app: Flask, completion_app, user, payload_patch, payload_data):
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
                method(
                    api,
                    completion_module.CompletionMessageExplorePayload.model_validate(payload_data),
                    _session(completion_app),
                    user,
                    completion_app,
                )

    def test_app_unavailable(self, app: Flask, completion_app, user, payload_patch, payload_data):
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
                method(
                    api,
                    completion_module.CompletionMessageExplorePayload.model_validate(payload_data),
                    _session(completion_app),
                    user,
                    completion_app,
                )

    def test_provider_not_initialized(self, app: Flask, completion_app, user, payload_patch, payload_data):
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
                method(
                    api,
                    completion_module.CompletionMessageExplorePayload.model_validate(payload_data),
                    _session(completion_app),
                    user,
                    completion_app,
                )

    def test_quota_exceeded(self, app: Flask, completion_app, user, payload_patch, payload_data):
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
                method(
                    api,
                    completion_module.CompletionMessageExplorePayload.model_validate(payload_data),
                    _session(completion_app),
                    user,
                    completion_app,
                )

    def test_model_not_supported(self, app: Flask, completion_app, user, payload_patch, payload_data):
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
                method(
                    api,
                    completion_module.CompletionMessageExplorePayload.model_validate(payload_data),
                    _session(completion_app),
                    user,
                    completion_app,
                )

    def test_invoke_error(self, app: Flask, completion_app, user, payload_patch, payload_data):
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
                method(
                    api,
                    completion_module.CompletionMessageExplorePayload.model_validate(payload_data),
                    _session(completion_app),
                    user,
                    completion_app,
                )


class TestCompletionStopApi:
    def test_stop_success(self, completion_app):
        api = completion_module.CompletionStopApi()
        method = unwrap(api.post)

        with patch.object(completion_module.AppTaskService, "stop_task"):
            resp, status = method(api, _session(completion_app), "u1", completion_app, "task-1")

        assert status == 200
        assert resp == {"result": "success"}

    def test_stop_wrong_app_mode(self, sqlite_session: Session):
        api = completion_module.CompletionStopApi()
        method = unwrap(api.post)

        installed_app = _installed_app(AppMode.CHAT, sqlite_session)

        with pytest.raises(NotCompletionAppError):
            method(api, sqlite_session, "u1", installed_app, "task")


class TestChatApi:
    def test_post_success(self, app: Flask, chat_app, user, payload_patch, payload_data):
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
            result = method(
                api,
                completion_module.ChatMessagePayload.model_validate(payload_data),
                _session(chat_app),
                user,
                chat_app,
            )

        assert result == ("ok", 200)

    def test_post_not_chat_app(self, user, sqlite_session: Session):
        api = completion_module.ChatApi()
        method = unwrap(api.post)

        installed_app = _installed_app(AppMode.COMPLETION, sqlite_session)

        with pytest.raises(NotChatAppError):
            method(
                api,
                completion_module.ChatMessagePayload.model_validate({"inputs": {}, "query": "hi"}),
                sqlite_session,
                user,
                installed_app,
            )

    def test_rate_limit_error(self, app: Flask, chat_app, user, payload_patch, payload_data):
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
                method(
                    api,
                    completion_module.ChatMessagePayload.model_validate(payload_data),
                    _session(chat_app),
                    user,
                    chat_app,
                )

    def test_conversation_completed_chat(self, app: Flask, chat_app, user, payload_patch, payload_data):
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
                method(
                    api,
                    completion_module.ChatMessagePayload.model_validate(payload_data),
                    _session(chat_app),
                    user,
                    chat_app,
                )

    def test_conversation_not_exists_chat(self, app: Flask, chat_app, user, payload_patch, payload_data):
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
                method(
                    api,
                    completion_module.ChatMessagePayload.model_validate(payload_data),
                    _session(chat_app),
                    user,
                    chat_app,
                )

    def test_invalid_conversation_id_fails_fast_as_not_found(self, app: Flask, chat_app, user) -> None:
        # A nonexistent conversation_id must fail fast as 404, before the streaming
        # generator is created. Previously the lookup only ran inside the generator,
        # so an invalid id surfaced as a hang instead of a clean error.
        conversation_id = str(uuid.uuid4())
        payload_patch = patch.object(
            type(completion_module.console_ns),
            "payload",
            new_callable=PropertyMock,
            return_value={"inputs": {}, "query": "hi", "conversation_id": conversation_id},
        )
        generate_mock = MagicMock(return_value={"ok": True})
        get_conversation_mock = MagicMock(
            side_effect=completion_module.services.errors.conversation.ConversationNotExistsError()
        )
        session = _session(chat_app)

        api = completion_module.ChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
            payload_patch,
            patch.object(
                completion_module.ConversationService,
                "get_conversation",
                get_conversation_mock,
            ),
            patch.object(completion_module.AppGenerateService, "generate", generate_mock),
        ):
            with pytest.raises(completion_module.NotFound):
                method(
                    api,
                    completion_module.ChatMessagePayload.model_validate(
                        {"inputs": {}, "query": "hi", "conversation_id": conversation_id}
                    ),
                    session,
                    user,
                    chat_app,
                )

        # The lookup must run before generation, so the generator is never started.
        generate_mock.assert_not_called()
        assert get_conversation_mock.call_args.kwargs["session"] is session

    def test_app_unavailable_chat(self, app: Flask, chat_app, user, payload_patch, payload_data):
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
                method(
                    api,
                    completion_module.ChatMessagePayload.model_validate(payload_data),
                    _session(chat_app),
                    user,
                    chat_app,
                )

    def test_provider_not_initialized_chat(self, app: Flask, chat_app, user, payload_patch, payload_data):
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
                method(
                    api,
                    completion_module.ChatMessagePayload.model_validate(payload_data),
                    _session(chat_app),
                    user,
                    chat_app,
                )

    def test_quota_exceeded_chat(self, app: Flask, chat_app, user, payload_patch, payload_data):
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
                method(
                    api,
                    completion_module.ChatMessagePayload.model_validate(payload_data),
                    _session(chat_app),
                    user,
                    chat_app,
                )

    def test_model_not_supported_chat(self, app: Flask, chat_app, user, payload_patch, payload_data):
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
                method(
                    api,
                    completion_module.ChatMessagePayload.model_validate(payload_data),
                    _session(chat_app),
                    user,
                    chat_app,
                )

    def test_invoke_error_chat(self, app: Flask, chat_app, user, payload_patch, payload_data):
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
                method(
                    api,
                    completion_module.ChatMessagePayload.model_validate(payload_data),
                    _session(chat_app),
                    user,
                    chat_app,
                )

    def test_internal_error_chat(self, app: Flask, chat_app, user, payload_patch, payload_data):
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
                method(
                    api,
                    completion_module.ChatMessagePayload.model_validate(payload_data),
                    _session(chat_app),
                    user,
                    chat_app,
                )


class TestChatStopApi:
    def test_stop_success(self, chat_app):
        api = completion_module.ChatStopApi()
        method = unwrap(api.post)
        with patch.object(completion_module.AppTaskService, "stop_task"):
            resp, status = method(api, _session(chat_app), "u1", chat_app, "task-1")

        assert status == 200
        assert resp == {"result": "success"}

    def test_stop_not_chat_app(self, sqlite_session: Session):
        api = completion_module.ChatStopApi()
        method = unwrap(api.post)

        installed_app = _installed_app(AppMode.COMPLETION, sqlite_session)

        with pytest.raises(NotChatAppError):
            method(api, sqlite_session, "u1", installed_app, "task")
