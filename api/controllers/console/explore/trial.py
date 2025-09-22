import logging

from flask import request
from flask_restx import Resource, marshal_with, reqparse
from werkzeug.exceptions import Forbidden, InternalServerError, NotFound

import services
from controllers.common import fields
from controllers.common.fields import build_app_detail_fields_with_site, build_site_model
from controllers.console.app.error import (
    AppUnavailableError,
    AudioTooLargeError,
    CompletionRequestError,
    ConversationCompletedError,
    NoAudioUploadedError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderNotSupportSpeechToTextError,
    ProviderQuotaExceededError,
    UnsupportedAudioTypeError,
)
from controllers.console.app.wraps import get_app_model
from controllers.console.explore.error import (
    AppSuggestedQuestionsAfterAnswerDisabledError,
    NotChatAppError,
    NotCompletionAppError,
)
from controllers.console.explore.wraps import TrialAppResource, trial_feature_enable
from controllers.service_api import service_api_ns
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from core.app.app_config.common.parameters_mapping import get_parameters_from_feature_dict
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import (
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from core.model_runtime.errors.invoke import InvokeError
from extensions.ext_database import db
from libs import helper
from libs.helper import uuid_value
from libs.login import current_user
from models import Account
from models.account import TenantStatus
from models.model import AppMode, Site
from services.app_generate_service import AppGenerateService
from services.app_service import AppService
from services.audio_service import AudioService
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    ProviderNotSupportSpeechToTextServiceError,
    UnsupportedAudioTypeServiceError,
)
from services.errors.conversation import ConversationNotExistsError
from services.errors.llm import InvokeRateLimitError
from services.errors.message import (
    MessageNotExistsError,
    SuggestedQuestionsAfterAnswerDisabledError,
)
from services.message_service import MessageService
from services.recommended_app_service import RecommendedAppService

logger = logging.getLogger(__name__)


class TrialChatApi(TrialAppResource):
    @trial_feature_enable
    def post(self, trial_app):
        app_model = trial_app
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        parser = reqparse.RequestParser()
        parser.add_argument("inputs", type=dict, required=True, location="json")
        parser.add_argument("query", type=str, required=True, location="json")
        parser.add_argument("files", type=list, required=False, location="json")
        parser.add_argument("conversation_id", type=uuid_value, location="json")
        parser.add_argument("parent_message_id", type=uuid_value, required=False, location="json")
        parser.add_argument("retriever_from", type=str, required=False, default="explore_app", location="json")
        args = parser.parse_args()

        args["auto_generate_name"] = False

        try:
            if not isinstance(current_user, Account):
                raise ValueError("current_user must be an Account instance")
            response = AppGenerateService.generate(
                app_model=app_model, user=current_user, args=args, invoke_from=InvokeFrom.EXPLORE, streaming=True
            )
            RecommendedAppService.add_trial_app_record(app_model.id, current_user.id)
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


class TrialMessageSuggestedQuestionApi(TrialAppResource):
    @trial_feature_enable
    def get(self, trial_app, message_id):
        app_model = trial_app
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        message_id = str(message_id)

        try:
            if not isinstance(current_user, Account):
                raise ValueError("current_user must be an Account instance")
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


class TrialChatAudioApi(TrialAppResource):
    @trial_feature_enable
    def post(self, trial_app):
        app_model = trial_app

        file = request.files["file"]

        try:
            if not isinstance(current_user, Account):
                raise ValueError("current_user must be an Account instance")
            response = AudioService.transcript_asr(app_model=app_model, file=file, end_user=None)
            RecommendedAppService.add_trial_app_record(app_model.id, current_user.id)
            return response
        except services.errors.app_model_config.AppModelConfigBrokenError:
            logger.exception("App model config broken.")
            raise AppUnavailableError()
        except NoAudioUploadedServiceError:
            raise NoAudioUploadedError()
        except AudioTooLargeServiceError as e:
            raise AudioTooLargeError(str(e))
        except UnsupportedAudioTypeServiceError:
            raise UnsupportedAudioTypeError()
        except ProviderNotSupportSpeechToTextServiceError:
            raise ProviderNotSupportSpeechToTextError()
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
        except Exception as e:
            logger.exception("internal server error.")
            raise InternalServerError()


class TrialChatTextApi(TrialAppResource):
    @trial_feature_enable
    def post(self, trial_app):
        app_model = trial_app
        try:
            parser = reqparse.RequestParser()
            parser.add_argument("message_id", type=str, required=False, location="json")
            parser.add_argument("voice", type=str, location="json")
            parser.add_argument("text", type=str, location="json")
            parser.add_argument("streaming", type=bool, location="json")
            args = parser.parse_args()

            message_id = args.get("message_id", None)
            text = args.get("text", None)
            voice = args.get("voice", None)
            if not isinstance(current_user, Account):
                raise ValueError("current_user must be an Account instance")
            response = AudioService.transcript_tts(app_model=app_model, text=text, voice=voice, message_id=message_id)
            RecommendedAppService.add_trial_app_record(app_model.id, current_user.id)
            return response
        except services.errors.app_model_config.AppModelConfigBrokenError:
            logger.exception("App model config broken.")
            raise AppUnavailableError()
        except NoAudioUploadedServiceError:
            raise NoAudioUploadedError()
        except AudioTooLargeServiceError as e:
            raise AudioTooLargeError(str(e))
        except UnsupportedAudioTypeServiceError:
            raise UnsupportedAudioTypeError()
        except ProviderNotSupportSpeechToTextServiceError:
            raise ProviderNotSupportSpeechToTextError()
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
        except Exception as e:
            logger.exception("internal server error.")
            raise InternalServerError()


class TrialCompletionApi(TrialAppResource):
    @trial_feature_enable
    def post(self, trial_app):
        app_model = trial_app
        if app_model.mode != "completion":
            raise NotCompletionAppError()

        parser = reqparse.RequestParser()
        parser.add_argument("inputs", type=dict, required=True, location="json")
        parser.add_argument("query", type=str, location="json", default="")
        parser.add_argument("files", type=list, required=False, location="json")
        parser.add_argument("response_mode", type=str, choices=["blocking", "streaming"], location="json")
        parser.add_argument("retriever_from", type=str, required=False, default="explore_app", location="json")
        args = parser.parse_args()

        streaming = args["response_mode"] == "streaming"
        args["auto_generate_name"] = False

        try:
            if not isinstance(current_user, Account):
                raise ValueError("current_user must be an Account instance")
            response = AppGenerateService.generate(
                app_model=app_model, user=current_user, args=args, invoke_from=InvokeFrom.EXPLORE, streaming=streaming
            )

            RecommendedAppService.add_trial_app_record(app_model.id, current_user.id)
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


class TrialSitApi(Resource):
    """Resource for trial app sites."""

    @trial_feature_enable
    @get_app_model
    @service_api_ns.marshal_with(build_site_model(service_api_ns))
    def get(self, app_model):
        """Retrieve app site info.

        Returns the site configuration for the application including theme, icons, and text.
        """
        site = db.session.query(Site).where(Site.app_id == app_model.id).first()

        if not site:
            raise Forbidden()

        assert app_model.tenant
        if app_model.tenant.status == TenantStatus.ARCHIVE:
            raise Forbidden()

        return site


class TrialAppParameterApi(Resource):
    """Resource for app variables."""

    @trial_feature_enable
    @get_app_model
    @marshal_with(fields.parameters_fields)
    def get(self, app_model):
        """Retrieve app parameters."""

        if app_model is None:
            raise AppUnavailableError()

        if app_model.mode in {AppMode.ADVANCED_CHAT, AppMode.WORKFLOW}:
            workflow = app_model.workflow
            if workflow is None:
                raise AppUnavailableError()

            features_dict = workflow.features_dict
            user_input_form = workflow.user_input_form(to_old_structure=True)
        else:
            app_model_config = app_model.app_model_config
            if app_model_config is None:
                raise AppUnavailableError()

            features_dict = app_model_config.to_dict()

            user_input_form = features_dict.get("user_input_form", [])

        return get_parameters_from_feature_dict(features_dict=features_dict, user_input_form=user_input_form)


class AppApi(Resource):
    @trial_feature_enable
    @get_app_model
    @service_api_ns.marshal_with(build_app_detail_fields_with_site(service_api_ns))
    def get(self, app_model):
        """Get app detail"""

        app_service = AppService()
        app_model = app_service.get_app(app_model)

        return app_model
