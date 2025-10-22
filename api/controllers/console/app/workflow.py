import json
import logging
from collections.abc import Sequence
from typing import cast

from flask import abort, request
from flask_restx import Resource, fields, inputs, marshal_with, reqparse
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, InternalServerError, NotFound

import services
from controllers.console import api, console_ns
from controllers.console.app.error import ConversationCompletedError, DraftWorkflowNotExist, DraftWorkflowNotSync
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, edit_permission_required, setup_required
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.file.models import File
from core.helper.trace_id_helper import get_external_trace_id
from core.workflow.graph_engine.manager import GraphEngineManager
from extensions.ext_database import db
from factories import file_factory, variable_factory
from fields.workflow_fields import workflow_fields, workflow_pagination_fields
from fields.workflow_run_fields import workflow_run_node_execution_fields
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
    @api.doc("get_draft_workflow")
    @api.doc(description="Get draft workflow for an application")
    @api.doc(params={"app_id": "Application ID"})
    @api.response(200, "Draft workflow retrieved successfully", workflow_fields)
    @api.response(404, "Draft workflow not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_fields)
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
    @api.doc("sync_draft_workflow")
    @api.doc(description="Sync draft workflow configuration")
    @api.expect(
        api.model(
            "SyncDraftWorkflowRequest",
            {
                "graph": fields.Raw(required=True, description="Workflow graph configuration"),
                "features": fields.Raw(required=True, description="Workflow features configuration"),
                "hash": fields.String(description="Workflow hash for validation"),
                "environment_variables": fields.List(fields.Raw, required=True, description="Environment variables"),
                "conversation_variables": fields.List(fields.Raw, description="Conversation variables"),
            },
        )
    )
    @api.response(
        200,
        "Draft workflow synced successfully",
        api.model(
            "SyncDraftWorkflowResponse",
            {
                "result": fields.String,
                "hash": fields.String,
                "updated_at": fields.String,
            },
        ),
    )
    @api.response(400, "Invalid workflow configuration")
    @api.response(403, "Permission denied")
    @edit_permission_required
    def post(self, app_model: App):
        """
        Sync draft workflow
        """
        current_user, _ = current_account_with_tenant()

        content_type = request.headers.get("Content-Type", "")

        if "application/json" in content_type:
            parser = (
                reqparse.RequestParser()
                .add_argument("graph", type=dict, required=True, nullable=False, location="json")
                .add_argument("features", type=dict, required=True, nullable=False, location="json")
                .add_argument("hash", type=str, required=False, location="json")
                .add_argument("environment_variables", type=list, required=True, location="json")
                .add_argument("conversation_variables", type=list, required=False, location="json")
            )
            args = parser.parse_args()
        elif "text/plain" in content_type:
            try:
                data = json.loads(request.data.decode("utf-8"))
                if "graph" not in data or "features" not in data:
                    raise ValueError("graph or features not found in data")

                if not isinstance(data.get("graph"), dict) or not isinstance(data.get("features"), dict):
                    raise ValueError("graph or features is not a dict")

                args = {
                    "graph": data.get("graph"),
                    "features": data.get("features"),
                    "hash": data.get("hash"),
                    "environment_variables": data.get("environment_variables"),
                    "conversation_variables": data.get("conversation_variables"),
                }
            except json.JSONDecodeError:
                return {"message": "Invalid JSON data"}, 400
        else:
            abort(415)
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
    @api.doc("run_advanced_chat_draft_workflow")
    @api.doc(description="Run draft workflow for advanced chat application")
    @api.doc(params={"app_id": "Application ID"})
    @api.expect(
        api.model(
            "AdvancedChatWorkflowRunRequest",
            {
                "query": fields.String(required=True, description="User query"),
                "inputs": fields.Raw(description="Input variables"),
                "files": fields.List(fields.Raw, description="File uploads"),
                "conversation_id": fields.String(description="Conversation ID"),
            },
        )
    )
    @api.response(200, "Workflow run started successfully")
    @api.response(400, "Invalid request parameters")
    @api.response(403, "Permission denied")
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

        parser = (
            reqparse.RequestParser()
            .add_argument("inputs", type=dict, location="json")
            .add_argument("query", type=str, required=True, location="json", default="")
            .add_argument("files", type=list, location="json")
            .add_argument("conversation_id", type=uuid_value, location="json")
            .add_argument("parent_message_id", type=uuid_value, required=False, location="json")
        )

        args = parser.parse_args()

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
    @api.doc("run_advanced_chat_draft_iteration_node")
    @api.doc(description="Run draft workflow iteration node for advanced chat")
    @api.doc(params={"app_id": "Application ID", "node_id": "Node ID"})
    @api.expect(
        api.model(
            "IterationNodeRunRequest",
            {
                "task_id": fields.String(required=True, description="Task ID"),
                "inputs": fields.Raw(description="Input variables"),
            },
        )
    )
    @api.response(200, "Iteration node run started successfully")
    @api.response(403, "Permission denied")
    @api.response(404, "Node not found")
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
        parser = reqparse.RequestParser().add_argument("inputs", type=dict, location="json")
        args = parser.parse_args()

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
    @api.doc("run_workflow_draft_iteration_node")
    @api.doc(description="Run draft workflow iteration node")
    @api.doc(params={"app_id": "Application ID", "node_id": "Node ID"})
    @api.expect(
        api.model(
            "WorkflowIterationNodeRunRequest",
            {
                "task_id": fields.String(required=True, description="Task ID"),
                "inputs": fields.Raw(description="Input variables"),
            },
        )
    )
    @api.response(200, "Workflow iteration node run started successfully")
    @api.response(403, "Permission denied")
    @api.response(404, "Node not found")
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
        parser = reqparse.RequestParser().add_argument("inputs", type=dict, location="json")
        args = parser.parse_args()

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
    @api.doc("run_advanced_chat_draft_loop_node")
    @api.doc(description="Run draft workflow loop node for advanced chat")
    @api.doc(params={"app_id": "Application ID", "node_id": "Node ID"})
    @api.expect(
        api.model(
            "LoopNodeRunRequest",
            {
                "task_id": fields.String(required=True, description="Task ID"),
                "inputs": fields.Raw(description="Input variables"),
            },
        )
    )
    @api.response(200, "Loop node run started successfully")
    @api.response(403, "Permission denied")
    @api.response(404, "Node not found")
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
        parser = reqparse.RequestParser().add_argument("inputs", type=dict, location="json")
        args = parser.parse_args()

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
    @api.doc("run_workflow_draft_loop_node")
    @api.doc(description="Run draft workflow loop node")
    @api.doc(params={"app_id": "Application ID", "node_id": "Node ID"})
    @api.expect(
        api.model(
            "WorkflowLoopNodeRunRequest",
            {
                "task_id": fields.String(required=True, description="Task ID"),
                "inputs": fields.Raw(description="Input variables"),
            },
        )
    )
    @api.response(200, "Workflow loop node run started successfully")
    @api.response(403, "Permission denied")
    @api.response(404, "Node not found")
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
        parser = reqparse.RequestParser().add_argument("inputs", type=dict, location="json")
        args = parser.parse_args()

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
    @api.doc("run_draft_workflow")
    @api.doc(description="Run draft workflow")
    @api.doc(params={"app_id": "Application ID"})
    @api.expect(
        api.model(
            "DraftWorkflowRunRequest",
            {
                "inputs": fields.Raw(required=True, description="Input variables"),
                "files": fields.List(fields.Raw, description="File uploads"),
            },
        )
    )
    @api.response(200, "Draft workflow run started successfully")
    @api.response(403, "Permission denied")
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
        parser = (
            reqparse.RequestParser()
            .add_argument("inputs", type=dict, required=True, nullable=False, location="json")
            .add_argument("files", type=list, required=False, location="json")
        )
        args = parser.parse_args()

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
    @api.doc("stop_workflow_task")
    @api.doc(description="Stop running workflow task")
    @api.doc(params={"app_id": "Application ID", "task_id": "Task ID"})
    @api.response(200, "Task stopped successfully")
    @api.response(404, "Task not found")
    @api.response(403, "Permission denied")
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
    @api.doc("run_draft_workflow_node")
    @api.doc(description="Run draft workflow node")
    @api.doc(params={"app_id": "Application ID", "node_id": "Node ID"})
    @api.expect(
        api.model(
            "DraftWorkflowNodeRunRequest",
            {
                "inputs": fields.Raw(description="Input variables"),
            },
        )
    )
    @api.response(200, "Node run started successfully", workflow_run_node_execution_fields)
    @api.response(403, "Permission denied")
    @api.response(404, "Node not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_run_node_execution_fields)
    @edit_permission_required
    def post(self, app_model: App, node_id: str):
        """
        Run draft workflow node
        """
        current_user, _ = current_account_with_tenant()
        parser = (
            reqparse.RequestParser()
            .add_argument("inputs", type=dict, required=True, nullable=False, location="json")
            .add_argument("query", type=str, required=False, location="json", default="")
            .add_argument("files", type=list, location="json", default=[])
        )
        args = parser.parse_args()

        user_inputs = args.get("inputs")
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
    @api.doc("get_published_workflow")
    @api.doc(description="Get published workflow for an application")
    @api.doc(params={"app_id": "Application ID"})
    @api.response(200, "Published workflow retrieved successfully", workflow_fields)
    @api.response(404, "Published workflow not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_fields)
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
        parser = (
            reqparse.RequestParser()
            .add_argument("marked_name", type=str, required=False, default="", location="json")
            .add_argument("marked_comment", type=str, required=False, default="", location="json")
        )
        args = parser.parse_args()

        # Validate name and comment length
        if args.marked_name and len(args.marked_name) > 20:
            raise ValueError("Marked name cannot exceed 20 characters")
        if args.marked_comment and len(args.marked_comment) > 100:
            raise ValueError("Marked comment cannot exceed 100 characters")

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
    @api.doc("get_default_block_configs")
    @api.doc(description="Get default block configurations for workflow")
    @api.doc(params={"app_id": "Application ID"})
    @api.response(200, "Default block configurations retrieved successfully")
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
    @api.doc("get_default_block_config")
    @api.doc(description="Get default block configuration by type")
    @api.doc(params={"app_id": "Application ID", "block_type": "Block type"})
    @api.response(200, "Default block configuration retrieved successfully")
    @api.response(404, "Block type not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @edit_permission_required
    def get(self, app_model: App, block_type: str):
        """
        Get default block config
        """
        parser = reqparse.RequestParser().add_argument("q", type=str, location="args")
        args = parser.parse_args()

        q = args.get("q")

        filters = None
        if q:
            try:
                filters = json.loads(args.get("q", ""))
            except json.JSONDecodeError:
                raise ValueError("Invalid filters")

        # Get default block configs
        workflow_service = WorkflowService()
        return workflow_service.get_default_block_config(node_type=block_type, filters=filters)


@console_ns.route("/apps/<uuid:app_id>/convert-to-workflow")
class ConvertToWorkflowApi(Resource):
    @api.doc("convert_to_workflow")
    @api.doc(description="Convert application to workflow mode")
    @api.doc(params={"app_id": "Application ID"})
    @api.response(200, "Application converted to workflow successfully")
    @api.response(400, "Application cannot be converted")
    @api.response(403, "Permission denied")
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

        if request.data:
            parser = (
                reqparse.RequestParser()
                .add_argument("name", type=str, required=False, nullable=True, location="json")
                .add_argument("icon_type", type=str, required=False, nullable=True, location="json")
                .add_argument("icon", type=str, required=False, nullable=True, location="json")
                .add_argument("icon_background", type=str, required=False, nullable=True, location="json")
            )
            args = parser.parse_args()
        else:
            args = {}

        # convert to workflow mode
        workflow_service = WorkflowService()
        new_app_model = workflow_service.convert_to_workflow(app_model=app_model, account=current_user, args=args)

        # return app id
        return {
            "new_app_id": new_app_model.id,
        }


@console_ns.route("/apps/<uuid:app_id>/workflows")
class PublishedAllWorkflowApi(Resource):
    @api.doc("get_all_published_workflows")
    @api.doc(description="Get all published workflows for an application")
    @api.doc(params={"app_id": "Application ID"})
    @api.response(200, "Published workflows retrieved successfully", workflow_pagination_fields)
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_pagination_fields)
    @edit_permission_required
    def get(self, app_model: App):
        """
        Get published workflows
        """
        current_user, _ = current_account_with_tenant()

        parser = (
            reqparse.RequestParser()
            .add_argument("page", type=inputs.int_range(1, 99999), required=False, default=1, location="args")
            .add_argument("limit", type=inputs.int_range(1, 100), required=False, default=20, location="args")
            .add_argument("user_id", type=str, required=False, location="args")
            .add_argument("named_only", type=inputs.boolean, required=False, default=False, location="args")
        )
        args = parser.parse_args()
        page = int(args.get("page", 1))
        limit = int(args.get("limit", 10))
        user_id = args.get("user_id")
        named_only = args.get("named_only", False)

        if user_id:
            if user_id != current_user.id:
                raise Forbidden()
            user_id = cast(str, user_id)

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
    @api.doc("update_workflow_by_id")
    @api.doc(description="Update workflow by ID")
    @api.doc(params={"app_id": "Application ID", "workflow_id": "Workflow ID"})
    @api.expect(
        api.model(
            "UpdateWorkflowRequest",
            {
                "environment_variables": fields.List(fields.Raw, description="Environment variables"),
                "conversation_variables": fields.List(fields.Raw, description="Conversation variables"),
            },
        )
    )
    @api.response(200, "Workflow updated successfully", workflow_fields)
    @api.response(404, "Workflow not found")
    @api.response(403, "Permission denied")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_fields)
    @edit_permission_required
    def patch(self, app_model: App, workflow_id: str):
        """
        Update workflow attributes
        """
        current_user, _ = current_account_with_tenant()
        parser = (
            reqparse.RequestParser()
            .add_argument("marked_name", type=str, required=False, location="json")
            .add_argument("marked_comment", type=str, required=False, location="json")
        )
        args = parser.parse_args()

        # Validate name and comment length
        if args.marked_name and len(args.marked_name) > 20:
            raise ValueError("Marked name cannot exceed 20 characters")
        if args.marked_comment and len(args.marked_comment) > 100:
            raise ValueError("Marked comment cannot exceed 100 characters")

        # Prepare update data
        update_data = {}
        if args.get("marked_name") is not None:
            update_data["marked_name"] = args["marked_name"]
        if args.get("marked_comment") is not None:
            update_data["marked_comment"] = args["marked_comment"]

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
    @api.doc("get_draft_workflow_node_last_run")
    @api.doc(description="Get last run result for draft workflow node")
    @api.doc(params={"app_id": "Application ID", "node_id": "Node ID"})
    @api.response(200, "Node last run retrieved successfully", workflow_run_node_execution_fields)
    @api.response(404, "Node last run not found")
    @api.response(403, "Permission denied")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_run_node_execution_fields)
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
