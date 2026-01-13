from datetime import UTC, datetime, timedelta
from typing import Literal, cast

from flask import request
from flask_restx import Resource, fields, marshal_with
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select

from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
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
from libs.archive_storage import ArchiveStorageNotConfiguredError, get_archive_storage
from libs.custom_inputs import time_duration
from libs.helper import uuid_value
from libs.login import current_user, login_required
from models import Account, App, AppMode, EndUser, WorkflowArchiveLog, WorkflowRunTriggeredFrom
from services.retention.workflow_run.constants import ARCHIVE_BUNDLE_NAME
from services.workflow_run_service import WorkflowRunService

# Workflow run status choices for filtering
WORKFLOW_RUN_STATUS_CHOICES = ["running", "succeeded", "failed", "stopped", "partial-succeeded"]
EXPORT_SIGNED_URL_EXPIRE_SECONDS = 3600

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

workflow_run_export_fields = console_ns.model(
    "WorkflowRunExport",
    {
        "status": fields.String(description="Export status: success/failed"),
        "presigned_url": fields.String(description="Pre-signed URL for download", required=False),
        "presigned_url_expires_at": fields.String(description="Pre-signed URL expiration time", required=False),
    },
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


@console_ns.route("/apps/<uuid:app_id>/workflow-runs/<uuid:run_id>/export")
class WorkflowRunExportApi(Resource):
    @console_ns.doc("get_workflow_run_export_url")
    @console_ns.doc(description="Generate a download URL for an archived workflow run.")
    @console_ns.doc(params={"app_id": "Application ID", "run_id": "Workflow run ID"})
    @console_ns.response(200, "Export URL generated", workflow_run_export_fields)
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model()
    def get(self, app_model: App, run_id: str):
        tenant_id = str(app_model.tenant_id)
        app_id = str(app_model.id)
        run_id_str = str(run_id)

        run_created_at = db.session.scalar(
            select(WorkflowArchiveLog.run_created_at)
            .where(
                WorkflowArchiveLog.tenant_id == tenant_id,
                WorkflowArchiveLog.app_id == app_id,
                WorkflowArchiveLog.workflow_run_id == run_id_str,
            )
            .limit(1)
        )
        if not run_created_at:
            return {"code": "archive_log_not_found", "message": "workflow run archive not found"}, 404

        prefix = (
            f"{tenant_id}/app_id={app_id}/year={run_created_at.strftime('%Y')}/"
            f"month={run_created_at.strftime('%m')}/workflow_run_id={run_id_str}"
        )
        archive_key = f"{prefix}/{ARCHIVE_BUNDLE_NAME}"

        try:
            archive_storage = get_archive_storage()
        except ArchiveStorageNotConfiguredError as e:
            return {"code": "archive_storage_not_configured", "message": str(e)}, 500

        presigned_url = archive_storage.generate_presigned_url(
            archive_key,
            expires_in=EXPORT_SIGNED_URL_EXPIRE_SECONDS,
        )
        expires_at = datetime.now(UTC) + timedelta(seconds=EXPORT_SIGNED_URL_EXPIRE_SECONDS)
        return {
            "status": "success",
            "presigned_url": presigned_url,
            "presigned_url_expires_at": expires_at.isoformat(),
        }, 200


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
