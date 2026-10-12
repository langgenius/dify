import datetime
from http import HTTPStatus
from typing import Literal

from flask import redirect
from flask_restx import Resource
from pydantic import BaseModel, Field, ValidationError

from controllers.common.fields import RedirectResponse
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import (
    cloud_edition_billing_paid_plan_required,
    model_validate,
)
from enums import DeploymentEdition
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response
from machinery.context import RequestContext
from models.account import TenantAccountRole
from services.retention.workflow_run.archive_deletion_task import WorkflowRunArchiveDeletionStatus
from services.retention.workflow_run.archive_download_task import (
    WorkflowRunArchiveDownloadStatus,
)
from services.retention.workflow_run.archive_log_service import (
    WorkflowRunArchiveInvalidMonthError,
)

_WORKFLOW_RUN_ARCHIVE_ALLOWED_ROLES = frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN})


class WorkflowRunArchiveDownloadPayload(BaseModel):
    """Request body for preparing one monthly workflow-run archive download."""

    year: int = Field(ge=1, le=9999)
    month: int = Field(ge=1, le=12)


class WorkflowRunArchiveSummaryResponse(ResponseModel):
    archived_month_count: int
    workflow_run_count: int
    archive_bytes: int
    latest_archived_at: datetime.datetime | None = None


class WorkflowRunArchiveDownloadTaskResponse(ResponseModel):
    download_id: str
    year: int
    month: int
    bundle_count: int
    archive_bytes: int
    status: WorkflowRunArchiveDownloadStatus
    file_name: str | None = None
    file_size_bytes: int | None = None
    error: str | None = None
    created_at: datetime.datetime
    updated_at: datetime.datetime
    expires_at: datetime.datetime
    started_at: datetime.datetime | None = None
    finished_at: datetime.datetime | None = None


class WorkflowRunArchiveMonthResponse(ResponseModel):
    year: int
    month: int
    bundle_count: int
    workflow_run_count: int
    row_count: int
    archive_bytes: int
    latest_archived_at: datetime.datetime
    download_task: WorkflowRunArchiveDownloadTaskResponse | None = None
    deletion_status: (
        Literal[
            WorkflowRunArchiveDeletionStatus.PENDING,
            WorkflowRunArchiveDeletionStatus.PROCESSING,
            WorkflowRunArchiveDeletionStatus.FAILED,
        ]
        | None
    ) = None


class WorkflowRunArchiveDeletionTaskResponse(ResponseModel):
    year: int
    month: int
    status: WorkflowRunArchiveDeletionStatus
    error: str | None = None


class WorkflowRunArchiveListResponse(ResponseModel):
    summary: WorkflowRunArchiveSummaryResponse
    months: list[WorkflowRunArchiveMonthResponse]


register_schema_models(console_ns, WorkflowRunArchiveDownloadPayload)
register_response_schema_models(
    console_ns,
    WorkflowRunArchiveSummaryResponse,
    WorkflowRunArchiveMonthResponse,
    WorkflowRunArchiveListResponse,
    WorkflowRunArchiveDownloadTaskResponse,
    WorkflowRunArchiveDeletionTaskResponse,
    RedirectResponse,
)


@console_ns.route("/workflow-run-archives")
class WorkflowRunArchivesApi(Resource):
    @console_ns.doc("list_workflow_run_archives")
    @console_ns.doc(description="List monthly workflow-run archive metadata for the current workspace")
    @console_ns.response(200, "Success", console_ns.models[WorkflowRunArchiveListResponse.__name__])
    @console_account_admission(
        editions=frozenset({DeploymentEdition.CLOUD}),
        allowed_roles=_WORKFLOW_RUN_ARCHIVE_ALLOWED_ROLES,
    )
    @cloud_edition_billing_paid_plan_required
    def get(self, request_context: RequestContext):
        archives = application_services().workflow_run_archives.list_archives(request_context)
        return dump_response(WorkflowRunArchiveListResponse, archives)


@console_ns.route("/workflow-run-archives/<int:year>/<int:month>")
class WorkflowRunArchiveMonthApi(Resource):
    @console_ns.doc("delete_workflow_run_archive")
    @console_ns.doc(description="Permanently delete this workspace's monthly archive files and archive index")
    @console_ns.doc(
        params={
            "year": {"in": "path", "type": "integer", "minimum": 1, "maximum": 9999},
            "month": {"in": "path", "type": "integer", "minimum": 1, "maximum": 12},
        }
    )
    @console_ns.response(
        HTTPStatus.ACCEPTED,
        "Archive deletion accepted",
        console_ns.models[WorkflowRunArchiveDeletionTaskResponse.__name__],
    )
    @console_account_admission(
        editions=frozenset({DeploymentEdition.CLOUD}),
        allowed_roles=_WORKFLOW_RUN_ARCHIVE_ALLOWED_ROLES,
    )
    @cloud_edition_billing_paid_plan_required
    def delete(self, request_context: RequestContext, year: int, month: int):
        try:
            archive_month = WorkflowRunArchiveDownloadPayload(year=year, month=month)
        except ValidationError as exc:
            raise WorkflowRunArchiveInvalidMonthError(str(exc)) from exc
        task = application_services().workflow_run_archives.delete_archive(
            request_context, year=archive_month.year, month=archive_month.month
        )
        return dump_response(WorkflowRunArchiveDeletionTaskResponse, task), HTTPStatus.ACCEPTED


@console_ns.route("/workflow-run-archives/downloads")
class WorkflowRunArchiveDownloadsApi(Resource):
    @console_ns.doc("create_workflow_run_archive_download")
    @console_ns.doc(description="Create or return a temporary workflow-run archive download task")
    @console_ns.expect(console_ns.models[WorkflowRunArchiveDownloadPayload.__name__])
    @console_ns.response(
        HTTPStatus.ACCEPTED,
        "Download task accepted",
        console_ns.models[WorkflowRunArchiveDownloadTaskResponse.__name__],
    )
    @console_account_admission(
        editions=frozenset({DeploymentEdition.CLOUD}),
        allowed_roles=_WORKFLOW_RUN_ARCHIVE_ALLOWED_ROLES,
    )
    @cloud_edition_billing_paid_plan_required
    @model_validate(WorkflowRunArchiveDownloadPayload)
    def post(self, req_data: WorkflowRunArchiveDownloadPayload, request_context: RequestContext):
        task = application_services().workflow_run_archives.create_download(
            request_context,
            year=req_data.year,
            month=req_data.month,
        )
        return dump_response(WorkflowRunArchiveDownloadTaskResponse, task), HTTPStatus.ACCEPTED


@console_ns.route("/workflow-run-archives/downloads/<string:download_id>")
class WorkflowRunArchiveDownloadApi(Resource):
    @console_ns.doc("get_workflow_run_archive_download")
    @console_ns.doc(description="Get a temporary workflow-run archive download task")
    @console_ns.response(200, "Success", console_ns.models[WorkflowRunArchiveDownloadTaskResponse.__name__])
    @console_account_admission(
        editions=frozenset({DeploymentEdition.CLOUD}),
        allowed_roles=_WORKFLOW_RUN_ARCHIVE_ALLOWED_ROLES,
    )
    @cloud_edition_billing_paid_plan_required
    def get(self, request_context: RequestContext, download_id: str):
        task = application_services().workflow_run_archives.get_download(
            request_context,
            download_id=download_id,
        )
        return dump_response(WorkflowRunArchiveDownloadTaskResponse, task)


@console_ns.route("/workflow-run-archives/downloads/<string:download_id>/file")
class WorkflowRunArchiveDownloadFileApi(Resource):
    @console_ns.doc("download_workflow_run_archive_file")
    @console_ns.doc(description="Redirect to a prepared workflow-run archive ZIP file")
    @console_ns.response(
        302,
        "Redirect to pre-signed archive storage URL",
        console_ns.models[RedirectResponse.__name__],
    )
    @console_ns.response(409, "Download task is not ready")
    @console_account_admission(
        editions=frozenset({DeploymentEdition.CLOUD}),
        allowed_roles=_WORKFLOW_RUN_ARCHIVE_ALLOWED_ROLES,
    )
    @cloud_edition_billing_paid_plan_required
    def get(self, request_context: RequestContext, download_id: str):
        presigned_url = application_services().workflow_run_archives.get_download_url(
            request_context,
            download_id=download_id,
        )
        return redirect(presigned_url, code=HTTPStatus.FOUND)
