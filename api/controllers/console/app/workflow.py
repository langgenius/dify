import json
import logging
from collections.abc import Sequence
from datetime import datetime
from typing import Any, NotRequired, TypedDict, cast

from flask import abort, request
from flask_restx import Resource, fields
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, RootModel, ValidationError, field_validator
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import BadRequest, Forbidden, InternalServerError, NotFound

import services
from controllers.common.controller_schemas import DefaultBlockConfigQuery, WorkflowListQuery, WorkflowUpdatePayload
from controllers.common.errors import InvalidArgumentError
from controllers.common.fields import GeneratedAppResponse, NewAppResponse, SimpleResultResponse
from controllers.common.schema import (
    query_params_from_model,
    register_response_schema_model,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console import console_ns
from controllers.console.app.error import (
    ConversationCompletedError,
    DraftWorkflowNotExist,
    DraftWorkflowNotSync,
)
from controllers.console.app.permission_keys import get_app_permission_keys
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    edit_permission_required,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.workflow.app_generator import SKIP_PREPARE_USER_INPUTS_KEY
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.file_access import DatabaseFileAccessController
from core.helper import encrypter
from core.helper.trace_id_helper import get_external_trace_id
from core.plugin.impl.exc import PluginInvokeError
from core.trigger.constants import TRIGGER_SCHEDULE_NODE_TYPE
from core.trigger.debug.event_selectors import (
    TriggerDebugEvent,
    TriggerDebugEventPoller,
    create_event_poller,
    select_trigger_debug_events,
)
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from factories import file_factory, variable_factory
from fields.base import ResponseModel
from fields.member_fields import SimpleAccount
from fields.workflow_run_fields import WorkflowRunNodeExecutionResponse
from graphon.enums import NodeType
from graphon.file import File
from graphon.file import helpers as file_helpers
from graphon.graph_engine.manager import GraphEngineManager
from graphon.model_runtime.utils.encoders import jsonable_encoder
from graphon.variables import SecretVariable, SegmentType, VariableBase
from graphon.variables.exc import VariableError
from libs import helper
from libs.datetime_utils import naive_utc_now
from libs.helper import TimestampField, dump_response, to_timestamp, uuid_value
from libs.login import login_required
from models import Account, App
from models.model import AppMode
from models.workflow import Workflow
from repositories.workflow_collaboration_repository import WORKFLOW_ONLINE_USERS_PREFIX
from services.app_generate_service import AppGenerateService
from services.errors.app import IsDraftWorkflowError, WorkflowHashNotEqualError, WorkflowNotFoundError
from services.errors.llm import InvokeRateLimitError
from services.workflow_ref_service import WorkflowRefService
from services.workflow_service import DraftWorkflowDeletionError, WorkflowInUseError, WorkflowService

from sqlalchemy.orm import Session
from controllers.console.app.wraps import with_session

logger = logging.getLogger(__name__)

_file_access_controller = DatabaseFileAccessController()
LISTENING_RETRY_IN = 2000

RESTORE_SOURCE_WORKFLOW_MUST_BE_PUBLISHED_MESSAGE = "source workflow must be published"
MAX_WORKFLOW_ONLINE_USERS_REQUEST_IDS = 1000
WORKFLOW_ONLINE_USERS_REDIS_BATCH_SIZE = 50
ENVIRONMENT_VARIABLE_SUPPORTED_TYPES = (SegmentType.STRING, SegmentType.NUMBER, SegmentType.SECRET)


class EnvironmentVariableResponseDict(TypedDict):
    value_type: str
    id: NotRequired[str]
    name: NotRequired[str]
    value: NotRequired[Any]
    description: NotRequired[str | None]


class SyncDraftWorkflowPayload(BaseModel):
    graph: dict[str, Any]
    features: dict[str, Any]
    hash: str | None = None
    environment_variables: list[dict[str, Any]] = Field(
        default_factory=list,
    )
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
    autoPlay: str | None = None


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


class WorkflowConversationVariableResponse(ResponseModel):
    id: str
    name: str
    value_type: str
    value: Any
    description: str

    @field_validator("value_type", mode="before")
    @classmethod
    def _serialize_value_type(cls, value: Any) -> str:
        if hasattr(value, "exposed_type"):
            return str(value.exposed_type())
        return str(value)


class PipelineVariableResponse(ResponseModel):
    label: str
    variable: str
    type: str
    belong_to_node_id: str
    max_length: int | None = None
    required: bool
    unit: str | None = None
    default_value: Any = Field(default=None)
    options: list[str] | None = None
    placeholder: str | None = None
    tooltips: str | None = None
    allowed_file_types: list[str] | None = None
    allowed_file_extensions: list[str] | None = Field(
        default=None, validation_alias=AliasChoices("allowed_file_extensions", "allow_file_extension")
    )
    allowed_file_upload_methods: list[str] | None = Field(
        default=None, validation_alias=AliasChoices("allowed_file_upload_methods", "allow_file_upload_methods")
    )


class WorkflowEnvironmentVariableResponse(ResponseModel):
    value_type: str
    id: str
    name: str
    value: Any
    description: str


class WorkflowResponse(ResponseModel):
    id: str
    graph: dict[str, Any] = Field(
        validation_alias=AliasChoices("graph_dict", "graph"),
    )
    features: dict[str, Any] = Field(
        validation_alias=AliasChoices("features_dict", "features"),
    )
    hash: str = Field(validation_alias=AliasChoices("unique_hash", "hash"))
    version: str
    marked_name: str
    marked_comment: str
    created_by: SimpleAccount | None = Field(
        default=None, validation_alias=AliasChoices("created_by_account", "created_by")
    )
    created_at: int
    updated_by: SimpleAccount | None = Field(
        default=None, validation_alias=AliasChoices("updated_by_account", "updated_by")
    )
    updated_at: int
    tool_published: bool
    environment_variables: list[WorkflowEnvironmentVariableResponse]
    conversation_variables: list[WorkflowConversationVariableResponse]
    rag_pipeline_variables: list[PipelineVariableResponse]

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int:
        timestamp = to_timestamp(value)
        if timestamp is None:
            raise ValueError("timestamp is required")
        return timestamp

    @field_validator("environment_variables", mode="before")
    @classmethod
    def _serialize_environment_variables(cls, value: Any) -> list[Any]:
        if value is None:
            return []

        return [_serialize_environment_variable(item) for item in value]


class WorkflowPaginationResponse(ResponseModel):
    items: list[WorkflowResponse]
    page: int
    limit: int
    has_more: bool


class WorkflowOnlineUser(ResponseModel):
    user_id: str
    username: str
    avatar: str | None = None


class WorkflowOnlineUsersByApp(ResponseModel):
    app_id: str
    users: list[WorkflowOnlineUser]


class WorkflowOnlineUsersResponse(ResponseModel):
    data: list[WorkflowOnlineUsersByApp]


class WorkflowPublishResponse(ResponseModel):
    result: str
    created_at: int


class WorkflowRestoreResponse(ResponseModel):
    result: str
    hash: str
    updated_at: int


class DefaultBlockConfigsResponse(RootModel[list[dict[str, Any]]]):
    root: list[dict[str, Any]]


class DefaultBlockConfigResponse(RootModel[dict[str, Any]]):
    root: dict[str, Any]


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


# TODO(QuantumGhost): Refactor existing node run API to handle file parameter parsing
# at the controller level rather than in the workflow logic. This would improve separation
# of concerns and make the code more maintainable.
def _parse_file(workflow: Workflow, files: list[dict] | None = None) -> Sequence[File]:
    files = files or []

    file_extra_config = FileUploadConfigManager.convert(workflow.features_dict, is_vision=False)
    file_objs: Sequence[File] = []
    if file_extra_config is None:
        return file_objs
    file_objs = file_factory.build_from_mappings(
        mappings=files,
        tenant_id=workflow.tenant_id,
        config=file_extra_config,
        access_controller=_file_access_controller,
    )
    return file_objs


def _serialize_environment_variable(value: Any) -> EnvironmentVariableResponseDict | Any:
    match value:
        case SecretVariable():
            return {
                "id": value.id,
                "name": value.name,
                "value": encrypter.full_mask_token(),
                "value_type": value.value_type.value,
                "description": value.description,
            }

        case VariableBase():
            return {
                "id": value.id,
                "name": value.name,
                "value": value.value,
                "value_type": str(value.value_type.exposed_type()),
                "description": value.description,
            }

        case dict():
            value_type_str = value.get("value_type")
            if not isinstance(value_type_str, str):
                raise TypeError(
                    f"unexpected type for value_type field, value={value_type_str}, type={type(value_type_str)}"
                )
            value_type = SegmentType(value_type_str).exposed_type()
            if value_type not in ENVIRONMENT_VARIABLE_SUPPORTED_TYPES:
                raise ValueError(f"Unsupported environment variable value type: {value_type}")
            return value

        case _:
            return value


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
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App):
        """
        Get draft workflow
        """
        # fetch draft workflow by app_model
        workflow_service = WorkflowService()
        workflow = workflow_service.get_draft_workflow(app_model=app_model)

        if not workflow:
            raise DraftWorkflowNotExist()

        from services.agent.workflow_publish_service import WorkflowAgentPublishService

        # Return workflow with response-only Agent node job projection so the
        # front-end can treat draft graph node data as the editing source.
        response = WorkflowResponse.model_validate(workflow, from_attributes=True).model_dump(mode="json")
        response["graph"] = WorkflowAgentPublishService.project_draft_bindings_to_graph(
            session=cast(Session, db.session),
            draft_workflow=workflow,
        )
        return response

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @console_ns.doc("sync_draft_workflow")
    @console_ns.doc(description="Sync draft workflow configuration")
    @console_ns.expect(console_ns.models[SyncDraftWorkflowPayload.__name__])
    @console_ns.response(
        200,
        "Draft workflow synced successfully",
        console_ns.model(
            "SyncDraftWorkflowResponse",
            {
                "result": fields.String,
                "hash": fields.String,
                "updated_at": fields.String,
            },
        ),
    )
    @console_ns.response(400, "Invalid workflow configuration")
    @console_ns.response(403, "Permission denied")
    @with_current_user
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    def post(self, current_user: Account, app_model: App):
        """
        Sync draft workflow
        """
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
            abort(415)
        args = args_model.model_dump()
        workflow_service = WorkflowService()

        try:
            environment_variables_list = Workflow.normalize_environment_variable_mappings(
                args.get("environment_variables") or [],
            )
            environment_variables = [
                variable_factory.build_environment_variable_from_mapping(obj) for obj in environment_variables_list
            ]
            conversation_variables_list = args.get("conversation_variables") or []
            conversation_variables = [
                variable_factory.build_conversation_variable_from_mapping(obj) for obj in conversation_variables_list
            ]
            workflow = workflow_service.sync_draft_workflow(
                app_model=app_model,
                graph=args["graph"],
                features=args["features"],
                unique_hash=args.get("hash"),
                account=current_user,
                environment_variables=environment_variables,
                conversation_variables=conversation_variables,
            )
        except WorkflowHashNotEqualError:
            raise DraftWorkflowNotSync()
        except VariableError as e:
            raise InvalidArgumentError(description=str(e))

        return {
            "result": "success",
            "hash": workflow.unique_hash,
            "updated_at": TimestampField().format(workflow.updated_at or workflow.created_at),
        }


@console_ns.route("/apps/<uuid:app_id>/advanced-chat/workflows/draft/run")
class AdvancedChatDraftWorkflowRunApi(Resource):
    @console_ns.doc("run_advanced_chat_draft_workflow")
    @console_ns.doc(description="Run draft workflow for advanced chat application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[AdvancedChatWorkflowRunPayload.__name__])
    @console_ns.response(200, "Workflow run started successfully", console_ns.models[GeneratedAppResponse.__name__])
    @console_ns.response(400, "Invalid request parameters")
    @console_ns.response(403, "Permission denied")
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_TEST_AND_RUN)
    @get_app_model(mode=[AppMode.ADVANCED_CHAT])
    @with_current_user
    @edit_permission_required
    @with_session
    def post(self, session: Session, current_user: Account, app_model: App):
        """
        Run draft workflow
        """
        args_model = AdvancedChatWorkflowRunPayload.model_validate(console_ns.payload or {})
        args = args_model.model_dump(exclude_none=True)

        external_trace_id = get_external_trace_id(request)
        if external_trace_id:
            args["external_trace_id"] = external_trace_id

        try:
            response = AppGenerateService.generate(
                session=session,
                app_model=app_model, user=current_user, args=args, invoke_from=InvokeFrom.DEBUGGER, streaming=True
            )

            return helper.compact_generate_response(response)
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        except services.errors.conversation.ConversationCompletedError:
            raise ConversationCompletedError()
        except InvokeRateLimitError as ex:
            raise InvokeRateLimitHttpError(ex.description)
        except ValueError as e:
            raise e
        except Exception:
            logger.exception("internal server error.")
            raise InternalServerError()


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
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_TEST_AND_RUN)
    @get_app_model(mode=[AppMode.ADVANCED_CHAT])
    @with_current_user
    @edit_permission_required
    def post(self, current_user: Account, app_model: App, node_id: str):
        """
        Run draft workflow iteration node
        """
        args = IterationNodeRunPayload.model_validate(console_ns.payload or {}).model_dump(exclude_none=True)

        try:
            response = AppGenerateService.generate_single_iteration(
                app_model=app_model, user=current_user, node_id=node_id, args=args, streaming=True
            )

            return helper.compact_generate_response(response)
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        except services.errors.conversation.ConversationCompletedError:
            raise ConversationCompletedError()
        except ValueError as e:
            raise e
        except Exception:
            logger.exception("internal server error.")
            raise InternalServerError()


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
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_TEST_AND_RUN)
    @get_app_model(mode=[AppMode.WORKFLOW])
    @with_current_user
    @edit_permission_required
    def post(self, current_user: Account, app_model: App, node_id: str):
        """
        Run draft workflow iteration node
        """
        args = IterationNodeRunPayload.model_validate(console_ns.payload or {}).model_dump(exclude_none=True)

        try:
            response = AppGenerateService.generate_single_iteration(
                app_model=app_model, user=current_user, node_id=node_id, args=args, streaming=True
            )

            return helper.compact_generate_response(response)
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        except services.errors.conversation.ConversationCompletedError:
            raise ConversationCompletedError()
        except ValueError as e:
            raise e
        except Exception:
            logger.exception("internal server error.")
            raise InternalServerError()


@console_ns.route("/apps/<uuid:app_id>/advanced-chat/workflows/draft/loop/nodes/<string:node_id>/run")
class AdvancedChatDraftRunLoopNodeApi(Resource):
    @console_ns.doc("run_advanced_chat_draft_loop_node")
    @console_ns.doc(description="Run draft workflow loop node for advanced chat")
    @console_ns.doc(params={"app_id": "Application ID", "node_id": "Node ID"})
    @console_ns.expect(console_ns.models[LoopNodeRunPayload.__name__])
    @console_ns.response(200, "Loop node run started successfully", console_ns.models[GeneratedAppResponse.__name__])
    @console_ns.response(403, "Permission denied")
    @console_ns.response(404, "Node not found")
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_TEST_AND_RUN)
    @get_app_model(mode=[AppMode.ADVANCED_CHAT])
    @with_current_user
    @edit_permission_required
    def post(self, current_user: Account, app_model: App, node_id: str):
        """
        Run draft workflow loop node
        """
        args = LoopNodeRunPayload.model_validate(console_ns.payload or {})

        try:
            response = AppGenerateService.generate_single_loop(
                app_model=app_model, user=current_user, node_id=node_id, args=args, streaming=True
            )

            return helper.compact_generate_response(response)
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        except services.errors.conversation.ConversationCompletedError:
            raise ConversationCompletedError()
        except ValueError as e:
            raise e
        except Exception:
            logger.exception("internal server error.")
            raise InternalServerError()


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
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_TEST_AND_RUN)
    @get_app_model(mode=[AppMode.WORKFLOW])
    @with_current_user
    @edit_permission_required
    def post(self, current_user: Account, app_model: App, node_id: str):
        """
        Run draft workflow loop node
        """
        args = LoopNodeRunPayload.model_validate(console_ns.payload or {})

        try:
            response = AppGenerateService.generate_single_loop(
                app_model=app_model, user=current_user, node_id=node_id, args=args, streaming=True
            )

            return helper.compact_generate_response(response)
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        except services.errors.conversation.ConversationCompletedError:
            raise ConversationCompletedError()
        except ValueError as e:
            raise e
        except Exception:
            logger.exception("internal server error.")
            raise InternalServerError()


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
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT])
    @with_current_user
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    def post(self, current_user: Account, app_model: App, node_id: str):
        """
        Preview human input form content and placeholders
        """
        args = HumanInputFormPreviewPayload.model_validate(console_ns.payload or {})
        inputs = args.inputs

        workflow_service = WorkflowService()
        preview = workflow_service.get_human_input_form_preview(
            app_model=app_model,
            account=current_user,
            node_id=node_id,
            inputs=inputs,
        )
        return jsonable_encoder(preview)


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
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_TEST_AND_RUN)
    @get_app_model(mode=[AppMode.ADVANCED_CHAT])
    @with_current_user
    @edit_permission_required
    def post(self, current_user: Account, app_model: App, node_id: str):
        """
        Submit human input form preview
        """
        args = HumanInputFormSubmitPayload.model_validate(console_ns.payload or {})
        workflow_service = WorkflowService()
        result = workflow_service.submit_human_input_form_preview(
            app_model=app_model,
            account=current_user,
            node_id=node_id,
            form_inputs=args.form_inputs,
            inputs=args.inputs,
            action=args.action,
        )
        return jsonable_encoder(result)


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/human-input/nodes/<string:node_id>/form/preview")
class WorkflowDraftHumanInputFormPreviewApi(Resource):
    @console_ns.doc("get_workflow_draft_human_input_form")
    @console_ns.doc(description="Get human input form preview for workflow")
    @console_ns.doc(params={"app_id": "Application ID", "node_id": "Node ID"})
    @console_ns.expect(console_ns.models[HumanInputFormPreviewPayload.__name__])
    @console_ns.response(200, "Human input form preview", console_ns.models[HumanInputFormPreviewResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW])
    @with_current_user
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    def post(self, current_user: Account, app_model: App, node_id: str):
        """
        Preview human input form content and placeholders
        """
        args = HumanInputFormPreviewPayload.model_validate(console_ns.payload or {})
        inputs = args.inputs

        workflow_service = WorkflowService()
        preview = workflow_service.get_human_input_form_preview(
            app_model=app_model,
            account=current_user,
            node_id=node_id,
            inputs=inputs,
        )
        return jsonable_encoder(preview)


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
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_TEST_AND_RUN)
    @get_app_model(mode=[AppMode.WORKFLOW])
    @with_current_user
    @edit_permission_required
    def post(self, current_user: Account, app_model: App, node_id: str):
        """
        Submit human input form preview
        """
        workflow_service = WorkflowService()
        args = HumanInputFormSubmitPayload.model_validate(console_ns.payload or {})
        result = workflow_service.submit_human_input_form_preview(
            app_model=app_model,
            account=current_user,
            node_id=node_id,
            form_inputs=args.form_inputs,
            inputs=args.inputs,
            action=args.action,
        )
        return jsonable_encoder(result)


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/human-input/nodes/<string:node_id>/delivery-test")
class WorkflowDraftHumanInputDeliveryTestApi(Resource):
    @console_ns.doc("test_workflow_draft_human_input_delivery")
    @console_ns.doc(description="Test human input delivery for workflow")
    @console_ns.doc(params={"app_id": "Application ID", "node_id": "Node ID"})
    @console_ns.expect(console_ns.models[HumanInputDeliveryTestPayload.__name__])
    @console_ns.response(200, "Human input delivery test result", console_ns.models[EmptyObjectResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
    @with_current_user
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_TEST_AND_RUN)
    def post(self, current_user: Account, app_model: App, node_id: str):
        """
        Test human input delivery
        """
        workflow_service = WorkflowService()
        args = HumanInputDeliveryTestPayload.model_validate(console_ns.payload or {})
        workflow_service.test_human_input_delivery(
            app_model=app_model,
            account=current_user,
            node_id=node_id,
            delivery_method_id=args.delivery_method_id,
            inputs=args.inputs,
        )
        return jsonable_encoder({})


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
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_TEST_AND_RUN)
    @get_app_model(mode=[AppMode.WORKFLOW])
    @with_current_user
    @edit_permission_required
    @with_session
    def post(self, session: Session, current_user: Account, app_model: App):
        """
        Run draft workflow
        """
        args = DraftWorkflowRunPayload.model_validate(console_ns.payload or {}).model_dump(exclude_none=True)

        external_trace_id = get_external_trace_id(request)
        if external_trace_id:
            args["external_trace_id"] = external_trace_id

        try:
            response = AppGenerateService.generate(
                session=session,
                app_model=app_model,
                user=current_user,
                args=args,
                invoke_from=InvokeFrom.DEBUGGER,
                streaming=True,
            )

            return helper.compact_generate_response(response)
        except InvokeRateLimitError as ex:
            raise InvokeRateLimitHttpError(ex.description)


@console_ns.route("/apps/<uuid:app_id>/workflow-runs/tasks/<string:task_id>/stop")
class WorkflowTaskStopApi(Resource):
    @console_ns.doc("stop_workflow_task")
    @console_ns.doc(description="Stop running workflow task")
    @console_ns.doc(params={"app_id": "Application ID", "task_id": "Task ID"})
    @console_ns.response(200, "Task stopped successfully", console_ns.models[SimpleResultResponse.__name__])
    @console_ns.response(404, "Task not found")
    @console_ns.response(403, "Permission denied")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_TEST_AND_RUN)
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def post(self, app_model: App, task_id: str):
        """
        Stop workflow task
        """
        # Stop using both mechanisms for backward compatibility
        # Legacy stop flag mechanism (without user check)
        AppQueueManager.set_stop_flag_no_user_check(task_id)

        # New graph engine command channel mechanism
        GraphEngineManager(redis_client).send_stop_command(task_id)

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
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_TEST_AND_RUN)
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @with_current_user
    @edit_permission_required
    def post(self, current_user: Account, app_model: App, node_id: str):
        """
        Run draft workflow node
        """
        args_model = DraftWorkflowNodeRunPayload.model_validate(console_ns.payload or {})
        args = args_model.model_dump(exclude_none=True)

        user_inputs = args_model.inputs
        if user_inputs is None:
            raise ValueError("missing inputs")

        workflow_srv = WorkflowService()
        # fetch draft workflow by app_model
        draft_workflow = workflow_srv.get_draft_workflow(app_model=app_model)
        if not draft_workflow:
            raise ValueError("Workflow not initialized")
        files = _parse_file(draft_workflow, args.get("files"))
        workflow_service = WorkflowService()

        workflow_node_execution = workflow_service.run_draft_workflow_node(
            app_model=app_model,
            draft_workflow=draft_workflow,
            node_id=node_id,
            user_inputs=user_inputs,
            account=current_user,
            query=args.get("query", ""),
            files=files,
        )

        return WorkflowRunNodeExecutionResponse.model_validate(
            workflow_node_execution, from_attributes=True
        ).model_dump(mode="json")


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
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App):
        """
        Get published workflow
        """
        # fetch published workflow by app_model
        workflow_service = WorkflowService()
        workflow = workflow_service.get_published_workflow(app_model=app_model)

        # return workflow, if not found, return None
        if workflow is None:
            return None

        return dump_response(WorkflowResponse, workflow)

    @console_ns.expect(console_ns.models[PublishWorkflowPayload.__name__])
    @console_ns.response(200, "Workflow published successfully", console_ns.models[WorkflowPublishResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_RELEASE_AND_VERSION)
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @with_current_user
    @edit_permission_required
    def post(self, current_user: Account, app_model: App):
        """
        Publish workflow
        """

        args = PublishWorkflowPayload.model_validate(console_ns.payload or {})

        workflow_service = WorkflowService()
        with sessionmaker(db.engine).begin() as session:
            workflow = workflow_service.publish_workflow(
                session=session,
                app_model=app_model,
                account=current_user,
                marked_name=args.marked_name or "",
                marked_comment=args.marked_comment or "",
            )

            # Update app_model within the same session to ensure atomicity
            app_model_in_session = session.get(App, app_model.id)
            if app_model_in_session:
                app_model_in_session.workflow_id = workflow.id
                app_model_in_session.updated_by = current_user.id
                app_model_in_session.updated_at = naive_utc_now()

            workflow_created_at = TimestampField().format(workflow.created_at)

        return {
            "result": "success",
            "created_at": workflow_created_at,
        }


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
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App):
        """
        Get default block config
        """
        # Get default block configs
        workflow_service = WorkflowService()
        return workflow_service.get_default_block_configs()


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
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App, block_type: str):
        """
        Get default block config
        """
        args = DefaultBlockConfigQuery.model_validate(request.args.to_dict(flat=True))

        filters = None
        if args.q:
            try:
                filters = json.loads(args.q)
            except json.JSONDecodeError:
                raise ValueError("Invalid filters")

        # Get default block configs
        workflow_service = WorkflowService()
        return workflow_service.get_default_block_config(node_type=block_type, filters=filters)


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
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.COMPLETION])
    @with_current_user
    @with_current_tenant_id
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_EDIT)
    def post(self, current_tenant_id: str, current_user: Account, app_model: App):
        """
        Convert basic mode of chatbot app to workflow mode
        Convert expert mode of chatbot app to workflow mode
        Convert Completion App to Workflow App
        """
        payload = console_ns.payload or {}
        args = ConvertToWorkflowPayload.model_validate(payload).model_dump(exclude_none=True)

        # convert to workflow mode
        workflow_service = WorkflowService()
        new_app_model = workflow_service.convert_to_workflow(app_model=app_model, account=current_user, args=args)

        # return app id
        return {
            "new_app_id": new_app_model.id,
            "permission_keys": get_app_permission_keys(str(current_tenant_id), current_user.id, str(new_app_model.id)),
        }


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/features")
class WorkflowFeaturesApi(Resource):
    """Update draft workflow features."""

    @console_ns.expect(console_ns.models[WorkflowFeaturesPayload.__name__])
    @console_ns.doc("update_workflow_features")
    @console_ns.doc(description="Update draft workflow features")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(
        200,
        "Workflow features updated successfully",
        console_ns.models[SimpleResultResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @with_current_user
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    def post(self, current_user: Account, app_model: App):

        args = WorkflowFeaturesPayload.model_validate(console_ns.payload or {})
        features = args.features.model_dump(mode="json", exclude_unset=True)

        workflow_service = WorkflowService()
        workflow_service.update_draft_workflow_features(app_model=app_model, features=features, account=current_user)

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
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @with_current_user
    @edit_permission_required
    def get(self, current_user: Account, app_model: App):
        """
        Get published workflows
        """

        args = WorkflowListQuery.model_validate(request.args.to_dict(flat=True))
        page = args.page
        limit = args.limit
        user_id = args.user_id
        named_only = args.named_only

        if user_id:
            if user_id != current_user.id:
                raise Forbidden()

        workflow_service = WorkflowService()
        with sessionmaker(db.engine).begin() as session:
            workflows, has_more = workflow_service.get_all_published_workflow(
                session=session,
                app_model=app_model,
                page=page,
                limit=limit,
                user_id=user_id,
                named_only=named_only,
            )
            return WorkflowPaginationResponse.model_validate(
                {
                    "items": workflows,
                    "page": page,
                    "limit": limit,
                    "has_more": has_more,
                }
            ).model_dump(mode="json")


@console_ns.route("/apps/<uuid:app_id>/workflows/<string:workflow_id>/restore")
class DraftWorkflowRestoreApi(Resource):
    @console_ns.doc("restore_workflow_to_draft")
    @console_ns.doc(description="Restore a published workflow version into the draft workflow")
    @console_ns.doc(params={"app_id": "Application ID", "workflow_id": "Published workflow ID"})
    @console_ns.response(200, "Workflow restored successfully", console_ns.models[WorkflowRestoreResponse.__name__])
    @console_ns.response(400, "Source workflow must be published")
    @console_ns.response(404, "Workflow not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @with_current_user
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_RELEASE_AND_VERSION)
    def post(self, current_user: Account, app_model: App, workflow_id: str):
        workflow_service = WorkflowService()

        try:
            workflow = workflow_service.restore_published_workflow_to_draft(
                app_model=app_model,
                workflow_id=workflow_id,
                account=current_user,
            )
        except IsDraftWorkflowError as exc:
            raise BadRequest(RESTORE_SOURCE_WORKFLOW_MUST_BE_PUBLISHED_MESSAGE) from exc
        except WorkflowNotFoundError as exc:
            raise NotFound(str(exc)) from exc
        except ValueError as exc:
            raise BadRequest(str(exc)) from exc

        return {
            "result": "success",
            "hash": workflow.unique_hash,
            "updated_at": TimestampField().format(workflow.updated_at or workflow.created_at),
        }


@console_ns.route("/apps/<uuid:app_id>/workflows/<string:workflow_id>")
class WorkflowByIdApi(Resource):
    @console_ns.doc("update_workflow_by_id")
    @console_ns.doc(description="Update workflow by ID")
    @console_ns.doc(params={"app_id": "Application ID", "workflow_id": "Workflow ID"})
    @console_ns.expect(console_ns.models[WorkflowUpdatePayload.__name__])
    @console_ns.response(200, "Workflow updated successfully", console_ns.models[WorkflowResponse.__name__])
    @console_ns.response(404, "Workflow not found")
    @console_ns.response(403, "Permission denied")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @with_current_user
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_EDIT)
    def patch(self, current_user: Account, app_model: App, workflow_id: str):
        """
        Update workflow attributes
        """
        args = WorkflowUpdatePayload.model_validate(console_ns.payload or {})

        # Prepare update data
        update_data = {}
        if args.marked_name is not None:
            update_data["marked_name"] = args.marked_name
        if args.marked_comment is not None:
            update_data["marked_comment"] = args.marked_comment

        if not update_data:
            return {"message": "No valid fields to update"}, 400

        workflow_service = WorkflowService()
        workflow_ref = WorkflowRefService.create_app_workflow_ref(app_model, workflow_id)

        # Create a session and manage the transaction
        with sessionmaker(db.engine, expire_on_commit=False).begin() as session:
            workflow = workflow_service.update_workflow(
                session=session,
                account_id=current_user.id,
                data=update_data,
                workflow_ref=workflow_ref,
            )

            if not workflow:
                raise NotFound("Workflow not found")

        return dump_response(WorkflowResponse, workflow)

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_EDIT)
    @console_ns.response(204, "Workflow deleted successfully")
    def delete(self, app_model: App, workflow_id: str):
        """
        Delete workflow
        """
        workflow_service = WorkflowService()
        workflow_ref = WorkflowRefService.create_app_workflow_ref(app_model, workflow_id)

        # Create a session and manage the transaction
        with sessionmaker(db.engine).begin() as session:
            try:
                workflow_service.delete_workflow(
                    session=session,
                    workflow_ref=workflow_ref,
                )
            except WorkflowInUseError as e:
                abort(400, description=str(e))
            except DraftWorkflowDeletionError as e:
                abort(400, description=str(e))
            except ValueError as e:
                raise NotFound(str(e))

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
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App, node_id: str):
        srv = WorkflowService()
        workflow = srv.get_draft_workflow(app_model)
        if not workflow:
            raise NotFound("Workflow not found")
        node_exec = srv.get_node_last_run(
            app_model=app_model,
            workflow=workflow,
            node_id=node_id,
        )
        if node_exec is None:
            raise NotFound("last run not found")
        return WorkflowRunNodeExecutionResponse.model_validate(node_exec, from_attributes=True).model_dump(mode="json")


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/trigger/run")
class DraftWorkflowTriggerRunApi(Resource):
    """
    Full workflow debug - Polling API for trigger events
    Path: /apps/<uuid:app_id>/workflows/draft/trigger/run
    """

    @console_ns.doc("poll_draft_workflow_trigger_run")
    @console_ns.doc(description="Poll for trigger events and execute full workflow when event arrives")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(
        console_ns.model(
            "DraftWorkflowTriggerRunRequest",
            {
                "node_id": fields.String(required=True, description="Node ID"),
            },
        )
    )
    @console_ns.response(
        200,
        "Trigger event received and workflow executed successfully",
        console_ns.models[GeneratedAppResponse.__name__],
    )
    @console_ns.response(403, "Permission denied")
    @console_ns.response(500, "Internal server error")
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_TEST_AND_RUN)
    @get_app_model(mode=[AppMode.WORKFLOW])
    @with_current_user
    @edit_permission_required
    @with_session
    def post(self, session: Session, current_user: Account, app_model: App):
        """
        Poll for trigger events and execute full workflow when event arrives
        """
        args = DraftWorkflowTriggerRunPayload.model_validate(console_ns.payload or {})
        node_id = args.node_id
        workflow_service = WorkflowService()
        draft_workflow = workflow_service.get_draft_workflow(app_model)
        if not draft_workflow:
            raise ValueError("Workflow not found")

        poller: TriggerDebugEventPoller = create_event_poller(
            draft_workflow=draft_workflow,
            tenant_id=app_model.tenant_id,
            user_id=current_user.id,
            app_id=app_model.id,
            node_id=node_id,
        )
        event: TriggerDebugEvent | None = None
        try:
            event = poller.poll()
            if not event:
                return jsonable_encoder({"status": "waiting", "retry_in": LISTENING_RETRY_IN})
            workflow_args = dict(event.workflow_args)

            workflow_args[SKIP_PREPARE_USER_INPUTS_KEY] = True
            return helper.compact_generate_response(
                AppGenerateService.generate(
                    session=session,
                    app_model=app_model,
                    user=current_user,
                    args=workflow_args,
                    invoke_from=InvokeFrom.DEBUGGER,
                    streaming=True,
                    root_node_id=node_id,
                )
            )
        except InvokeRateLimitError as ex:
            raise InvokeRateLimitHttpError(ex.description)
        except PluginInvokeError as e:
            return jsonable_encoder({"status": "error", "error": e.to_user_friendly_error()}), 400
        except Exception as e:
            logger.exception("Error polling trigger debug event")
            raise e


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/trigger/run")
class DraftWorkflowTriggerNodeApi(Resource):
    """
    Single node debug - Polling API for trigger events
    Path: /apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/trigger/run
    """

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
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_TEST_AND_RUN)
    @get_app_model(mode=[AppMode.WORKFLOW])
    @with_current_user
    @edit_permission_required
    def post(self, current_user: Account, app_model: App, node_id: str):
        """
        Poll for trigger events and execute single node when event arrives
        """

        workflow_service = WorkflowService()
        draft_workflow = workflow_service.get_draft_workflow(app_model)
        if not draft_workflow:
            raise ValueError("Workflow not found")

        node_config = draft_workflow.get_node_config_by_id(node_id=node_id)
        if not node_config:
            raise ValueError("Node data not found for node %s", node_id)
        node_type: NodeType = draft_workflow.get_node_type_from_node_config(node_config)
        event: TriggerDebugEvent | None = None
        # for schedule trigger, when run single node, just execute directly
        if node_type == TRIGGER_SCHEDULE_NODE_TYPE:
            event = TriggerDebugEvent(
                workflow_args={},
                node_id=node_id,
            )
        # for other trigger types, poll for the event
        else:
            try:
                poller: TriggerDebugEventPoller = create_event_poller(
                    draft_workflow=draft_workflow,
                    tenant_id=app_model.tenant_id,
                    user_id=current_user.id,
                    app_id=app_model.id,
                    node_id=node_id,
                )
                event = poller.poll()
            except PluginInvokeError as e:
                return jsonable_encoder({"status": "error", "error": e.to_user_friendly_error()}), 400
            except Exception as e:
                logger.exception("Error polling trigger debug event")
                raise e
        if not event:
            return jsonable_encoder({"status": "waiting", "retry_in": LISTENING_RETRY_IN})

        raw_files = event.workflow_args.get("files")
        files = _parse_file(draft_workflow, raw_files if isinstance(raw_files, list) else None)
        try:
            node_execution = workflow_service.run_draft_workflow_node(
                app_model=app_model,
                draft_workflow=draft_workflow,
                node_id=node_id,
                user_inputs=event.workflow_args.get("inputs") or {},
                account=current_user,
                query="",
                files=files,
            )
            return jsonable_encoder(node_execution)
        except Exception as e:
            logger.exception("Error running draft workflow trigger node")
            return jsonable_encoder(
                {"status": "error", "error": "An unexpected error occurred while running the node."}
            ), 400


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/trigger/run-all")
class DraftWorkflowTriggerRunAllApi(Resource):
    """
    Full workflow debug - Polling API for trigger events
    Path: /apps/<uuid:app_id>/workflows/draft/trigger/run-all
    """

    @console_ns.doc("draft_workflow_trigger_run_all")
    @console_ns.doc(description="Full workflow debug when the start node is a trigger")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[DraftWorkflowTriggerRunAllPayload.__name__])
    @console_ns.response(200, "Workflow executed successfully", console_ns.models[GeneratedAppResponse.__name__])
    @console_ns.response(403, "Permission denied")
    @console_ns.response(500, "Internal server error")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW])
    @with_current_user
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_TEST_AND_RUN)
    @with_session
    def post(self, session: Session, current_user: Account, app_model: App):
        """
        Full workflow debug when the start node is a trigger
        """

        args = DraftWorkflowTriggerRunAllPayload.model_validate(console_ns.payload or {})
        node_ids = args.node_ids
        workflow_service = WorkflowService()
        draft_workflow = workflow_service.get_draft_workflow(app_model)
        if not draft_workflow:
            raise ValueError("Workflow not found")

        try:
            trigger_debug_event: TriggerDebugEvent | None = select_trigger_debug_events(
                draft_workflow=draft_workflow,
                app_model=app_model,
                user_id=current_user.id,
                node_ids=node_ids,
            )
        except PluginInvokeError as e:
            return jsonable_encoder({"status": "error", "error": e.to_user_friendly_error()}), 400
        except Exception as e:
            logger.exception("Error polling trigger debug event")
            raise e
        if trigger_debug_event is None:
            return jsonable_encoder({"status": "waiting", "retry_in": LISTENING_RETRY_IN})

        try:
            workflow_args = dict(trigger_debug_event.workflow_args)

            workflow_args[SKIP_PREPARE_USER_INPUTS_KEY] = True
            response = AppGenerateService.generate(
                session=session,
                app_model=app_model,
                user=current_user,
                args=workflow_args,
                invoke_from=InvokeFrom.DEBUGGER,
                streaming=True,
                root_node_id=trigger_debug_event.node_id,
            )
            return helper.compact_generate_response(response)
        except InvokeRateLimitError as ex:
            raise InvokeRateLimitHttpError(ex.description)
        except Exception:
            logger.exception("Error running draft workflow trigger run-all")
            return jsonable_encoder(
                {
                    "status": "error",
                }
            ), 400


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
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def post(self, current_tenant_id: str):
        args = WorkflowOnlineUsersPayload.model_validate(console_ns.payload or {})

        app_ids = args.app_ids
        if len(app_ids) > MAX_WORKFLOW_ONLINE_USERS_REQUEST_IDS:
            raise BadRequest(f"Maximum {MAX_WORKFLOW_ONLINE_USERS_REQUEST_IDS} app_ids are allowed per request.")

        if not app_ids:
            return {"data": []}

        workflow_service = WorkflowService()
        accessible_app_ids = workflow_service.get_accessible_app_ids(app_ids, current_tenant_id)
        ordered_accessible_app_ids = [app_id for app_id in app_ids if app_id in accessible_app_ids]

        users_json_by_app_id: dict[str, Any] = {}
        for start_index in range(0, len(ordered_accessible_app_ids), WORKFLOW_ONLINE_USERS_REDIS_BATCH_SIZE):
            app_id_batch = ordered_accessible_app_ids[
                start_index: start_index + WORKFLOW_ONLINE_USERS_REDIS_BATCH_SIZE
            ]
            pipe = redis_client.pipeline(transaction=False)
            for app_id in app_id_batch:
                pipe.hgetall(f"{WORKFLOW_ONLINE_USERS_PREFIX}{app_id}")

            users_json_batch = pipe.execute()
            for app_id, users_json in zip(app_id_batch, users_json_batch):
                users_json_by_app_id[app_id] = users_json

        results = []
        for app_id in ordered_accessible_app_ids:
            users_json = users_json_by_app_id.get(app_id, {})

            users = []
            for _, user_info_json in users_json.items():
                try:
                    user_info = json.loads(user_info_json)
                except Exception:
                    continue

                if not isinstance(user_info, dict):
                    continue

                user_id = user_info.get("user_id")
                username = user_info.get("username")
                if not isinstance(user_id, str) or not isinstance(username, str):
                    continue

                avatar = user_info.get("avatar")
                if avatar is not None and not isinstance(avatar, str):
                    avatar = None

                if isinstance(avatar, str) and avatar and not avatar.startswith(("http://", "https://")):
                    try:
                        avatar = file_helpers.get_signed_file_url(avatar)
                    except Exception as exc:
                        logger.warning(
                            "Failed to sign workflow online user avatar; using original value. "
                            "app_id=%s avatar=%s error=%s",
                            app_id,
                            avatar,
                            exc,
                        )

                users.append({"user_id": user_id, "username": username, "avatar": avatar})
            results.append({"app_id": app_id, "users": users})

        return WorkflowOnlineUsersResponse.model_validate({"data": results}).model_dump(mode="json")
