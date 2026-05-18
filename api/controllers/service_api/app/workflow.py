import logging
from collections.abc import Mapping
from datetime import datetime
from typing import Literal

from dateutil.parser import isoparse
from flask import request
from flask_restx import Resource, fields
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import sessionmaker
from werkzeug.exceptions import BadRequest, InternalServerError, NotFound

from controllers.common.controller_schemas import WorkflowRunPayload as WorkflowRunPayloadBase
from controllers.common.schema import register_schema_models
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
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from fields.base import ResponseModel
from fields.end_user_fields import SimpleEndUser
from fields.member_fields import SimpleAccount
from graphon.enums import WorkflowExecutionStatus
from graphon.graph_engine.manager import GraphEngineManager
from graphon.model_runtime.errors.invoke import InvokeError
from libs import helper
from libs.helper import to_timestamp
from models.model import App, AppMode, EndUser
from models.workflow import WorkflowRun
from repositories.factory import DifyAPIRepositoryFactory
from services.app_generate_service import AppGenerateService
from services.errors.app import IsDraftWorkflowError, WorkflowIdFormatError, WorkflowNotFoundError
from services.errors.llm import InvokeRateLimitError
from services.workflow_app_service import WorkflowAppService

logger = logging.getLogger(__name__)


class WorkflowRunPayload(WorkflowRunPayloadBase):
    response_mode: Literal["blocking", "streaming"] | None = None


class WorkflowLogQuery(BaseModel):
    keyword: str | None = None
    status: Literal["succeeded", "failed", "stopped"] | None = None
    created_at__before: str | None = None
    created_at__after: str | None = None
    created_by_end_user_session_id: str | None = None
    created_by_account: str | None = None
    page: int = Field(default=1, ge=1, le=99999)
    limit: int = Field(default=20, ge=1, le=100)


register_schema_models(service_api_ns, WorkflowRunPayload, WorkflowLogQuery)


def _enum_value(value):
    return getattr(value, "value", value)


class WorkflowRunStatusField(fields.Raw):
    def output(self, key, obj: WorkflowRun, **kwargs):
        return _enum_value(obj.status)


class WorkflowRunOutputsField(fields.Raw):
    def output(self, key, obj: WorkflowRun, **kwargs):
        status = _enum_value(obj.status)
        if status == WorkflowExecutionStatus.PAUSED.value:
            return {}

        outputs = obj.outputs_dict
        return outputs or {}


class WorkflowRunResponse(ResponseModel):
    id: str
    workflow_id: str
    status: str
    inputs: dict | list | str | int | float | bool | None = None
    outputs: dict = Field(default_factory=dict)
    error: str | None = None
    total_steps: int | None = None
    total_tokens: int | None = None
    created_at: int | None = None
    finished_at: int | None = None
    elapsed_time: float | int | None = None

    @field_validator("created_at", "finished_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class WorkflowRunForLogResponse(ResponseModel):
    id: str
    version: str | None = None
    status: str | None = None
    triggered_from: str | None = None
    error: str | None = None
    elapsed_time: float | int | None = None
    total_tokens: int | None = None
    total_steps: int | None = None
    created_at: int | None = None
    finished_at: int | None = None
    exceptions_count: int | None = None

    @field_validator("status", "triggered_from", mode="before")
    @classmethod
    def _normalize_enum(cls, value):
        return _enum_value(value)

    @field_validator("created_at", "finished_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class WorkflowAppLogPartialResponse(ResponseModel):
    id: str
    workflow_run: WorkflowRunForLogResponse | None = None
    details: dict | list | str | int | float | bool | None = None
    created_from: str | None = None
    created_by_role: str | None = None
    created_by_account: SimpleAccount | None = None
    created_by_end_user: SimpleEndUser | None = None
    created_at: int | None = None

    @field_validator("created_from", "created_by_role", mode="before")
    @classmethod
    def _normalize_enum(cls, value):
        return _enum_value(value)

    @field_validator("created_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class WorkflowAppLogPaginationResponse(ResponseModel):
    page: int
    limit: int
    total: int
    has_more: bool
    data: list[WorkflowAppLogPartialResponse]


register_schema_models(
    service_api_ns,
    WorkflowRunResponse,
    WorkflowRunForLogResponse,
    WorkflowAppLogPartialResponse,
    WorkflowAppLogPaginationResponse,
)


def _serialize_workflow_run(workflow_run: WorkflowRun) -> dict:
    status = _enum_value(workflow_run.status)
    raw_outputs = workflow_run.outputs_dict
    if status == WorkflowExecutionStatus.PAUSED.value or raw_outputs is None:
        outputs: dict = {}
    elif isinstance(raw_outputs, dict):
        outputs = raw_outputs
    elif isinstance(raw_outputs, Mapping):
        outputs = dict(raw_outputs)
    else:
        outputs = {}
    return WorkflowRunResponse.model_validate(
        {
            "id": workflow_run.id,
            "workflow_id": workflow_run.workflow_id,
            "status": status,
            "inputs": workflow_run.inputs,
            "outputs": outputs,
            "error": workflow_run.error,
            "total_steps": workflow_run.total_steps,
            "total_tokens": workflow_run.total_tokens,
            "created_at": workflow_run.created_at,
            "finished_at": workflow_run.finished_at,
            "elapsed_time": workflow_run.elapsed_time,
        }
    ).model_dump(mode="json")


def _serialize_workflow_log_pagination(pagination) -> dict:
    return WorkflowAppLogPaginationResponse.model_validate(pagination, from_attributes=True).model_dump(mode="json")


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
    @service_api_ns.response(
        200,
        "Workflow run details retrieved successfully",
        service_api_ns.models[WorkflowRunResponse.__name__],
    )
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
        if not workflow_run:
            raise NotFound("Workflow run not found.")
        return _serialize_workflow_run(workflow_run)


@service_api_ns.route("/workflows/run")
class WorkflowRunApi(Resource):
    @service_api_ns.expect(service_api_ns.models[WorkflowRunPayload.__name__])
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

        payload = WorkflowRunPayload.model_validate(service_api_ns.payload or {})
        args = payload.model_dump(exclude_none=True)
        external_trace_id = get_external_trace_id(request)
        if external_trace_id:
            args["external_trace_id"] = external_trace_id
        streaming = payload.response_mode == "streaming"

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
    @service_api_ns.expect(service_api_ns.models[WorkflowRunPayload.__name__])
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

        payload = WorkflowRunPayload.model_validate(service_api_ns.payload or {})
        args = payload.model_dump(exclude_none=True)

        # Add workflow_id to args for AppGenerateService
        args["workflow_id"] = workflow_id

        external_trace_id = get_external_trace_id(request)
        if external_trace_id:
            args["external_trace_id"] = external_trace_id
        streaming = payload.response_mode == "streaming"

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
        GraphEngineManager(redis_client).send_stop_command(task_id)

        return {"result": "success"}


@service_api_ns.route("/workflows/logs")
class WorkflowAppLogApi(Resource):
    @service_api_ns.expect(service_api_ns.models[WorkflowLogQuery.__name__])
    @service_api_ns.doc("get_workflow_logs")
    @service_api_ns.doc(description="Get workflow execution logs")
    @service_api_ns.doc(
        responses={
            200: "Logs retrieved successfully",
            401: "Unauthorized - invalid API token",
        }
    )
    @validate_app_token
    @service_api_ns.response(
        200,
        "Logs retrieved successfully",
        service_api_ns.models[WorkflowAppLogPaginationResponse.__name__],
    )
    def get(self, app_model: App):
        """Get workflow app logs.

        Returns paginated workflow execution logs with filtering options.
        """
        args = WorkflowLogQuery.model_validate(request.args.to_dict())

        status = WorkflowExecutionStatus(args.status) if args.status else None
        created_at_before = isoparse(args.created_at__before) if args.created_at__before else None
        created_at_after = isoparse(args.created_at__after) if args.created_at__after else None

        # get paginate workflow app logs
        workflow_app_service = WorkflowAppService()
        with sessionmaker(db.engine).begin() as session:
            workflow_app_log_pagination = workflow_app_service.get_paginate_workflow_app_logs(
                session=session,
                app_model=app_model,
                keyword=args.keyword,
                status=status,
                created_at_before=created_at_before,
                created_at_after=created_at_after,
                page=args.page,
                limit=args.limit,
                created_by_end_user_session_id=args.created_by_end_user_session_id,
                created_by_account=args.created_by_account,
            )

            return _serialize_workflow_log_pagination(workflow_app_log_pagination)
