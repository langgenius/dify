import logging

from dateutil.parser import isoparse
from flask import request
from flask_restx import Api, Namespace, Resource, fields, reqparse
from flask_restx.inputs import int_range
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import BadRequest, InternalServerError, NotFound

from controllers.service_api import service_api_ns
from controllers.service_api.app.error import (
    CompletionRequestError,
    NotWorkflowAppError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import (
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from core.helper.trace_id_helper import get_external_trace_id
from core.model_runtime.errors.invoke import InvokeError
from core.workflow.enums import WorkflowExecutionStatus
from core.workflow.graph_engine.manager import GraphEngineManager
from extensions.ext_database import db
from fields.workflow_app_log_fields import build_workflow_app_log_pagination_model
from libs import helper
from libs.helper import TimestampField
from models.model import App, AppMode, EndUser
from repositories.factory import DifyAPIRepositoryFactory
from services.app_generate_service import AppGenerateService
from services.errors.app import IsDraftWorkflowError, WorkflowIdFormatError, WorkflowNotFoundError
from services.errors.llm import InvokeRateLimitError
from services.workflow_app_service import WorkflowAppService

logger = logging.getLogger(__name__)

# Define parsers for workflow APIs
workflow_run_parser = (
    reqparse.RequestParser()
    .add_argument("inputs", type=dict, required=True, nullable=False, location="json")
    .add_argument("files", type=list, required=False, location="json")
    .add_argument("response_mode", type=str, choices=["blocking", "streaming"], location="json")
)

workflow_log_parser = (
    reqparse.RequestParser()
    .add_argument("keyword", type=str, location="args")
    .add_argument("status", type=str, choices=["succeeded", "failed", "stopped"], location="args")
    .add_argument("created_at__before", type=str, location="args")
    .add_argument("created_at__after", type=str, location="args")
    .add_argument(
        "created_by_end_user_session_id",
        type=str,
        location="args",
        required=False,
        default=None,
    )
    .add_argument(
        "created_by_account",
        type=str,
        location="args",
        required=False,
        default=None,
    )
    .add_argument("page", type=int_range(1, 99999), default=1, location="args")
    .add_argument("limit", type=int_range(1, 100), default=20, location="args")
)

workflow_run_fields = {
    "id": fields.String,
    "workflow_id": fields.String,
    "status": fields.String,
    "inputs": fields.Raw,
    "outputs": fields.Raw,
    "error": fields.String,
    "total_steps": fields.Integer,
    "total_tokens": fields.Integer,
    "created_at": TimestampField,
    "finished_at": TimestampField,
    "elapsed_time": fields.Float,
}


def build_workflow_run_model(api_or_ns: Api | Namespace):
    """Build the workflow run model for the API or Namespace."""
    return api_or_ns.model("WorkflowRun", workflow_run_fields)


@service_api_ns.route("/workflows/run/<string:workflow_run_id>")
class WorkflowRunDetailApi(Resource):
    @service_api_ns.doc("get_workflow_run_detail")
    @service_api_ns.doc(description="Get workflow run details")
    @service_api_ns.doc(params={"workflow_run_id": "Workflow run ID"})
    @service_api_ns.doc(
        responses={
            200: "Workflow run details retrieved successfully",
            401: "Unauthorized - invalid API token",
            404: "Workflow run not found",
        }
    )
    @validate_app_token
    @service_api_ns.marshal_with(build_workflow_run_model(service_api_ns))
    def get(self, app_model: App, workflow_run_id: str):
        """Get a workflow task running detail.

        Returns detailed information about a specific workflow run.
        """
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT]:
            raise NotWorkflowAppError()

        # Use repository to get workflow run
        session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
        workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_maker)

        workflow_run = workflow_run_repo.get_workflow_run_by_id(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            run_id=workflow_run_id,
        )
        return workflow_run


@service_api_ns.route("/workflows/run")
class WorkflowRunApi(Resource):
    @service_api_ns.expect(workflow_run_parser)
    @service_api_ns.doc("run_workflow")
    @service_api_ns.doc(description="Execute a workflow")
    @service_api_ns.doc(
        responses={
            200: "Workflow executed successfully",
            400: "Bad request - invalid parameters or workflow issues",
            401: "Unauthorized - invalid API token",
            404: "Workflow not found",
            429: "Rate limit exceeded",
            500: "Internal server error",
        }
    )
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON, required=True))
    def post(self, app_model: App, end_user: EndUser):
        """Execute a workflow.

        Runs a workflow with the provided inputs and returns the results.
        Supports both blocking and streaming response modes.
        """
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode != AppMode.WORKFLOW:
            raise NotWorkflowAppError()

        args = workflow_run_parser.parse_args()
        external_trace_id = get_external_trace_id(request)
        if external_trace_id:
            args["external_trace_id"] = external_trace_id
        streaming = args.get("response_mode") == "streaming"

        try:
            response = AppGenerateService.generate(
                app_model=app_model, user=end_user, args=args, invoke_from=InvokeFrom.SERVICE_API, streaming=streaming
            )

            return helper.compact_generate_response(response)
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except InvokeRateLimitError as ex:
            raise InvokeRateLimitHttpError(ex.description)
        except InvokeError as e:
            raise CompletionRequestError(e.description)
        except ValueError as e:
            raise e
        except Exception:
            logger.exception("internal server error.")
            raise InternalServerError()


@service_api_ns.route("/workflows/<string:workflow_id>/run")
class WorkflowRunByIdApi(Resource):
    @service_api_ns.expect(workflow_run_parser)
    @service_api_ns.doc("run_workflow_by_id")
    @service_api_ns.doc(description="Execute a specific workflow by ID")
    @service_api_ns.doc(params={"workflow_id": "Workflow ID to execute"})
    @service_api_ns.doc(
        responses={
            200: "Workflow executed successfully",
            400: "Bad request - invalid parameters or workflow issues",
            401: "Unauthorized - invalid API token",
            404: "Workflow not found",
            429: "Rate limit exceeded",
            500: "Internal server error",
        }
    )
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON, required=True))
    def post(self, app_model: App, end_user: EndUser, workflow_id: str):
        """Run specific workflow by ID.

        Executes a specific workflow version identified by its ID.
        """
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode != AppMode.WORKFLOW:
            raise NotWorkflowAppError()

        args = workflow_run_parser.parse_args()

        # Add workflow_id to args for AppGenerateService
        args["workflow_id"] = workflow_id

        external_trace_id = get_external_trace_id(request)
        if external_trace_id:
            args["external_trace_id"] = external_trace_id
        streaming = args.get("response_mode") == "streaming"

        try:
            response = AppGenerateService.generate(
                app_model=app_model, user=end_user, args=args, invoke_from=InvokeFrom.SERVICE_API, streaming=streaming
            )

            return helper.compact_generate_response(response)
        except WorkflowNotFoundError as ex:
            raise NotFound(str(ex))
        except IsDraftWorkflowError as ex:
            raise BadRequest(str(ex))
        except WorkflowIdFormatError as ex:
            raise BadRequest(str(ex))
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except InvokeRateLimitError as ex:
            raise InvokeRateLimitHttpError(ex.description)
        except InvokeError as e:
            raise CompletionRequestError(e.description)
        except ValueError as e:
            raise e
        except Exception:
            logger.exception("internal server error.")
            raise InternalServerError()


@service_api_ns.route("/workflows/tasks/<string:task_id>/stop")
class WorkflowTaskStopApi(Resource):
    @service_api_ns.doc("stop_workflow_task")
    @service_api_ns.doc(description="Stop a running workflow task")
    @service_api_ns.doc(params={"task_id": "Task ID to stop"})
    @service_api_ns.doc(
        responses={
            200: "Task stopped successfully",
            401: "Unauthorized - invalid API token",
            404: "Task not found",
        }
    )
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON, required=True))
    def post(self, app_model: App, end_user: EndUser, task_id: str):
        """Stop a running workflow task."""
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode != AppMode.WORKFLOW:
            raise NotWorkflowAppError()

        # Stop using both mechanisms for backward compatibility
        # Legacy stop flag mechanism (without user check)
        AppQueueManager.set_stop_flag_no_user_check(task_id)

        # New graph engine command channel mechanism
        GraphEngineManager.send_stop_command(task_id)

        return {"result": "success"}


@service_api_ns.route("/workflows/logs")
class WorkflowAppLogApi(Resource):
    @service_api_ns.expect(workflow_log_parser)
    @service_api_ns.doc("get_workflow_logs")
    @service_api_ns.doc(description="Get workflow execution logs")
    @service_api_ns.doc(
        responses={
            200: "Logs retrieved successfully",
            401: "Unauthorized - invalid API token",
        }
    )
    @validate_app_token
    @service_api_ns.marshal_with(build_workflow_app_log_pagination_model(service_api_ns))
    def get(self, app_model: App):
        """Get workflow app logs.

        Returns paginated workflow execution logs with filtering options.
        """
        args = workflow_log_parser.parse_args()

        args.status = WorkflowExecutionStatus(args.status) if args.status else None
        if args.created_at__before:
            args.created_at__before = isoparse(args.created_at__before)

        if args.created_at__after:
            args.created_at__after = isoparse(args.created_at__after)

        # get paginate workflow app logs
        workflow_app_service = WorkflowAppService()
        with Session(db.engine) as session:
            workflow_app_log_pagination = workflow_app_service.get_paginate_workflow_app_logs(
                session=session,
                app_model=app_model,
                keyword=args.keyword,
                status=args.status,
                created_at_before=args.created_at__before,
                created_at_after=args.created_at__after,
                page=args.page,
                limit=args.limit,
                created_by_end_user_session_id=args.created_by_end_user_session_id,
                created_by_account=args.created_by_account,
            )

            return workflow_app_log_pagination
