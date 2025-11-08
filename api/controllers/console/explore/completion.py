import logging

from flask_restx import reqparse
from werkzeug.exceptions import InternalServerError, NotFound

import services
from controllers.console.app.error import (
    AppUnavailableError,
    CompletionRequestError,
    ConversationCompletedError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.explore.error import NotChatAppError, NotCompletionAppError
from controllers.console.explore.wraps import InstalledAppResource
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import (
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from core.model_runtime.errors.invoke import InvokeError
from extensions.ext_database import db
from libs import helper
from libs.datetime_utils import naive_utc_now
from libs.helper import uuid_value
from libs.login import current_user
from models import Account
from models.model import AppMode
from services.app_generate_service import AppGenerateService
from services.errors.llm import InvokeRateLimitError

from .. import console_ns

logger = logging.getLogger(__name__)


# define completion api for user
@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/completion-messages",
    endpoint="installed_app_completion",
)
class CompletionApi(InstalledAppResource):
    def post(self, installed_app):
        app_model = installed_app.app
        if app_model.mode != "completion":
            raise NotCompletionAppError()

        parser = (
            reqparse.RequestParser()
            .add_argument("inputs", type=dict, required=True, location="json")
            .add_argument("query", type=str, location="json", default="")
            .add_argument("files", type=list, required=False, location="json")
            .add_argument("response_mode", type=str, choices=["blocking", "streaming"], location="json")
            .add_argument("retriever_from", type=str, required=False, default="explore_app", location="json")
        )
        args = parser.parse_args()

        streaming = args["response_mode"] == "streaming"
        args["auto_generate_name"] = False

        installed_app.last_used_at = naive_utc_now()
        db.session.commit()

        try:
            if not isinstance(current_user, Account):
                raise ValueError("current_user must be an Account instance")
            response = AppGenerateService.generate(
                app_model=app_model, user=current_user, args=args, invoke_from=InvokeFrom.EXPLORE, streaming=streaming
            )

            return helper.compact_generate_response(response)
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        except services.errors.conversation.ConversationCompletedError:
            raise ConversationCompletedError()
        except services.errors.app_model_config.AppModelConfigBrokenError:
            logger.exception("App model config broken.")
            raise AppUnavailableError()
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
    "/installed-apps/<uuid:installed_app_id>/completion-messages/<string:task_id>/stop",
    endpoint="installed_app_stop_completion",
)
class CompletionStopApi(InstalledAppResource):
    def post(self, installed_app, task_id):
        app_model = installed_app.app
        if app_model.mode != "completion":
            raise NotCompletionAppError()

        if not isinstance(current_user, Account):
            raise ValueError("current_user must be an Account instance")
        AppQueueManager.set_stop_flag(task_id, InvokeFrom.EXPLORE, current_user.id)

        return {"result": "success"}, 200


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/chat-messages",
    endpoint="installed_app_chat_completion",
)
class ChatApi(InstalledAppResource):
    def post(self, installed_app):
        app_model = installed_app.app
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        parser = (
            reqparse.RequestParser()
            .add_argument("inputs", type=dict, required=True, location="json")
            .add_argument("query", type=str, required=True, location="json")
            .add_argument("files", type=list, required=False, location="json")
            .add_argument("conversation_id", type=uuid_value, location="json")
            .add_argument("parent_message_id", type=uuid_value, required=False, location="json")
            .add_argument("retriever_from", type=str, required=False, default="explore_app", location="json")
        )
        args = parser.parse_args()

        args["auto_generate_name"] = False

        installed_app.last_used_at = naive_utc_now()
        db.session.commit()

        try:
            if not isinstance(current_user, Account):
                raise ValueError("current_user must be an Account instance")
            response = AppGenerateService.generate(
                app_model=app_model, user=current_user, args=args, invoke_from=InvokeFrom.EXPLORE, streaming=True
            )

            return helper.compact_generate_response(response)
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        except services.errors.conversation.ConversationCompletedError:
            raise ConversationCompletedError()
        except services.errors.app_model_config.AppModelConfigBrokenError:
            logger.exception("App model config broken.")
            raise AppUnavailableError()
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except InvokeError as e:
            raise CompletionRequestError(e.description)
        except InvokeRateLimitError as ex:
            raise InvokeRateLimitHttpError(ex.description)
        except ValueError as e:
            raise e
        except Exception:
            logger.exception("internal server error.")
            raise InternalServerError()


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/chat-messages/<string:task_id>/stop",
    endpoint="installed_app_stop_chat_completion",
)
class ChatStopApi(InstalledAppResource):
    def post(self, installed_app, task_id):
        app_model = installed_app.app
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        if not isinstance(current_user, Account):
            raise ValueError("current_user must be an Account instance")
        AppQueueManager.set_stop_flag(task_id, InvokeFrom.EXPLORE, current_user.id)

        return {"result": "success"}, 200
