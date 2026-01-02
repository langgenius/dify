from typing import Literal, cast

from flask import request
from flask_restx import Resource, fields, marshal_with
from pydantic import BaseModel, Field, field_validator
from werkzeug.exceptions import BadRequest, Conflict, NotFound

from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from fields.end_user_fields import simple_end_user_fields
from fields.member_fields import simple_account_fields
from fields.workflow_run_fields import (
    advanced_chat_workflow_run_for_list_fields,
    advanced_chat_workflow_run_pagination_fields,
    workflow_run_count_fields,
    workflow_run_detail_fields,
    workflow_run_for_list_fields,
    workflow_run_node_execution_fields,
    workflow_run_node_execution_list_fields,
    workflow_run_pagination_fields,
)
from libs.custom_inputs import time_duration
from libs.helper import uuid_value
from libs.login import current_user, login_required
from models import Account, App, AppMode, EndUser, WorkflowRunTriggeredFrom
from services.workflow_run_service import WorkflowRunService

# Workflow run status choices for filtering
WORKFLOW_RUN_STATUS_CHOICES = ["running", "succeeded", "failed", "stopped", "partial-succeeded"]

# Register models for flask_restx to avoid dict type issues in Swagger
# Register in dependency order: base models first, then dependent models

# Base models
simple_account_model = console_ns.model("SimpleAccount", simple_account_fields)

simple_end_user_model = console_ns.model("SimpleEndUser", simple_end_user_fields)

# Models that depend on simple_account_fields
workflow_run_for_list_fields_copy = workflow_run_for_list_fields.copy()
workflow_run_for_list_fields_copy["created_by_account"] = fields.Nested(
    simple_account_model, attribute="created_by_account", allow_null=True
)
workflow_run_for_list_model = console_ns.model("WorkflowRunForList", workflow_run_for_list_fields_copy)

advanced_chat_workflow_run_for_list_fields_copy = advanced_chat_workflow_run_for_list_fields.copy()
advanced_chat_workflow_run_for_list_fields_copy["created_by_account"] = fields.Nested(
    simple_account_model, attribute="created_by_account", allow_null=True
)
advanced_chat_workflow_run_for_list_model = console_ns.model(
    "AdvancedChatWorkflowRunForList", advanced_chat_workflow_run_for_list_fields_copy
)

workflow_run_detail_fields_copy = workflow_run_detail_fields.copy()
workflow_run_detail_fields_copy["created_by_account"] = fields.Nested(
    simple_account_model, attribute="created_by_account", allow_null=True
)
workflow_run_detail_fields_copy["created_by_end_user"] = fields.Nested(
    simple_end_user_model, attribute="created_by_end_user", allow_null=True
)
workflow_run_detail_model = console_ns.model("WorkflowRunDetail", workflow_run_detail_fields_copy)

workflow_run_node_execution_fields_copy = workflow_run_node_execution_fields.copy()
workflow_run_node_execution_fields_copy["created_by_account"] = fields.Nested(
    simple_account_model, attribute="created_by_account", allow_null=True
)
workflow_run_node_execution_fields_copy["created_by_end_user"] = fields.Nested(
    simple_end_user_model, attribute="created_by_end_user", allow_null=True
)
workflow_run_node_execution_model = console_ns.model(
    "WorkflowRunNodeExecution", workflow_run_node_execution_fields_copy
)

# Simple models without nested dependencies
workflow_run_count_model = console_ns.model("WorkflowRunCount", workflow_run_count_fields)

# Pagination models that depend on list models
advanced_chat_workflow_run_pagination_fields_copy = advanced_chat_workflow_run_pagination_fields.copy()
advanced_chat_workflow_run_pagination_fields_copy["data"] = fields.List(
    fields.Nested(advanced_chat_workflow_run_for_list_model), attribute="data"
)
advanced_chat_workflow_run_pagination_model = console_ns.model(
    "AdvancedChatWorkflowRunPagination", advanced_chat_workflow_run_pagination_fields_copy
)

workflow_run_pagination_fields_copy = workflow_run_pagination_fields.copy()
workflow_run_pagination_fields_copy["data"] = fields.List(fields.Nested(workflow_run_for_list_model), attribute="data")
workflow_run_pagination_model = console_ns.model("WorkflowRunPagination", workflow_run_pagination_fields_copy)

workflow_run_node_execution_list_fields_copy = workflow_run_node_execution_list_fields.copy()
workflow_run_node_execution_list_fields_copy["data"] = fields.List(fields.Nested(workflow_run_node_execution_model))
workflow_run_node_execution_list_model = console_ns.model(
    "WorkflowRunNodeExecutionList", workflow_run_node_execution_list_fields_copy
)

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class WorkflowRunListQuery(BaseModel):
    last_id: str | None = Field(default=None, description="Last run ID for pagination")
    limit: int = Field(default=20, ge=1, le=100, description="Number of items per page (1-100)")
    status: Literal["running", "succeeded", "failed", "stopped", "partial-succeeded"] | None = Field(
        default=None, description="Workflow run status filter"
    )
    triggered_from: Literal["debugging", "app-run"] | None = Field(
        default=None, description="Filter by trigger source: debugging or app-run"
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
    time_range: str | None = Field(default=None, description="Time range filter (e.g., 7d, 4h, 30m, 30s)")
    triggered_from: Literal["debugging", "app-run"] | None = Field(
        default=None, description="Filter by trigger source: debugging or app-run"
    )

    @field_validator("time_range")
    @classmethod
    def validate_time_range(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return time_duration(value)


console_ns.schema_model(
    WorkflowRunListQuery.__name__, WorkflowRunListQuery.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0)
)
console_ns.schema_model(
    WorkflowRunCountQuery.__name__,
    WorkflowRunCountQuery.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
)


@console_ns.route("/apps/<uuid:app_id>/advanced-chat/workflow-runs")
class AdvancedChatAppWorkflowRunListApi(Resource):
    @console_ns.doc("get_advanced_chat_workflow_runs")
    @console_ns.doc(description="Get advanced chat workflow run list")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.doc(params={"last_id": "Last run ID for pagination", "limit": "Number of items per page (1-100)"})
    @console_ns.doc(
        params={"status": "Filter by status (optional): running, succeeded, failed, stopped, partial-succeeded"}
    )
    @console_ns.doc(
        params={"triggered_from": "Filter by trigger source (optional): debugging or app-run. Default: debugging"}
    )
    @console_ns.expect(console_ns.models[WorkflowRunListQuery.__name__])
    @console_ns.response(200, "Workflow runs retrieved successfully", advanced_chat_workflow_run_pagination_model)
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT])
    @marshal_with(advanced_chat_workflow_run_pagination_model)
    def get(self, app_model: App):
        """
        Get advanced chat app workflow run list
        """
        args_model = WorkflowRunListQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore
        args = args_model.model_dump(exclude_none=True)

        # Default to DEBUGGING if not specified
        triggered_from = (
            WorkflowRunTriggeredFrom(args_model.triggered_from)
            if args_model.triggered_from
            else WorkflowRunTriggeredFrom.DEBUGGING
        )

        workflow_run_service = WorkflowRunService()
        result = workflow_run_service.get_paginate_advanced_chat_workflow_runs(
            app_model=app_model, args=args, triggered_from=triggered_from
        )

        return result


@console_ns.route("/apps/<uuid:app_id>/advanced-chat/workflow-runs/count")
class AdvancedChatAppWorkflowRunCountApi(Resource):
    @console_ns.doc("get_advanced_chat_workflow_runs_count")
    @console_ns.doc(description="Get advanced chat workflow runs count statistics")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.doc(
        params={"status": "Filter by status (optional): running, succeeded, failed, stopped, partial-succeeded"}
    )
    @console_ns.doc(
        params={
            "time_range": (
                "Filter by time range (optional): e.g., 7d (7 days), 4h (4 hours), "
                "30m (30 minutes), 30s (30 seconds). Filters by created_at field."
            )
        }
    )
    @console_ns.doc(
        params={"triggered_from": "Filter by trigger source (optional): debugging or app-run. Default: debugging"}
    )
    @console_ns.response(200, "Workflow runs count retrieved successfully", workflow_run_count_model)
    @console_ns.expect(console_ns.models[WorkflowRunCountQuery.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT])
    @marshal_with(workflow_run_count_model)
    def get(self, app_model: App):
        """
        Get advanced chat workflow runs count statistics
        """
        args_model = WorkflowRunCountQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore
        args = args_model.model_dump(exclude_none=True)

        # Default to DEBUGGING if not specified
        triggered_from = (
            WorkflowRunTriggeredFrom(args_model.triggered_from)
            if args_model.triggered_from
            else WorkflowRunTriggeredFrom.DEBUGGING
        )

        workflow_run_service = WorkflowRunService()
        result = workflow_run_service.get_workflow_runs_count(
            app_model=app_model,
            status=args.get("status"),
            time_range=args.get("time_range"),
            triggered_from=triggered_from,
        )

        return result


@console_ns.route("/apps/<uuid:app_id>/workflow-runs")
class WorkflowRunListApi(Resource):
    @console_ns.doc("get_workflow_runs")
    @console_ns.doc(description="Get workflow run list")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.doc(params={"last_id": "Last run ID for pagination", "limit": "Number of items per page (1-100)"})
    @console_ns.doc(
        params={"status": "Filter by status (optional): running, succeeded, failed, stopped, partial-succeeded"}
    )
    @console_ns.doc(
        params={"triggered_from": "Filter by trigger source (optional): debugging or app-run. Default: debugging"}
    )
    @console_ns.response(200, "Workflow runs retrieved successfully", workflow_run_pagination_model)
    @console_ns.expect(console_ns.models[WorkflowRunListQuery.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_run_pagination_model)
    def get(self, app_model: App):
        """
        Get workflow run list
        """
        args_model = WorkflowRunListQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore
        args = args_model.model_dump(exclude_none=True)

        # Default to DEBUGGING for workflow if not specified (backward compatibility)
        triggered_from = (
            WorkflowRunTriggeredFrom(args_model.triggered_from)
            if args_model.triggered_from
            else WorkflowRunTriggeredFrom.DEBUGGING
        )

        workflow_run_service = WorkflowRunService()
        result = workflow_run_service.get_paginate_workflow_runs(
            app_model=app_model, args=args, triggered_from=triggered_from
        )

        return result


@console_ns.route("/apps/<uuid:app_id>/workflow-runs/count")
class WorkflowRunCountApi(Resource):
    @console_ns.doc("get_workflow_runs_count")
    @console_ns.doc(description="Get workflow runs count statistics")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.doc(
        params={"status": "Filter by status (optional): running, succeeded, failed, stopped, partial-succeeded"}
    )
    @console_ns.doc(
        params={
            "time_range": (
                "Filter by time range (optional): e.g., 7d (7 days), 4h (4 hours), "
                "30m (30 minutes), 30s (30 seconds). Filters by created_at field."
            )
        }
    )
    @console_ns.doc(
        params={"triggered_from": "Filter by trigger source (optional): debugging or app-run. Default: debugging"}
    )
    @console_ns.response(200, "Workflow runs count retrieved successfully", workflow_run_count_model)
    @console_ns.expect(console_ns.models[WorkflowRunCountQuery.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_run_count_model)
    def get(self, app_model: App):
        """
        Get workflow runs count statistics
        """
        args_model = WorkflowRunCountQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore
        args = args_model.model_dump(exclude_none=True)

        # Default to DEBUGGING for workflow if not specified (backward compatibility)
        triggered_from = (
            WorkflowRunTriggeredFrom(args_model.triggered_from)
            if args_model.triggered_from
            else WorkflowRunTriggeredFrom.DEBUGGING
        )

        workflow_run_service = WorkflowRunService()
        result = workflow_run_service.get_workflow_runs_count(
            app_model=app_model,
            status=args.get("status"),
            time_range=args.get("time_range"),
            triggered_from=triggered_from,
        )

        return result


@console_ns.route("/apps/<uuid:app_id>/workflow-runs/<uuid:run_id>")
class WorkflowRunDetailApi(Resource):
    @console_ns.doc("get_workflow_run_detail")
    @console_ns.doc(description="Get workflow run detail")
    @console_ns.doc(params={"app_id": "Application ID", "run_id": "Workflow run ID"})
    @console_ns.response(200, "Workflow run detail retrieved successfully", workflow_run_detail_model)
    @console_ns.response(404, "Workflow run not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_run_detail_model)
    def get(self, app_model: App, run_id):
        """
        Get workflow run detail
        """
        run_id = str(run_id)

        workflow_run_service = WorkflowRunService()
        workflow_run = workflow_run_service.get_workflow_run(app_model=app_model, run_id=run_id)

        return workflow_run


@console_ns.route("/apps/<uuid:app_id>/workflow-runs/<uuid:run_id>/node-executions")
class WorkflowRunNodeExecutionListApi(Resource):
    @console_ns.doc("get_workflow_run_node_executions")
    @console_ns.doc(description="Get workflow run node execution list")
    @console_ns.doc(params={"app_id": "Application ID", "run_id": "Workflow run ID"})
    @console_ns.response(200, "Node executions retrieved successfully", workflow_run_node_execution_list_model)
    @console_ns.response(404, "Workflow run not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_run_node_execution_list_model)
    def get(self, app_model: App, run_id):
        """
        Get workflow run node execution list
        """
        run_id = str(run_id)

        workflow_run_service = WorkflowRunService()
        user = cast("Account | EndUser", current_user)
        node_executions = workflow_run_service.get_workflow_run_node_executions(
            app_model=app_model,
            run_id=run_id,
            user=user,
        )

        return {"data": node_executions}


class WorkflowResumeRequest(BaseModel):
    reason: str = Field(..., min_length=1, max_length=500, description="Reason for resuming the workflow")
    action: Literal["approve", "reject"] = Field(..., description="Action to take: approve or reject")
    use_signal: bool = Field(default=True, description="Use Redis signal for debugger mode SSE")


console_ns.schema_model(
    WorkflowResumeRequest.__name__,
    WorkflowResumeRequest.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
)


@console_ns.route("/apps/<uuid:app_id>/workflow-runs/<uuid:run_id>/resume")
class WorkflowRunResumeApi(Resource):
    @console_ns.doc("resume_workflow_run")
    @console_ns.doc(description="Resume a paused workflow run with a reason")
    @console_ns.doc(params={"app_id": "Application ID", "run_id": "Workflow run ID"})
    @console_ns.doc(body=console_ns.models[WorkflowResumeRequest.__name__])
    @console_ns.expect(console_ns.models[WorkflowResumeRequest.__name__])
    @console_ns.response(200, "Workflow resumed successfully")
    @console_ns.response(400, "Bad request - workflow not in paused state or invalid reason")
    @console_ns.response(404, "Workflow run not found")
    @console_ns.response(409, "Workflow already resumed")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def post(self, app_model: App, run_id):
        """
        Resume a paused workflow run.

        This endpoint allows resuming a workflow that was paused due to a HumanInputNode.
        A reason must be provided explaining why the workflow is being resumed.
        The workflow will continue execution from where it was paused.

        Request body:
        - reason (string, required): Reason for resuming (1-500 characters)

        Returns:
        - result: "success" if resumption was triggered
        - workflow_run_id: The ID of the resumed workflow run
        - status: "running" (workflow is now resuming execution)
        - resumed_at: ISO 8601 timestamp when workflow was resumed
        - resume_reason: The provided reason for resuming
        """
        run_id = str(run_id)
        user = cast(Account, current_user)

        # Validate request body
        try:
            resume_request = WorkflowResumeRequest.model_validate(request.get_json())
        except Exception as e:
            raise BadRequest(str(e))

        # Call service to resume workflow
        workflow_run_service = WorkflowRunService()
        try:
            result = workflow_run_service.resume_workflow(
                app_model=app_model,
                run_id=run_id,
                user_id=user.id,
                resume_reason=resume_request.reason,
                action=resume_request.action,
                use_signal=resume_request.use_signal,
            )
            return result, 200
        except ValueError as e:
            error_msg = str(e)
            if "not found" in error_msg:
                raise NotFound(error_msg)
            elif "not in paused state" in error_msg:
                raise BadRequest(error_msg)
            elif "already been resumed" in error_msg or "No active pause" in error_msg:
                raise Conflict("Workflow has already been resumed")
            else:
                raise BadRequest(error_msg)


@console_ns.route("/apps/<uuid:app_id>/workflow-runs/<uuid:run_id>/pause-info")
class WorkflowRunPauseInfoApi(Resource):
    @console_ns.doc("get_workflow_run_pause_info")
    @console_ns.doc(description="Get pause information for a workflow run")
    @console_ns.doc(params={"app_id": "Application ID", "run_id": "Workflow run ID"})
    @console_ns.response(200, "Pause information retrieved successfully")
    @console_ns.response(404, "Workflow run not found or not paused")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App, run_id):
        """
        Get pause information for a workflow run.

        Returns detailed information about a paused workflow, including:
        - status: Current pause status ("paused" or "resumed")
        - pause_reason: Details about why the workflow was paused
          - type: Pause reason type (e.g., "human_input_required")
          - node_id: ID of the node that triggered the pause
          - pause_reason_text: Human-readable reason message
        - paused_at: ISO 8601 timestamp when workflow was paused
        - resumed_at: ISO 8601 timestamp when workflow was resumed (null if not resumed)
        - resume_reason: Reason provided when workflow was resumed (null if not resumed)
        """
        run_id = str(run_id)

        workflow_run_service = WorkflowRunService()
        pause_info = workflow_run_service.get_pause_info(app_model=app_model, run_id=run_id)

        if not pause_info:
            raise NotFound("Workflow run not found or not paused")

        return pause_info, 200
