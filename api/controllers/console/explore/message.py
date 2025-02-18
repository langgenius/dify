import logging

from flask_login import current_user  # type: ignore
from flask_restful import marshal_with, reqparse  # type: ignore
from flask_restful.inputs import int_range  # type: ignore
from werkzeug.exceptions import InternalServerError, NotFound

import services
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
from models.model import AppMode
from services.app_generate_service import AppGenerateService
from services.errors.app import MoreLikeThisDisabledError
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import MessageNotExistsError, SuggestedQuestionsAfterAnswerDisabledError
from services.message_service import MessageService


class MessageListApi(InstalledAppResource):
    @marshal_with(message_infinite_scroll_pagination_fields)
    def get(self, installed_app):
        app_model = installed_app.app

        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        parser = reqparse.RequestParser()
        parser.add_argument("conversation_id", required=True, type=uuid_value, location="args")
        parser.add_argument("first_id", type=uuid_value, location="args")
        parser.add_argument("limit", type=int_range(1, 100), required=False, default=20, location="args")
        args = parser.parse_args()

        try:
            return MessageService.pagination_by_first_id(
                app_model, current_user, args["conversation_id"], args["first_id"], args["limit"]
            )
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        except services.errors.message.FirstMessageNotExistsError:
            raise NotFound("First Message Not Exists.")


class MessageFeedbackApi(InstalledAppResource):
    def post(self, installed_app, message_id):
        app_model = installed_app.app

        message_id = str(message_id)

        parser = reqparse.RequestParser()
        parser.add_argument("rating", type=str, choices=["like", "dislike", None], location="json")
        parser.add_argument("content", type=str, location="json")
        args = parser.parse_args()

        try:
            MessageService.create_feedback(
                app_model=app_model,
                message_id=message_id,
                user=current_user,
                rating=args.get("rating"),
                content=args.get("content"),
            )
        except services.errors.message.MessageNotExistsError:
            raise NotFound("Message Not Exists.")

        return {"result": "success"}


class MessageMoreLikeThisApi(InstalledAppResource):
    def get(self, installed_app, message_id):
        app_model = installed_app.app
        if app_model.mode != "completion":
            raise NotCompletionAppError()

        message_id = str(message_id)

        parser = reqparse.RequestParser()
        parser.add_argument(
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
            logging.exception("internal server error.")
            raise InternalServerError()


class MessageSuggestedQuestionApi(InstalledAppResource):
    def get(self, installed_app, message_id):
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
            logging.exception("internal server error.")
            raise InternalServerError()

        return {"data": questions}
