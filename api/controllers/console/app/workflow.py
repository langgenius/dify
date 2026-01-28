import json
import logging
from collections.abc import Sequence
from typing import Any

from flask import abort, request
from flask_restx import Resource, fields, marshal_with
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, InternalServerError, NotFound

import services
from controllers.console import console_ns
from controllers.console.app.error import ConversationCompletedError, DraftWorkflowNotExist, DraftWorkflowNotSync
from controllers.console.app.workflow_run import workflow_run_node_execution_model
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, edit_permission_required, setup_required
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.workflow.app_generator import SKIP_PREPARE_USER_INPUTS_KEY
from core.app.entities.app_invoke_entities import InvokeFrom
from core.file.models import File
from core.helper.trace_id_helper import get_external_trace_id
from core.model_runtime.utils.encoders import jsonable_encoder
from core.plugin.impl.exc import PluginInvokeError
from core.trigger.debug.event_selectors import (
    TriggerDebugEvent,
    TriggerDebugEventPoller,
    create_event_poller,
    select_trigger_debug_events,
)
from core.workflow.enums import NodeType
from core.workflow.graph_engine.manager import GraphEngineManager
from extensions.ext_database import db
from factories import file_factory, variable_factory
from fields.member_fields import simple_account_fields
from fields.workflow_fields import workflow_fields, workflow_pagination_fields
from libs import helper
from libs.datetime_utils import naive_utc_now
from libs.helper import TimestampField, uuid_value
from libs.login import current_account_with_tenant, login_required
from models import App
from models.model import AppMode
from models.workflow import Workflow
from services.app_generate_service import AppGenerateService
from services.errors.app import WorkflowHashNotEqualError
from services.errors.llm import InvokeRateLimitError
from services.workflow_service import DraftWorkflowDeletionError, WorkflowInUseError, WorkflowService

logger = logging.getLogger(__name__)
LISTENING_RETRY_IN = 2000
DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"

# Register models for flask_restx to avoid dict type issues in Swagger
# Register in dependency order: base models first, then dependent models

# Base models
simple_account_model = console_ns.model("SimpleAccount", simple_account_fields)

from fields.workflow_fields import pipeline_variable_fields, serialize_value_type

conversation_variable_model = console_ns.model(
    "ConversationVariable",
    {
        "id": fields.String,
        "name": fields.String,
        "value_type": fields.String(attribute=serialize_value_type),
        "value": fields.Raw,
        "description": fields.String,
    },
)

pipeline_variable_model = console_ns.model("PipelineVariable", pipeline_variable_fields)

# Workflow model with nested dependencies
workflow_fields_copy = workflow_fields.copy()
workflow_fields_copy["created_by"] = fields.Nested(simple_account_model, attribute="created_by_account")
workflow_fields_copy["updated_by"] = fields.Nested(
    simple_account_model, attribute="updated_by_account", allow_null=True
)
workflow_fields_copy["conversation_variables"] = fields.List(fields.Nested(conversation_variable_model))
workflow_fields_copy["rag_pipeline_variables"] = fields.List(fields.Nested(pipeline_variable_model))
workflow_model = console_ns.model("Workflow", workflow_fields_copy)

# Workflow pagination model
workflow_pagination_fields_copy = workflow_pagination_fields.copy()
workflow_pagination_fields_copy["items"] = fields.List(fields.Nested(workflow_model), attribute="items")
workflow_pagination_model = console_ns.model("WorkflowPagination", workflow_pagination_fields_copy)


class SyncDraftWorkflowPayload(BaseModel):
    graph: dict[str, Any]
    features: dict[str, Any]
    hash: str | None = None
    environment_variables: list[dict[str, Any]] = Field(default_factory=list)
    conversation_variables: list[dict[str, Any]] = Field(default_factory=list)


class BaseWorkflowRunPayload(BaseModel):
    files: list[dict[str, Any]] | None = None


class AdvancedChatWorkflowRunPayload(BaseWorkflowRunPayload):
    inputs: dict[str, Any] | None = None
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
    inputs: dict[str, Any] | None = None


class LoopNodeRunPayload(BaseModel):
    inputs: dict[str, Any] | None = None


class DraftWorkflowRunPayload(BaseWorkflowRunPayload):
    inputs: dict[str, Any]


class DraftWorkflowNodeRunPayload(BaseWorkflowRunPayload):
    inputs: dict[str, Any]
    query: str = ""


class PublishWorkflowPayload(BaseModel):
    marked_name: str | None = Field(default=None, max_length=20)
    marked_comment: str | None = Field(default=None, max_length=100)


class DefaultBlockConfigQuery(BaseModel):
    q: str | None = None


class ConvertToWorkflowPayload(BaseModel):
    name: str | None = None
    icon_type: str | None = None
    icon: str | None = None
    icon_background: str | None = None


class WorkflowListQuery(BaseModel):
    page: int = Field(default=1, ge=1, le=99999)
    limit: int = Field(default=10, ge=1, le=100)
    user_id: str | None = None
    named_only: bool = False


class WorkflowUpdatePayload(BaseModel):
    marked_name: str | None = Field(default=None, max_length=20)
    marked_comment: str | None = Field(default=None, max_length=100)


class DraftWorkflowTriggerRunPayload(BaseModel):
    node_id: str


class DraftWorkflowTriggerRunAllPayload(BaseModel):
    node_ids: list[str]


def reg(cls: type[BaseModel]):
    console_ns.schema_model(cls.__name__, cls.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0))


reg(SyncDraftWorkflowPayload)
reg(AdvancedChatWorkflowRunPayload)
reg(IterationNodeRunPayload)
reg(LoopNodeRunPayload)
reg(DraftWorkflowRunPayload)
reg(DraftWorkflowNodeRunPayload)
reg(PublishWorkflowPayload)
reg(DefaultBlockConfigQuery)
reg(ConvertToWorkflowPayload)
reg(WorkflowListQuery)
reg(WorkflowUpdatePayload)
reg(DraftWorkflowTriggerRunPayload)
reg(DraftWorkflowTriggerRunAllPayload)


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
    )
    return file_objs


@console_ns.route("/apps/<uuid:app_id>/workflows/draft")
class DraftWorkflowApi(Resource):
    @console_ns.doc("get_draft_workflow")
    @console_ns.doc(description="Get draft workflow for an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(200, "Draft workflow retrieved successfully", workflow_model)
    @console_ns.response(404, "Draft workflow not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_model)
    @edit_permission_required
    def get(self, app_model: App):
        """
        Get draft workflow
        """
        # fetch draft workflow by app_model
        workflow_service = WorkflowService()
        workflow = workflow_service.get_draft_workflow(app_model=app_model)

        if not workflow:
            raise DraftWorkflowNotExist()

        # return workflow, if not found, return None (initiate graph by frontend)
        return workflow

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
    @edit_permission_required
    def post(self, app_model: App):
        """
        Sync draft workflow
        """
        current_user, _ = current_account_with_tenant()

        content_type = request.headers.get("Content-Type", "")

        payload_data: dict[str, Any] | None = None
        if "application/json" in content_type:
            payload_data = request.get_json(silent=True)
            if not isinstance(payload_data, dict):
                return {"message": "Invalid JSON data"}, 400
        elif "text/plain" in content_type:
            try:
                payload_data = json.loads(request.data.decode("utf-8"))
            except json.JSONDecodeError:
                return {"message": "Invalid JSON data"}, 400
            if not isinstance(payload_data, dict):
                return {"message": "Invalid JSON data"}, 400
        else:
            abort(415)

        args_model = SyncDraftWorkflowPayload.model_validate(payload_data)
        args = args_model.model_dump()
        workflow_service = WorkflowService()

        try:
            environment_variables_list = args.get("environment_variables") or []
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
    @console_ns.response(200, "Workflow run started successfully")
    @console_ns.response(400, "Invalid request parameters")
    @console_ns.response(403, "Permission denied")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT])
    @edit_permission_required
    def post(self, app_model: App):
        """
        Run draft workflow
        """
        current_user, _ = current_account_with_tenant()

        args_model = AdvancedChatWorkflowRunPayload.model_validate(console_ns.payload or {})
        args = args_model.model_dump(exclude_none=True)

        external_trace_id = get_external_trace_id(request)
        if external_trace_id:
            args["external_trace_id"] = external_trace_id

        try:
            response = AppGenerateService.generate(
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
    @console_ns.response(200, "Iteration node run started successfully")
    @console_ns.response(403, "Permission denied")
    @console_ns.response(404, "Node not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT])
    @edit_permission_required
    def post(self, app_model: App, node_id: str):
        """
        Run draft workflow iteration node
        """
        current_user, _ = current_account_with_tenant()
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
    @console_ns.response(200, "Workflow iteration node run started successfully")
    @console_ns.response(403, "Permission denied")
    @console_ns.response(404, "Node not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW])
    @edit_permission_required
    def post(self, app_model: App, node_id: str):
        """
        Run draft workflow iteration node
        """
        current_user, _ = current_account_with_tenant()
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
    @console_ns.response(200, "Loop node run started successfully")
    @console_ns.response(403, "Permission denied")
    @console_ns.response(404, "Node not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT])
    @edit_permission_required
    def post(self, app_model: App, node_id: str):
        """
        Run draft workflow loop node
        """
        current_user, _ = current_account_with_tenant()
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
    @console_ns.response(200, "Workflow loop node run started successfully")
    @console_ns.response(403, "Permission denied")
    @console_ns.response(404, "Node not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW])
    @edit_permission_required
    def post(self, app_model: App, node_id: str):
        """
        Run draft workflow loop node
        """
        current_user, _ = current_account_with_tenant()
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


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/run")
class DraftWorkflowRunApi(Resource):
    @console_ns.doc("run_draft_workflow")
    @console_ns.doc(description="Run draft workflow")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[DraftWorkflowRunPayload.__name__])
    @console_ns.response(200, "Draft workflow run started successfully")
    @console_ns.response(403, "Permission denied")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW])
    @edit_permission_required
    def post(self, app_model: App):
        """
        Run draft workflow
        """
        current_user, _ = current_account_with_tenant()
        args = DraftWorkflowRunPayload.model_validate(console_ns.payload or {}).model_dump(exclude_none=True)

        external_trace_id = get_external_trace_id(request)
        if external_trace_id:
            args["external_trace_id"] = external_trace_id

        try:
            response = AppGenerateService.generate(
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
    @console_ns.response(200, "Task stopped successfully")
    @console_ns.response(404, "Task not found")
    @console_ns.response(403, "Permission denied")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @edit_permission_required
    def post(self, app_model: App, task_id: str):
        """
        Stop workflow task
        """
        # Stop using both mechanisms for backward compatibility
        # Legacy stop flag mechanism (without user check)
        AppQueueManager.set_stop_flag_no_user_check(task_id)

        # New graph engine command channel mechanism
        GraphEngineManager.send_stop_command(task_id)

        return {"result": "success"}


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/run")
class DraftWorkflowNodeRunApi(Resource):
    @console_ns.doc("run_draft_workflow_node")
    @console_ns.doc(description="Run draft workflow node")
    @console_ns.doc(params={"app_id": "Application ID", "node_id": "Node ID"})
    @console_ns.expect(console_ns.models[DraftWorkflowNodeRunPayload.__name__])
    @console_ns.response(200, "Node run started successfully", workflow_run_node_execution_model)
    @console_ns.response(403, "Permission denied")
    @console_ns.response(404, "Node not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_run_node_execution_model)
    @edit_permission_required
    def post(self, app_model: App, node_id: str):
        """
        Run draft workflow node
        """
        current_user, _ = current_account_with_tenant()
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

        return workflow_node_execution


@console_ns.route("/apps/<uuid:app_id>/workflows/publish")
class PublishedWorkflowApi(Resource):
    @console_ns.doc("get_published_workflow")
    @console_ns.doc(description="Get published workflow for an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(200, "Published workflow retrieved successfully", workflow_model)
    @console_ns.response(404, "Published workflow not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_model)
    @edit_permission_required
    def get(self, app_model: App):
        """
        Get published workflow
        """
        # fetch published workflow by app_model
        workflow_service = WorkflowService()
        workflow = workflow_service.get_published_workflow(app_model=app_model)

        # return workflow, if not found, return None
        return workflow

    @console_ns.expect(console_ns.models[PublishWorkflowPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @edit_permission_required
    def post(self, app_model: App):
        """
        Publish workflow
        """
        current_user, _ = current_account_with_tenant()

        args = PublishWorkflowPayload.model_validate(console_ns.payload or {})

        workflow_service = WorkflowService()
        with Session(db.engine) as session:
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

            session.commit()

        return {
            "result": "success",
            "created_at": workflow_created_at,
        }


@console_ns.route("/apps/<uuid:app_id>/workflows/default-workflow-block-configs")
class DefaultBlockConfigsApi(Resource):
    @console_ns.doc("get_default_block_configs")
    @console_ns.doc(description="Get default block configurations for workflow")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(200, "Default block configurations retrieved successfully")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @edit_permission_required
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
    @console_ns.response(200, "Default block configuration retrieved successfully")
    @console_ns.response(404, "Block type not found")
    @console_ns.expect(console_ns.models[DefaultBlockConfigQuery.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @edit_permission_required
    def get(self, app_model: App, block_type: str):
        """
        Get default block config
        """
        args = DefaultBlockConfigQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore

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
    @console_ns.response(200, "Application converted to workflow successfully")
    @console_ns.response(400, "Application cannot be converted")
    @console_ns.response(403, "Permission denied")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.COMPLETION])
    @edit_permission_required
    def post(self, app_model: App):
        """
        Convert basic mode of chatbot app to workflow mode
        Convert expert mode of chatbot app to workflow mode
        Convert Completion App to Workflow App
        """
        current_user, _ = current_account_with_tenant()

        payload = console_ns.payload or {}
        args = ConvertToWorkflowPayload.model_validate(payload).model_dump(exclude_none=True)

        # convert to workflow mode
        workflow_service = WorkflowService()
        new_app_model = workflow_service.convert_to_workflow(app_model=app_model, account=current_user, args=args)

        # return app id
        return {
            "new_app_id": new_app_model.id,
        }


@console_ns.route("/apps/<uuid:app_id>/workflows")
class PublishedAllWorkflowApi(Resource):
    @console_ns.expect(console_ns.models[WorkflowListQuery.__name__])
    @console_ns.doc("get_all_published_workflows")
    @console_ns.doc(description="Get all published workflows for an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(200, "Published workflows retrieved successfully", workflow_pagination_model)
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_pagination_model)
    @edit_permission_required
    def get(self, app_model: App):
        """
        Get published workflows
        """
        current_user, _ = current_account_with_tenant()

        args = WorkflowListQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore
        page = args.page
        limit = args.limit
        user_id = args.user_id
        named_only = args.named_only

        if user_id:
            if user_id != current_user.id:
                raise Forbidden()

        workflow_service = WorkflowService()
        with Session(db.engine) as session:
            workflows, has_more = workflow_service.get_all_published_workflow(
                session=session,
                app_model=app_model,
                page=page,
                limit=limit,
                user_id=user_id,
                named_only=named_only,
            )

            return {
                "items": workflows,
                "page": page,
                "limit": limit,
                "has_more": has_more,
            }


@console_ns.route("/apps/<uuid:app_id>/workflows/<string:workflow_id>")
class WorkflowByIdApi(Resource):
    @console_ns.doc("update_workflow_by_id")
    @console_ns.doc(description="Update workflow by ID")
    @console_ns.doc(params={"app_id": "Application ID", "workflow_id": "Workflow ID"})
    @console_ns.expect(console_ns.models[WorkflowUpdatePayload.__name__])
    @console_ns.response(200, "Workflow updated successfully", workflow_model)
    @console_ns.response(404, "Workflow not found")
    @console_ns.response(403, "Permission denied")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_model)
    @edit_permission_required
    def patch(self, app_model: App, workflow_id: str):
        """
        Update workflow attributes
        """
        current_user, _ = current_account_with_tenant()
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

        # Create a session and manage the transaction
        with Session(db.engine, expire_on_commit=False) as session:
            workflow = workflow_service.update_workflow(
                session=session,
                workflow_id=workflow_id,
                tenant_id=app_model.tenant_id,
                account_id=current_user.id,
                data=update_data,
            )

            if not workflow:
                raise NotFound("Workflow not found")

            # Commit the transaction in the controller
            session.commit()

        return workflow

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @edit_permission_required
    def delete(self, app_model: App, workflow_id: str):
        """
        Delete workflow
        """
        workflow_service = WorkflowService()

        # Create a session and manage the transaction
        with Session(db.engine) as session:
            try:
                workflow_service.delete_workflow(
                    session=session, workflow_id=workflow_id, tenant_id=app_model.tenant_id
                )
                # Commit the transaction in the controller
                session.commit()
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
    @console_ns.response(200, "Node last run retrieved successfully", workflow_run_node_execution_model)
    @console_ns.response(404, "Node last run not found")
    @console_ns.response(403, "Permission denied")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_run_node_execution_model)
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
        return node_exec


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
    @console_ns.response(200, "Trigger event received and workflow executed successfully")
    @console_ns.response(403, "Permission denied")
    @console_ns.response(500, "Internal server error")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW])
    @edit_permission_required
    def post(self, app_model: App):
        """
        Poll for trigger events and execute full workflow when event arrives
        """
        current_user, _ = current_account_with_tenant()
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
    @console_ns.response(200, "Trigger event received and node executed successfully")
    @console_ns.response(403, "Permission denied")
    @console_ns.response(500, "Internal server error")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW])
    @edit_permission_required
    def post(self, app_model: App, node_id: str):
        """
        Poll for trigger events and execute single node when event arrives
        """
        current_user, _ = current_account_with_tenant()

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
        if node_type == NodeType.TRIGGER_SCHEDULE:
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
    @console_ns.response(200, "Workflow executed successfully")
    @console_ns.response(403, "Permission denied")
    @console_ns.response(500, "Internal server error")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW])
    @edit_permission_required
    def post(self, app_model: App):
        """
        Full workflow debug when the start node is a trigger
        """
        current_user, _ = current_account_with_tenant()

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
