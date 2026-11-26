from datetime import UTC, datetime
from http import HTTPStatus
from typing import Any, Literal
from uuid import UUID

from dateutil.parser import isoparse
from flask import Response, request
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_serializer, field_validator

from controllers.common.errors import ForbiddenError, InvalidArgumentError, PaidPlanRequiredError
from controllers.common.fields import BinaryFileResponse
from controllers.common.rbac import PlainApp, RBACCheck
from controllers.common.schema import (
    query_params_from_model,
    query_params_from_request,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console import console_ns
from controllers.console.app.error import (
    AppNotFoundError,
    LogExportLimitReachedHTTPError,
    LogExportTaskNotCancelableHTTPError,
    WorkflowLogExportFileNotFoundHTTPError,
    WorkflowLogExportTaskNotFoundHTTPError,
    WorkflowLogExportTaskNotReadyHTTPError,
)
from controllers.console.app.log_export_response import (
    log_export_file_response,
    log_export_status_email_preference,
    update_log_export_email_preference,
)
from controllers.console.app.wraps import get_app_model
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import RBACPermission, is_cloud_edition_billing_paid_plan, model_validate
from enums.account import TenantAccountRole
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from fields.end_user_fields import SimpleEndUser
from fields.log_export_fields import (
    LogExportEmailNotificationPayload,
    LogExportEmailNotificationResponse,
    LogExportEstimatedRows,
    LogExportProgressResponse,
    LogExportTaskResponse,
)
from fields.member_fields import SimpleAccount
from graphon.enums import WorkflowExecutionStatus
from libs.datetime_utils import ensure_naive_utc
from libs.exception import BaseHTTPException
from libs.external_api import error_responses
from libs.helper import dump_response, to_timestamp
from libs.login import current_account_with_tenant
from machinery.context import RequestContext
from models import App
from models.model import AppMode
from services.app.console_service import ConsoleAppNotFoundError
from services.entities.conversation_entities import ConsoleLogIdentitySource
from services.feature_service import FeatureService
from services.retention.log_export_email import LogExportEmailState
from services.retention.log_export_task import (
    LogExportFileNotFoundError,
    LogExportIdentityLabel,
    LogExportKind,
    LogExportLimitReachedError,
    LogExportStatus,
    LogExportTaskNotCancelableError,
    LogExportTaskNotFoundError,
    LogExportTaskNotReadyError,
)
from services.retention.workflow_run.log_export_service import (
    WorkflowLogExportFilters,
    WorkflowLogExportScope,
    WorkflowLogExportTask,
)


class WorkflowAppLogQuery(BaseModel):
    keyword: str | None = Field(default=None, description="Search keyword for filtering logs")
    status: WorkflowExecutionStatus | None = Field(default=None, description="Execution status filter")
    created_at__before: datetime | None = Field(default=None, description="Filter logs created before this timestamp")
    created_at__after: datetime | None = Field(default=None, description="Filter logs created after this timestamp")
    created_by_end_user_session_id: str | None = Field(default=None, description="Filter by end user session ID")
    created_by_account: str | None = Field(default=None, description="Filter by account")
    end_user_ids: list[UUID] = Field(default_factory=list, description="End user IDs to include")
    account_ids: list[UUID] = Field(default_factory=list, description="Account IDs to include")
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
        return to_timestamp(value)


class WorkflowAppLogEvaluationNodeInfoResponse(ResponseModel):
    node_id: str
    type: str
    title: str


class WorkflowAppLogEvaluationItemResponse(ResponseModel):
    name: str
    value: Any = None
    details: dict[str, Any] = Field(default_factory=dict)
    node_info: WorkflowAppLogEvaluationNodeInfoResponse | None = Field(
        default=None,
        serialization_alias="nodeInfo",
    )


class WorkflowAppLogPartialResponse(ResponseModel):
    id: str
    workflow_run: WorkflowRunForLogResponse | None = None
    details: Any = None
    evaluation: list[WorkflowAppLogEvaluationItemResponse] = Field(default_factory=list)
    created_from: str | None = None
    created_by_role: str | None = None
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


register_schema_models(
    console_ns,
    WorkflowAppLogQuery,
    WorkflowRunForLogResponse,
    WorkflowAppLogEvaluationNodeInfoResponse,
    WorkflowAppLogEvaluationItemResponse,
    WorkflowAppLogPartialResponse,
    WorkflowAppLogPaginationResponse,
)


class _WorkflowLogValidationError(BaseHTTPException):
    error_code = "unprocessable_entity"
    code = HTTPStatus.UNPROCESSABLE_ENTITY


@console_ns.route("/apps/<uuid:app_id>/workflow-app-logs")
class WorkflowAppLogApi(Resource):
    @error_responses(_WorkflowLogValidationError)
    @console_ns.doc("get_workflow_app_logs")
    @console_ns.doc(description="Get workflow application execution logs")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.doc(params=query_params_from_model(WorkflowAppLogQuery))
    @console_ns.response(
        200,
        "Workflow app logs retrieved successfully",
        console_ns.models[WorkflowAppLogPaginationResponse.__name__],
    )
    @console_account_admission(
        rbac_checks=[RBACCheck(RBACPermission.APP_LOG_AND_ANNOTATION, PlainApp())],
    )
    @get_app_model(mode=[AppMode.WORKFLOW])
    def get(
        self,
        _request_context: RequestContext,
        app_model: App,
    ):
        """
        Get workflow app logs
        """
        try:
            req_data = query_params_from_request(WorkflowAppLogQuery, list_fields=("end_user_ids", "account_ids"))
        except ValidationError as exc:
            raise _WorkflowLogValidationError(
                exc.json(include_url=False, include_input=False, include_context=False)
            ) from None
        result = application_services().workflow_app_logs.list_logs(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            keyword=req_data.keyword,
            status=req_data.status,
            created_at_before=req_data.created_at__before,
            created_at_after=req_data.created_at__after,
            page=req_data.page,
            limit=req_data.limit,
            detail=req_data.detail,
            created_by_end_user_session_id=req_data.created_by_end_user_session_id,
            created_by_account=req_data.created_by_account,
            end_user_ids=tuple(map(str, req_data.end_user_ids)),
            account_ids=tuple(map(str, req_data.account_ids)),
        )
        return dump_response(WorkflowAppLogPaginationResponse, result)


class WorkflowLogExportPreviewQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    keyword: str | None = Field(default=None, description="Search keyword for Workflow Logs")
    status: WorkflowExecutionStatus | None = Field(default=None, description="Execution status filter")
    created_at__before: datetime | None = Field(default=None, description="Inclusive upper bound on log creation time")
    created_at__after: datetime | None = Field(default=None, description="Inclusive lower bound on log creation time")
    end_user_ids: list[UUID] = Field(default_factory=list, description="End user IDs to include")
    account_ids: list[UUID] = Field(default_factory=list, description="Account IDs to include")

    def to_filters(self) -> WorkflowLogExportFilters:
        """Normalize timestamps to naive UTC and reject a reversed time range."""
        before = ensure_naive_utc(self.created_at__before) if self.created_at__before is not None else None
        after = ensure_naive_utc(self.created_at__after) if self.created_at__after is not None else None
        if before is not None and after is not None and after > before:
            raise InvalidArgumentError("The start time must be before or equal to the end time.")
        return WorkflowLogExportFilters(
            keyword=self.keyword,
            status=self.status,
            created_at_before=before,
            created_at_after=after,
            end_user_ids=tuple(str(identity) for identity in self.end_user_ids),
            account_ids=tuple(str(identity) for identity in self.account_ids),
        )


class WorkflowLogExportIdentityQuery(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    keyword: str = Field(
        min_length=1, max_length=255, description="Part of an end-user ID or account name, or an exact internal ID"
    )


class WorkflowLogExportPreviewResponse(ResponseModel):
    row_count: int | None = Field(ge=0, description="CSV rows, one per matched run. Null on count timeout.")


class WorkflowLogExportCreatePayload(WorkflowLogExportPreviewQuery):
    """Submit unpaginated preview filters and their display labels for the export."""

    identity_labels: tuple[LogExportIdentityLabel, ...] = ()
    estimated_rows: LogExportEstimatedRows = None


class WorkflowLogExportTaskResponse(LogExportTaskResponse):
    status: Literal["pending"]


class WorkflowLogExportStatusResponse(LogExportTaskResponse):
    status: LogExportStatus
    progress: LogExportProgressResponse | None = None
    email_notification: LogExportEmailState | None = Field(default=None, exclude_if=lambda value: value is None)


class WorkflowLogExportFiltersResponse(ResponseModel):
    """Submitted filters for the export, with log time bounds in UTC."""

    keyword: str | None
    status: WorkflowExecutionStatus | None
    created_at__before: datetime | None = Field(validation_alias="created_at_before")
    created_at__after: datetime | None = Field(validation_alias="created_at_after")
    end_user_ids: tuple[str, ...]
    account_ids: tuple[str, ...]

    @field_serializer("created_at__before", "created_at__after")
    def _serialize_utc_bound(self, value: datetime | None) -> datetime | None:
        """Serialize a present bound as UTC so the Console can display it in local time."""
        return ensure_naive_utc(value).replace(tzinfo=UTC) if value is not None else None


class WorkflowLogExportLatestTaskResponse(WorkflowLogExportStatusResponse):
    filters: WorkflowLogExportFiltersResponse
    identity_labels: tuple[LogExportIdentityLabel, ...] = ()
    expires_at: datetime | None = Field(default=None, description="UTC deadline for downloading the export")


class WorkflowLogExportLatestResponse(ResponseModel):
    task: WorkflowLogExportLatestTaskResponse | None = Field(
        description="Null if the caller has no live export task for this app"
    )


class WorkflowLogExportIdentityResponse(ResponseModel):
    id: str
    label: str
    source: ConsoleLogIdentitySource


class WorkflowLogExportIdentitySearchResponse(ResponseModel):
    data: list[WorkflowLogExportIdentityResponse]


def _get_workflow_log_scope(request_context: RequestContext, app_id: UUID) -> WorkflowLogExportScope:
    """Resolve the Workflow app in the admitted caller's current workspace."""
    try:
        return application_services().workflow_app_logs.get_log_export_scope(request_context, str(app_id))
    except ConsoleAppNotFoundError as exc:
        raise AppNotFoundError(str(exc)) from exc


def _resolve_log_export_scope(request_context: RequestContext, app_id: UUID) -> WorkflowLogExportScope:
    """Require an admitted workspace Owner or Admin, a Workflow app, and any Cloud export entitlement."""
    if not TenantAccountRole.is_privileged_role(current_account_with_tenant().account.role):
        raise ForbiddenError()
    scope = _get_workflow_log_scope(request_context, app_id)
    if FeatureService.requires_paid_plan_for_log_export() and not is_cloud_edition_billing_paid_plan(scope.tenant_id):
        raise PaidPlanRequiredError()
    return scope


register_schema_models(console_ns, WorkflowLogExportCreatePayload, LogExportEmailNotificationPayload)
register_response_schema_models(
    console_ns,
    WorkflowLogExportPreviewResponse,
    WorkflowLogExportIdentityResponse,
    WorkflowLogExportIdentitySearchResponse,
    WorkflowLogExportTaskResponse,
    WorkflowLogExportStatusResponse,
    WorkflowLogExportLatestResponse,
    LogExportEmailNotificationResponse,
    BinaryFileResponse,
)


@console_ns.route("/apps/<uuid:app_id>/workflow-log-exports/preview")
class WorkflowLogExportPreviewApi(Resource):
    @error_responses(
        AppNotFoundError, ForbiddenError, PaidPlanRequiredError, InvalidArgumentError, _WorkflowLogValidationError
    )
    @console_ns.doc("preview_workflow_log_export")
    @console_ns.doc(description="Count CSV rows for published Workflow runs matching the Logs filters")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(WorkflowLogExportPreviewQuery)})
    @console_ns.response(HTTPStatus.OK, "Export preview", console_ns.models[WorkflowLogExportPreviewResponse.__name__])
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.APP_LOG_AND_ANNOTATION, PlainApp()),))
    def get(self, request_context: RequestContext, app_id: UUID) -> dict[str, object]:
        """Return the admitted app's unpaginated export count, with one row per published run."""
        scope = _resolve_log_export_scope(request_context, app_id)
        try:
            query = query_params_from_request(
                WorkflowLogExportPreviewQuery, list_fields=("end_user_ids", "account_ids")
            )
        except ValidationError as exc:
            raise _WorkflowLogValidationError(
                exc.json(include_url=False, include_input=False, include_context=False)
            ) from None
        row_count = application_services().workflow_app_logs.count_log_export_rows(
            scope=scope, filters=query.to_filters()
        )
        return dump_response(WorkflowLogExportPreviewResponse, {"row_count": row_count})


@console_ns.route("/apps/<uuid:app_id>/workflow-log-exports/identity-options")
class WorkflowLogExportIdentityOptionsApi(Resource):
    @error_responses(AppNotFoundError, ForbiddenError, PaidPlanRequiredError, _WorkflowLogValidationError)
    @console_ns.doc("search_workflow_log_export_identities")
    @console_ns.doc(description="Search end users and accounts with visible runs in the Workflow app")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(WorkflowLogExportIdentityQuery)})
    @console_ns.response(
        HTTPStatus.OK, "Matching identities", console_ns.models[WorkflowLogExportIdentitySearchResponse.__name__]
    )
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.APP_LOG_AND_ANNOTATION, PlainApp()),))
    def get(self, request_context: RequestContext, app_id: UUID) -> dict[str, object]:
        """Return up to 20 matches per identity type for the admitted Workflow app."""
        scope = _resolve_log_export_scope(request_context, app_id)
        return _search_log_identities(scope)


def _search_log_identities(scope: WorkflowLogExportScope) -> dict[str, object]:
    """Return matching visible identities for the resolved Workflow app."""
    try:
        query = query_params_from_request(WorkflowLogExportIdentityQuery)
    except ValidationError as exc:
        raise _WorkflowLogValidationError(
            exc.json(include_url=False, include_input=False, include_context=False)
        ) from None
    matches = application_services().workflow_app_logs.search_log_export_identities(scope=scope, keyword=query.keyword)
    return dump_response(WorkflowLogExportIdentitySearchResponse, {"data": matches})


@console_ns.route("/apps/<uuid:app_id>/workflow-app-logs/identity-options")
class WorkflowAppLogIdentityOptionsApi(Resource):
    @error_responses(AppNotFoundError, _WorkflowLogValidationError)
    @console_ns.doc("search_workflow_app_log_identities")
    @console_ns.doc(description="Search identities in the visible logs of a Workflow app")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(WorkflowLogExportIdentityQuery)})
    @console_ns.response(
        HTTPStatus.OK, "Matching identities", console_ns.models[WorkflowLogExportIdentitySearchResponse.__name__]
    )
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.APP_LOG_AND_ANNOTATION, PlainApp()),))
    def get(self, request_context: RequestContext, app_id: UUID) -> dict[str, object]:
        """Search app identities under the Logs permission granted by the route."""
        return _search_log_identities(_get_workflow_log_scope(request_context, app_id))


@console_ns.route("/apps/<uuid:app_id>/workflow-log-exports")
class WorkflowLogExportApi(Resource):
    @error_responses(
        AppNotFoundError,
        ForbiddenError,
        PaidPlanRequiredError,
        InvalidArgumentError,
        LogExportLimitReachedHTTPError,
        _WorkflowLogValidationError,
    )
    @console_ns.doc("create_workflow_log_export")
    @console_ns.doc(description="Create a pending CSV export task for published runs in a Workflow app")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[WorkflowLogExportCreatePayload.__name__])
    @console_ns.response(
        HTTPStatus.ACCEPTED, "Export task accepted", console_ns.models[WorkflowLogExportTaskResponse.__name__]
    )
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.APP_LOG_AND_ANNOTATION, PlainApp()),))
    def post(self, request_context: RequestContext, app_id: UUID) -> tuple[dict[str, object], HTTPStatus]:
        """Admit the app and caller and acknowledge the task after persisting the normalized filters."""
        scope = _resolve_log_export_scope(request_context, app_id)
        try:
            payload = WorkflowLogExportCreatePayload.model_validate(request.get_json(silent=True))
        except ValidationError as exc:
            raise _WorkflowLogValidationError(
                exc.json(include_url=False, include_input=False, include_context=False)
            ) from None
        try:
            task = application_services().workflow_log_exports.create_task(
                scope=scope,
                requested_by=request_context.account_id,
                filters=payload.to_filters(),
                identity_labels=payload.identity_labels,
                estimated_rows=payload.estimated_rows,
            )
        except LogExportLimitReachedError as exc:
            raise LogExportLimitReachedHTTPError() from exc
        return dump_response(WorkflowLogExportTaskResponse, task), HTTPStatus.ACCEPTED


@console_ns.route("/apps/<uuid:app_id>/workflow-log-exports/latest")
class WorkflowLogExportLatestApi(Resource):
    @error_responses(AppNotFoundError, ForbiddenError, PaidPlanRequiredError)
    @console_ns.doc("get_latest_workflow_log_export")
    @console_ns.doc(description="Read the caller's latest Workflow CSV export and its submitted filters")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(HTTPStatus.OK, "Latest export", console_ns.models[WorkflowLogExportLatestResponse.__name__])
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.APP_LOG_AND_ANNOTATION, PlainApp()),))
    def get(
        self, request_context: RequestContext, app_id: UUID
    ) -> tuple[dict[str, object], HTTPStatus, dict[str, str]]:
        """Return the caller's latest live export for this app, or null if it is unavailable."""
        scope = _resolve_log_export_scope(request_context, app_id)
        task = application_services().workflow_log_exports.get_latest_task(
            scope=scope, requested_by=request_context.account_id
        )
        return (
            dump_response(WorkflowLogExportLatestResponse, {"task": task}),
            HTTPStatus.OK,
            {"Cache-Control": "no-store"},
        )


@console_ns.route("/apps/<uuid:app_id>/workflow-log-exports/<uuid:task_id>")
class WorkflowLogExportTaskApi(Resource):
    @staticmethod
    def _get_task(request_context: RequestContext, app_id: UUID, task_id: UUID) -> WorkflowLogExportTask:
        """Load an export in the caller's admitted Workflow scope."""
        scope = _resolve_log_export_scope(request_context, app_id)
        return application_services().workflow_log_exports.get_task(scope=scope, task_id=str(task_id))

    @error_responses(AppNotFoundError, WorkflowLogExportTaskNotFoundHTTPError, ForbiddenError, PaidPlanRequiredError)
    @console_ns.doc("get_workflow_log_export_status")
    @console_ns.doc(description="Get the current status of a Workflow CSV export task")
    @console_ns.doc(params={"app_id": "Application ID", "task_id": "Export task ID"})
    @console_ns.response(
        HTTPStatus.OK, "Export task status", console_ns.models[WorkflowLogExportStatusResponse.__name__]
    )
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.APP_LOG_AND_ANNOTATION, PlainApp()),))
    def get(
        self, request_context: RequestContext, app_id: UUID, task_id: UUID
    ) -> tuple[dict[str, object], HTTPStatus, dict[str, str]]:
        """Return the state of a live task for the admitted workspace and Workflow app."""
        try:
            task = self._get_task(request_context, app_id, task_id)
        except LogExportTaskNotFoundError as exc:
            raise WorkflowLogExportTaskNotFoundHTTPError() from exc
        return (
            dump_response(WorkflowLogExportStatusResponse, task)
            | log_export_status_email_preference(
                task, account_id=request_context.account_id, export_kind=LogExportKind.WORKFLOW
            ),
            HTTPStatus.OK,
            {"Cache-Control": "no-store"},
        )

    @error_responses(AppNotFoundError, WorkflowLogExportTaskNotFoundHTTPError, ForbiddenError, PaidPlanRequiredError)
    @console_ns.doc("set_workflow_log_export_email_notification")
    @console_ns.doc(description="Set the requester's email preference for this Workflow CSV export")
    @console_ns.expect(console_ns.models[LogExportEmailNotificationPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK, "Email notification preference", console_ns.models[LogExportEmailNotificationResponse.__name__]
    )
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.APP_LOG_AND_ANNOTATION, PlainApp()),))
    @model_validate(LogExportEmailNotificationPayload)
    def put(
        self, payload: LogExportEmailNotificationPayload, request_context: RequestContext, app_id: UUID, task_id: UUID
    ) -> tuple[dict[str, object], HTTPStatus, dict[str, str]]:
        """Update the caller's preference for a live Workflow export."""
        try:
            task = self._get_task(request_context, app_id, task_id)
            return update_log_export_email_preference(
                task, account_id=request_context.account_id, export_kind=LogExportKind.WORKFLOW, enabled=payload.enabled
            )
        except LogExportTaskNotFoundError as exc:
            raise WorkflowLogExportTaskNotFoundHTTPError() from exc


@console_ns.route("/apps/<uuid:app_id>/workflow-log-exports/<uuid:task_id>/cancel")
class WorkflowLogExportCancelApi(Resource):
    @error_responses(
        AppNotFoundError,
        WorkflowLogExportTaskNotFoundHTTPError,
        LogExportTaskNotCancelableHTTPError,
        ForbiddenError,
        PaidPlanRequiredError,
    )
    @console_ns.doc(
        "cancel_workflow_log_export",
        description="Cancel a queued Workflow CSV export task",
        params={"app_id": "Application ID", "task_id": "Export task ID"},
    )
    @console_ns.response(HTTPStatus.OK, "Export canceled", console_ns.models[WorkflowLogExportStatusResponse.__name__])
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.APP_LOG_AND_ANNOTATION, PlainApp()),))
    def post(
        self, request_context: RequestContext, app_id: UUID, task_id: UUID
    ) -> tuple[dict[str, object], HTTPStatus, dict[str, str]]:
        """Cancel the admitted requester's queued Workflow task and return its new status."""
        scope = _resolve_log_export_scope(request_context, app_id)
        try:
            task = application_services().workflow_log_exports.cancel_task(
                scope=scope, task_id=str(task_id), requested_by=request_context.account_id
            )
        except LogExportTaskNotFoundError as exc:
            raise WorkflowLogExportTaskNotFoundHTTPError() from exc
        except LogExportTaskNotCancelableError as exc:
            raise LogExportTaskNotCancelableHTTPError() from exc
        return dump_response(WorkflowLogExportStatusResponse, task), HTTPStatus.OK, {"Cache-Control": "no-store"}


@console_ns.route("/apps/<uuid:app_id>/workflow-log-exports/<uuid:task_id>/file")
class WorkflowLogExportFileApi(Resource):
    @error_responses(
        AppNotFoundError,
        WorkflowLogExportTaskNotFoundHTTPError,
        WorkflowLogExportTaskNotReadyHTTPError,
        WorkflowLogExportFileNotFoundHTTPError,
        ForbiddenError,
        PaidPlanRequiredError,
    )
    @console_ns.doc("download_workflow_log_export")
    @console_ns.doc(description="Download a completed Workflow CSV from object storage or the Console API")
    @console_ns.doc(params={"app_id": "Application ID", "task_id": "Export task ID"})
    @console_ns.produces(["text/csv"])
    @console_ns.response(HTTPStatus.OK, "CSV attachment", console_ns.models[BinaryFileResponse.__name__])
    @console_ns.response(
        HTTPStatus.FOUND,
        "Redirect to a pre-signed CSV download URL",
        headers={"Location": {"description": "Pre-signed object storage URL", "type": "string"}},
    )
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.APP_LOG_AND_ANNOTATION, PlainApp()),))
    def get(self, request_context: RequestContext, app_id: UUID, task_id: UUID) -> Response:
        """Authorize the Workflow app and ready export before opening its CSV."""
        scope = _resolve_log_export_scope(request_context, app_id)
        filename = f"workflow-logs-{task_id}.csv"
        try:
            download = application_services().workflow_log_exports.download_csv(
                scope=scope, task_id=str(task_id), filename=filename
            )
        except LogExportTaskNotFoundError as exc:
            raise WorkflowLogExportTaskNotFoundHTTPError() from exc
        except LogExportTaskNotReadyError as exc:
            raise WorkflowLogExportTaskNotReadyHTTPError() from exc
        except LogExportFileNotFoundError as exc:
            raise WorkflowLogExportFileNotFoundHTTPError() from exc
        # response-contract:ignore signed redirect or streamed CSV attachment
        return log_export_file_response(download, filename=filename)
