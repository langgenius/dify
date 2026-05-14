from __future__ import annotations

from datetime import datetime
from typing import Any

from flask_restx import Namespace, fields
from pydantic import field_validator

from fields.base import ResponseModel
from fields.end_user_fields import SimpleEndUser, simple_end_user_fields
from fields.member_fields import SimpleAccount, simple_account_fields
from fields.workflow_run_fields import (
    WorkflowRunForArchivedLogResponse,
    WorkflowRunForLogResponse,
    build_workflow_run_for_archived_log_model,
    build_workflow_run_for_log_model,
    workflow_run_for_archived_log_fields,
    workflow_run_for_log_fields,
)
from libs.helper import TimestampField, to_timestamp

workflow_app_log_partial_fields = {
    "id": fields.String,
    "workflow_run": fields.Nested(workflow_run_for_log_fields, attribute="workflow_run", allow_null=True),
    "details": fields.Raw(attribute="details"),
    "created_from": fields.String,
    "created_by_role": fields.String,
    "created_by_account": fields.Nested(simple_account_fields, attribute="created_by_account", allow_null=True),
    "created_by_end_user": fields.Nested(simple_end_user_fields, attribute="created_by_end_user", allow_null=True),
    "created_at": TimestampField,
}


def build_workflow_app_log_partial_model(api_or_ns: Namespace):
    """Build the workflow app log partial model for the API or Namespace."""
    workflow_run_model = build_workflow_run_for_log_model(api_or_ns)

    copied_fields = workflow_app_log_partial_fields.copy()
    copied_fields["workflow_run"] = fields.Nested(workflow_run_model, attribute="workflow_run", allow_null=True)
    return api_or_ns.model("WorkflowAppLogPartial", copied_fields)


workflow_archived_log_partial_fields = {
    "id": fields.String,
    "workflow_run": fields.Nested(workflow_run_for_archived_log_fields, allow_null=True),
    "trigger_metadata": fields.Raw,
    "created_by_account": fields.Nested(simple_account_fields, attribute="created_by_account", allow_null=True),
    "created_by_end_user": fields.Nested(simple_end_user_fields, attribute="created_by_end_user", allow_null=True),
    "created_at": TimestampField,
}


def build_workflow_archived_log_partial_model(api_or_ns: Namespace):
    """Build the workflow archived log partial model for the API or Namespace."""
    workflow_run_model = build_workflow_run_for_archived_log_model(api_or_ns)

    copied_fields = workflow_archived_log_partial_fields.copy()
    copied_fields["workflow_run"] = fields.Nested(workflow_run_model, allow_null=True)
    return api_or_ns.model("WorkflowArchivedLogPartial", copied_fields)


workflow_app_log_pagination_fields = {
    "page": fields.Integer,
    "limit": fields.Integer,
    "total": fields.Integer,
    "has_more": fields.Boolean,
    "data": fields.List(fields.Nested(workflow_app_log_partial_fields)),
}


def build_workflow_app_log_pagination_model(api_or_ns: Namespace):
    """Build the workflow app log pagination model for the API or Namespace."""
    # Build the nested partial model first
    workflow_app_log_partial_model = build_workflow_app_log_partial_model(api_or_ns)

    copied_fields = workflow_app_log_pagination_fields.copy()
    copied_fields["data"] = fields.List(fields.Nested(workflow_app_log_partial_model))
    return api_or_ns.model("WorkflowAppLogPagination", copied_fields)


workflow_archived_log_pagination_fields = {
    "page": fields.Integer,
    "limit": fields.Integer,
    "total": fields.Integer,
    "has_more": fields.Boolean,
    "data": fields.List(fields.Nested(workflow_archived_log_partial_fields)),
}


def build_workflow_archived_log_pagination_model(api_or_ns: Namespace):
    """Build the workflow archived log pagination model for the API or Namespace."""
    workflow_archived_log_partial_model = build_workflow_archived_log_partial_model(api_or_ns)

    copied_fields = workflow_archived_log_pagination_fields.copy()
    copied_fields["data"] = fields.List(fields.Nested(workflow_archived_log_partial_model))
    return api_or_ns.model("WorkflowArchivedLogPagination", copied_fields)


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
        return to_timestamp(value)


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
        return to_timestamp(value)


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
