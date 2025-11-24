import logging

from flask_restx import marshal_with, reqparse
from flask_restx.inputs import int_range
from werkzeug.exceptions import InternalServerError, NotFound

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
from controllers.console.explore.wraps import InstalledAppResource
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_runtime.errors.invoke import InvokeError
from fields.message_fields import message_infinite_scroll_pagination_fields
from libs import helper
from libs.helper import uuid_value
from libs.login import current_account_with_tenant
from models.model import AppMode
from services.app_generate_service import AppGenerateService
from services.errors.app import MoreLikeThisDisabledError
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import (
    FirstMessageNotExistsError,
    MessageNotExistsError,
    SuggestedQuestionsAfterAnswerDisabledError,
)
from services.message_service import MessageService

from .. import console_ns

logger = logging.getLogger(__name__)


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/messages",
    endpoint="installed_app_messages",
)
class MessageListApi(InstalledAppResource):
    @marshal_with(message_infinite_scroll_pagination_fields)
    def get(self, installed_app):
        current_user, _ = current_account_with_tenant()
        app_model = installed_app.app

        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        parser = (
            reqparse.RequestParser()
            .add_argument("conversation_id", required=True, type=uuid_value, location="args")
            .add_argument("first_id", type=uuid_value, location="args")
            .add_argument("limit", type=int_range(1, 100), required=False, default=20, location="args")
        )
        args = parser.parse_args()

        try:
            return MessageService.pagination_by_first_id(
                app_model, current_user, args["conversation_id"], args["first_id"], args["limit"]
            )
        except ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        except FirstMessageNotExistsError:
            raise NotFound("First Message Not Exists.")


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/messages/<uuid:message_id>/feedbacks",
    endpoint="installed_app_message_feedback",
)
class MessageFeedbackApi(InstalledAppResource):
    def post(self, installed_app, message_id):
        current_user, _ = current_account_with_tenant()
        app_model = installed_app.app

        message_id = str(message_id)

        parser = (
            reqparse.RequestParser()
            .add_argument("rating", type=str, choices=["like", "dislike", None], location="json")
            .add_argument("content", type=str, location="json")
        )
        args = parser.parse_args()

        try:
            MessageService.create_feedback(
                app_model=app_model,
                message_id=message_id,
                user=current_user,
                rating=args.get("rating"),
                content=args.get("content"),
            )
        except MessageNotExistsError:
            raise NotFound("Message Not Exists.")

        return {"result": "success"}


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/messages/<uuid:message_id>/more-like-this",
    endpoint="installed_app_more_like_this",
)
class MessageMoreLikeThisApi(InstalledAppResource):
    def get(self, installed_app, message_id):
        current_user, _ = current_account_with_tenant()
        app_model = installed_app.app
        if app_model.mode != "completion":
            raise NotCompletionAppError()

        message_id = str(message_id)

        parser = reqparse.RequestParser().add_argument(
            "response_mode", type=str, required=True, choices=["blocking", "streaming"], location="args"
        )
        args = parser.parse_args()

        streaming = args["response_mode"] == "streaming"

        try:
            response = AppGenerateService.generate_more_like_this(
                app_model=app_model,
                user=current_user,
                message_id=message_id,
                invoke_from=InvokeFrom.EXPLORE,
                streaming=streaming,
            )
            return helper.compact_generate_response(response)
        except MessageNotExistsError:
            raise NotFound("Message Not Exists.")
        except MoreLikeThisDisabledError:
            raise AppMoreLikeThisDisabledError()
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except InvokeError as e:
            raise CompletionRequestError(e.description)
        except ValueError as e:
            raise e
        except Exception:
            logger.exception("internal server error.")
            raise InternalServerError()


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/messages/<uuid:message_id>/suggested-questions",
    endpoint="installed_app_suggested_question",
)
class MessageSuggestedQuestionApi(InstalledAppResource):
    def get(self, installed_app, message_id):
        current_user, _ = current_account_with_tenant()
        app_model = installed_app.app
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        message_id = str(message_id)

        try:
            questions = MessageService.get_suggested_questions_after_answer(
                app_model=app_model, user=current_user, message_id=message_id, invoke_from=InvokeFrom.EXPLORE
            )
        except MessageNotExistsError:
            raise NotFound("Message not found")
        except ConversationNotExistsError:
            raise NotFound("Conversation not found")
        except SuggestedQuestionsAfterAnswerDisabledError:
            raise AppSuggestedQuestionsAfterAnswerDisabledError()
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except InvokeError as e:
            raise CompletionRequestError(e.description)
        except Exception:
            logger.exception("internal server error.")
            raise InternalServerError()

        return {"data": questions}
