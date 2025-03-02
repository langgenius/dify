import logging

from controllers.service_api_with_auth import api
from controllers.service_api_with_auth.app.error import (
    CompletionRequestError,
    NotWorkflowAppError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.service_api_with_auth.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_runtime.errors.invoke import InvokeError
from extensions.ext_database import db
from fields.workflow_app_log_fields import workflow_app_log_pagination_fields
from flask_restful import Resource, fields, marshal_with, reqparse  # type: ignore
from flask_restful.inputs import int_range  # type: ignore
from libs import helper
from models.model import App, AppMode, EndUser
from models.workflow import WorkflowRun
from services.app_generate_service import AppGenerateService
from services.workflow_app_service import WorkflowAppService
from werkzeug.exceptions import InternalServerError

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
        """Get workflow run details.
        ---
        tags:
          - service/workflow
        summary: Get workflow run details
        description: Retrieve details of a specific workflow run
        security:
          - ApiKeyAuth: []
        parameters:
          - name: workflow_id
            in: path
            required: true
            type: string
            description: ID of the workflow run to retrieve
        responses:
          200:
            description: Workflow run details retrieved successfully
            schema:
              type: object
              properties:
                id:
                  type: string
                workflow_id:
                  type: string
                status:
                  type: string
                inputs:
                  type: object
                outputs:
                  type: object
                error:
                  type: string
                total_steps:
                  type: integer
                total_tokens:
                  type: integer
                created_at:
                  type: string
                  format: date-time
                finished_at:
                  type: string
                  format: date-time
                elapsed_time:
                  type: number
                  format: float
          401:
            description: Invalid or missing token
          404:
            description: Workflow run not found or not a workflow app
        """
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode != AppMode.WORKFLOW:
            raise NotWorkflowAppError()

        workflow_run = db.session.query(WorkflowRun).filter(WorkflowRun.id == workflow_id).first()
        return workflow_run


class WorkflowRunApi(Resource):
    @validate_app_token
    def post(self, app_model: App, end_user: EndUser):
        """Run a workflow.
        ---
        tags:
          - service/workflow
        summary: Run workflow
        description: Execute a workflow with the provided inputs
        security:
          - ApiKeyAuth: []
        parameters:
          - name: body
            in: body
            required: true
            schema:
              type: object
              required:
                - inputs
              properties:
                inputs:
                  type: object
                  description: Input variables for the workflow
                response_mode:
                  type: string
                  enum: [blocking, streaming]
                  description: Response delivery mode
        responses:
          200:
            description: Workflow executed successfully
          400:
            description: Invalid request
          401:
            description: Invalid or missing token
          404:
            description: Not a workflow app
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
        except InvokeError as e:
            raise CompletionRequestError(e.description)
        except ValueError as e:
            raise e
        except Exception as e:
            logging.exception("internal server error.")
            raise InternalServerError()


class WorkflowTaskStopApi(Resource):
    @validate_app_token
    def post(self, app_model: App, end_user: EndUser, task_id: str):
        """Stop a running workflow task.
        ---
        tags:
          - service/workflow
        summary: Stop workflow task
        description: Stop a running workflow task
        security:
          - ApiKeyAuth: []
        parameters:
          - name: task_id
            in: path
            required: true
            type: string
            description: ID of the task to stop
        responses:
          200:
            description: Task stopped successfully
            schema:
              type: object
              properties:
                result:
                  type: string
                  example: success
          401:
            description: Invalid or missing token
          404:
            description: Not a workflow app
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
        """Get workflow app logs.
        ---
        tags:
          - service/workflow
        summary: Get workflow logs
        description: Retrieve logs for workflow app executions
        security:
          - ApiKeyAuth: []
        parameters:
          - name: page
            in: query
            type: integer
            minimum: 1
            default: 1
            description: Page number for pagination
          - name: limit
            in: query
            type: integer
            minimum: 1
            maximum: 100
            default: 20
            description: Number of logs per page
        responses:
          200:
            description: Workflow logs retrieved successfully
            schema:
              type: object
              properties:
                data:
                  type: array
                  items:
                    type: object
                has_more:
                  type: boolean
                limit:
                  type: integer
                total:
                  type: integer
                page:
                  type: integer
          401:
            description: Invalid or missing token
          404:
            description: Not a workflow app
        """
        parser = reqparse.RequestParser()
        parser.add_argument("keyword", type=str, location="args")
        parser.add_argument("status", type=str, choices=["succeeded", "failed", "stopped"], location="args")
        parser.add_argument("page", type=int_range(1, 99999), default=1, location="args")
        parser.add_argument("limit", type=int_range(1, 100), default=20, location="args")
        args = parser.parse_args()

        # get paginate workflow app logs
        workflow_app_service = WorkflowAppService()
        workflow_app_log_pagination = workflow_app_service.get_paginate_workflow_app_logs(
            app_model=app_model, args=args
        )

        return workflow_app_log_pagination


api.add_resource(WorkflowRunApi, "/workflows/run")
api.add_resource(WorkflowRunDetailApi, "/workflows/run/<string:workflow_id>")
api.add_resource(WorkflowTaskStopApi, "/workflows/tasks/<string:task_id>/stop")
api.add_resource(WorkflowAppLogApi, "/workflows/logs")
