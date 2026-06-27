import logging
from datetime import datetime
from typing import Any, Literal

from flask import request
from flask_restx import Resource
from pydantic import AliasChoices, BaseModel, Field, field_validator
from sqlalchemy import select
from werkzeug.exceptions import Forbidden, InternalServerError, NotFound

import services
from controllers.common.fields import (
    AudioBinaryResponse,
    AudioTranscriptResponse,
    GeneratedAppResponse,
    SimpleResultResponse,
)
from controllers.common.fields import Parameters as ParametersResponse
from controllers.common.fields import Site as SiteResponse
from controllers.common.schema import (
    query_params_from_model,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console import console_ns
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
from controllers.console.wraps import with_current_user
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from core.app.app_config.common.parameters_mapping import get_parameters_from_feature_dict
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import (
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from fields.base import ResponseModel
from fields.message_fields import SuggestedQuestionsResponse
from graphon.graph_engine.manager import GraphEngineManager
from graphon.model_runtime.errors.invoke import InvokeError
from libs import helper
from libs.helper import dump_response, to_timestamp, uuid_value
from models import Account
from models.account import TenantStatus
from models.model import AppMode, Site
from models.workflow import Workflow
from services.app_generate_service import AppGenerateService
from services.app_ref_service import AppRefService
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


class WorkflowRunRequest(BaseModel):
    inputs: dict
    files: list | None = Field(default=None)


class ChatRequest(BaseModel):
    inputs: dict
    query: str
    files: list | None = Field(default=None)
    conversation_id: str | None = None
    parent_message_id: str | None = None
    retriever_from: str = "explore_app"


class TextToSpeechRequest(BaseModel):
    message_id: str | None = None
    voice: str | None = None
    text: str | None = None
    streaming: bool | None = None


class CompletionRequest(BaseModel):
    inputs: dict
    query: str = ""
    files: list | None = Field(default=None)
    response_mode: Literal["blocking", "streaming"] | None = None
    retriever_from: str = "explore_app"


class TrialDatasetListQuery(BaseModel):
    page: int = Field(default=1, ge=1, description="Page number")
    limit: int = Field(default=20, ge=1, description="Number of items per page")
    ids: list[str] = Field(default_factory=list, description="Dataset IDs")


type TrialAppMode = Literal["chat", "agent-chat", "advanced-chat", "workflow", "completion"]
type TrialIconType = Literal["emoji", "image", "link"]
type JsonObject = dict[str, Any]


class TrialAppModel(ResponseModel):
    provider: str
    name: str
    mode: str | None = None
    completion_params: JsonObject = Field(default_factory=dict)


class TrialAppAgentMode(ResponseModel):
    enabled: bool | None = None
    strategy: str | None = None
    tools: list[JsonObject] = Field(default_factory=list)


class TrialAppModelConfigResponse(ResponseModel):
    opening_statement: str | None = None
    suggested_questions: list[str] = Field(
        default_factory=list,
        validation_alias=AliasChoices("suggested_questions_list", "suggested_questions"),
    )
    suggested_questions_after_answer: JsonObject | None = Field(
        default=None,
        validation_alias=AliasChoices("suggested_questions_after_answer_dict", "suggested_questions_after_answer"),
    )
    speech_to_text: JsonObject | None = Field(
        default=None, validation_alias=AliasChoices("speech_to_text_dict", "speech_to_text")
    )
    text_to_speech: JsonObject | None = Field(
        default=None, validation_alias=AliasChoices("text_to_speech_dict", "text_to_speech")
    )
    retriever_resource: JsonObject | None = Field(
        default=None, validation_alias=AliasChoices("retriever_resource_dict", "retriever_resource")
    )
    annotation_reply: JsonObject | None = Field(
        default=None, validation_alias=AliasChoices("annotation_reply_dict", "annotation_reply")
    )
    more_like_this: JsonObject | None = Field(
        default=None, validation_alias=AliasChoices("more_like_this_dict", "more_like_this")
    )
    sensitive_word_avoidance: JsonObject | None = Field(
        default=None, validation_alias=AliasChoices("sensitive_word_avoidance_dict", "sensitive_word_avoidance")
    )
    external_data_tools: list[JsonObject] = Field(
        default_factory=list, validation_alias=AliasChoices("external_data_tools_list", "external_data_tools")
    )
    model: TrialAppModel | None = Field(default=None, validation_alias=AliasChoices("model_dict", "model"))
    user_input_form: list[JsonObject] = Field(
        default_factory=list, validation_alias=AliasChoices("user_input_form_list", "user_input_form")
    )
    dataset_query_variable: str | None = None
    pre_prompt: str | None = None
    agent_mode: TrialAppAgentMode | None = Field(
        default=None,
        validation_alias=AliasChoices("agent_mode_dict", "agent_mode"),
    )
    prompt_type: str | None = None
    chat_prompt_config: JsonObject | None = Field(
        default=None, validation_alias=AliasChoices("chat_prompt_config_dict", "chat_prompt_config")
    )
    completion_prompt_config: JsonObject | None = Field(
        default=None, validation_alias=AliasChoices("completion_prompt_config_dict", "completion_prompt_config")
    )
    dataset_configs: JsonObject | None = Field(
        default=None,
        validation_alias=AliasChoices("dataset_configs_dict", "dataset_configs"),
    )
    file_upload: JsonObject | None = Field(
        default=None,
        validation_alias=AliasChoices("file_upload_dict", "file_upload"),
    )
    created_by: str | None = None
    created_at: int | None = None
    updated_by: str | None = None
    updated_at: int | None = None

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class TrialDeletedToolResponse(ResponseModel):
    type: str
    tool_name: str
    provider_id: str


class TrialTagResponse(ResponseModel):
    id: str
    name: str
    type: str


class TrialSiteResponse(ResponseModel):
    access_token: str | None = Field(default=None, validation_alias="code")
    code: str | None = None
    title: str
    icon_type: TrialIconType | None = None
    icon: str | None = None
    icon_background: str | None = None
    description: str | None = None
    default_language: str
    chat_color_theme: str | None = None
    chat_color_theme_inverted: bool | None = None
    customize_domain: str | None = None
    copyright: str | None = None
    privacy_policy: str | None = None
    input_placeholder: str | None = None
    custom_disclaimer: str | None = None
    customize_token_strategy: str | None = None
    prompt_public: bool | None = None
    app_base_url: str | None = None
    show_workflow_steps: bool | None = None
    use_icon_as_answer_icon: bool | None = None
    created_by: str | None = None
    created_at: int | None = None
    updated_by: str | None = None
    updated_at: int | None = None
    icon_url: str | None = None

    @field_validator("icon_type", mode="before")
    @classmethod
    def _normalize_icon_type(cls, value: Any) -> str | None:
        if hasattr(value, "value"):
            return value.value
        return value

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class TrialWorkflowPartialResponse(ResponseModel):
    id: str
    created_by: str | None = None
    created_at: int | None = None
    updated_by: str | None = None
    updated_at: int | None = None

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class TrialAppDetailResponse(ResponseModel):
    id: str
    name: str
    description: str | None = None
    mode: TrialAppMode = Field(validation_alias="mode_compatible_with_agent")
    icon_type: TrialIconType | None = None
    icon: str | None = None
    icon_background: str | None = None
    icon_url: str | None = None
    enable_site: bool
    enable_api: bool
    model_config_: TrialAppModelConfigResponse | None = Field(
        default=None,
        validation_alias=AliasChoices("app_model_config", "model_config"),
        alias="model_config",
    )
    workflow: TrialWorkflowPartialResponse | None = None
    api_base_url: str | None = None
    use_icon_as_answer_icon: bool | None = None
    max_active_requests: int | None = None
    created_by: str | None = None
    created_at: int | None = None
    updated_by: str | None = None
    updated_at: int | None = None
    deleted_tools: list[TrialDeletedToolResponse] = Field(default_factory=list)
    access_mode: str | None = None
    tags: list[TrialTagResponse] = Field(default_factory=list)
    permission_keys: list[str] = Field(default_factory=list)
    site: TrialSiteResponse

    @field_validator("icon_type", mode="before")
    @classmethod
    def _normalize_icon_type(cls, value: Any) -> str | None:
        if hasattr(value, "value"):
            return value.value
        return value

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class TrialDatasetResponse(ResponseModel):
    id: str
    name: str
    description: str | None = None
    permission: str | None = None
    data_source_type: str | None = None
    indexing_technique: str | None = None
    created_by: str | None = None
    created_at: int | None = None
    permission_keys: list[str] = Field(default_factory=list)


class TrialDatasetListResponse(ResponseModel):
    data: list[TrialDatasetResponse]
    has_more: bool
    limit: int
    total: int
    page: int


class TrialWorkflowAccount(ResponseModel):
    id: str
    name: str | None = None
    email: str | None = None


class TrialWorkflowResponse(ResponseModel):
    id: str
    graph: JsonObject = Field(validation_alias=AliasChoices("graph_dict", "graph"))
    features: JsonObject = Field(default_factory=dict, validation_alias=AliasChoices("features_dict", "features"))
    hash: str | None = Field(default=None, validation_alias=AliasChoices("unique_hash", "hash"))
    version: str | None = None
    marked_name: str | None = None
    marked_comment: str | None = None
    created_by: TrialWorkflowAccount | None = Field(
        default=None,
        validation_alias=AliasChoices("created_by_account", "created_by"),
    )
    created_at: int | None = None
    updated_by: TrialWorkflowAccount | None = Field(
        default=None,
        validation_alias=AliasChoices("updated_by_account", "updated_by"),
    )
    updated_at: int | None = None
    tool_published: bool | None = None
    environment_variables: list[JsonObject] = Field(default_factory=list)
    conversation_variables: list[JsonObject] = Field(default_factory=list)
    rag_pipeline_variables: list[JsonObject] = Field(default_factory=list)

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


register_schema_models(
    console_ns,
    WorkflowRunRequest,
    ChatRequest,
    TextToSpeechRequest,
    CompletionRequest,
    TrialDatasetListQuery,
)
register_response_schema_models(
    console_ns,
    ParametersResponse,
    AudioBinaryResponse,
    AudioTranscriptResponse,
    GeneratedAppResponse,
    SimpleResultResponse,
    SiteResponse,
    SuggestedQuestionsResponse,
    TrialAppDetailResponse,
    TrialDatasetListResponse,
    TrialWorkflowResponse,
)


class TrialAppWorkflowRunApi(TrialAppResource):
    @trial_feature_enable
    @console_ns.expect(console_ns.models[WorkflowRunRequest.__name__])
    @console_ns.response(200, "Success", console_ns.models[GeneratedAppResponse.__name__])
    @with_current_user
    def post(self, current_user: Account, trial_app):
        """
        Run workflow
        """
        app_model = trial_app
        if not app_model:
            raise NotWorkflowAppError()
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode != AppMode.WORKFLOW:
            raise NotWorkflowAppError()

        request_data = WorkflowRunRequest.model_validate(console_ns.payload)
        args = request_data.model_dump()
        try:
            app_id = app_model.id
            user_id = current_user.id
            response = AppGenerateService.generate(
                app_model=app_model, user=current_user, args=args, invoke_from=InvokeFrom.EXPLORE, streaming=True
            )
            RecommendedAppService.add_trial_app_record(db.session, app_id, user_id)
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
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @trial_feature_enable
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

        # Stop using both mechanisms for backward compatibility
        # Legacy stop flag mechanism (without user check)
        AppQueueManager.set_stop_flag_no_user_check(task_id)

        # New graph engine command channel mechanism
        GraphEngineManager(redis_client).send_stop_command(task_id)

        return {"result": "success"}


class TrialChatApi(TrialAppResource):
    @console_ns.expect(console_ns.models[ChatRequest.__name__])
    @console_ns.response(200, "Success", console_ns.models[GeneratedAppResponse.__name__])
    @trial_feature_enable
    @with_current_user
    def post(self, current_user: Account, trial_app):
        app_model = trial_app
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        request_data = ChatRequest.model_validate(console_ns.payload)
        args = request_data.model_dump()

        # Validate UUID values if provided
        if args.get("conversation_id"):
            args["conversation_id"] = uuid_value(args["conversation_id"])
        if args.get("parent_message_id"):
            args["parent_message_id"] = uuid_value(args["parent_message_id"])

        args["auto_generate_name"] = False

        try:
            # Get IDs before they might be detached from session
            app_id = app_model.id
            user_id = current_user.id

            response = AppGenerateService.generate(
                app_model=app_model, user=current_user, args=args, invoke_from=InvokeFrom.EXPLORE, streaming=True
            )
            RecommendedAppService.add_trial_app_record(db.session, app_id, user_id)
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
    @console_ns.response(200, "Success", console_ns.models[SuggestedQuestionsResponse.__name__])
    @with_current_user
    def get(self, current_user: Account, trial_app, message_id):
        app_model = trial_app
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


class TrialChatAudioApi(TrialAppResource):
    @console_ns.response(200, "Success", console_ns.models[AudioTranscriptResponse.__name__])
    @trial_feature_enable
    @with_current_user
    def post(self, current_user: Account, trial_app):
        app_model = trial_app

        file = request.files["file"]

        try:
            # Get IDs before they might be detached from session
            app_id = app_model.id
            user_id = current_user.id

            response = AudioService.transcript_asr(app_model=app_model, file=file, end_user=None)
            RecommendedAppService.add_trial_app_record(db.session, app_id, user_id)
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
    @console_ns.expect(console_ns.models[TextToSpeechRequest.__name__])
    @console_ns.response(200, "Success", console_ns.models[AudioBinaryResponse.__name__])
    @trial_feature_enable
    @with_current_user
    def post(self, current_user: Account, trial_app):
        app_model = trial_app
        try:
            request_data = TextToSpeechRequest.model_validate(console_ns.payload)

            message_id = request_data.message_id
            text = request_data.text
            voice = request_data.voice
            message_ref = None
            if message_id:
                app_ref = AppRefService.create_app_ref(app_model)
                message_ref = AppRefService.create_message_ref(
                    app_ref,
                    message_id,
                    account_id=current_user.id,
                )

            # Get IDs before they might be detached from session
            app_id = app_model.id
            user_id = current_user.id

            response = AudioService.transcript_tts(
                app_model=app_model,
                session=db.session,
                text=text,
                voice=voice,
                message_ref=message_ref,
            )
            RecommendedAppService.add_trial_app_record(db.session, app_id, user_id)
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
    @console_ns.expect(console_ns.models[CompletionRequest.__name__])
    @console_ns.response(200, "Success", console_ns.models[GeneratedAppResponse.__name__])
    @trial_feature_enable
    @with_current_user
    def post(self, current_user: Account, trial_app):
        app_model = trial_app
        if app_model.mode != "completion":
            raise NotCompletionAppError()

        request_data = CompletionRequest.model_validate(console_ns.payload)
        args = request_data.model_dump()

        streaming = args["response_mode"] == "streaming"
        args["auto_generate_name"] = False

        try:
            # Get IDs before they might be detached from session
            app_id = app_model.id
            user_id = current_user.id

            response = AppGenerateService.generate(
                app_model=app_model, user=current_user, args=args, invoke_from=InvokeFrom.EXPLORE, streaming=streaming
            )

            RecommendedAppService.add_trial_app_record(db.session, app_id, user_id)
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

    @console_ns.response(200, "Success", console_ns.models[SiteResponse.__name__])
    @get_app_model_with_trial(None)
    def get(self, app_model):
        """Retrieve app site info.

        Returns the site configuration for the application including theme, icons, and text.
        """
        site = db.session.scalar(select(Site).where(Site.app_id == app_model.id).limit(1))

        if not site:
            raise Forbidden()

        assert app_model.tenant
        if app_model.tenant.status == TenantStatus.ARCHIVE:
            raise Forbidden()

        return SiteResponse.model_validate(site).model_dump(mode="json")


class TrialAppParameterApi(Resource):
    """Resource for app variables."""

    @console_ns.response(200, "Success", console_ns.models[ParametersResponse.__name__])
    @get_app_model_with_trial(None)
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
    @console_ns.response(200, "Success", console_ns.models[TrialAppDetailResponse.__name__])
    @get_app_model_with_trial(None)
    def get(self, app_model):
        """Get app detail"""

        app_service = AppService()
        app_model = app_service.get_app(app_model)

        return dump_response(TrialAppDetailResponse, app_model)


class AppWorkflowApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[TrialWorkflowResponse.__name__])
    @get_app_model_with_trial(None)
    def get(self, app_model):
        """Get workflow detail"""
        if not app_model.workflow_id:
            raise AppUnavailableError()

        workflow = db.session.get(Workflow, app_model.workflow_id)
        if workflow is None:
            raise AppUnavailableError()

        return dump_response(TrialWorkflowResponse, workflow)


class DatasetListApi(Resource):
    @console_ns.doc(params=query_params_from_model(TrialDatasetListQuery))
    @console_ns.response(200, "Success", console_ns.models[TrialDatasetListResponse.__name__])
    @get_app_model_with_trial(None)
    def get(self, app_model):
        page = request.args.get("page", default=1, type=int)
        limit = request.args.get("limit", default=20, type=int)
        ids = request.args.getlist("ids")

        tenant_id = app_model.tenant_id
        if ids:
            datasets, total = DatasetService.get_datasets_by_ids(ids, tenant_id)
        else:
            raise NeedAddIdsError()

        response = {"data": datasets, "has_more": len(datasets) == limit, "limit": limit, "total": total, "page": page}
        return dump_response(TrialDatasetListResponse, response)


console_ns.add_resource(TrialChatApi, "/trial-apps/<uuid:app_id>/chat-messages", endpoint="trial_app_chat_completion")

console_ns.add_resource(
    TrialMessageSuggestedQuestionApi,
    "/trial-apps/<uuid:app_id>/messages/<uuid:message_id>/suggested-questions",
    endpoint="trial_app_suggested_question",
)

console_ns.add_resource(TrialChatAudioApi, "/trial-apps/<uuid:app_id>/audio-to-text", endpoint="trial_app_audio")
console_ns.add_resource(TrialChatTextApi, "/trial-apps/<uuid:app_id>/text-to-audio", endpoint="trial_app_text")

console_ns.add_resource(
    TrialCompletionApi, "/trial-apps/<uuid:app_id>/completion-messages", endpoint="trial_app_completion"
)

console_ns.add_resource(TrialSitApi, "/trial-apps/<uuid:app_id>/site")

console_ns.add_resource(TrialAppParameterApi, "/trial-apps/<uuid:app_id>/parameters", endpoint="trial_app_parameters")

console_ns.add_resource(AppApi, "/trial-apps/<uuid:app_id>", endpoint="trial_app")

console_ns.add_resource(
    TrialAppWorkflowRunApi, "/trial-apps/<uuid:app_id>/workflows/run", endpoint="trial_app_workflow_run"
)
console_ns.add_resource(TrialAppWorkflowTaskStopApi, "/trial-apps/<uuid:app_id>/workflows/tasks/<string:task_id>/stop")

console_ns.add_resource(AppWorkflowApi, "/trial-apps/<uuid:app_id>/workflows", endpoint="trial_app_workflow")
console_ns.add_resource(DatasetListApi, "/trial-apps/<uuid:app_id>/datasets", endpoint="trial_app_datasets")
