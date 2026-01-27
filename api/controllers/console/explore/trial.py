import logging
from typing import Any, cast

from flask import request
from flask_restx import Resource, fields, marshal, marshal_with, reqparse
from werkzeug.exceptions import Forbidden, InternalServerError, NotFound

import services
from controllers.common.fields import Parameters as ParametersResponse
from controllers.common.fields import Site as SiteResponse
from controllers.common.schema import get_or_create_model
from controllers.console import api, console_ns
from controllers.console.app.error import (
    AppUnavailableError,
    AudioTooLargeError,
    CompletionRequestError,
    ConversationCompletedError,
    NeedAddIdsError,
    NoAudioUploadedError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderNotSupportSpeechToTextError,
    ProviderQuotaExceededError,
    UnsupportedAudioTypeError,
)
from controllers.console.app.wraps import get_app_model_with_trial
from controllers.console.explore.error import (
    AppSuggestedQuestionsAfterAnswerDisabledError,
    NotChatAppError,
    NotCompletionAppError,
    NotWorkflowAppError,
)
from controllers.console.explore.wraps import TrialAppResource, trial_feature_enable
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from core.app.app_config.common.parameters_mapping import get_parameters_from_feature_dict
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import (
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from core.model_runtime.errors.invoke import InvokeError
from core.workflow.graph_engine.manager import GraphEngineManager
from extensions.ext_database import db
from fields.app_fields import (
    app_detail_fields_with_site,
    deleted_tool_fields,
    model_config_fields,
    site_fields,
    tag_fields,
)
from fields.dataset_fields import dataset_fields
from fields.member_fields import build_simple_account_model
from fields.workflow_fields import (
    conversation_variable_fields,
    pipeline_variable_fields,
    workflow_fields,
    workflow_partial_fields,
)
from libs import helper
from libs.helper import uuid_value
from libs.login import current_user
from models import Account
from models.account import TenantStatus
from models.model import AppMode, Site
from models.workflow import Workflow
from services.app_generate_service import AppGenerateService
from services.app_service import AppService
from services.audio_service import AudioService
from services.dataset_service import DatasetService
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


model_config_model = get_or_create_model("TrialAppModelConfig", model_config_fields)
workflow_partial_model = get_or_create_model("TrialWorkflowPartial", workflow_partial_fields)
deleted_tool_model = get_or_create_model("TrialDeletedTool", deleted_tool_fields)
tag_model = get_or_create_model("TrialTag", tag_fields)
site_model = get_or_create_model("TrialSite", site_fields)

app_detail_fields_with_site_copy = app_detail_fields_with_site.copy()
app_detail_fields_with_site_copy["model_config"] = fields.Nested(
    model_config_model, attribute="app_model_config", allow_null=True
)
app_detail_fields_with_site_copy["workflow"] = fields.Nested(workflow_partial_model, allow_null=True)
app_detail_fields_with_site_copy["deleted_tools"] = fields.List(fields.Nested(deleted_tool_model))
app_detail_fields_with_site_copy["tags"] = fields.List(fields.Nested(tag_model))
app_detail_fields_with_site_copy["site"] = fields.Nested(site_model)
app_detail_with_site_model = get_or_create_model("TrialAppDetailWithSite", app_detail_fields_with_site_copy)

simple_account_model = build_simple_account_model(console_ns)
conversation_variable_model = get_or_create_model("TrialConversationVariable", conversation_variable_fields)
pipeline_variable_model = get_or_create_model("TrialPipelineVariable", pipeline_variable_fields)

workflow_fields_copy = workflow_fields.copy()
workflow_fields_copy["created_by"] = fields.Nested(simple_account_model, attribute="created_by_account")
workflow_fields_copy["updated_by"] = fields.Nested(
    simple_account_model, attribute="updated_by_account", allow_null=True
)
workflow_fields_copy["conversation_variables"] = fields.List(fields.Nested(conversation_variable_model))
workflow_fields_copy["rag_pipeline_variables"] = fields.List(fields.Nested(pipeline_variable_model))
workflow_model = get_or_create_model("TrialWorkflow", workflow_fields_copy)


class TrialAppWorkflowRunApi(TrialAppResource):
    def post(self, trial_app):
        """
        Run workflow
        """
        app_model = trial_app
        if not app_model:
            raise NotWorkflowAppError()
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode != AppMode.WORKFLOW:
            raise NotWorkflowAppError()

        parser = reqparse.RequestParser()
        parser.add_argument("inputs", type=dict, required=True, nullable=False, location="json")
        parser.add_argument("files", type=list, required=False, location="json")
        args = parser.parse_args()
        assert current_user is not None
        try:
            app_id = app_model.id
            user_id = current_user.id
            response = AppGenerateService.generate(
                app_model=app_model, user=current_user, args=args, invoke_from=InvokeFrom.EXPLORE, streaming=True
            )
            RecommendedAppService.add_trial_app_record(app_id, user_id)
            return helper.compact_generate_response(response)
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


class TrialAppWorkflowTaskStopApi(TrialAppResource):
    def post(self, trial_app, task_id: str):
        """
        Stop workflow task
        """
        app_model = trial_app
        if not app_model:
            raise NotWorkflowAppError()
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode != AppMode.WORKFLOW:
            raise NotWorkflowAppError()
        assert current_user is not None

        # Stop using both mechanisms for backward compatibility
        # Legacy stop flag mechanism (without user check)
        AppQueueManager.set_stop_flag_no_user_check(task_id)

        # New graph engine command channel mechanism
        GraphEngineManager.send_stop_command(task_id)

        return {"result": "success"}


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

            # Get IDs before they might be detached from session
            app_id = app_model.id
            user_id = current_user.id

            response = AppGenerateService.generate(
                app_model=app_model, user=current_user, args=args, invoke_from=InvokeFrom.EXPLORE, streaming=True
            )
            RecommendedAppService.add_trial_app_record(app_id, user_id)
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

            # Get IDs before they might be detached from session
            app_id = app_model.id
            user_id = current_user.id

            response = AudioService.transcript_asr(app_model=app_model, file=file, end_user=None)
            RecommendedAppService.add_trial_app_record(app_id, user_id)
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

            # Get IDs before they might be detached from session
            app_id = app_model.id
            user_id = current_user.id

            response = AudioService.transcript_tts(app_model=app_model, text=text, voice=voice, message_id=message_id)
            RecommendedAppService.add_trial_app_record(app_id, user_id)
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

            # Get IDs before they might be detached from session
            app_id = app_model.id
            user_id = current_user.id

            response = AppGenerateService.generate(
                app_model=app_model, user=current_user, args=args, invoke_from=InvokeFrom.EXPLORE, streaming=streaming
            )

            RecommendedAppService.add_trial_app_record(app_id, user_id)
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
    @get_app_model_with_trial
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

        return SiteResponse.model_validate(site).model_dump(mode="json")


class TrialAppParameterApi(Resource):
    """Resource for app variables."""

    @trial_feature_enable
    @get_app_model_with_trial
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

        parameters = get_parameters_from_feature_dict(features_dict=features_dict, user_input_form=user_input_form)
        return ParametersResponse.model_validate(parameters).model_dump(mode="json")


class AppApi(Resource):
    @trial_feature_enable
    @get_app_model_with_trial
    @marshal_with(app_detail_with_site_model)
    def get(self, app_model):
        """Get app detail"""

        app_service = AppService()
        app_model = app_service.get_app(app_model)

        return app_model


class AppWorkflowApi(Resource):
    @trial_feature_enable
    @get_app_model_with_trial
    @marshal_with(workflow_model)
    def get(self, app_model):
        """Get workflow detail"""
        if not app_model.workflow_id:
            raise AppUnavailableError()

        workflow = (
            db.session.query(Workflow)
            .where(
                Workflow.id == app_model.workflow_id,
            )
            .first()
        )
        return workflow


class DatasetListApi(Resource):
    @trial_feature_enable
    @get_app_model_with_trial
    def get(self, app_model):
        page = request.args.get("page", default=1, type=int)
        limit = request.args.get("limit", default=20, type=int)
        ids = request.args.getlist("ids")

        tenant_id = app_model.tenant_id
        if ids:
            datasets, total = DatasetService.get_datasets_by_ids(ids, tenant_id)
        else:
            raise NeedAddIdsError()

        data = cast(list[dict[str, Any]], marshal(datasets, dataset_fields))

        response = {"data": data, "has_more": len(datasets) == limit, "limit": limit, "total": total, "page": page}
        return response


api.add_resource(TrialChatApi, "/trial-apps/<uuid:app_id>/chat-messages", endpoint="trial_app_chat_completion")

api.add_resource(
    TrialMessageSuggestedQuestionApi,
    "/trial-apps/<uuid:app_id>/messages/<uuid:message_id>/suggested-questions",
    endpoint="trial_app_suggested_question",
)

api.add_resource(TrialChatAudioApi, "/trial-apps/<uuid:app_id>/audio-to-text", endpoint="trial_app_audio")
api.add_resource(TrialChatTextApi, "/trial-apps/<uuid:app_id>/text-to-audio", endpoint="trial_app_text")

api.add_resource(TrialCompletionApi, "/trial-apps/<uuid:app_id>/completion-messages", endpoint="trial_app_completion")

api.add_resource(TrialSitApi, "/trial-apps/<uuid:app_id>/site")

api.add_resource(TrialAppParameterApi, "/trial-apps/<uuid:app_id>/parameters", endpoint="trial_app_parameters")

api.add_resource(AppApi, "/trial-apps/<uuid:app_id>", endpoint="trial_app")

api.add_resource(TrialAppWorkflowRunApi, "/trial-apps/<uuid:app_id>/workflows/run", endpoint="trial_app_workflow_run")
api.add_resource(TrialAppWorkflowTaskStopApi, "/trial-apps/<uuid:app_id>/workflows/tasks/<string:task_id>/stop")

api.add_resource(AppWorkflowApi, "/trial-apps/<uuid:app_id>/workflows", endpoint="trial_app_workflow")
api.add_resource(DatasetListApi, "/trial-apps/<uuid:app_id>/datasets", endpoint="trial_app_datasets")
