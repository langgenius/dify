from datetime import datetime

from dateutil.parser import isoparse
from flask import request
from flask_restx import Resource, marshal_with
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from core.workflow.enums import WorkflowExecutionStatus
from extensions.ext_database import db
from fields.workflow_app_log_fields import (
    build_workflow_app_log_pagination_model,
    build_workflow_archived_log_pagination_model,
)
from libs.login import login_required
from models import App
from models.model import AppMode
from services.workflow_app_service import WorkflowAppService

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class WorkflowAppLogQuery(BaseModel):
    keyword: str | None = Field(default=None, description="Search keyword for filtering logs")
    status: WorkflowExecutionStatus | None = Field(
        default=None, description="Execution status filter (succeeded, failed, stopped, partial-succeeded)"
    )
    created_at__before: datetime | None = Field(default=None, description="Filter logs created before this timestamp")
    created_at__after: datetime | None = Field(default=None, description="Filter logs created after this timestamp")
    created_by_end_user_session_id: str | None = Field(default=None, description="Filter by end user session ID")
    created_by_account: str | None = Field(default=None, description="Filter by account")
    detail: bool = Field(default=False, description="Whether to return detailed logs")
    page: int = Field(default=1, ge=1, le=99999, description="Page number (1-99999)")
    limit: int = Field(default=20, ge=1, le=100, description="Number of items per page (1-100)")

    @field_validator("created_at__before", "created_at__after", mode="before")
    @classmethod
    def parse_datetime(cls, value: str | None) -> datetime | None:
        if value in (None, ""):
            return None
        return isoparse(value)  # type: ignore

    @field_validator("detail", mode="before")
    @classmethod
    def parse_bool(cls, value: bool | str | None) -> bool:
        if isinstance(value, bool):
            return value
        if value is None:
            return False
        lowered = value.lower()
        if lowered in {"1", "true", "yes", "on"}:
            return True
        if lowered in {"0", "false", "no", "off"}:
            return False
        raise ValueError("Invalid boolean value for detail")


console_ns.schema_model(
    WorkflowAppLogQuery.__name__, WorkflowAppLogQuery.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0)
)

# Register model for flask_restx to avoid dict type issues in Swagger
workflow_app_log_pagination_model = build_workflow_app_log_pagination_model(console_ns)
workflow_archived_log_pagination_model = build_workflow_archived_log_pagination_model(console_ns)


@console_ns.route("/apps/<uuid:app_id>/workflow-app-logs")
class WorkflowAppLogApi(Resource):
    @console_ns.doc("get_workflow_app_logs")
    @console_ns.doc(description="Get workflow application execution logs")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[WorkflowAppLogQuery.__name__])
    @console_ns.response(200, "Workflow app logs retrieved successfully", workflow_app_log_pagination_model)
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW])
    @marshal_with(workflow_app_log_pagination_model)
    def get(self, app_model: App):
        """
        Get workflow app logs
        """
        args = WorkflowAppLogQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore

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
                detail=args.detail,
                created_by_end_user_session_id=args.created_by_end_user_session_id,
                created_by_account=args.created_by_account,
            )

            return workflow_app_log_pagination


@console_ns.route("/apps/<uuid:app_id>/workflow-archived-logs")
class WorkflowArchivedLogApi(Resource):
    @console_ns.doc("get_workflow_archived_logs")
    @console_ns.doc(description="Get workflow archived execution logs")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[WorkflowAppLogQuery.__name__])
    @console_ns.response(200, "Workflow archived logs retrieved successfully", workflow_archived_log_pagination_model)
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW])
    @marshal_with(workflow_archived_log_pagination_model)
    def get(self, app_model: App):
        """
        Get workflow archived logs
        """
        args = WorkflowAppLogQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore

        workflow_app_service = WorkflowAppService()
        with Session(db.engine) as session:
            workflow_app_log_pagination = workflow_app_service.get_paginate_workflow_archive_logs(
                session=session,
                app_model=app_model,
                page=args.page,
                limit=args.limit,
            )

            return workflow_app_log_pagination
