import json
import logging

from flask import abort, request
from flask_restful import Resource, inputs, marshal_with, reqparse  # type: ignore
from werkzeug.exceptions import Forbidden, InternalServerError, NotFound

import services
from configs import dify_config
from controllers.console import api
from controllers.console.app.error import ConversationCompletedError, DraftWorkflowNotExist, DraftWorkflowNotSync
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from factories import variable_factory
from fields.workflow_fields import workflow_fields, workflow_pagination_fields
from fields.workflow_run_fields import workflow_run_node_execution_fields
from libs import helper
from libs.helper import TimestampField, uuid_value
from libs.login import current_user, login_required
from models import App
from models.account import Account
from models.model import AppMode
from services.app_generate_service import AppGenerateService
from services.errors.app import WorkflowHashNotEqualError
from services.workflow_service import WorkflowService

logger = logging.getLogger(__name__)


class DraftWorkflowApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_fields)
    def get(self, app_model: App):
        """
        Get draft workflow
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

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
    def post(self, app_model: App):
        """
        Sync draft workflow
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        content_type = request.headers.get("Content-Type", "")

        if "application/json" in content_type:
            parser = reqparse.RequestParser()
            parser.add_argument("graph", type=dict, required=True, nullable=False, location="json")
            parser.add_argument("features", type=dict, required=True, nullable=False, location="json")
            parser.add_argument("hash", type=str, required=False, location="json")
            # TODO: set this to required=True after frontend is updated
            parser.add_argument("environment_variables", type=list, required=False, location="json")
            parser.add_argument("conversation_variables", type=list, required=False, location="json")
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

        if not isinstance(current_user, Account):
            raise Forbidden()

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


class AdvancedChatDraftWorkflowRunApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT])
    def post(self, app_model: App):
        """
        Run draft workflow
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        if not isinstance(current_user, Account):
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("inputs", type=dict, location="json")
        parser.add_argument("query", type=str, required=True, location="json", default="")
        parser.add_argument("files", type=list, location="json")
        parser.add_argument("conversation_id", type=uuid_value, location="json")
        parser.add_argument("parent_message_id", type=uuid_value, required=False, location="json")

        args = parser.parse_args()

        try:
            response = AppGenerateService.generate(
                app_model=app_model, user=current_user, args=args, invoke_from=InvokeFrom.DEBUGGER, streaming=True
            )

            return helper.compact_generate_response(response)
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        except services.errors.conversation.ConversationCompletedError:
            raise ConversationCompletedError()
        except ValueError as e:
            raise e
        except Exception:
            logging.exception("internal server error.")
            raise InternalServerError()


class AdvancedChatDraftRunIterationNodeApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT])
    def post(self, app_model: App, node_id: str):
        """
        Run draft workflow iteration node
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        if not isinstance(current_user, Account):
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("inputs", type=dict, location="json")
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
            logging.exception("internal server error.")
            raise InternalServerError()


class WorkflowDraftRunIterationNodeApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW])
    def post(self, app_model: App, node_id: str):
        """
        Run draft workflow iteration node
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        if not isinstance(current_user, Account):
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("inputs", type=dict, location="json")
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
            logging.exception("internal server error.")
            raise InternalServerError()


class AdvancedChatDraftRunLoopNodeApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT])
    def post(self, app_model: App, node_id: str):
        """
        Run draft workflow loop node
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        if not isinstance(current_user, Account):
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("inputs", type=dict, location="json")
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
            logging.exception("internal server error.")
            raise InternalServerError()


class WorkflowDraftRunLoopNodeApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW])
    def post(self, app_model: App, node_id: str):
        """
        Run draft workflow loop node
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        if not isinstance(current_user, Account):
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("inputs", type=dict, location="json")
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
            logging.exception("internal server error.")
            raise InternalServerError()


class DraftWorkflowRunApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW])
    def post(self, app_model: App):
        """
        Run draft workflow
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        if not isinstance(current_user, Account):
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("inputs", type=dict, required=True, nullable=False, location="json")
        parser.add_argument("files", type=list, required=False, location="json")
        args = parser.parse_args()

        response = AppGenerateService.generate(
            app_model=app_model,
            user=current_user,
            args=args,
            invoke_from=InvokeFrom.DEBUGGER,
            streaming=True,
        )

        return helper.compact_generate_response(response)


class WorkflowTaskStopApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def post(self, app_model: App, task_id: str):
        """
        Stop workflow task
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        AppQueueManager.set_stop_flag(task_id, InvokeFrom.DEBUGGER, current_user.id)

        return {"result": "success"}


class DraftWorkflowNodeRunApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_run_node_execution_fields)
    def post(self, app_model: App, node_id: str):
        """
        Run draft workflow node
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        if not isinstance(current_user, Account):
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("inputs", type=dict, required=True, nullable=False, location="json")
        args = parser.parse_args()

        inputs = args.get("inputs")
        if inputs == None:
            raise ValueError("missing inputs")

        workflow_service = WorkflowService()
        workflow_node_execution = workflow_service.run_draft_workflow_node(
            app_model=app_model, node_id=node_id, user_inputs=inputs, account=current_user
        )

        return workflow_node_execution


class PublishedWorkflowApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_fields)
    def get(self, app_model: App):
        """
        Get published workflow
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        # fetch published workflow by app_model
        workflow_service = WorkflowService()
        workflow = workflow_service.get_published_workflow(app_model=app_model)

        # return workflow, if not found, return None
        return workflow

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def post(self, app_model: App):
        """
        Publish workflow
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        if not isinstance(current_user, Account):
            raise Forbidden()

        workflow_service = WorkflowService()
        workflow = workflow_service.publish_workflow(app_model=app_model, account=current_user)

        return {"result": "success", "created_at": TimestampField().format(workflow.created_at)}


class DefaultBlockConfigsApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App):
        """
        Get default block config
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        # Get default block configs
        workflow_service = WorkflowService()
        return workflow_service.get_default_block_configs()


class DefaultBlockConfigApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App, block_type: str):
        """
        Get default block config
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        if not isinstance(current_user, Account):
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("q", type=str, location="args")
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


class ConvertToWorkflowApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.COMPLETION])
    def post(self, app_model: App):
        """
        Convert basic mode of chatbot app to workflow mode
        Convert expert mode of chatbot app to workflow mode
        Convert Completion App to Workflow App
        """
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        if not isinstance(current_user, Account):
            raise Forbidden()

        if request.data:
            parser = reqparse.RequestParser()
            parser.add_argument("name", type=str, required=False, nullable=True, location="json")
            parser.add_argument("icon_type", type=str, required=False, nullable=True, location="json")
            parser.add_argument("icon", type=str, required=False, nullable=True, location="json")
            parser.add_argument("icon_background", type=str, required=False, nullable=True, location="json")
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


class WorkflowConfigApi(Resource):
    """Resource for workflow configuration."""

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App):
        return {
            "parallel_depth_limit": dify_config.WORKFLOW_PARALLEL_DEPTH_LIMIT,
        }


class PublishedAllWorkflowApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_pagination_fields)
    def get(self, app_model: App):
        """
        Get published workflows
        """
        if not current_user.is_editor:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("page", type=inputs.int_range(1, 99999), required=False, default=1, location="args")
        parser.add_argument("limit", type=inputs.int_range(1, 100), required=False, default=20, location="args")
        args = parser.parse_args()
        page = args.get("page")
        limit = args.get("limit")
        workflow_service = WorkflowService()
        workflows, has_more = workflow_service.get_all_published_workflow(app_model=app_model, page=page, limit=limit)

        return {"items": workflows, "page": page, "limit": limit, "has_more": has_more}


api.add_resource(DraftWorkflowApi, "/apps/<uuid:app_id>/workflows/draft")
api.add_resource(WorkflowConfigApi, "/apps/<uuid:app_id>/workflows/draft/config")
api.add_resource(AdvancedChatDraftWorkflowRunApi, "/apps/<uuid:app_id>/advanced-chat/workflows/draft/run")
api.add_resource(DraftWorkflowRunApi, "/apps/<uuid:app_id>/workflows/draft/run")
api.add_resource(WorkflowTaskStopApi, "/apps/<uuid:app_id>/workflow-runs/tasks/<string:task_id>/stop")
api.add_resource(DraftWorkflowNodeRunApi, "/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/run")
api.add_resource(
    AdvancedChatDraftRunIterationNodeApi,
    "/apps/<uuid:app_id>/advanced-chat/workflows/draft/iteration/nodes/<string:node_id>/run",
)
api.add_resource(
    WorkflowDraftRunIterationNodeApi, "/apps/<uuid:app_id>/workflows/draft/iteration/nodes/<string:node_id>/run"
)
api.add_resource(
    AdvancedChatDraftRunLoopNodeApi,
    "/apps/<uuid:app_id>/advanced-chat/workflows/draft/loop/nodes/<string:node_id>/run",
)
api.add_resource(WorkflowDraftRunLoopNodeApi, "/apps/<uuid:app_id>/workflows/draft/loop/nodes/<string:node_id>/run")
api.add_resource(PublishedWorkflowApi, "/apps/<uuid:app_id>/workflows/publish")
api.add_resource(PublishedAllWorkflowApi, "/apps/<uuid:app_id>/workflows")
api.add_resource(DefaultBlockConfigsApi, "/apps/<uuid:app_id>/workflows/default-workflow-block-configs")
api.add_resource(
    DefaultBlockConfigApi, "/apps/<uuid:app_id>/workflows/default-workflow-block-configs/<string:block_type>"
)
api.add_resource(ConvertToWorkflowApi, "/apps/<uuid:app_id>/convert-to-workflow")
