from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session, scoped_session, sessionmaker
from werkzeug.exceptions import InternalServerError, NotFound

import controllers.console.explore.message as module
from controllers.console.app.error import (
    AppMoreLikeThisDisabledError,
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.explore.error import (
    AppSuggestedQuestionsAfterAnswerDisabledError,
    NotChatAppError,
    NotCompletionAppError,
)
from core.errors.error import (
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from graphon.model_runtime.errors.invoke import InvokeError
from models import Account
from models.enums import ConversationFromSource
from models.model import App, AppMode, InstalledApp, Message
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import (
    FirstMessageNotExistsError,
    MessageNotExistsError,
    SuggestedQuestionsAfterAnswerDisabledError,
)


def unwrap(func):
    bound_self = getattr(func, "__self__", None)
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    if bound_self is not None:
        return func.__get__(bound_self, bound_self.__class__)
    return func


def make_message(*, app_id: str):
    message = Message(
        id="m1",
        app_id=app_id,
        conversation_id="11111111-1111-1111-1111-111111111111",
        query="hello",
        message={"role": "user", "content": "hello"},
        answer="",
        message_tokens=0,
        message_unit_price=Decimal(0),
        answer_tokens=0,
        answer_unit_price=Decimal(0),
        provider_response_latency=0,
        currency="USD",
        from_source=ConversationFromSource.API,
        app_mode=AppMode.CHAT,
    )
    message._inputs = {}
    message.status = "normal"
    return message


def make_installed_app(session: Session, mode: str | None = None) -> InstalledApp:
    app_model = App(
        tenant_id="owner-tenant",
        name="Explore App",
        mode=mode or AppMode.CHAT,
        enable_site=True,
        enable_api=False,
    )
    session.add(app_model)
    session.flush()
    installed_app = InstalledApp(
        tenant_id="viewer-tenant",
        app_id=app_model.id,
        app_owner_tenant_id=app_model.tenant_id,
        position=0,
        is_pinned=False,
        last_used_at=None,
    )
    session.add(installed_app)
    session.commit()
    return installed_app


class _UsesSQLiteSession:
    sqlite_session: Session
    account: Account

    @pytest.fixture(autouse=True)
    def _bind_database(
        self,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
    ):
        self.sqlite_session = sqlite_session
        self.account = Account(name="User", email="user@example.com")
        self.account.id = "account-1"
        session_proxy = scoped_session(sqlite_session_factory)
        monkeypatch.setattr(module.db, "session", session_proxy)
        yield
        session_proxy.remove()


class TestMessageListApi(_UsesSQLiteSession):
    def test_get_success(self, app: Flask):
        api = module.MessageListApi()
        method = unwrap(api.get)

        installed_app = make_installed_app(self.sqlite_session, mode="chat")

        pagination = MagicMock(
            limit=20,
            has_more=False,
            data=[make_message(app_id=installed_app.app_id), make_message(app_id=installed_app.app_id)],
        )

        with (
            app.test_request_context(
                "/",
                query_string={"conversation_id": "11111111-1111-1111-1111-111111111111"},
            ),
            patch.object(
                module.MessageService,
                "pagination_by_first_id",
                return_value=pagination,
            ),
        ):
            result = method(self.account, installed_app)

        assert result["limit"] == 20
        assert result["has_more"] is False
        assert len(result["data"]) == 2

    def test_get_not_chat_app(self):
        api = module.MessageListApi()
        method = unwrap(api.get)

        installed_app = make_installed_app(self.sqlite_session, mode="completion")

        with pytest.raises(NotChatAppError):
            method(self.account, installed_app)

    def test_conversation_not_exists(self, app: Flask):
        api = module.MessageListApi()
        method = unwrap(api.get)

        installed_app = make_installed_app(self.sqlite_session, mode="chat")

        with (
            app.test_request_context(
                "/",
                query_string={"conversation_id": "11111111-1111-1111-1111-111111111111"},
            ),
            patch.object(
                module.MessageService,
                "pagination_by_first_id",
                side_effect=ConversationNotExistsError(),
            ),
        ):
            with pytest.raises(NotFound):
                method(self.account, installed_app)

    def test_first_message_not_exists(self, app: Flask):
        api = module.MessageListApi()
        method = unwrap(api.get)

        installed_app = make_installed_app(self.sqlite_session, mode="chat")

        with (
            app.test_request_context(
                "/",
                query_string={"conversation_id": "11111111-1111-1111-1111-111111111111"},
            ),
            patch.object(
                module.MessageService,
                "pagination_by_first_id",
                side_effect=FirstMessageNotExistsError(),
            ),
        ):
            with pytest.raises(NotFound):
                method(self.account, installed_app)


class TestMessageFeedbackApi(_UsesSQLiteSession):
    def test_post_success(self, app: Flask):
        api = module.MessageFeedbackApi()
        method = unwrap(api.post)

        installed_app = make_installed_app(self.sqlite_session)

        with (
            app.test_request_context("/", json={"rating": "like"}),
            patch.object(
                module.MessageService,
                "create_feedback",
            ),
        ):
            result = method(
                module.MessageFeedbackPayload.model_validate({"rating": "like"}), self.account, installed_app, "mid"
            )

        assert result["result"] == "success"

    def test_message_not_exists(self, app: Flask):
        api = module.MessageFeedbackApi()
        method = unwrap(api.post)

        installed_app = make_installed_app(self.sqlite_session)

        with (
            app.test_request_context("/", json={}),
            patch.object(
                module.MessageService,
                "create_feedback",
                side_effect=MessageNotExistsError(),
            ),
        ):
            with pytest.raises(NotFound):
                method(module.MessageFeedbackPayload.model_validate({}), self.account, installed_app, "mid")


class TestMessageMoreLikeThisApi(_UsesSQLiteSession):
    def test_get_success(self, app: Flask):
        api = module.MessageMoreLikeThisApi()
        method = unwrap(api.get)

        installed_app = make_installed_app(self.sqlite_session, mode="completion")

        with (
            app.test_request_context(
                "/",
                query_string={"response_mode": "blocking"},
            ),
            patch.object(
                module.AppGenerateService,
                "generate_more_like_this",
                return_value={"ok": True},
            ),
            patch.object(
                module.helper,
                "compact_generate_response",
                return_value=("ok", 200),
            ),
        ):
            resp = method(self.sqlite_session, self.account, installed_app, "mid")

        assert resp == ("ok", 200)

    def test_not_completion_app(self):
        api = module.MessageMoreLikeThisApi()
        method = unwrap(api.get)

        installed_app = make_installed_app(self.sqlite_session, mode="chat")

        with pytest.raises(NotCompletionAppError):
            method(self.sqlite_session, self.account, installed_app, "mid")

    def test_more_like_this_disabled(self, app: Flask):
        api = module.MessageMoreLikeThisApi()
        method = unwrap(api.get)

        installed_app = make_installed_app(self.sqlite_session, mode="completion")

        with (
            app.test_request_context(
                "/",
                query_string={"response_mode": "blocking"},
            ),
            patch.object(
                module.AppGenerateService,
                "generate_more_like_this",
                side_effect=module.MoreLikeThisDisabledError(),
            ),
        ):
            with pytest.raises(AppMoreLikeThisDisabledError):
                method(self.sqlite_session, self.account, installed_app, "mid")

    def test_message_not_exists_more_like_this(self, app: Flask):
        api = module.MessageMoreLikeThisApi()
        method = unwrap(api.get)

        installed_app = make_installed_app(self.sqlite_session, mode="completion")

        with (
            app.test_request_context(
                "/",
                query_string={"response_mode": "blocking"},
            ),
            patch.object(
                module.AppGenerateService,
                "generate_more_like_this",
                side_effect=MessageNotExistsError(),
            ),
        ):
            with pytest.raises(NotFound):
                method(self.sqlite_session, self.account, installed_app, "mid")

    def test_provider_not_init_more_like_this(self, app: Flask):
        api = module.MessageMoreLikeThisApi()
        method = unwrap(api.get)

        installed_app = make_installed_app(self.sqlite_session, mode="completion")

        with (
            app.test_request_context(
                "/",
                query_string={"response_mode": "blocking"},
            ),
            patch.object(
                module.AppGenerateService,
                "generate_more_like_this",
                side_effect=ProviderTokenNotInitError("test"),
            ),
        ):
            with pytest.raises(ProviderNotInitializeError):
                method(self.sqlite_session, self.account, installed_app, "mid")

    def test_quota_exceeded_more_like_this(self, app: Flask):
        api = module.MessageMoreLikeThisApi()
        method = unwrap(api.get)

        installed_app = make_installed_app(self.sqlite_session, mode="completion")

        with (
            app.test_request_context(
                "/",
                query_string={"response_mode": "blocking"},
            ),
            patch.object(
                module.AppGenerateService,
                "generate_more_like_this",
                side_effect=QuotaExceededError(),
            ),
        ):
            with pytest.raises(ProviderQuotaExceededError):
                method(self.sqlite_session, self.account, installed_app, "mid")

    def test_model_not_support_more_like_this(self, app: Flask):
        api = module.MessageMoreLikeThisApi()
        method = unwrap(api.get)

        installed_app = make_installed_app(self.sqlite_session, mode="completion")

        with (
            app.test_request_context(
                "/",
                query_string={"response_mode": "blocking"},
            ),
            patch.object(
                module.AppGenerateService,
                "generate_more_like_this",
                side_effect=ModelCurrentlyNotSupportError(),
            ),
        ):
            with pytest.raises(ProviderModelCurrentlyNotSupportError):
                method(self.sqlite_session, self.account, installed_app, "mid")

    def test_invoke_error_more_like_this(self, app: Flask):
        api = module.MessageMoreLikeThisApi()
        method = unwrap(api.get)

        installed_app = make_installed_app(self.sqlite_session, mode="completion")

        with (
            app.test_request_context(
                "/",
                query_string={"response_mode": "blocking"},
            ),
            patch.object(
                module.AppGenerateService,
                "generate_more_like_this",
                side_effect=InvokeError("test error"),
            ),
        ):
            with pytest.raises(CompletionRequestError):
                method(self.sqlite_session, self.account, installed_app, "mid")

    def test_unexpected_error_more_like_this(self, app: Flask):
        api = module.MessageMoreLikeThisApi()
        method = unwrap(api.get)

        installed_app = make_installed_app(self.sqlite_session, mode="completion")

        with (
            app.test_request_context(
                "/",
                query_string={"response_mode": "blocking"},
            ),
            patch.object(
                module.AppGenerateService,
                "generate_more_like_this",
                side_effect=Exception("unexpected"),
            ),
        ):
            with pytest.raises(InternalServerError):
                method(self.sqlite_session, self.account, installed_app, "mid")


class TestMessageSuggestedQuestionApi(_UsesSQLiteSession):
    def test_get_success(self):
        api = module.MessageSuggestedQuestionApi()
        method = unwrap(api.get)

        installed_app = make_installed_app(self.sqlite_session, mode="chat")

        with (
            patch.object(
                module.MessageService,
                "get_suggested_questions_after_answer",
                return_value=["q1", "q2"],
            ),
        ):
            result = method(self.account, installed_app, "mid")

        assert result["data"] == ["q1", "q2"]

    def test_not_chat_app(self):
        api = module.MessageSuggestedQuestionApi()
        method = unwrap(api.get)

        installed_app = make_installed_app(self.sqlite_session, mode="completion")

        with pytest.raises(NotChatAppError):
            method(self.account, installed_app, "mid")

    def test_disabled(self):
        api = module.MessageSuggestedQuestionApi()
        method = unwrap(api.get)

        installed_app = make_installed_app(self.sqlite_session, mode="chat")

        with (
            patch.object(
                module.MessageService,
                "get_suggested_questions_after_answer",
                side_effect=SuggestedQuestionsAfterAnswerDisabledError(),
            ),
        ):
            with pytest.raises(AppSuggestedQuestionsAfterAnswerDisabledError):
                method(self.account, installed_app, "mid")

    def test_message_not_exists_suggested_question(self):
        api = module.MessageSuggestedQuestionApi()
        method = unwrap(api.get)

        installed_app = make_installed_app(self.sqlite_session, mode="chat")

        with (
            patch.object(
                module.MessageService,
                "get_suggested_questions_after_answer",
                side_effect=MessageNotExistsError(),
            ),
        ):
            with pytest.raises(NotFound):
                method(self.account, installed_app, "mid")

    def test_conversation_not_exists_suggested_question(self):
        api = module.MessageSuggestedQuestionApi()
        method = unwrap(api.get)

        installed_app = make_installed_app(self.sqlite_session, mode="chat")

        with (
            patch.object(
                module.MessageService,
                "get_suggested_questions_after_answer",
                side_effect=ConversationNotExistsError(),
            ),
        ):
            with pytest.raises(NotFound):
                method(self.account, installed_app, "mid")

    def test_provider_not_init_suggested_question(self):
        api = module.MessageSuggestedQuestionApi()
        method = unwrap(api.get)

        installed_app = make_installed_app(self.sqlite_session, mode="chat")

        with (
            patch.object(
                module.MessageService,
                "get_suggested_questions_after_answer",
                side_effect=ProviderTokenNotInitError("test"),
            ),
        ):
            with pytest.raises(ProviderNotInitializeError):
                method(self.account, installed_app, "mid")

    def test_quota_exceeded_suggested_question(self):
        api = module.MessageSuggestedQuestionApi()
        method = unwrap(api.get)

        installed_app = make_installed_app(self.sqlite_session, mode="chat")

        with (
            patch.object(
                module.MessageService,
                "get_suggested_questions_after_answer",
                side_effect=QuotaExceededError(),
            ),
        ):
            with pytest.raises(ProviderQuotaExceededError):
                method(self.account, installed_app, "mid")

    def test_model_not_support_suggested_question(self):
        api = module.MessageSuggestedQuestionApi()
        method = unwrap(api.get)

        installed_app = make_installed_app(self.sqlite_session, mode="chat")

        with (
            patch.object(
                module.MessageService,
                "get_suggested_questions_after_answer",
                side_effect=ModelCurrentlyNotSupportError(),
            ),
        ):
            with pytest.raises(ProviderModelCurrentlyNotSupportError):
                method(self.account, installed_app, "mid")

    def test_invoke_error_suggested_question(self):
        api = module.MessageSuggestedQuestionApi()
        method = unwrap(api.get)

        installed_app = make_installed_app(self.sqlite_session, mode="chat")

        with (
            patch.object(
                module.MessageService,
                "get_suggested_questions_after_answer",
                side_effect=InvokeError("test error"),
            ),
        ):
            with pytest.raises(CompletionRequestError):
                method(self.account, installed_app, "mid")

    def test_unexpected_error_suggested_question(self):
        api = module.MessageSuggestedQuestionApi()
        method = unwrap(api.get)

        installed_app = make_installed_app(self.sqlite_session, mode="chat")

        with (
            patch.object(
                module.MessageService,
                "get_suggested_questions_after_answer",
                side_effect=Exception("unexpected"),
            ),
        ):
            with pytest.raises(InternalServerError):
                method(self.account, installed_app, "mid")
