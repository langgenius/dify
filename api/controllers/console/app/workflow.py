import json
import logging
from typing import Any, Literal, Self
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field, RootModel, ValidationError, field_validator, model_validator

import services.errors.conversation
from controllers.common.controller_schemas import DefaultBlockConfigQuery, WorkflowListQuery, WorkflowUpdatePayload
from controllers.common.errors import (
    InternalServerError,
    InvalidArgumentError,
    InvalidRequestError,
    NotFoundError,
    UnsupportedMediaTypeError,
)
from controllers.common.fields import GeneratedAppResponse, NewAppResponse, SimpleResultResponse
from controllers.common.schema import (
    query_params_from_model,
    register_response_schema_model,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console import console_ns
from controllers.console.app.error import ConversationCompletedError, DraftWorkflowNotSync
from controllers.console.app.workflow_admission import console_workflow_admission
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import RBACPermission, model_validate
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from core.helper.trace_id_helper import get_external_trace_id
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from fields.conversation_variable_fields import WorkflowConversationVariableResponse
from fields.workflow_fields import (
    DefaultBlockConfigResponse,
    DefaultBlockConfigsResponse,
    PipelineVariableResponse,
    WorkflowEnvironmentVariableResponse,
    WorkflowPaginationResponse,
    WorkflowPublishResponse,
    WorkflowResponse,
    WorkflowRestoreResponse,
)
from fields.workflow_run_fields import WorkflowRunNodeExecutionResponse
from graphon.model_runtime.utils.encoders import jsonable_encoder
from graphon.variables.exc import VariableError
from libs import helper
from libs.helper import TimestampField, dump_response, uuid_value
from machinery.context import RequestContext
from models.model import AppMode
from services.errors.app import IsDraftWorkflowError, WorkflowHashNotEqualError, WorkflowNotFoundError
from services.errors.workflow_service import DraftWorkflowDeletionError, WorkflowInUseError
from services.workflow.contracts import (
    RESTORE_SOURCE_WORKFLOW_MUST_BE_PUBLISHED_MESSAGE,
    DraftSyncCommand,
    WorkflowOwner,
    WorkflowTriggerError,
)

logger = logging.getLogger(__name__)
LISTENING_RETRY_IN = 2000

from services.errors.llm import InvokeRateLimitError


class SyncEnvironmentVariablePatchPayload(BaseModel):
    environment_variables: list[dict[str, Any]] = Field(default_factory=list)
    deleted_environment_variable_ids: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_patch(self) -> Self:
        """Require stable, disjoint IDs so the service can merge the patch deterministically."""
        upsert_ids = [variable.get("id") for variable in self.environment_variables]
        if any(not isinstance(variable_id, str) or not variable_id for variable_id in upsert_ids):
            raise ValueError("patched environment variables require an id")
        if len(set(upsert_ids)) != len(upsert_ids):
            raise ValueError("patched environment variable ids must be unique")
        if any(not variable_id for variable_id in self.deleted_environment_variable_ids):
            raise ValueError("deleted environment variable ids must not be empty")
        if len(set(self.deleted_environment_variable_ids)) != len(self.deleted_environment_variable_ids):
            raise ValueError("deleted environment variable ids must be unique")
        if set(upsert_ids).intersection(self.deleted_environment_variable_ids):
            raise ValueError("an environment variable cannot be upserted and deleted in the same patch")
        return self


class SyncDraftWorkflowPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    graph: dict[str, Any]
    features: dict[str, Any]
    hash: str | None = None
    is_collaborative: bool = Field(default=False, alias="_is_collaborative")
    environment_variable_patch: SyncEnvironmentVariablePatchPayload | None = None
    conversation_variables: list[dict[str, Any]] = Field(
        default_factory=list,
    )


class BaseWorkflowRunPayload(BaseModel):
    files: list[dict[str, Any]] | None = Field(default=None)


class AdvancedChatWorkflowRunPayload(BaseWorkflowRunPayload):
    inputs: dict[str, Any] | None = Field(default=None)
    query: str = ""
    conversation_id: str | None = None
    parent_message_id: str | None = None

    @field_validator("conversation_id", "parent_message_id")
    @classmethod
    def validate_uuid(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return uuid_value(value)


class IterationNodeRunPayload(BaseModel):
    inputs: dict[str, Any] | None = Field(default=None)


class LoopNodeRunPayload(BaseModel):
    inputs: dict[str, Any] | None = Field(default=None)


class DraftWorkflowRunPayload(BaseWorkflowRunPayload):
    inputs: dict[str, Any]


class DraftWorkflowNodeRunPayload(BaseWorkflowRunPayload):
    inputs: dict[str, Any]
    query: str = ""


class PublishWorkflowPayload(BaseModel):
    marked_name: str | None = Field(default=None, max_length=20)
    marked_comment: str | None = Field(default=None, max_length=100)


class ConvertToWorkflowPayload(BaseModel):
    name: str | None = None
    icon_type: str | None = None
    icon: str | None = None
    icon_background: str | None = None


class WorkflowFeatureTogglePayload(BaseModel):
    model_config = ConfigDict(extra="allow")

    enabled: bool | None = None


class WorkflowSuggestedQuestionsAfterAnswerPayload(WorkflowFeatureTogglePayload):
    model: dict[str, Any] | None = None
    prompt: str | None = None


class WorkflowTextToSpeechPayload(WorkflowFeatureTogglePayload):
    language: str | None = None
    voice: str | None = None
    autoPlay: Literal["enabled", "disabled"] | None = None


class WorkflowSensitiveWordAvoidancePayload(WorkflowFeatureTogglePayload):
    type: str | None = None
    config: dict[str, Any] | None = None


class WorkflowFileUploadTransferPayload(WorkflowFeatureTogglePayload):
    number_limits: int | None = None
    transfer_methods: list[str] | None = None


class WorkflowFileUploadImagePayload(WorkflowFileUploadTransferPayload):
    detail: str | None = None


class WorkflowFileUploadPreviewConfigPayload(BaseModel):
    mode: str | None = None
    file_type_list: list[str] | None = None


class WorkflowFileUploadPayload(WorkflowFeatureTogglePayload):
    allowed_file_types: list[str] | None = None
    allowed_file_extensions: list[str] | None = None
    allowed_file_upload_methods: list[str] | None = None
    number_limits: int | None = None
    image: WorkflowFileUploadImagePayload | None = None
    document: WorkflowFileUploadTransferPayload | None = None
    audio: WorkflowFileUploadTransferPayload | None = None
    video: WorkflowFileUploadTransferPayload | None = None
    custom: WorkflowFileUploadTransferPayload | None = None
    preview_config: WorkflowFileUploadPreviewConfigPayload | None = None
    fileUploadConfig: dict[str, Any] | None = None


class WorkflowFeaturesConfigPayload(BaseModel):
    model_config = ConfigDict(extra="allow")

    opening_statement: str | None = None
    suggested_questions: list[str] | None = None
    suggested_questions_after_answer: WorkflowSuggestedQuestionsAfterAnswerPayload | None = None
    text_to_speech: WorkflowTextToSpeechPayload | None = None
    speech_to_text: WorkflowFeatureTogglePayload | None = None
    retriever_resource: WorkflowFeatureTogglePayload | None = None
    sensitive_word_avoidance: WorkflowSensitiveWordAvoidancePayload | None = None
    file_upload: WorkflowFileUploadPayload | None = None


class WorkflowFeaturesPayload(BaseModel):
    features: WorkflowFeaturesConfigPayload = Field(
        ...,
        description="Workflow feature configuration",
    )


class WorkflowOnlineUsersPayload(BaseModel):
    app_ids: list[str] = Field(default_factory=list, description="App IDs")

    @field_validator("app_ids")
    @classmethod
    def normalize_app_ids(cls, app_ids: list[str]) -> list[str]:
        return list(dict.fromkeys(app_id.strip() for app_id in app_ids if app_id.strip()))


class WorkflowOnlineUser(ResponseModel):
    user_id: str
    username: str
    avatar: str | None = None


class WorkflowOnlineUsersByApp(ResponseModel):
    app_id: str
    users: list[WorkflowOnlineUser]


class WorkflowOnlineUsersResponse(ResponseModel):
    data: list[WorkflowOnlineUsersByApp]


class SyncDraftWorkflowResponse(ResponseModel):
    result: str
    hash: str
    updated_at: int


class HumanInputFormPreviewResponse(ResponseModel):
    form_id: str
    node_id: str
    node_title: str
    form_content: str
    inputs: list[dict[str, Any]] = Field(default_factory=list)
    actions: list[dict[str, Any]] = Field(default_factory=list)
    display_in_ui: bool | None = None
    form_token: str | None = None
    resolved_default_values: dict[str, Any] = Field(default_factory=dict)
    expiration_time: int | None = None


class HumanInputFormSubmitResponse(RootModel[dict[str, Any]]):
    root: dict[str, Any]


class EmptyObjectResponse(RootModel[dict[str, Any]]):
    root: dict[str, Any]


class DraftWorkflowTriggerRunPayload(BaseModel):
    node_id: str


class DraftWorkflowTriggerRunAllPayload(BaseModel):
    node_ids: list[str]


register_schema_models(
    console_ns,
    SyncDraftWorkflowPayload,
    AdvancedChatWorkflowRunPayload,
    IterationNodeRunPayload,
    LoopNodeRunPayload,
    DraftWorkflowRunPayload,
    DraftWorkflowNodeRunPayload,
    PublishWorkflowPayload,
    DefaultBlockConfigQuery,
    ConvertToWorkflowPayload,
    WorkflowListQuery,
    WorkflowUpdatePayload,
    WorkflowFeatureTogglePayload,
    WorkflowSuggestedQuestionsAfterAnswerPayload,
    WorkflowTextToSpeechPayload,
    WorkflowSensitiveWordAvoidancePayload,
    WorkflowFileUploadTransferPayload,
    WorkflowFileUploadImagePayload,
    WorkflowFileUploadPreviewConfigPayload,
    WorkflowFileUploadPayload,
    WorkflowFeaturesConfigPayload,
    WorkflowFeaturesPayload,
    WorkflowOnlineUsersPayload,
    DraftWorkflowTriggerRunPayload,
    DraftWorkflowTriggerRunAllPayload,
)


register_response_schema_model(console_ns, WorkflowRunNodeExecutionResponse)


register_response_schema_models(
    console_ns,
    WorkflowConversationVariableResponse,
    PipelineVariableResponse,
    WorkflowEnvironmentVariableResponse,
    WorkflowResponse,
    WorkflowPaginationResponse,
    WorkflowOnlineUser,
    WorkflowOnlineUsersByApp,
    WorkflowOnlineUsersResponse,
    WorkflowPublishResponse,
    SyncDraftWorkflowResponse,
    WorkflowRestoreResponse,
    DefaultBlockConfigsResponse,
    DefaultBlockConfigResponse,
    HumanInputFormPreviewResponse,
    HumanInputFormSubmitResponse,
    EmptyObjectResponse,
    GeneratedAppResponse,
    NewAppResponse,
    SimpleResultResponse,
)


@console_ns.route("/apps/<uuid:app_id>/workflows/draft")
class DraftWorkflowApi(Resource):
    @console_ns.doc("get_draft_workflow")
    @console_ns.doc(description="Get draft workflow for an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(
        200,
        "Draft workflow retrieved successfully",
        console_ns.models[WorkflowResponse.__name__],
    )
    @console_ns.response(404, "Draft workflow not found")
    @console_workflow_admission(permission=RBACPermission.APP_VIEW_LAYOUT)
    def get(self, request_context: RequestContext, app_id: UUID):
        return dump_response(
            WorkflowResponse, application_services().console_workflows.draft(request_context, str(app_id))
        )

    @console_ns.doc("sync_draft_workflow")
    @console_ns.doc(description="Sync draft workflow configuration")
    @console_ns.expect(console_ns.models[SyncDraftWorkflowPayload.__name__])
    @console_ns.response(
        200,
        "Draft workflow synced successfully",
        console_ns.models[SyncDraftWorkflowResponse.__name__],
    )
    @console_ns.response(400, "Invalid workflow configuration")
    @console_ns.response(403, "Permission denied")
    @console_workflow_admission(permission=RBACPermission.APP_VIEW_LAYOUT)
    def post(self, request_context: RequestContext, app_id: UUID):
        content_type = request.headers.get("Content-Type", "")
        if "application/json" in content_type:
            payload_data = request.get_json(silent=True)
            if not isinstance(payload_data, dict):
                return {"message": "Invalid JSON data"}, 400
            args_model = SyncDraftWorkflowPayload.model_validate(payload_data)
        elif "text/plain" in content_type:
            try:
                args_model = SyncDraftWorkflowPayload.model_validate_json(request.data)
            except (ValueError, ValidationError):
                return {"message": "Invalid JSON data"}, 400
        else:
            raise UnsupportedMediaTypeError()
        patch = args_model.environment_variable_patch
        try:
            result = application_services().console_workflows.sync(
                request_context,
                str(app_id),
                DraftSyncCommand(
                    graph=args_model.graph,
                    features=args_model.features,
                    unique_hash=args_model.hash,
                    is_collaborative=args_model.is_collaborative,
                    environment_upserts=patch.environment_variables if patch is not None else None,
                    environment_deletions=patch.deleted_environment_variable_ids if patch is not None else [],
                    conversation_variables=args_model.conversation_variables,
                ),
            )
        except WorkflowHashNotEqualError as error:
            raise DraftWorkflowNotSync() from error
        except VariableError as error:
            raise InvalidArgumentError(description=str(error)) from error
        return dump_response(
            SyncDraftWorkflowResponse,
            {
                "result": "success",
                "hash": result.hash,
                "updated_at": TimestampField().format(result.updated_at),
            },
        )


@console_ns.route("/apps/<uuid:app_id>/advanced-chat/workflows/draft/run")
class AdvancedChatDraftWorkflowRunApi(Resource):
    @console_ns.doc("run_advanced_chat_draft_workflow")
    @console_ns.doc(description="Run draft workflow for advanced chat application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[AdvancedChatWorkflowRunPayload.__name__])
    @console_ns.response(200, "Workflow run started successfully", console_ns.models[GeneratedAppResponse.__name__])
    @console_ns.response(400, "Invalid request parameters")
    @console_ns.response(403, "Permission denied")
    @console_workflow_admission(permission=RBACPermission.APP_TEST_AND_RUN, modes=(AppMode.ADVANCED_CHAT,))
    @model_validate(AdvancedChatWorkflowRunPayload)
    def post(self, payload: AdvancedChatWorkflowRunPayload, request_context: RequestContext, app_id: UUID):
        args = payload.model_dump(exclude_none=True)
        external_trace_id = get_external_trace_id(request)
        if external_trace_id:
            args["external_trace_id"] = external_trace_id
        try:
            result = application_services().console_workflows.generate(request_context, str(app_id), args)
            return helper.compact_generate_response(result)
        except services.errors.conversation.ConversationNotExistsError as error:
            raise NotFoundError("Conversation Not Exists.") from error
        except services.errors.conversation.ConversationCompletedError as error:
            raise ConversationCompletedError() from error
        except InvokeRateLimitError as error:
            raise InvokeRateLimitHttpError(error.description) from error
        except ValueError:
            raise
        except Exception as error:
            logger.exception("internal server error.")
            raise InternalServerError() from error


@console_ns.route("/apps/<uuid:app_id>/advanced-chat/workflows/draft/iteration/nodes/<string:node_id>/run")
class AdvancedChatDraftRunIterationNodeApi(Resource):
    @console_ns.doc("run_advanced_chat_draft_iteration_node")
    @console_ns.doc(description="Run draft workflow iteration node for advanced chat")
    @console_ns.doc(params={"app_id": "Application ID", "node_id": "Node ID"})
    @console_ns.expect(console_ns.models[IterationNodeRunPayload.__name__])
    @console_ns.response(
        200,
        "Iteration node run started successfully",
        console_ns.models[GeneratedAppResponse.__name__],
    )
    @console_ns.response(403, "Permission denied")
    @console_ns.response(404, "Node not found")
    @console_workflow_admission(permission=RBACPermission.APP_TEST_AND_RUN, modes=(AppMode.ADVANCED_CHAT,))
    @model_validate(IterationNodeRunPayload)
    def post(self, payload: IterationNodeRunPayload, request_context: RequestContext, app_id: UUID, node_id: str):
        try:
            result = application_services().console_workflows.iteration(
                request_context, str(app_id), node_id, payload.inputs
            )
            return helper.compact_generate_response(result)
        except services.errors.conversation.ConversationNotExistsError as error:
            raise NotFoundError("Conversation Not Exists.") from error
        except services.errors.conversation.ConversationCompletedError as error:
            raise ConversationCompletedError() from error
        except ValueError:
            raise
        except Exception as error:
            logger.exception("internal server error.")
            raise InternalServerError() from error


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/iteration/nodes/<string:node_id>/run")
class WorkflowDraftRunIterationNodeApi(Resource):
    @console_ns.doc("run_workflow_draft_iteration_node")
    @console_ns.doc(description="Run draft workflow iteration node")
    @console_ns.doc(params={"app_id": "Application ID", "node_id": "Node ID"})
    @console_ns.expect(console_ns.models[IterationNodeRunPayload.__name__])
    @console_ns.response(
        200,
        "Workflow iteration node run started successfully",
        console_ns.models[GeneratedAppResponse.__name__],
    )
    @console_ns.response(403, "Permission denied")
    @console_ns.response(404, "Node not found")
    @console_workflow_admission(permission=RBACPermission.APP_TEST_AND_RUN, modes=(AppMode.WORKFLOW,))
    @model_validate(IterationNodeRunPayload)
    def post(self, payload: IterationNodeRunPayload, request_context: RequestContext, app_id: UUID, node_id: str):
        try:
            result = application_services().console_workflows.iteration(
                request_context, str(app_id), node_id, payload.inputs
            )
            return helper.compact_generate_response(result)
        except services.errors.conversation.ConversationNotExistsError as error:
            raise NotFoundError("Conversation Not Exists.") from error
        except services.errors.conversation.ConversationCompletedError as error:
            raise ConversationCompletedError() from error
        except ValueError:
            raise
        except Exception as error:
            logger.exception("internal server error.")
            raise InternalServerError() from error


@console_ns.route("/apps/<uuid:app_id>/advanced-chat/workflows/draft/loop/nodes/<string:node_id>/run")
class AdvancedChatDraftRunLoopNodeApi(Resource):
    @console_ns.doc("run_advanced_chat_draft_loop_node")
    @console_ns.doc(description="Run draft workflow loop node for advanced chat")
    @console_ns.doc(params={"app_id": "Application ID", "node_id": "Node ID"})
    @console_ns.expect(console_ns.models[LoopNodeRunPayload.__name__])
    @console_ns.response(200, "Loop node run started successfully", console_ns.models[GeneratedAppResponse.__name__])
    @console_ns.response(403, "Permission denied")
    @console_ns.response(404, "Node not found")
    @console_workflow_admission(permission=RBACPermission.APP_TEST_AND_RUN, modes=(AppMode.ADVANCED_CHAT,))
    @model_validate(LoopNodeRunPayload)
    def post(self, payload: LoopNodeRunPayload, request_context: RequestContext, app_id: UUID, node_id: str):
        try:
            result = application_services().console_workflows.loop(
                request_context, str(app_id), node_id, payload.inputs
            )
            return helper.compact_generate_response(result)
        except services.errors.conversation.ConversationNotExistsError as error:
            raise NotFoundError("Conversation Not Exists.") from error
        except services.errors.conversation.ConversationCompletedError as error:
            raise ConversationCompletedError() from error
        except ValueError:
            raise
        except Exception as error:
            logger.exception("internal server error.")
            raise InternalServerError() from error


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/loop/nodes/<string:node_id>/run")
class WorkflowDraftRunLoopNodeApi(Resource):
    @console_ns.doc("run_workflow_draft_loop_node")
    @console_ns.doc(description="Run draft workflow loop node")
    @console_ns.doc(params={"app_id": "Application ID", "node_id": "Node ID"})
    @console_ns.expect(console_ns.models[LoopNodeRunPayload.__name__])
    @console_ns.response(
        200,
        "Workflow loop node run started successfully",
        console_ns.models[GeneratedAppResponse.__name__],
    )
    @console_ns.response(403, "Permission denied")
    @console_ns.response(404, "Node not found")
    @console_workflow_admission(permission=RBACPermission.APP_TEST_AND_RUN, modes=(AppMode.WORKFLOW,))
    @model_validate(LoopNodeRunPayload)
    def post(self, payload: LoopNodeRunPayload, request_context: RequestContext, app_id: UUID, node_id: str):
        try:
            result = application_services().console_workflows.loop(
                request_context, str(app_id), node_id, payload.inputs
            )
            return helper.compact_generate_response(result)
        except services.errors.conversation.ConversationNotExistsError as error:
            raise NotFoundError("Conversation Not Exists.") from error
        except services.errors.conversation.ConversationCompletedError as error:
            raise ConversationCompletedError() from error
        except ValueError:
            raise
        except Exception as error:
            logger.exception("internal server error.")
            raise InternalServerError() from error


class HumanInputFormPreviewPayload(BaseModel):
    inputs: dict[str, Any] = Field(
        default_factory=dict,
        description="Values used to fill missing upstream variables referenced in form_content",
    )


class HumanInputFormSubmitPayload(BaseModel):
    form_inputs: dict[str, Any] = Field(
        ...,
        description="Values the user provides for the form's own fields",
    )
    inputs: dict[str, Any] = Field(
        ...,
        description="Values used to fill missing upstream variables referenced in form_content",
    )
    action: str = Field(..., description="Selected action ID")


class HumanInputDeliveryTestPayload(BaseModel):
    delivery_method_id: str = Field(..., description="Delivery method ID")
    inputs: dict[str, Any] = Field(
        default_factory=dict,
        description="Values used to fill missing upstream variables referenced in form_content",
    )


register_schema_models(
    console_ns,
    HumanInputFormPreviewPayload,
    HumanInputFormSubmitPayload,
    HumanInputDeliveryTestPayload,
)


@console_ns.route("/apps/<uuid:app_id>/advanced-chat/workflows/draft/human-input/nodes/<string:node_id>/form/preview")
class AdvancedChatDraftHumanInputFormPreviewApi(Resource):
    @console_ns.doc("get_advanced_chat_draft_human_input_form")
    @console_ns.doc(description="Get human input form preview for advanced chat workflow")
    @console_ns.doc(params={"app_id": "Application ID", "node_id": "Node ID"})
    @console_ns.expect(console_ns.models[HumanInputFormPreviewPayload.__name__])
    @console_ns.response(200, "Human input form preview", console_ns.models[HumanInputFormPreviewResponse.__name__])
    @console_workflow_admission(permission=RBACPermission.APP_VIEW_LAYOUT, modes=(AppMode.ADVANCED_CHAT,))
    @model_validate(HumanInputFormPreviewPayload)
    def post(self, args: HumanInputFormPreviewPayload, request_context: RequestContext, app_id: UUID, node_id: str):
        return jsonable_encoder(
            application_services().human_input_debug.preview_form(request_context, str(app_id), node_id, args.inputs)
        )


@console_ns.route("/apps/<uuid:app_id>/advanced-chat/workflows/draft/human-input/nodes/<string:node_id>/form/run")
class AdvancedChatDraftHumanInputFormRunApi(Resource):
    @console_ns.doc("submit_advanced_chat_draft_human_input_form")
    @console_ns.doc(description="Submit human input form preview for advanced chat workflow")
    @console_ns.doc(params={"app_id": "Application ID", "node_id": "Node ID"})
    @console_ns.expect(console_ns.models[HumanInputFormSubmitPayload.__name__])
    @console_ns.response(
        200,
        "Human input form submission result",
        console_ns.models[HumanInputFormSubmitResponse.__name__],
    )
    @console_workflow_admission(permission=RBACPermission.APP_TEST_AND_RUN, modes=(AppMode.ADVANCED_CHAT,))
    @model_validate(HumanInputFormSubmitPayload)
    def post(self, args: HumanInputFormSubmitPayload, request_context: RequestContext, app_id: UUID, node_id: str):
        return jsonable_encoder(
            application_services().human_input_debug.submit_form(
                request_context,
                str(app_id),
                node_id,
                inputs=args.inputs,
                form_inputs=args.form_inputs,
                action=args.action,
            )
        )


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/human-input/nodes/<string:node_id>/form/preview")
class WorkflowDraftHumanInputFormPreviewApi(Resource):
    @console_ns.doc("get_workflow_draft_human_input_form")
    @console_ns.doc(description="Get human input form preview for workflow")
    @console_ns.doc(params={"app_id": "Application ID", "node_id": "Node ID"})
    @console_ns.expect(console_ns.models[HumanInputFormPreviewPayload.__name__])
    @console_ns.response(200, "Human input form preview", console_ns.models[HumanInputFormPreviewResponse.__name__])
    @console_workflow_admission(permission=RBACPermission.APP_VIEW_LAYOUT, modes=(AppMode.WORKFLOW,))
    @model_validate(HumanInputFormPreviewPayload)
    def post(self, args: HumanInputFormPreviewPayload, request_context: RequestContext, app_id: UUID, node_id: str):
        return jsonable_encoder(
            application_services().human_input_debug.preview_form(request_context, str(app_id), node_id, args.inputs)
        )


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/human-input/nodes/<string:node_id>/form/run")
class WorkflowDraftHumanInputFormRunApi(Resource):
    @console_ns.doc("submit_workflow_draft_human_input_form")
    @console_ns.doc(description="Submit human input form preview for workflow")
    @console_ns.doc(params={"app_id": "Application ID", "node_id": "Node ID"})
    @console_ns.expect(console_ns.models[HumanInputFormSubmitPayload.__name__])
    @console_ns.response(
        200,
        "Human input form submission result",
        console_ns.models[HumanInputFormSubmitResponse.__name__],
    )
    @console_workflow_admission(permission=RBACPermission.APP_TEST_AND_RUN, modes=(AppMode.WORKFLOW,))
    @model_validate(HumanInputFormSubmitPayload)
    def post(self, args: HumanInputFormSubmitPayload, request_context: RequestContext, app_id: UUID, node_id: str):
        return jsonable_encoder(
            application_services().human_input_debug.submit_form(
                request_context,
                str(app_id),
                node_id,
                inputs=args.inputs,
                form_inputs=args.form_inputs,
                action=args.action,
            )
        )


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/human-input/nodes/<string:node_id>/delivery-test")
class WorkflowDraftHumanInputDeliveryTestApi(Resource):
    @console_ns.doc("test_workflow_draft_human_input_delivery")
    @console_ns.doc(description="Test human input delivery for workflow")
    @console_ns.doc(params={"app_id": "Application ID", "node_id": "Node ID"})
    @console_ns.expect(console_ns.models[HumanInputDeliveryTestPayload.__name__])
    @console_ns.response(200, "Human input delivery test result", console_ns.models[EmptyObjectResponse.__name__])
    @console_workflow_admission(permission=RBACPermission.APP_TEST_AND_RUN)
    @model_validate(HumanInputDeliveryTestPayload)
    def post(self, args: HumanInputDeliveryTestPayload, request_context: RequestContext, app_id: UUID, node_id: str):
        application_services().human_input_debug.test_delivery(
            request_context,
            str(app_id),
            node_id,
            inputs=args.inputs,
            delivery_method_id=args.delivery_method_id,
        )
        return {}


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/run")
class DraftWorkflowRunApi(Resource):
    @console_ns.doc("run_draft_workflow")
    @console_ns.doc(description="Run draft workflow")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[DraftWorkflowRunPayload.__name__])
    @console_ns.response(
        200,
        "Draft workflow run started successfully",
        console_ns.models[GeneratedAppResponse.__name__],
    )
    @console_ns.response(403, "Permission denied")
    @console_workflow_admission(permission=RBACPermission.APP_TEST_AND_RUN, modes=(AppMode.WORKFLOW,))
    @model_validate(DraftWorkflowRunPayload)
    def post(self, payload: DraftWorkflowRunPayload, request_context: RequestContext, app_id: UUID):
        args = payload.model_dump(exclude_none=True)
        external_trace_id = get_external_trace_id(request)
        if external_trace_id:
            args["external_trace_id"] = external_trace_id
        try:
            result = application_services().console_workflows.generate(request_context, str(app_id), args)
            return helper.compact_generate_response(result)
        except InvokeRateLimitError as error:
            raise InvokeRateLimitHttpError(error.description) from error


@console_ns.route("/apps/<uuid:app_id>/workflow-runs/tasks/<string:task_id>/stop")
class WorkflowTaskStopApi(Resource):
    @console_ns.doc("stop_workflow_task")
    @console_ns.doc(description="Stop running workflow task")
    @console_ns.doc(params={"app_id": "Application ID", "task_id": "Task ID"})
    @console_ns.response(200, "Task stopped successfully", console_ns.models[SimpleResultResponse.__name__])
    @console_ns.response(404, "Task not found")
    @console_ns.response(403, "Permission denied")
    @console_workflow_admission(permission=RBACPermission.APP_TEST_AND_RUN)
    def post(self, request_context: RequestContext, app_id: UUID, task_id: str):
        application_services().console_workflows.stop(task_id)
        return {"result": "success"}


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/run")
class DraftWorkflowNodeRunApi(Resource):
    @console_ns.doc("run_draft_workflow_node")
    @console_ns.doc(description="Run draft workflow node")
    @console_ns.doc(params={"app_id": "Application ID", "node_id": "Node ID"})
    @console_ns.expect(console_ns.models[DraftWorkflowNodeRunPayload.__name__])
    @console_ns.response(
        200,
        "Node run started successfully",
        console_ns.models[WorkflowRunNodeExecutionResponse.__name__],
    )
    @console_ns.response(403, "Permission denied")
    @console_ns.response(404, "Node not found")
    @console_workflow_admission(permission=RBACPermission.APP_TEST_AND_RUN)
    @model_validate(DraftWorkflowNodeRunPayload)
    def post(self, payload: DraftWorkflowNodeRunPayload, request_context: RequestContext, app_id: UUID, node_id: str):
        return dump_response(
            WorkflowRunNodeExecutionResponse,
            application_services().console_workflows.run_node(
                request_context,
                str(app_id),
                node_id,
                payload.model_dump(exclude_none=True),
            ),
        )


@console_ns.route("/apps/<uuid:app_id>/workflows/publish")
class PublishedWorkflowApi(Resource):
    @console_ns.doc("get_published_workflow")
    @console_ns.doc(description="Get published workflow for an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(
        200,
        "Published workflow retrieved successfully, or null if not found",
        console_ns.models[WorkflowResponse.__name__],
    )
    @console_workflow_admission(permission=RBACPermission.APP_VIEW_LAYOUT)
    def get(self, request_context: RequestContext, app_id: UUID):
        result = application_services().console_workflows.published(request_context, str(app_id))
        return dump_response(WorkflowResponse, result) if result is not None else None

    @console_ns.expect(console_ns.models[PublishWorkflowPayload.__name__])
    @console_ns.response(200, "Workflow published successfully", console_ns.models[WorkflowPublishResponse.__name__])
    @console_workflow_admission(permission=RBACPermission.APP_RELEASE_AND_VERSION)
    @model_validate(PublishWorkflowPayload)
    def post(self, args: PublishWorkflowPayload, request_context: RequestContext, app_id: UUID):
        publication, warning = application_services().console_workflows.publish(
            request_context,
            str(app_id),
            marked_name=args.marked_name or "",
            marked_comment=args.marked_comment or "",
        )
        payload: dict[str, object] = {
            "result": "success",
            "created_at": TimestampField().format(publication.created_at),
        }
        if warning:
            payload["warning"] = warning
        return payload


@console_ns.route("/apps/<uuid:app_id>/workflows/default-workflow-block-configs")
class DefaultBlockConfigsApi(Resource):
    @console_ns.doc("get_default_block_configs")
    @console_ns.doc(description="Get default block configurations for workflow")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(
        200,
        "Default block configurations retrieved successfully",
        console_ns.models[DefaultBlockConfigsResponse.__name__],
    )
    @console_workflow_admission(permission=RBACPermission.APP_VIEW_LAYOUT)
    def get(self, request_context: RequestContext, app_id: UUID):
        return application_services().console_workflows.default_blocks()


@console_ns.route("/apps/<uuid:app_id>/workflows/default-workflow-block-configs/<string:block_type>")
class DefaultBlockConfigApi(Resource):
    @console_ns.doc("get_default_block_config")
    @console_ns.doc(description="Get default block configuration by type")
    @console_ns.doc(params={"app_id": "Application ID", "block_type": "Block type"})
    @console_ns.response(
        200,
        "Default block configuration retrieved successfully",
        console_ns.models[DefaultBlockConfigResponse.__name__],
    )
    @console_ns.response(404, "Block type not found")
    @console_ns.doc(params=query_params_from_model(DefaultBlockConfigQuery))
    @console_workflow_admission(permission=RBACPermission.APP_VIEW_LAYOUT)
    @model_validate(DefaultBlockConfigQuery)
    def get(self, args: DefaultBlockConfigQuery, request_context: RequestContext, app_id: UUID, block_type: str):
        filters = None
        if args.q:
            try:
                filters = json.loads(args.q)
            except json.JSONDecodeError as error:
                raise ValueError("Invalid filters") from error
        return application_services().console_workflows.default_block(block_type, filters)


@console_ns.route("/apps/<uuid:app_id>/convert-to-workflow")
class ConvertToWorkflowApi(Resource):
    @console_ns.expect(console_ns.models[ConvertToWorkflowPayload.__name__])
    @console_ns.doc("convert_to_workflow")
    @console_ns.doc(description="Convert application to workflow mode")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(
        200,
        "Application converted to workflow successfully",
        console_ns.models[NewAppResponse.__name__],
    )
    @console_ns.response(400, "Application cannot be converted")
    @console_ns.response(403, "Permission denied")
    @console_workflow_admission(permission=RBACPermission.APP_EDIT, modes=(AppMode.CHAT, AppMode.COMPLETION))
    @model_validate(ConvertToWorkflowPayload)
    def post(self, payload: ConvertToWorkflowPayload, request_context: RequestContext, app_id: UUID):
        return application_services().console_workflows.convert(
            request_context, str(app_id), payload.model_dump(exclude_none=True)
        )


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/features")
class WorkflowFeaturesApi(Resource):
    @console_ns.expect(console_ns.models[WorkflowFeaturesPayload.__name__])
    @console_ns.doc("update_workflow_features")
    @console_ns.doc(description="Update draft workflow features")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(
        200,
        "Workflow features updated successfully",
        console_ns.models[SimpleResultResponse.__name__],
    )
    @console_workflow_admission(permission=RBACPermission.APP_VIEW_LAYOUT)
    @model_validate(WorkflowFeaturesPayload)
    def post(self, args: WorkflowFeaturesPayload, request_context: RequestContext, app_id: UUID):
        application_services().console_workflows.update_features(
            request_context,
            str(app_id),
            args.features.model_dump(mode="json", exclude_unset=True),
        )
        return {"result": "success"}


@console_ns.route("/apps/<uuid:app_id>/workflows")
class PublishedAllWorkflowApi(Resource):
    @console_ns.doc(params=query_params_from_model(WorkflowListQuery))
    @console_ns.doc("get_all_published_workflows")
    @console_ns.doc(description="Get all published workflows for an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(
        200,
        "Published workflows retrieved successfully",
        console_ns.models[WorkflowPaginationResponse.__name__],
    )
    @console_workflow_admission(permission=RBACPermission.APP_VIEW_LAYOUT)
    @model_validate(WorkflowListQuery)
    def get(self, args: WorkflowListQuery, request_context: RequestContext, app_id: UUID):
        items, has_more = application_services().console_workflows.versions(
            request_context,
            str(app_id),
            page=args.page,
            limit=args.limit,
            user_id=args.user_id,
            named_only=args.named_only,
        )
        return dump_response(
            WorkflowPaginationResponse, {"items": items, "page": args.page, "limit": args.limit, "has_more": has_more}
        )


@console_ns.route("/apps/<uuid:app_id>/workflows/<string:workflow_id>/restore")
class DraftWorkflowRestoreApi(Resource):
    @console_ns.doc("restore_workflow_to_draft")
    @console_ns.doc(description="Restore a published workflow version into the draft workflow")
    @console_ns.doc(params={"app_id": "Application ID", "workflow_id": "Published workflow ID"})
    @console_ns.response(200, "Workflow restored successfully", console_ns.models[WorkflowRestoreResponse.__name__])
    @console_ns.response(400, "Source workflow must be published")
    @console_ns.response(404, "Workflow not found")
    @console_workflow_admission(permission=RBACPermission.APP_RELEASE_AND_VERSION)
    def post(self, request_context: RequestContext, app_id: UUID, workflow_id: str):
        try:
            result = application_services().console_workflows.restore(request_context, str(app_id), workflow_id)
        except IsDraftWorkflowError as error:
            raise InvalidRequestError(RESTORE_SOURCE_WORKFLOW_MUST_BE_PUBLISHED_MESSAGE) from error
        except WorkflowNotFoundError as error:
            raise NotFoundError(str(error)) from error
        except ValueError as error:
            raise InvalidRequestError(str(error)) from error
        return {"result": "success", "hash": result.hash, "updated_at": TimestampField().format(result.updated_at)}


@console_ns.route("/apps/<uuid:app_id>/workflows/<string:workflow_id>")
class WorkflowByIdApi(Resource):
    @console_ns.doc("update_workflow_by_id")
    @console_ns.doc(description="Update workflow by ID")
    @console_ns.doc(params={"app_id": "Application ID", "workflow_id": "Workflow ID"})
    @console_ns.expect(console_ns.models[WorkflowUpdatePayload.__name__])
    @console_ns.response(200, "Workflow updated successfully", console_ns.models[WorkflowResponse.__name__])
    @console_ns.response(404, "Workflow not found")
    @console_ns.response(403, "Permission denied")
    @console_workflow_admission(permission=RBACPermission.APP_EDIT)
    @model_validate(WorkflowUpdatePayload)
    def patch(self, args: WorkflowUpdatePayload, request_context: RequestContext, app_id: UUID, workflow_id: str):
        changes = args.model_dump(exclude_none=True)
        if not changes:
            return {"message": "No valid fields to update"}, 400
        return dump_response(
            WorkflowResponse,
            application_services().console_workflows.update(request_context, str(app_id), workflow_id, changes),
        )

    @console_ns.response(204, "Workflow deleted successfully")
    @console_workflow_admission(permission=RBACPermission.APP_EDIT)
    def delete(self, request_context: RequestContext, app_id: UUID, workflow_id: str):
        try:
            application_services().console_workflows.delete(request_context, WorkflowOwner(str(app_id)), workflow_id)
        except (WorkflowInUseError, DraftWorkflowDeletionError) as error:
            raise InvalidRequestError(str(error))
        return None, 204


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/last-run")
class DraftWorkflowNodeLastRunApi(Resource):
    @console_ns.doc("get_draft_workflow_node_last_run")
    @console_ns.doc(description="Get last run result for draft workflow node")
    @console_ns.doc(params={"app_id": "Application ID", "node_id": "Node ID"})
    @console_ns.response(
        200,
        "Node last run retrieved successfully",
        console_ns.models[WorkflowRunNodeExecutionResponse.__name__],
    )
    @console_ns.response(404, "Node last run not found")
    @console_ns.response(403, "Permission denied")
    @console_workflow_admission(permission=RBACPermission.APP_VIEW_LAYOUT, require_editor=False)
    def get(self, request_context: RequestContext, app_id: UUID, node_id: str):
        return dump_response(
            WorkflowRunNodeExecutionResponse,
            application_services().console_workflows.last_run(request_context, str(app_id), node_id),
        )


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/trigger/run")
class DraftWorkflowTriggerRunApi(Resource):
    @console_ns.doc("poll_draft_workflow_trigger_run")
    @console_ns.doc(description="Poll for trigger events and execute full workflow when event arrives")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[DraftWorkflowTriggerRunPayload.__name__])
    @console_ns.response(
        200,
        "Trigger event received and workflow executed successfully",
        console_ns.models[GeneratedAppResponse.__name__],
    )
    @console_ns.response(403, "Permission denied")
    @console_ns.response(500, "Internal server error")
    @console_workflow_admission(permission=RBACPermission.APP_TEST_AND_RUN, modes=(AppMode.WORKFLOW,))
    @model_validate(DraftWorkflowTriggerRunPayload)
    def post(self, args: DraftWorkflowTriggerRunPayload, request_context: RequestContext, app_id: UUID):
        try:
            result = application_services().console_workflows.trigger(
                request_context, str(app_id), [args.node_id], single_node=False, select_all=False
            )
        except WorkflowTriggerError as error:
            payload = {"status": "error"}
            if error.message is not None:
                payload["error"] = error.message
            return payload, 400
        except InvokeRateLimitError as error:
            raise InvokeRateLimitHttpError(error.description) from error
        if result is None:
            return {"status": "waiting", "retry_in": LISTENING_RETRY_IN}
        return helper.compact_generate_response(result)


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/trigger/run")
class DraftWorkflowTriggerNodeApi(Resource):
    @console_ns.doc("poll_draft_workflow_trigger_node")
    @console_ns.doc(description="Poll for trigger events and execute single node when event arrives")
    @console_ns.doc(params={"app_id": "Application ID", "node_id": "Node ID"})
    @console_ns.response(
        200,
        "Trigger event received and node executed successfully",
        console_ns.models[GeneratedAppResponse.__name__],
    )
    @console_ns.response(403, "Permission denied")
    @console_ns.response(500, "Internal server error")
    @console_workflow_admission(permission=RBACPermission.APP_TEST_AND_RUN, modes=(AppMode.WORKFLOW,))
    def post(self, request_context: RequestContext, app_id: UUID, node_id: str):
        try:
            result = application_services().console_workflows.trigger(
                request_context, str(app_id), [node_id], single_node=True, select_all=False
            )
        except WorkflowTriggerError as error:
            payload = {"status": "error"}
            if error.message is not None:
                payload["error"] = error.message
            return payload, 400
        except InvokeRateLimitError as error:
            raise InvokeRateLimitHttpError(error.description) from error
        if result is None:
            return {"status": "waiting", "retry_in": LISTENING_RETRY_IN}
        return jsonable_encoder(result)


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/trigger/run-all")
class DraftWorkflowTriggerRunAllApi(Resource):
    @console_ns.doc("draft_workflow_trigger_run_all")
    @console_ns.doc(description="Full workflow debug when the start node is a trigger")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[DraftWorkflowTriggerRunAllPayload.__name__])
    @console_ns.response(200, "Workflow executed successfully", console_ns.models[GeneratedAppResponse.__name__])
    @console_ns.response(403, "Permission denied")
    @console_ns.response(500, "Internal server error")
    @console_workflow_admission(permission=RBACPermission.APP_TEST_AND_RUN, modes=(AppMode.WORKFLOW,))
    @model_validate(DraftWorkflowTriggerRunAllPayload)
    def post(self, args: DraftWorkflowTriggerRunAllPayload, request_context: RequestContext, app_id: UUID):
        try:
            result = application_services().console_workflows.trigger(
                request_context, str(app_id), args.node_ids, single_node=False, select_all=True
            )
        except WorkflowTriggerError as error:
            payload = {"status": "error"}
            if error.message is not None:
                payload["error"] = error.message
            return payload, 400
        except InvokeRateLimitError as error:
            raise InvokeRateLimitHttpError(error.description) from error
        if result is None:
            return {"status": "waiting", "retry_in": LISTENING_RETRY_IN}
        return helper.compact_generate_response(result)


@console_ns.route("/apps/workflows/online-users")
class WorkflowOnlineUsersApi(Resource):
    @console_ns.expect(console_ns.models[WorkflowOnlineUsersPayload.__name__])
    @console_ns.response(
        200,
        "Workflow online users retrieved successfully",
        console_ns.models[WorkflowOnlineUsersResponse.__name__],
    )
    @console_ns.doc("get_workflow_online_users")
    @console_ns.doc(description="Get workflow online users")
    @console_account_admission()
    @model_validate(WorkflowOnlineUsersPayload)
    def post(self, args: WorkflowOnlineUsersPayload, request_context: RequestContext):
        try:
            data = application_services().console_workflows.online_users(request_context, args.app_ids)
        except ValueError as error:
            raise InvalidRequestError(str(error)) from error
        return dump_response(WorkflowOnlineUsersResponse, {"data": data})
