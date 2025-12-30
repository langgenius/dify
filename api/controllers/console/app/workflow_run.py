import json
from typing import Literal, cast

from flask import request
from flask_restx import Resource, fields, marshal_with
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import sessionmaker

from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from controllers.web.error import NotFoundError
from core.workflow.enums import WorkflowExecutionStatus
from extensions.ext_database import db
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
from libs.login import current_account_with_tenant, current_user, login_required
from models import Account, App, AppMode, EndUser, WorkflowRunTriggeredFrom
from models.workflow import WorkflowRun
from repositories.factory import DifyAPIRepositoryFactory
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


@console_ns.route("/workflow/<string:workflow_run_id>/pause-details")
class ConsoleWorkflowPauseDetailsApi(Resource):
    """Console API for getting workflow pause details."""

    @account_initialization_required
    @login_required
    def get(self, workflow_run_id: str):
        """
        Get workflow pause details.

        GET /console/api/workflow/<workflow_run_id>/pause-details

        Returns information about why and where the workflow is paused.
        """

        # Query WorkflowRun to determine if workflow is suspended
        account, tenant = current_account_with_tenant()
        session_maker = sessionmaker(bind=db.engine)
        workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_maker=session_maker)
        workflow_run = db.session.get(WorkflowRun, workflow_run_id)
        if not workflow_run:
            raise NotFoundError("Workflow run not found")

        # Check if workflow is suspended
        is_paused = workflow_run.status == WorkflowExecutionStatus.PAUSED
        if not is_paused:
            return {
                "paused_at": None,
                "paused_nodes": [],
            }, 200

        pause_entity = workflow_run_repo.get_workflow_pause(workflow_run_id)
        pause_reasons: list[dict[str, object]] = []
        if pause_entity:
            for reason in pause_entity.get_pause_reasons():
                pause_reasons.append(reason.model_dump(mode="json"))

        # Get pending Human Input forms for this workflow run
        service = HumanInputFormService(db.session())
        pending_forms = service.get_pending_forms_for_workflow_run(workflow_run_id)

        # Build response
        response = {
            "paused_at": workflow_run.created_at.isoformat() + "Z" if workflow_run.created_at else None,
            "paused_nodes": [],
        }

        # Add pending human input forms
        for form in pending_forms:
            form_definition = json.loads(form.form_definition) if form.form_definition else {}
            response["pending_human_inputs"].append(
                {
                    "form_id": form.id,
                    "node_id": form_definition.get("node_id", "unknown"),
                    "node_title": form_definition.get("title", "Human Input"),
                    "created_at": form.created_at.isoformat() + "Z" if form.created_at else None,
                }
            )

            # Also add to paused_nodes for backward compatibility
            response["paused_nodes"].append(
                {
                    "node_id": form_definition.get("node_id", "unknown"),
                    "node_title": form_definition.get("title", "Human Input"),
                    "pause_type": {"type": "human_input", "form_id": form.id},
                }
            )

        return response, 200
