from datetime import datetime
from typing import Any

from dateutil.parser import isoparse
from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import sessionmaker

from controllers.common.schema import register_schema_models
from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from extensions.ext_database import db
from fields.base import ResponseModel
from fields.end_user_fields import SimpleEndUser
from fields.member_fields import SimpleAccount
from graphon.enums import WorkflowExecutionStatus
from libs.login import login_required
from models import App
from models.model import AppMode
from services.workflow_app_service import WorkflowAppService


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


class WorkflowRunForLogResponse(ResponseModel):
    id: str
    version: str | None = None
    status: str | None = None
    triggered_from: str | None = None
    error: str | None = None
    elapsed_time: float | None = None
    total_tokens: int | None = None
    total_steps: int | None = None
    created_at: int | None = None
    finished_at: int | None = None
    exceptions_count: int | None = None

    @field_validator("status", mode="before")
    @classmethod
    def _normalize_status(cls, value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, str):
            return value
        return str(getattr(value, "value", value))

    @field_validator("created_at", "finished_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        if isinstance(value, datetime):
            return int(value.timestamp())
        return value


class WorkflowRunForArchivedLogResponse(ResponseModel):
    id: str
    status: str | None = None
    triggered_from: str | None = None
    elapsed_time: float | None = None
    total_tokens: int | None = None

    @field_validator("status", mode="before")
    @classmethod
    def _normalize_status(cls, value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, str):
            return value
        return str(getattr(value, "value", value))


class WorkflowAppLogPartialResponse(ResponseModel):
    id: str
    workflow_run: WorkflowRunForLogResponse | None = None
    details: Any = None
    created_from: str | None = None
    created_by_role: str | None = None
    created_by_account: SimpleAccount | None = None
    created_by_end_user: SimpleEndUser | None = None
    created_at: int | None = None

    @field_validator("created_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        if isinstance(value, datetime):
            return int(value.timestamp())
        return value


class WorkflowArchivedLogPartialResponse(ResponseModel):
    id: str
    workflow_run: WorkflowRunForArchivedLogResponse | None = None
    trigger_metadata: Any = None
    created_by_account: SimpleAccount | None = None
    created_by_end_user: SimpleEndUser | None = None
    created_at: int | None = None

    @field_validator("created_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        if isinstance(value, datetime):
            return int(value.timestamp())
        return value


class WorkflowAppLogPaginationResponse(ResponseModel):
    page: int
    limit: int
    total: int
    has_more: bool
    data: list[WorkflowAppLogPartialResponse]


class WorkflowArchivedLogPaginationResponse(ResponseModel):
    page: int
    limit: int
    total: int
    has_more: bool
    data: list[WorkflowArchivedLogPartialResponse]


register_schema_models(
    console_ns,
    WorkflowAppLogQuery,
    WorkflowRunForLogResponse,
    WorkflowRunForArchivedLogResponse,
    WorkflowAppLogPartialResponse,
    WorkflowArchivedLogPartialResponse,
    WorkflowAppLogPaginationResponse,
    WorkflowArchivedLogPaginationResponse,
)


@console_ns.route("/apps/<uuid:app_id>/workflow-app-logs")
class WorkflowAppLogApi(Resource):
    @console_ns.doc("get_workflow_app_logs")
    @console_ns.doc(description="Get workflow application execution logs")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[WorkflowAppLogQuery.__name__])
    @console_ns.response(
        200,
        "Workflow app logs retrieved successfully",
        console_ns.models[WorkflowAppLogPaginationResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW])
    def get(self, app_model: App):
        """
        Get workflow app logs
        """
        args = WorkflowAppLogQuery.model_validate(request.args.to_dict(flat=True))

        # get paginate workflow app logs
        workflow_app_service = WorkflowAppService()
        with sessionmaker(db.engine, expire_on_commit=False).begin() as session:
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

            return WorkflowAppLogPaginationResponse.model_validate(
                workflow_app_log_pagination, from_attributes=True
            ).model_dump(mode="json")


@console_ns.route("/apps/<uuid:app_id>/workflow-archived-logs")
class WorkflowArchivedLogApi(Resource):
    @console_ns.doc("get_workflow_archived_logs")
    @console_ns.doc(description="Get workflow archived execution logs")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[WorkflowAppLogQuery.__name__])
    @console_ns.response(
        200,
        "Workflow archived logs retrieved successfully",
        console_ns.models[WorkflowArchivedLogPaginationResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW])
    def get(self, app_model: App):
        """
        Get workflow archived logs
        """
        args = WorkflowAppLogQuery.model_validate(request.args.to_dict(flat=True))

        workflow_app_service = WorkflowAppService()
        with sessionmaker(db.engine, expire_on_commit=False).begin() as session:
            workflow_app_log_pagination = workflow_app_service.get_paginate_workflow_archive_logs(
                session=session,
                app_model=app_model,
                page=args.page,
                limit=args.limit,
            )

            return WorkflowArchivedLogPaginationResponse.model_validate(
                workflow_app_log_pagination, from_attributes=True
            ).model_dump(mode="json")
