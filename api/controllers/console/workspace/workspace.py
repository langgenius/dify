import logging
from datetime import datetime
from http import HTTPStatus

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from werkzeug.exceptions import Unauthorized

import services
from configs import dify_config
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
from controllers.console.admin import admin_required
from controllers.console.error import AccountNotLinkTenantError
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_resource_check,
    only_edition_enterprise,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from enums.cloud_plan import CloudPlan
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.helper import dump_response, to_timestamp
from libs.login import login_required
from libs.pagination import paginate_query
from models.account import Account, Tenant, TenantAccountJoin, TenantCustomConfigDict, TenantStatus
from services.account_service import TenantService
from services.billing_service import BillingService, SubscriptionPlan
from services.enterprise.enterprise_service import EnterpriseService
from services.feature_service import FeatureService
from services.file_service import FileService
from services.workspace_service import WorkspaceService

logger = logging.getLogger(__name__)


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
    plan: str | None = None
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

    @field_validator("plan", "status", "trial_end_reason", mode="before")
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


class TenantListItemResponse(ResponseModel):
    id: str
    name: str | None = None
    plan: str | None = None
    status: str | None = None
    created_at: int | None = None
    last_opened_at: int | None = None
    current: bool

    @field_validator("plan", "status", mode="before")
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
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, current_tenant_id: str, current_user: Account):
        tenant_rows: list[tuple[Tenant, TenantAccountJoin]] = [
            (tenant, membership)
            for tenant, membership in TenantService.get_workspaces_for_account(current_user.id, session=db.session())
            if tenant.status == TenantStatus.NORMAL
        ]
        tenants = [tenant for tenant, _ in tenant_rows]
        tenant_dicts = []
        is_enterprise_only = dify_config.ENTERPRISE_ENABLED and not dify_config.BILLING_ENABLED
        is_saas = dify_config.EDITION == "CLOUD" and dify_config.BILLING_ENABLED
        tenant_plans: dict[str, SubscriptionPlan] = {}

        if is_saas:
            tenant_ids = [tenant.id for tenant in tenants]
            if tenant_ids:
                tenant_plans = BillingService.get_plan_bulk(tenant_ids)
                if not tenant_plans:
                    logger.warning("get_plan_bulk returned empty result, falling back to legacy feature path")

        for tenant, membership in tenant_rows:
            plan: str = CloudPlan.SANDBOX
            if is_saas:
                tenant_plan = tenant_plans.get(tenant.id)
                if tenant_plan:
                    plan = tenant_plan["plan"] or CloudPlan.SANDBOX
                else:
                    features = FeatureService.get_features(tenant.id, exclude_vector_space=True)
                    plan = features.billing.subscription.plan or CloudPlan.SANDBOX
            elif not is_enterprise_only:
                features = FeatureService.get_features(tenant.id, exclude_vector_space=True)
                plan = features.billing.subscription.plan or CloudPlan.SANDBOX

            # Create a dictionary with tenant attributes
            tenant_dict = {
                "id": tenant.id,
                "name": tenant.name,
                "status": tenant.status,
                "created_at": tenant.created_at,
                "last_opened_at": membership.last_opened_at,
                "plan": plan,
                "current": tenant.id == current_tenant_id if current_tenant_id else False,
            }

            tenant_dicts.append(tenant_dict)

        return dump_response(TenantListResponse, {"workspaces": tenant_dicts}), HTTPStatus.OK


@console_ns.route("/all-workspaces")
class WorkspaceListApi(Resource):
    @console_ns.doc(params=query_params_from_model(WorkspaceListQuery))
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[WorkspacePaginationResponse.__name__])
    @setup_required
    @admin_required
    def get(self):
        args = query_params_from_request(WorkspaceListQuery)

        stmt = select(Tenant).order_by(Tenant.created_at.desc())
        tenants = paginate_query(stmt, page=args.page, per_page=args.limit)
        has_more = False

        if tenants.has_next:
            has_more = True

        return WorkspacePaginationResponse(
            data=tenants.items, has_more=has_more, limit=args.limit, page=args.page, total=tenants.total or 0
        ).model_dump(mode="json"), HTTPStatus.OK


@console_ns.route("/workspaces/current", endpoint="workspaces_current")
@console_ns.route("/info", endpoint="info")  # Deprecated
class TenantApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[TenantInfoResponse.__name__])
    @with_current_user
    def post(self, current_user: Account):
        if request.path == "/info":
            logger.warning("Deprecated URL /info was used.")

        tenant = current_user.current_tenant
        if not tenant:
            raise ValueError("No current tenant")

        if tenant.status == TenantStatus.ARCHIVE:
            tenants = TenantService.get_join_tenants(current_user, session=db.session())
            # if there is any tenant, switch to the first one
            if len(tenants) > 0:
                TenantService.switch_tenant(current_user, tenants[0].id, session=db.session())
                tenant = tenants[0]
            # else, raise Unauthorized
            else:
                raise Unauthorized("workspace is archived")

        return (
            dump_response(TenantInfoResponse, WorkspaceService.get_tenant_info(tenant, session=db.session())),
            HTTPStatus.OK,
        )


@console_ns.route("/workspaces/switch")
class SwitchWorkspaceApi(Resource):
    @console_ns.expect(console_ns.models[SwitchWorkspacePayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[SwitchWorkspaceResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    def post(self, current_user: Account):
        payload = console_ns.payload or {}
        args = SwitchWorkspacePayload.model_validate(payload)

        # Check whether the tenant_id belongs to the current account.
        try:
            TenantService.switch_tenant(current_user, args.tenant_id, session=db.session())
        except Exception:
            raise AccountNotLinkTenantError("Account not link tenant")

        new_tenant = db.session.get(Tenant, args.tenant_id)  # Get new tenant
        if new_tenant is None:
            raise ValueError("Tenant not found")

        return SwitchWorkspaceResponse(
            result="success", new_tenant=WorkspaceService.get_tenant_info(new_tenant, session=db.session())
        ).model_dump(mode="json")


@console_ns.route("/workspaces/custom-config")
class CustomConfigWorkspaceApi(Resource):
    @console_ns.expect(console_ns.models[WorkspaceCustomConfigPayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[WorkspaceTenantResultResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("workspace_custom")
    @with_current_tenant_id
    def post(self, current_tenant_id: str):
        payload = console_ns.payload or {}
        args = WorkspaceCustomConfigPayload.model_validate(payload)
        tenant = db.get_or_404(Tenant, current_tenant_id)

        custom_config_dict: TenantCustomConfigDict = {
            "remove_webapp_brand": args.remove_webapp_brand
            if args.remove_webapp_brand is not None
            else tenant.custom_config_dict.get("remove_webapp_brand", False),
            "replace_webapp_logo": args.replace_webapp_logo
            if args.replace_webapp_logo is not None
            else tenant.custom_config_dict.get("replace_webapp_logo"),
        }

        tenant.custom_config_dict = custom_config_dict
        db.session.commit()

        return WorkspaceTenantResultResponse(
            result="success", tenant=WorkspaceService.get_tenant_info(tenant, session=db.session())
        ).model_dump(mode="json")


@console_ns.route("/workspaces/custom-config/webapp-logo/upload")
class WebappLogoWorkspaceApi(Resource):
    @console_ns.doc(consumes=["multipart/form-data"], params=WORKSPACE_LOGO_UPLOAD_PARAMS)
    @console_ns.response(HTTPStatus.CREATED, "Logo uploaded", console_ns.models[WorkspaceLogoUploadResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("workspace_custom")
    @with_current_user
    def post(self, current_user: Account):
        # check file
        if "file" not in request.files:
            raise NoFileUploadedError()

        if len(request.files) > 1:
            raise TooManyFilesError()

        # get file from request
        file = request.files["file"]
        if not file.filename:
            raise FilenameNotExistsError

        extension = file.filename.split(".")[-1]
        if extension.lower() not in {"svg", "png"}:
            raise UnsupportedFileTypeError()

        try:
            upload_file = FileService(db.engine).upload_file(
                filename=file.filename,
                content=file.stream.read(),
                mimetype=file.mimetype,
                user=current_user,
            )

        except services.errors.file.FileTooLargeError as file_too_large_error:
            raise FileTooLargeError(file_too_large_error.description)
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError()

        return WorkspaceLogoUploadResponse(id=upload_file.id).model_dump(mode="json"), HTTPStatus.CREATED


@console_ns.route("/workspaces/info")
class WorkspaceInfoApi(Resource):
    @console_ns.expect(console_ns.models[WorkspaceInfoPayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[WorkspaceTenantResultResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    # Change workspace name
    @with_current_tenant_id
    def post(self, current_tenant_id: str):
        payload = console_ns.payload or {}
        args = WorkspaceInfoPayload.model_validate(payload)

        if not current_tenant_id:
            raise ValueError("No current tenant")
        tenant = db.get_or_404(Tenant, current_tenant_id)
        tenant.name = args.name
        db.session.commit()

        return WorkspaceTenantResultResponse(
            result="success", tenant=WorkspaceService.get_tenant_info(tenant, session=db.session())
        ).model_dump(mode="json")


@console_ns.route("/workspaces/current/permission")
class WorkspacePermissionApi(Resource):
    """Get workspace permissions for the current workspace."""

    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[WorkspacePermissionResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_enterprise
    @with_current_tenant_id
    def get(self, current_tenant_id: str):
        """
        Get workspace permission settings.
        Returns permission flags that control workspace features like member invitations and owner transfer.
        """
        if not current_tenant_id:
            raise ValueError("No current tenant")

        # Get workspace permissions from enterprise service
        permission = EnterpriseService.WorkspacePermissionService.get_permission(current_tenant_id)

        return WorkspacePermissionResponse(
            workspace_id=permission.workspace_id,
            allow_member_invite=permission.allow_member_invite,
            allow_owner_transfer=permission.allow_owner_transfer,
        ).model_dump(mode="json"), HTTPStatus.OK
