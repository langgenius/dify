from unittest.mock import MagicMock, patch

import pytest
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
from core.model_runtime.errors.invoke import InvokeError
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


def make_message():
    msg = MagicMock()
    msg.id = "m1"
    msg.conversation_id = "11111111-1111-1111-1111-111111111111"
    msg.parent_message_id = None
    msg.inputs = {}
    msg.query = "hello"
    msg.re_sign_file_url_answer = ""
    msg.user_feedback = MagicMock(rating=None)
    msg.status = "success"
    msg.error = None
    return msg


class TestMessageListApi:
    def test_get_success(self, app):
        api = module.MessageListApi()
        method = unwrap(api.get)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="chat")

        pagination = MagicMock(
            limit=20,
            has_more=False,
            data=[make_message(), make_message()],
        )

        with (
            app.test_request_context(
                "/",
                query_string={"conversation_id": "11111111-1111-1111-1111-111111111111"},
            ),
            patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)),
            patch.object(
                module.MessageService,
                "pagination_by_first_id",
                return_value=pagination,
            ),
        ):
            result = method(installed_app)

        assert result["limit"] == 20
        assert result["has_more"] is False
        assert len(result["data"]) == 2

    def test_get_not_chat_app(self):
        api = module.MessageListApi()
        method = unwrap(api.get)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="completion")

        with patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)):
            with pytest.raises(NotChatAppError):
                method(installed_app)

    def test_conversation_not_exists(self, app):
        api = module.MessageListApi()
        method = unwrap(api.get)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="chat")

        with (
            app.test_request_context(
                "/",
                query_string={"conversation_id": "11111111-1111-1111-1111-111111111111"},
            ),
            patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)),
            patch.object(
                module.MessageService,
                "pagination_by_first_id",
                side_effect=ConversationNotExistsError(),
            ),
        ):
            with pytest.raises(NotFound):
                method(installed_app)

    def test_first_message_not_exists(self, app):
        api = module.MessageListApi()
        method = unwrap(api.get)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="chat")

        with (
            app.test_request_context(
                "/",
                query_string={"conversation_id": "11111111-1111-1111-1111-111111111111"},
            ),
            patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)),
            patch.object(
                module.MessageService,
                "pagination_by_first_id",
                side_effect=FirstMessageNotExistsError(),
            ),
        ):
            with pytest.raises(NotFound):
                method(installed_app)


class TestMessageFeedbackApi:
    def test_post_success(self, app):
        api = module.MessageFeedbackApi()
        method = unwrap(api.post)

        installed_app = MagicMock()
        installed_app.app = MagicMock()

        with (
            app.test_request_context("/", json={"rating": "like"}),
            patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)),
            patch.object(
                module.MessageService,
                "create_feedback",
            ),
        ):
            result = method(installed_app, "mid")

        assert result["result"] == "success"

    def test_message_not_exists(self, app):
        api = module.MessageFeedbackApi()
        method = unwrap(api.post)

        installed_app = MagicMock()
        installed_app.app = MagicMock()

        with (
            app.test_request_context("/", json={}),
            patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)),
            patch.object(
                module.MessageService,
                "create_feedback",
                side_effect=MessageNotExistsError(),
            ),
        ):
            with pytest.raises(NotFound):
                method(installed_app, "mid")


class TestMessageMoreLikeThisApi:
    def test_get_success(self, app):
        api = module.MessageMoreLikeThisApi()
        method = unwrap(api.get)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="completion")

        with (
            app.test_request_context(
                "/",
                query_string={"response_mode": "blocking"},
            ),
            patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)),
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
            resp = method(installed_app, "mid")

        assert resp == ("ok", 200)

    def test_not_completion_app(self):
        api = module.MessageMoreLikeThisApi()
        method = unwrap(api.get)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="chat")

        with patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)):
            with pytest.raises(NotCompletionAppError):
                method(installed_app, "mid")

    def test_more_like_this_disabled(self, app):
        api = module.MessageMoreLikeThisApi()
        method = unwrap(api.get)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="completion")

        with (
            app.test_request_context(
                "/",
                query_string={"response_mode": "blocking"},
            ),
            patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)),
            patch.object(
                module.AppGenerateService,
                "generate_more_like_this",
                side_effect=module.MoreLikeThisDisabledError(),
            ),
        ):
            with pytest.raises(AppMoreLikeThisDisabledError):
                method(installed_app, "mid")

    def test_message_not_exists_more_like_this(self, app):
        api = module.MessageMoreLikeThisApi()
        method = unwrap(api.get)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="completion")

        with (
            app.test_request_context(
                "/",
                query_string={"response_mode": "blocking"},
            ),
            patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)),
            patch.object(
                module.AppGenerateService,
                "generate_more_like_this",
                side_effect=MessageNotExistsError(),
            ),
        ):
            with pytest.raises(NotFound):
                method(installed_app, "mid")

    def test_provider_not_init_more_like_this(self, app):
        api = module.MessageMoreLikeThisApi()
        method = unwrap(api.get)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="completion")

        with (
            app.test_request_context(
                "/",
                query_string={"response_mode": "blocking"},
            ),
            patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)),
            patch.object(
                module.AppGenerateService,
                "generate_more_like_this",
                side_effect=ProviderTokenNotInitError("test"),
            ),
        ):
            with pytest.raises(ProviderNotInitializeError):
                method(installed_app, "mid")

    def test_quota_exceeded_more_like_this(self, app):
        api = module.MessageMoreLikeThisApi()
        method = unwrap(api.get)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="completion")

        with (
            app.test_request_context(
                "/",
                query_string={"response_mode": "blocking"},
            ),
            patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)),
            patch.object(
                module.AppGenerateService,
                "generate_more_like_this",
                side_effect=QuotaExceededError(),
            ),
        ):
            with pytest.raises(ProviderQuotaExceededError):
                method(installed_app, "mid")

    def test_model_not_support_more_like_this(self, app):
        api = module.MessageMoreLikeThisApi()
        method = unwrap(api.get)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="completion")

        with (
            app.test_request_context(
                "/",
                query_string={"response_mode": "blocking"},
            ),
            patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)),
            patch.object(
                module.AppGenerateService,
                "generate_more_like_this",
                side_effect=ModelCurrentlyNotSupportError(),
            ),
        ):
            with pytest.raises(ProviderModelCurrentlyNotSupportError):
                method(installed_app, "mid")

    def test_invoke_error_more_like_this(self, app):
        api = module.MessageMoreLikeThisApi()
        method = unwrap(api.get)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="completion")

        with (
            app.test_request_context(
                "/",
                query_string={"response_mode": "blocking"},
            ),
            patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)),
            patch.object(
                module.AppGenerateService,
                "generate_more_like_this",
                side_effect=InvokeError("test error"),
            ),
        ):
            with pytest.raises(CompletionRequestError):
                method(installed_app, "mid")

    def test_unexpected_error_more_like_this(self, app):
        api = module.MessageMoreLikeThisApi()
        method = unwrap(api.get)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="completion")

        with (
            app.test_request_context(
                "/",
                query_string={"response_mode": "blocking"},
            ),
            patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)),
            patch.object(
                module.AppGenerateService,
                "generate_more_like_this",
                side_effect=Exception("unexpected"),
            ),
        ):
            with pytest.raises(InternalServerError):
                method(installed_app, "mid")


class TestMessageSuggestedQuestionApi:
    def test_get_success(self):
        api = module.MessageSuggestedQuestionApi()
        method = unwrap(api.get)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="chat")

        with (
            patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)),
            patch.object(
                module.MessageService,
                "get_suggested_questions_after_answer",
                return_value=["q1", "q2"],
            ),
        ):
            result = method(installed_app, "mid")

        assert result["data"] == ["q1", "q2"]

    def test_not_chat_app(self):
        api = module.MessageSuggestedQuestionApi()
        method = unwrap(api.get)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="completion")

        with patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)):
            with pytest.raises(NotChatAppError):
                method(installed_app, "mid")

    def test_disabled(self):
        api = module.MessageSuggestedQuestionApi()
        method = unwrap(api.get)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="chat")

        with (
            patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)),
            patch.object(
                module.MessageService,
                "get_suggested_questions_after_answer",
                side_effect=SuggestedQuestionsAfterAnswerDisabledError(),
            ),
        ):
            with pytest.raises(AppSuggestedQuestionsAfterAnswerDisabledError):
                method(installed_app, "mid")

    def test_message_not_exists_suggested_question(self):
        api = module.MessageSuggestedQuestionApi()
        method = unwrap(api.get)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="chat")

        with (
            patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)),
            patch.object(
                module.MessageService,
                "get_suggested_questions_after_answer",
                side_effect=MessageNotExistsError(),
            ),
        ):
            with pytest.raises(NotFound):
                method(installed_app, "mid")

    def test_conversation_not_exists_suggested_question(self):
        api = module.MessageSuggestedQuestionApi()
        method = unwrap(api.get)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="chat")

        with (
            patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)),
            patch.object(
                module.MessageService,
                "get_suggested_questions_after_answer",
                side_effect=ConversationNotExistsError(),
            ),
        ):
            with pytest.raises(NotFound):
                method(installed_app, "mid")

    def test_provider_not_init_suggested_question(self):
        api = module.MessageSuggestedQuestionApi()
        method = unwrap(api.get)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="chat")

        with (
            patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)),
            patch.object(
                module.MessageService,
                "get_suggested_questions_after_answer",
                side_effect=ProviderTokenNotInitError("test"),
            ),
        ):
            with pytest.raises(ProviderNotInitializeError):
                method(installed_app, "mid")

    def test_quota_exceeded_suggested_question(self):
        api = module.MessageSuggestedQuestionApi()
        method = unwrap(api.get)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="chat")

        with (
            patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)),
            patch.object(
                module.MessageService,
                "get_suggested_questions_after_answer",
                side_effect=QuotaExceededError(),
            ),
        ):
            with pytest.raises(ProviderQuotaExceededError):
                method(installed_app, "mid")

    def test_model_not_support_suggested_question(self):
        api = module.MessageSuggestedQuestionApi()
        method = unwrap(api.get)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="chat")

        with (
            patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)),
            patch.object(
                module.MessageService,
                "get_suggested_questions_after_answer",
                side_effect=ModelCurrentlyNotSupportError(),
            ),
        ):
            with pytest.raises(ProviderModelCurrentlyNotSupportError):
                method(installed_app, "mid")

    def test_invoke_error_suggested_question(self):
        api = module.MessageSuggestedQuestionApi()
        method = unwrap(api.get)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="chat")

        with (
            patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)),
            patch.object(
                module.MessageService,
                "get_suggested_questions_after_answer",
                side_effect=InvokeError("test error"),
            ),
        ):
            with pytest.raises(CompletionRequestError):
                method(installed_app, "mid")

    def test_unexpected_error_suggested_question(self):
        api = module.MessageSuggestedQuestionApi()
        method = unwrap(api.get)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="chat")

        with (
            patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)),
            patch.object(
                module.MessageService,
                "get_suggested_questions_after_answer",
                side_effect=Exception("unexpected"),
            ),
        ):
            with pytest.raises(InternalServerError):
                method(installed_app, "mid")
