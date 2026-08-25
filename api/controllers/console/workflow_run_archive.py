import datetime
from http import HTTPStatus

from flask import redirect
from flask_restx import Resource
from pydantic import BaseModel, Field
from werkzeug.exceptions import Conflict, NotFound

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
from services.retention.workflow_run.archive_download_task import (
    WorkflowRunArchiveDownloadStatus,
)
from services.retention.workflow_run.archive_log_service import (
    WorkflowRunArchiveDownloadNotReadyError,
    WorkflowRunArchiveDownloadTaskNotFoundError,
    WorkflowRunArchiveNotFoundError,
)

_WORKFLOW_RUN_ARCHIVE_ALLOWED_ROLES = frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN})
_CLOUD_EDITIONS = frozenset({DeploymentEdition.CLOUD})


class WorkflowRunArchiveDownloadPayload(BaseModel):
    """Request body for preparing one monthly workflow-run archive download."""

    year: int = Field(ge=1)
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
    RedirectResponse,
)


@console_ns.route("/workflow-run-archives")
class WorkflowRunArchivesApi(Resource):
    @console_ns.doc("list_workflow_run_archives")
    @console_ns.doc(description="List monthly workflow-run archive metadata for the current workspace")
    @console_ns.response(200, "Success", console_ns.models[WorkflowRunArchiveListResponse.__name__])
    @console_account_admission(
        editions=_CLOUD_EDITIONS,
        allowed_roles=_WORKFLOW_RUN_ARCHIVE_ALLOWED_ROLES,
    )
    @cloud_edition_billing_paid_plan_required
    def get(self, request_context: RequestContext):
        archives = application_services().workflow_run_archives.list_archives(request_context)
        return dump_response(WorkflowRunArchiveListResponse, archives)


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
        editions=_CLOUD_EDITIONS,
        allowed_roles=_WORKFLOW_RUN_ARCHIVE_ALLOWED_ROLES,
    )
    @cloud_edition_billing_paid_plan_required
    @model_validate(WorkflowRunArchiveDownloadPayload)
    def post(self, req_data: WorkflowRunArchiveDownloadPayload, request_context: RequestContext):
        try:
            task = application_services().workflow_run_archives.create_download(
                request_context,
                year=req_data.year,
                month=req_data.month,
            )
        except WorkflowRunArchiveNotFoundError as exc:
            raise NotFound(str(exc)) from exc
        return dump_response(WorkflowRunArchiveDownloadTaskResponse, task), HTTPStatus.ACCEPTED


@console_ns.route("/workflow-run-archives/downloads/<string:download_id>")
class WorkflowRunArchiveDownloadApi(Resource):
    @console_ns.doc("get_workflow_run_archive_download")
    @console_ns.doc(description="Get a temporary workflow-run archive download task")
    @console_ns.response(200, "Success", console_ns.models[WorkflowRunArchiveDownloadTaskResponse.__name__])
    @console_account_admission(
        editions=_CLOUD_EDITIONS,
        allowed_roles=_WORKFLOW_RUN_ARCHIVE_ALLOWED_ROLES,
    )
    @cloud_edition_billing_paid_plan_required
    def get(self, request_context: RequestContext, download_id: str):
        try:
            task = application_services().workflow_run_archives.get_download(
                request_context,
                download_id=download_id,
            )
        except WorkflowRunArchiveDownloadTaskNotFoundError as exc:
            raise NotFound(str(exc)) from exc
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
        editions=_CLOUD_EDITIONS,
        allowed_roles=_WORKFLOW_RUN_ARCHIVE_ALLOWED_ROLES,
    )
    @cloud_edition_billing_paid_plan_required
    def get(self, request_context: RequestContext, download_id: str):
        try:
            presigned_url = application_services().workflow_run_archives.get_download_url(
                request_context,
                download_id=download_id,
            )
        except WorkflowRunArchiveDownloadTaskNotFoundError as exc:
            raise NotFound(str(exc)) from exc
        except WorkflowRunArchiveDownloadNotReadyError as exc:
            raise Conflict(str(exc)) from exc
        return redirect(presigned_url, code=HTTPStatus.FOUND)
