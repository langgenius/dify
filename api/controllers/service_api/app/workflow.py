import logging

from dateutil.parser import isoparse
from flask import request
from flask_restful import Resource, fields, marshal_with, reqparse
from flask_restful.inputs import int_range
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import InternalServerError

from controllers.service_api import api
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
from core.workflow.entities.workflow_execution import WorkflowExecutionStatus
from extensions.ext_database import db
from fields.workflow_app_log_fields import workflow_app_log_pagination_fields
from libs import helper
from libs.helper import TimestampField
from models.model import App, AppMode, EndUser
from repositories.factory import DifyAPIRepositoryFactory
from services.app_generate_service import AppGenerateService
from services.errors.llm import InvokeRateLimitError
from services.workflow_app_service import WorkflowAppService

logger = logging.getLogger(__name__)

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


class WorkflowRunDetailApi(Resource):
    @validate_app_token
    @marshal_with(workflow_run_fields)
    def get(self, app_model: App, workflow_run_id: str):
        """
        Get a workflow task running detail
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


class WorkflowRunApi(Resource):
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON, required=True))
    def post(self, app_model: App, end_user: EndUser):
        """
        Run workflow
        """
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode != AppMode.WORKFLOW:
            raise NotWorkflowAppError()

        parser = reqparse.RequestParser()
        parser.add_argument("inputs", type=dict, required=True, nullable=False, location="json")
        parser.add_argument("files", type=list, required=False, location="json")
        parser.add_argument("response_mode", type=str, choices=["blocking", "streaming"], location="json")
        args = parser.parse_args()
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
            logging.exception("internal server error.")
            raise InternalServerError()


class WorkflowTaskStopApi(Resource):
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON, required=True))
    def post(self, app_model: App, end_user: EndUser, task_id: str):
        """
        Stop workflow task
        """
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode != AppMode.WORKFLOW:
            raise NotWorkflowAppError()

        AppQueueManager.set_stop_flag(task_id, InvokeFrom.SERVICE_API, end_user.id)

        return {"result": "success"}


class WorkflowAppLogApi(Resource):
    @validate_app_token
    @marshal_with(workflow_app_log_pagination_fields)
    def get(self, app_model: App):
        """
        Get workflow app logs
        """
        parser = reqparse.RequestParser()
        parser.add_argument("keyword", type=str, location="args")
        parser.add_argument("status", type=str, choices=["succeeded", "failed", "stopped"], location="args")
        parser.add_argument("created_at__before", type=str, location="args")
        parser.add_argument("created_at__after", type=str, location="args")
        parser.add_argument(
            "created_by_end_user_session_id",
            type=str,
            location="args",
            required=False,
            default=None,
        )
        parser.add_argument(
            "created_by_account",
            type=str,
            location="args",
            required=False,
            default=None,
        )
        parser.add_argument("page", type=int_range(1, 99999), default=1, location="args")
        parser.add_argument("limit", type=int_range(1, 100), default=20, location="args")
        args = parser.parse_args()

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


api.add_resource(WorkflowRunApi, "/workflows/run")
api.add_resource(WorkflowRunDetailApi, "/workflows/run/<string:workflow_run_id>")
api.add_resource(WorkflowTaskStopApi, "/workflows/tasks/<string:task_id>/stop")
api.add_resource(WorkflowAppLogApi, "/workflows/logs")
