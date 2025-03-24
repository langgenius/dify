import logging
from datetime import datetime

from flask_restful import Resource, fields, marshal_with, reqparse  # type: ignore
from flask_restful.inputs import int_range  # type: ignore
from sqlalchemy.orm import Session
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
from core.model_runtime.errors.invoke import InvokeError
from extensions.ext_database import db
from fields.workflow_app_log_fields import workflow_app_log_pagination_fields
from libs import helper
from models.model import App, AppMode, EndUser
from models.workflow import WorkflowRun, WorkflowRunStatus
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
    "created_at": fields.DateTime,
    "finished_at": fields.DateTime,
    "elapsed_time": fields.Float,
}


class WorkflowRunDetailApi(Resource):
    @validate_app_token
    @marshal_with(workflow_run_fields)
    def get(self, app_model: App, workflow_id: str):
        """
        Get a workflow task running detail
        """
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode != AppMode.WORKFLOW:
            raise NotWorkflowAppError()

        workflow_run = db.session.query(WorkflowRun).filter(WorkflowRun.id == workflow_id).first()
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
        parser.add_argument("page", type=int_range(1, 99999), default=1, location="args")
        parser.add_argument("limit", type=int_range(1, 100), default=20, location="args")
        args = parser.parse_args()

        args.status = WorkflowRunStatus(args.status) if args.status else None
        if args.created_at__before:
            args.created_at__before = datetime.fromisoformat(args.created_at__before.replace("Z", "+00:00"))

        if args.created_at__after:
            args.created_at__after = datetime.fromisoformat(args.created_at__after.replace("Z", "+00:00"))

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
            )

            return workflow_app_log_pagination


api.add_resource(WorkflowRunApi, "/workflows/run")
api.add_resource(WorkflowRunDetailApi, "/workflows/run/<string:workflow_id>")
api.add_resource(WorkflowTaskStopApi, "/workflows/tasks/<string:task_id>/stop")
api.add_resource(WorkflowAppLogApi, "/workflows/logs")
