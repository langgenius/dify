from datetime import datetime
from http import HTTPStatus

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from werkzeug.exceptions import NotFound

from controllers.common.errors import (
    FilenameNotExistsError,
    FileTooLargeError,
    NoFileUploadedError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.common.schema import (
    query_params_from_model,
    query_params_from_request,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console import console_ns
from controllers.console.error import AccountNotLinkTenantError
from controllers.console.flask_admission import console_account_admission, console_admin_admission
from controllers.console.workspace.error import CurrentWorkspaceArchivedError
from enums import CloudPlan, DeploymentEdition
from enums.account import TenantAccountRole
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response, to_timestamp
from machinery.context import RequestContext
from services.errors import file as file_errors
from services.errors.workspace import WorkspaceArchivedError, WorkspaceNotFoundError, WorkspaceNotLinkedError
from services.workspace.contracts import WorkspaceCustomConfigChanges


class WorkspaceListQuery(BaseModel):
    page: int = Field(default=1, ge=1, le=99999)
    limit: int = Field(default=20, ge=1, le=100)


class SwitchWorkspacePayload(BaseModel):
    tenant_id: str


class WorkspaceCustomConfigPayload(BaseModel):
    remove_webapp_brand: bool | None = None
    replace_webapp_logo: str | None = None


class WorkspaceCustomConfigResponse(ResponseModel):
    remove_webapp_brand: bool | None = None
    replace_webapp_logo: str | None = None


class WorkspaceInfoPayload(BaseModel):
    name: str


class TenantInfoResponse(ResponseModel):
    id: str
    name: str | None = None
    plan: CloudPlan | None = None
    status: str | None = None
    created_at: int | None = None
    role: str | None = None
    in_trial: bool | None = None
    trial_end_reason: str | None = None
    custom_config: WorkspaceCustomConfigResponse | None = None
    trial_credits: int | None = None
    trial_credits_used: int | None = None
    trial_credits_exhausted_at: int | None = None
    next_credit_reset_date: int | None = None

    @field_validator("status", "trial_end_reason", mode="before")
    @classmethod
    def _normalize_enum_like(cls, value):
        if value is None:
            return None
        if isinstance(value, str):
            return value
        return str(getattr(value, "value", value))

    @field_validator("created_at", mode="before")
    @classmethod
    def _normalize_created_at(cls, value: datetime | int | None):
        return to_timestamp(value)


class CurrentWorkspaceSummaryResponse(ResponseModel):
    id: str
    name: str
    role: TenantAccountRole
    plan: CloudPlan | None
    credits: int | None = Field(description="Remaining credits in the effective pool; -1 means unlimited.")


class TenantListItemResponse(ResponseModel):
    id: str
    name: str | None = None
    plan: CloudPlan | None = None
    status: str | None = None
    created_at: int | None = None
    last_opened_at: int | None = None
    current: bool

    @field_validator("status", mode="before")
    @classmethod
    def _normalize_enum_like(cls, value):
        if value is None:
            return None
        if isinstance(value, str):
            return value
        return str(getattr(value, "value", value))

    @field_validator("created_at", "last_opened_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None):
        return to_timestamp(value)


class TenantListResponse(ResponseModel):
    workspaces: list[TenantListItemResponse]


class WorkspaceListItemResponse(ResponseModel):
    id: str
    name: str | None = None
    status: str | None = None
    created_at: int | None = None

    @field_validator("status", mode="before")
    @classmethod
    def _normalize_enum_like(cls, value):
        if value is None:
            return None
        if isinstance(value, str):
            return value
        return str(getattr(value, "value", value))

    @field_validator("created_at", mode="before")
    @classmethod
    def _normalize_created_at(cls, value: datetime | int | None):
        return to_timestamp(value)


class WorkspacePaginationResponse(ResponseModel):
    data: list[WorkspaceListItemResponse]
    has_more: bool
    limit: int
    page: int
    total: int


class SwitchWorkspaceResponse(ResponseModel):
    result: str
    new_tenant: TenantInfoResponse


class WorkspaceTenantResultResponse(ResponseModel):
    result: str
    tenant: TenantInfoResponse


class WorkspaceLogoUploadResponse(ResponseModel):
    id: str


class WorkspacePermissionResponse(ResponseModel):
    workspace_id: str
    allow_member_invite: bool
    allow_owner_transfer: bool


WORKSPACE_LOGO_UPLOAD_PARAMS = {
    "file": {
        "in": "formData",
        "type": "file",
        "required": True,
        "description": "Workspace web app logo file. Only SVG and PNG files are supported.",
    }
}


register_schema_models(
    console_ns,
    WorkspaceListQuery,
    SwitchWorkspacePayload,
    WorkspaceCustomConfigPayload,
    WorkspaceInfoPayload,
)
register_response_schema_models(
    console_ns,
    CurrentWorkspaceSummaryResponse,
    TenantInfoResponse,
    TenantListItemResponse,
    TenantListResponse,
    WorkspaceCustomConfigResponse,
    WorkspaceListItemResponse,
    WorkspacePaginationResponse,
    SwitchWorkspaceResponse,
    WorkspaceTenantResultResponse,
    WorkspaceLogoUploadResponse,
    WorkspacePermissionResponse,
)


@console_ns.route("/workspaces")
class TenantListApi(Resource):
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[TenantListResponse.__name__])
    @console_account_admission()
    def get(self, request_context: RequestContext):
        workspaces = application_services().workspaces.queries.list_for_account(request_context)
        return dump_response(TenantListResponse, {"workspaces": workspaces}), HTTPStatus.OK


@console_ns.route("/all-workspaces")
class WorkspaceListApi(Resource):
    @console_ns.doc(params=query_params_from_model(WorkspaceListQuery))
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[WorkspacePaginationResponse.__name__])
    @console_admin_admission
    def get(self):
        args = query_params_from_request(WorkspaceListQuery)
        result = application_services().workspaces.management.list_all(page=args.page, limit=args.limit)
        return dump_response(WorkspacePaginationResponse, result), HTTPStatus.OK


@console_ns.route("/workspaces/current/summary")
class CurrentWorkspaceSummaryApi(Resource):
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[CurrentWorkspaceSummaryResponse.__name__])
    @console_ns.response(HTTPStatus.CONFLICT, "Current workspace is archived")
    @console_account_admission()
    def get(self, context: RequestContext):
        try:
            summary = application_services().workspaces.management.current_summary(context)
        except WorkspaceArchivedError as exc:
            raise CurrentWorkspaceArchivedError() from exc
        except WorkspaceNotFoundError as exc:
            raise NotFound() from exc
        return dump_response(CurrentWorkspaceSummaryResponse, summary), HTTPStatus.OK


@console_ns.route("/workspaces/switch")
class SwitchWorkspaceApi(Resource):
    @console_ns.expect(console_ns.models[SwitchWorkspacePayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[SwitchWorkspaceResponse.__name__])
    @console_account_admission()
    def post(self, context: RequestContext):
        args = SwitchWorkspacePayload.model_validate(console_ns.payload or {})
        try:
            tenant = application_services().workspaces.management.switch(context, args.tenant_id)
        except WorkspaceNotLinkedError as exc:
            raise AccountNotLinkTenantError("Account not link tenant") from exc
        except WorkspaceNotFoundError as exc:
            raise NotFound() from exc
        return dump_response(SwitchWorkspaceResponse, {"result": "success", "new_tenant": tenant})


@console_ns.route("/workspaces/custom-config")
class CustomConfigWorkspaceApi(Resource):
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[WorkspaceCustomConfigResponse.__name__])
    @console_account_admission()
    def get(self, context: RequestContext):
        try:
            config = application_services().workspaces.management.custom_config(context)
        except WorkspaceNotFoundError as exc:
            raise NotFound() from exc
        return dump_response(WorkspaceCustomConfigResponse, config)

    @console_ns.expect(console_ns.models[WorkspaceCustomConfigPayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[WorkspaceTenantResultResponse.__name__])
    @console_account_admission(billing_resource="workspace_custom")
    def post(self, context: RequestContext):
        args = WorkspaceCustomConfigPayload.model_validate(console_ns.payload or {})
        try:
            tenant = application_services().workspaces.management.update_custom_config(
                context,
                WorkspaceCustomConfigChanges(
                    remove_webapp_brand=args.remove_webapp_brand, replace_webapp_logo=args.replace_webapp_logo
                ),
            )
        except WorkspaceNotFoundError as exc:
            raise NotFound() from exc
        return dump_response(WorkspaceTenantResultResponse, {"result": "success", "tenant": tenant})


@console_ns.route("/workspaces/custom-config/webapp-logo/upload")
class WebappLogoWorkspaceApi(Resource):
    @console_ns.doc(consumes=["multipart/form-data"], params=WORKSPACE_LOGO_UPLOAD_PARAMS)
    @console_ns.response(HTTPStatus.CREATED, "Logo uploaded", console_ns.models[WorkspaceLogoUploadResponse.__name__])
    @console_account_admission(billing_resource="workspace_custom")
    def post(self, context: RequestContext):
        if "file" not in request.files:
            raise NoFileUploadedError()
        if len(request.files) > 1:
            raise TooManyFilesError()
        file = request.files["file"]
        if not file.filename:
            raise FilenameNotExistsError()
        try:
            file_id = application_services().workspaces.management.upload_logo(
                context, filename=file.filename, content=file.stream.read(), mimetype=file.mimetype
            )
        except file_errors.FileTooLargeError as exc:
            raise FileTooLargeError(exc.description) from exc
        except file_errors.UnsupportedFileTypeError as exc:
            raise UnsupportedFileTypeError() from exc
        return dump_response(WorkspaceLogoUploadResponse, {"id": file_id}), HTTPStatus.CREATED


@console_ns.route("/workspaces/info")
class WorkspaceInfoApi(Resource):
    @console_ns.expect(console_ns.models[WorkspaceInfoPayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[WorkspaceTenantResultResponse.__name__])
    @console_account_admission()
    def post(self, context: RequestContext):
        args = WorkspaceInfoPayload.model_validate(console_ns.payload or {})
        try:
            tenant = application_services().workspaces.management.rename(context, args.name)
        except WorkspaceNotFoundError as exc:
            raise NotFound() from exc
        return dump_response(WorkspaceTenantResultResponse, {"result": "success", "tenant": tenant})


@console_ns.route("/workspaces/current/permission")
class WorkspacePermissionApi(Resource):
    """Get workspace permissions for the current workspace."""

    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[WorkspacePermissionResponse.__name__])
    @console_account_admission(editions=frozenset({DeploymentEdition.ENTERPRISE}))
    def get(self, context: RequestContext):
        permission = application_services().workspaces.management.permission(context)
        return dump_response(WorkspacePermissionResponse, permission), HTTPStatus.OK
