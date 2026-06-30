import datetime
from http import HTTPStatus

from flask import redirect
from flask_restx import Resource
from pydantic import BaseModel, Field
from werkzeug.exceptions import Conflict, NotFound

from controllers.common.fields import RedirectResponse
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    is_admin_or_owner_required,
    rbac_permission_required,
    setup_required,
)
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.archive_storage import get_export_storage
from libs.helper import dump_response
from libs.login import current_account_with_tenant, login_required
from services.retention.workflow_run.archive_download_preparation import ARCHIVE_DOWNLOAD_MIME_TYPE
from services.retention.workflow_run.archive_download_task_cache import (
    WorkflowRunArchiveDownloadStatus,
)
from services.retention.workflow_run.archive_log_service import (
    WorkflowRunArchiveDownloadNotReadyError,
    WorkflowRunArchiveDownloadTaskNotFoundError,
    WorkflowRunArchiveNotFoundError,
    create_workflow_run_archive_download_task,
    get_ready_workflow_run_archive_download_task,
    get_workflow_run_archive_download_task,
    list_workflow_run_archives,
)


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


def _current_ids() -> tuple[str, str]:
    """Return current `(tenant_id, account_id)` or raise when no workspace is selected."""
    current_user, current_tenant_id = current_account_with_tenant()
    if not current_tenant_id:
        raise NotFound("Current workspace not found")
    return current_tenant_id, current_user.id


def _presigned_url_expires_in(expires_at: datetime.datetime) -> int:
    """Keep the storage URL no longer-lived than the Redis task and cap it for browser downloads."""
    expires_at_utc = expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=datetime.UTC)
    remaining_seconds = int((expires_at_utc - datetime.datetime.now(datetime.UTC)).total_seconds())
    return max(1, min(3600, remaining_seconds))


@console_ns.route("/workflow-run-archives")
class WorkflowRunArchivesApi(Resource):
    @console_ns.doc("list_workflow_run_archives")
    @console_ns.doc(description="List monthly workflow-run archive metadata for the current workspace")
    @console_ns.response(200, "Success", console_ns.models[WorkflowRunArchiveListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @rbac_permission_required(
        RBACResourceScope.WORKSPACE, RBACPermission.WORKSPACE_ROLE_MANAGE, resource_required=False
    )
    def get(self):
        tenant_id, _ = _current_ids()
        return dump_response(WorkflowRunArchiveListResponse, list_workflow_run_archives(db.session(), tenant_id))


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
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @rbac_permission_required(
        RBACResourceScope.WORKSPACE, RBACPermission.WORKSPACE_ROLE_MANAGE, resource_required=False
    )
    def post(self):
        tenant_id, account_id = _current_ids()
        payload = WorkflowRunArchiveDownloadPayload.model_validate(console_ns.payload or {})
        try:
            task = create_workflow_run_archive_download_task(
                db.session(),
                tenant_id=tenant_id,
                requested_by=account_id,
                year=payload.year,
                month=payload.month,
            )
        except WorkflowRunArchiveNotFoundError as exc:
            raise NotFound(str(exc)) from exc
        return dump_response(WorkflowRunArchiveDownloadTaskResponse, task), HTTPStatus.ACCEPTED


@console_ns.route("/workflow-run-archives/downloads/<string:download_id>")
class WorkflowRunArchiveDownloadApi(Resource):
    @console_ns.doc("get_workflow_run_archive_download")
    @console_ns.doc(description="Get a temporary workflow-run archive download task")
    @console_ns.response(200, "Success", console_ns.models[WorkflowRunArchiveDownloadTaskResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @rbac_permission_required(
        RBACResourceScope.WORKSPACE, RBACPermission.WORKSPACE_ROLE_MANAGE, resource_required=False
    )
    def get(self, download_id: str):
        tenant_id, _ = _current_ids()
        try:
            task = get_workflow_run_archive_download_task(tenant_id=tenant_id, download_id=download_id)
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
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @rbac_permission_required(
        RBACResourceScope.WORKSPACE, RBACPermission.WORKSPACE_ROLE_MANAGE, resource_required=False
    )
    def get(self, download_id: str):
        tenant_id, _ = _current_ids()
        try:
            task = get_ready_workflow_run_archive_download_task(tenant_id=tenant_id, download_id=download_id)
        except WorkflowRunArchiveDownloadTaskNotFoundError as exc:
            raise NotFound(str(exc)) from exc
        except WorkflowRunArchiveDownloadNotReadyError as exc:
            raise Conflict(str(exc)) from exc

        storage_key = task.storage_key
        if storage_key is None:
            raise Conflict(f"Workflow run archive download is not ready: {download_id}")

        storage = get_export_storage()
        presigned_url = storage.generate_presigned_url(
            storage_key,
            expires_in=_presigned_url_expires_in(task.expires_at),
            filename=task.file_name,
            content_type=ARCHIVE_DOWNLOAD_MIME_TYPE,
        )
        return redirect(presigned_url, code=HTTPStatus.FOUND)
