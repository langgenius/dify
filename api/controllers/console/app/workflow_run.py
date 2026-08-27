from typing import Literal
from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator

from configs import dify_config
from controllers.common.errors import NotFoundError
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    model_validate,
)
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from fields.workflow_run_fields import (
    AdvancedChatWorkflowRunPaginationResponse,
    WorkflowRunCountResponse,
    WorkflowRunDetailResponse,
    WorkflowRunNodeExecutionListResponse,
    WorkflowRunNodeExecutionResponse,
    WorkflowRunPaginationResponse,
)
from libs.custom_inputs import time_duration
from libs.helper import dump_response, uuid_value
from machinery.context import RequestContext
from models import App, AppMode, WorkflowRunTriggeredFrom
from services.workflow_run_service import WorkflowRunListArgs


def _build_backstage_input_url(form_token: str | None) -> str | None:
    if not form_token:
        return None
    base_url = dify_config.APP_WEB_URL
    if not base_url:
        return None
    return f"{base_url.rstrip('/')}/form/{form_token}"


class WorkflowRunListQuery(BaseModel):
    last_id: str | None = Field(default=None, description="Last run ID for pagination")
    limit: int = Field(default=20, ge=1, le=100, description="Number of items per page (1-100)")
    status: Literal["running", "succeeded", "failed", "stopped", "partial-succeeded"] | None = Field(
        default=None, description="Workflow run status filter"
    )
    triggered_from: Literal["debugging", "app-run"] | None = Field(
        default=None, description="Filter by trigger source: debugging or app-run. Default: debugging"
    )

    @field_validator("last_id")
    @classmethod
    def validate_last_id(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return uuid_value(value)


class WorkflowRunCountQuery(BaseModel):
    status: Literal["running", "succeeded", "failed", "stopped", "partial-succeeded"] | None = Field(
        default=None, description="Workflow run status filter"
    )
    time_range: str | None = Field(
        default=None,
        description=(
            "Filter by time range (optional): e.g., 7d (7 days), 4h (4 hours), "
            "30m (30 minutes), 30s (30 seconds). Filters by created_at field."
        ),
    )
    triggered_from: Literal["debugging", "app-run"] | None = Field(
        default=None, description="Filter by trigger source: debugging or app-run. Default: debugging"
    )

    @field_validator("time_range")
    @classmethod
    def validate_time_range(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return time_duration(value)


def _workflow_run_list_args(req_data: WorkflowRunListQuery) -> WorkflowRunListArgs:
    args: WorkflowRunListArgs = {"limit": req_data.limit}
    if req_data.last_id is not None:
        args["last_id"] = req_data.last_id
    if req_data.status is not None:
        args["status"] = req_data.status
    return args


def _triggered_from(value: str | None) -> WorkflowRunTriggeredFrom:
    return WorkflowRunTriggeredFrom(value) if value else WorkflowRunTriggeredFrom.DEBUGGING


class HumanInputPauseTypeResponse(ResponseModel):
    type: Literal["human_input"]
    form_id: str
    backstage_input_url: str | None = None


class PausedNodeResponse(ResponseModel):
    node_id: str
    node_title: str
    pause_type: HumanInputPauseTypeResponse


class WorkflowPauseDetailsResponse(ResponseModel):
    paused_at: str | None = None
    paused_nodes: list[PausedNodeResponse]


register_schema_models(
    console_ns,
    WorkflowRunListQuery,
    WorkflowRunCountQuery,
)
register_response_schema_models(
    console_ns,
    AdvancedChatWorkflowRunPaginationResponse,
    WorkflowRunPaginationResponse,
    WorkflowRunCountResponse,
    WorkflowRunDetailResponse,
    WorkflowRunNodeExecutionResponse,
    WorkflowRunNodeExecutionListResponse,
    HumanInputPauseTypeResponse,
    PausedNodeResponse,
    WorkflowPauseDetailsResponse,
)


@console_ns.route("/apps/<uuid:app_id>/advanced-chat/workflow-runs")
class AdvancedChatAppWorkflowRunListApi(Resource):
    @console_ns.doc("get_advanced_chat_workflow_runs")
    @console_ns.doc(description="Get advanced chat workflow run list")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.doc(params=query_params_from_model(WorkflowRunListQuery))
    @console_ns.response(
        200,
        "Workflow runs retrieved successfully",
        console_ns.models[AdvancedChatWorkflowRunPaginationResponse.__name__],
    )
    @console_account_admission(
        rbac_resource_scope=RBACResourceScope.APP,
        rbac_permission=RBACPermission.APP_CREATE_AND_MANAGEMENT,
    )
    @get_app_model(mode=[AppMode.ADVANCED_CHAT])
    @model_validate(WorkflowRunListQuery)
    def get(self, req_data: WorkflowRunListQuery, request_context: RequestContext, app_model: App):
        """
        Get advanced chat app workflow run list
        """
        result = application_services().workflow_runs.get_paginate_advanced_chat_workflow_runs(
            request_context,
            app_id=app_model.id,
            args=_workflow_run_list_args(req_data),
            triggered_from=_triggered_from(req_data.triggered_from),
        )

        return dump_response(AdvancedChatWorkflowRunPaginationResponse, result)


@console_ns.route("/apps/<uuid:app_id>/advanced-chat/workflow-runs/count")
class AdvancedChatAppWorkflowRunCountApi(Resource):
    @console_ns.doc("get_advanced_chat_workflow_runs_count")
    @console_ns.doc(description="Get advanced chat workflow runs count statistics")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.doc(params=query_params_from_model(WorkflowRunCountQuery))
    @console_ns.response(
        200,
        "Workflow runs count retrieved successfully",
        console_ns.models[WorkflowRunCountResponse.__name__],
    )
    @console_account_admission(
        rbac_resource_scope=RBACResourceScope.APP,
        rbac_permission=RBACPermission.APP_CREATE_AND_MANAGEMENT,
    )
    @get_app_model(mode=[AppMode.ADVANCED_CHAT])
    @model_validate(WorkflowRunCountQuery)
    def get(self, req_data: WorkflowRunCountQuery, request_context: RequestContext, app_model: App):
        """
        Get advanced chat workflow runs count statistics
        """
        result = application_services().workflow_runs.get_workflow_runs_count(
            request_context,
            app_id=app_model.id,
            status=req_data.status,
            time_range=req_data.time_range,
            triggered_from=_triggered_from(req_data.triggered_from),
        )

        return dump_response(WorkflowRunCountResponse, result)


@console_ns.route("/apps/<uuid:app_id>/workflow-runs")
class WorkflowRunListApi(Resource):
    @console_ns.doc("get_workflow_runs")
    @console_ns.doc(description="Get workflow run list")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.doc(params=query_params_from_model(WorkflowRunListQuery))
    @console_ns.response(
        200,
        "Workflow runs retrieved successfully",
        console_ns.models[WorkflowRunPaginationResponse.__name__],
    )
    @console_account_admission(
        rbac_resource_scope=RBACResourceScope.APP,
        rbac_permission=RBACPermission.APP_CREATE_AND_MANAGEMENT,
    )
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @model_validate(WorkflowRunListQuery)
    def get(self, req_data: WorkflowRunListQuery, request_context: RequestContext, app_model: App):
        """
        Get workflow run list
        """
        result = application_services().workflow_runs.get_paginate_workflow_runs(
            request_context,
            app_id=app_model.id,
            args=_workflow_run_list_args(req_data),
            triggered_from=_triggered_from(req_data.triggered_from),
        )

        return dump_response(WorkflowRunPaginationResponse, result)


@console_ns.route("/apps/<uuid:app_id>/workflow-runs/count")
class WorkflowRunCountApi(Resource):
    @console_ns.doc("get_workflow_runs_count")
    @console_ns.doc(description="Get workflow runs count statistics")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.doc(params=query_params_from_model(WorkflowRunCountQuery))
    @console_ns.response(
        200,
        "Workflow runs count retrieved successfully",
        console_ns.models[WorkflowRunCountResponse.__name__],
    )
    @console_account_admission(
        rbac_resource_scope=RBACResourceScope.APP,
        rbac_permission=RBACPermission.APP_CREATE_AND_MANAGEMENT,
    )
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @model_validate(WorkflowRunCountQuery)
    def get(self, req_data: WorkflowRunCountQuery, request_context: RequestContext, app_model: App):
        """
        Get workflow runs count statistics
        """
        result = application_services().workflow_runs.get_workflow_runs_count(
            request_context,
            app_id=app_model.id,
            status=req_data.status,
            time_range=req_data.time_range,
            triggered_from=_triggered_from(req_data.triggered_from),
        )

        return dump_response(WorkflowRunCountResponse, result)


@console_ns.route("/apps/<uuid:app_id>/workflow-runs/<uuid:run_id>")
class WorkflowRunDetailApi(Resource):
    @console_ns.doc("get_workflow_run_detail")
    @console_ns.doc(description="Get workflow run detail")
    @console_ns.doc(params={"app_id": "Application ID", "run_id": "Workflow run ID"})
    @console_ns.response(
        200,
        "Workflow run detail retrieved successfully",
        console_ns.models[WorkflowRunDetailResponse.__name__],
    )
    @console_ns.response(404, "Workflow run not found")
    @console_account_admission(
        rbac_resource_scope=RBACResourceScope.APP,
        rbac_permission=RBACPermission.APP_CREATE_AND_MANAGEMENT,
    )
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, request_context: RequestContext, app_model: App, run_id: UUID):
        """
        Get workflow run detail
        """
        workflow_run = application_services().workflow_runs.get_workflow_run(
            request_context,
            app_id=app_model.id,
            run_id=str(run_id),
        )
        if workflow_run is None:
            raise NotFoundError("Workflow run not found")

        return dump_response(WorkflowRunDetailResponse, workflow_run)


@console_ns.route("/apps/<uuid:app_id>/workflow-runs/<uuid:run_id>/node-executions")
class WorkflowRunNodeExecutionListApi(Resource):
    @console_ns.doc("get_workflow_run_node_executions")
    @console_ns.doc(description="Get workflow run node execution list")
    @console_ns.doc(params={"app_id": "Application ID", "run_id": "Workflow run ID"})
    @console_ns.response(
        200,
        "Node executions retrieved successfully",
        console_ns.models[WorkflowRunNodeExecutionListResponse.__name__],
    )
    @console_ns.response(404, "Workflow run not found")
    @console_account_admission(
        rbac_resource_scope=RBACResourceScope.APP,
        rbac_permission=RBACPermission.APP_CREATE_AND_MANAGEMENT,
    )
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, request_context: RequestContext, app_model: App, run_id: UUID):
        """
        Get workflow run node execution list
        """
        node_executions = application_services().workflow_runs.get_workflow_run_node_executions(
            request_context,
            app_id=app_model.id,
            run_id=str(run_id),
        )

        return dump_response(WorkflowRunNodeExecutionListResponse, {"data": node_executions})


@console_ns.route("/workflow/<string:workflow_run_id>/pause-details")
class ConsoleWorkflowPauseDetailsApi(Resource):
    """Console API for getting workflow pause details."""

    @console_ns.doc("get_workflow_pause_details")
    @console_ns.doc(description="Get workflow pause details")
    @console_ns.doc(params={"workflow_run_id": "Workflow run ID"})
    @console_ns.response(
        200,
        "Workflow pause details retrieved successfully",
        console_ns.models[WorkflowPauseDetailsResponse.__name__],
    )
    @console_ns.response(404, "Workflow run not found")
    @console_account_admission()
    def get(self, request_context: RequestContext, workflow_run_id: str):
        """
        Get workflow pause details.

        GET /console/api/workflow/<workflow_run_id>/pause-details

        Returns information about why and where the workflow is paused.
        """

        details = application_services().workflow_runs.get_pause_details(
            request_context,
            workflow_run_id=workflow_run_id,
        )
        if details is None:
            raise NotFoundError("Workflow run not found")

        return (
            dump_response(
                WorkflowPauseDetailsResponse,
                {
                    "paused_at": details.paused_at.isoformat() + "Z" if details.paused_at else None,
                    "paused_nodes": [
                        {
                            "node_id": node.node_id,
                            "node_title": node.node_title,
                            "pause_type": {
                                "type": "human_input",
                                "form_id": node.form_id,
                                "backstage_input_url": _build_backstage_input_url(node.form_token),
                            },
                        }
                        for node in details.paused_nodes
                    ],
                },
            ),
            200,
        )
