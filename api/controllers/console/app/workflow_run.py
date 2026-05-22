from datetime import UTC, datetime, timedelta
from typing import Literal, cast

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from controllers.web.error import NotFoundError
from core.workflow.human_input_forms import load_form_tokens_by_form_id as _load_form_tokens_by_form_id
from extensions.ext_database import db
from fields.base import ResponseModel
from fields.workflow_run_fields import (
    AdvancedChatWorkflowRunPaginationResponse,
    WorkflowRunCountResponse,
    WorkflowRunDetailResponse,
    WorkflowRunNodeExecutionListResponse,
    WorkflowRunNodeExecutionResponse,
    WorkflowRunPaginationResponse,
)
from graphon.entities.pause_reason import HumanInputRequired
from graphon.enums import WorkflowExecutionStatus
from libs.archive_storage import ArchiveStorageNotConfiguredError, get_archive_storage
from libs.custom_inputs import time_duration
from libs.helper import uuid_value
from libs.login import current_user, login_required
from models import Account, App, AppMode, EndUser, WorkflowArchiveLog, WorkflowRunTriggeredFrom
from models.workflow import WorkflowRun
from repositories.factory import DifyAPIRepositoryFactory
from services.retention.workflow_run.constants import ARCHIVE_BUNDLE_NAME
from services.workflow_run_service import WorkflowRunListArgs, WorkflowRunService


def _build_backstage_input_url(form_token: str | None) -> str | None:
    if not form_token:
        return None
    base_url = dify_config.APP_WEB_URL
    if not base_url:
        return None
    return f"{base_url.rstrip('/')}/form/{form_token}"


# Workflow run status choices for filtering
WORKFLOW_RUN_STATUS_CHOICES = ["running", "succeeded", "failed", "stopped", "partial-succeeded"]
EXPORT_SIGNED_URL_EXPIRE_SECONDS = 3600


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


class WorkflowRunExportResponse(ResponseModel):
    status: str = Field(description="Export status: success/failed")
    presigned_url: str | None = Field(default=None, description="Pre-signed URL for download")
    presigned_url_expires_at: str | None = Field(default=None, description="Pre-signed URL expiration time")


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
    WorkflowRunExportResponse,
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
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT])
    def get(self, app_model: App):
        """
        Get advanced chat app workflow run list
        """
        args_model = WorkflowRunListQuery.model_validate(request.args.to_dict(flat=True))
        args: WorkflowRunListArgs = {"limit": args_model.limit}
        if args_model.last_id is not None:
            args["last_id"] = args_model.last_id
        if args_model.status is not None:
            args["status"] = args_model.status

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

        return AdvancedChatWorkflowRunPaginationResponse.model_validate(result, from_attributes=True).model_dump(
            mode="json"
        )


@console_ns.route("/apps/<uuid:app_id>/workflow-runs/<uuid:run_id>/export")
class WorkflowRunExportApi(Resource):
    @console_ns.doc("get_workflow_run_export_url")
    @console_ns.doc(description="Generate a download URL for an archived workflow run.")
    @console_ns.doc(params={"app_id": "Application ID", "run_id": "Workflow run ID"})
    @console_ns.response(200, "Export URL generated", console_ns.models[WorkflowRunExportResponse.__name__])
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
        response = WorkflowRunExportResponse.model_validate(
            {
                "status": "success",
                "presigned_url": presigned_url,
                "presigned_url_expires_at": expires_at.isoformat(),
            }
        )
        return response.model_dump(mode="json"), 200


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
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT])
    def get(self, app_model: App):
        """
        Get advanced chat workflow runs count statistics
        """
        args_model = WorkflowRunCountQuery.model_validate(request.args.to_dict(flat=True))
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

        return WorkflowRunCountResponse.model_validate(result).model_dump(mode="json")


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
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App):
        """
        Get workflow run list
        """
        args_model = WorkflowRunListQuery.model_validate(request.args.to_dict(flat=True))
        args: WorkflowRunListArgs = {"limit": args_model.limit}
        if args_model.last_id is not None:
            args["last_id"] = args_model.last_id
        if args_model.status is not None:
            args["status"] = args_model.status

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

        return WorkflowRunPaginationResponse.model_validate(result, from_attributes=True).model_dump(mode="json")


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
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App):
        """
        Get workflow runs count statistics
        """
        args_model = WorkflowRunCountQuery.model_validate(request.args.to_dict(flat=True))
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

        return WorkflowRunCountResponse.model_validate(result).model_dump(mode="json")


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
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App, run_id):
        """
        Get workflow run detail
        """
        run_id = str(run_id)

        workflow_run_service = WorkflowRunService()
        workflow_run = workflow_run_service.get_workflow_run(app_model=app_model, run_id=run_id)
        if workflow_run is None:
            raise NotFoundError("Workflow run not found")

        return WorkflowRunDetailResponse.model_validate(workflow_run, from_attributes=True).model_dump(mode="json")


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
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
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

        return WorkflowRunNodeExecutionListResponse.model_validate(
            {"data": node_executions}, from_attributes=True
        ).model_dump(mode="json")


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
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, workflow_run_id: str):
        """
        Get workflow pause details.

        GET /console/api/workflow/<workflow_run_id>/pause-details

        Returns information about why and where the workflow is paused.
        """

        # Query WorkflowRun to determine if workflow is suspended
        session_maker = sessionmaker(bind=db.engine)
        workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_maker=session_maker)

        workflow_run = db.session.get(WorkflowRun, workflow_run_id)
        if not workflow_run:
            raise NotFoundError("Workflow run not found")

        if workflow_run.tenant_id != current_user.current_tenant_id:
            raise NotFoundError("Workflow run not found")

        # Check if workflow is suspended
        is_paused = workflow_run.status == WorkflowExecutionStatus.PAUSED
        if not is_paused:
            empty_response = WorkflowPauseDetailsResponse(paused_at=None, paused_nodes=[])
            return empty_response.model_dump(mode="json"), 200

        pause_entity = workflow_run_repo.get_workflow_pause(workflow_run_id)
        pause_reasons = pause_entity.get_pause_reasons() if pause_entity else []
        form_tokens_by_form_id = _load_form_tokens_by_form_id(
            [reason.form_id for reason in pause_reasons if isinstance(reason, HumanInputRequired)]
        )

        # Build response
        paused_at = pause_entity.paused_at if pause_entity else None
        paused_nodes: list[PausedNodeResponse] = []

        for reason in pause_reasons:
            if isinstance(reason, HumanInputRequired):
                paused_nodes.append(
                    PausedNodeResponse(
                        node_id=reason.node_id,
                        node_title=reason.node_title,
                        pause_type=HumanInputPauseTypeResponse(
                            type="human_input",
                            form_id=reason.form_id,
                            backstage_input_url=_build_backstage_input_url(form_tokens_by_form_id.get(reason.form_id)),
                        ),
                    )
                )
            else:
                raise AssertionError("unimplemented.")

        response = WorkflowPauseDetailsResponse(
            paused_at=paused_at.isoformat() + "Z" if paused_at else None,
            paused_nodes=paused_nodes,
        )
        return response.model_dump(mode="json"), 200
