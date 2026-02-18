import logging

from flask import request
from flask_restx import Resource, fields, marshal, marshal_with
from pydantic import BaseModel, Field
from sqlalchemy import select
from werkzeug.exceptions import Unauthorized

import services
from controllers.common.errors import (
    FilenameNotExistsError,
    FileTooLargeError,
    NoFileUploadedError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.console import console_ns
from controllers.console.admin import admin_required
from controllers.console.error import AccountNotLinkTenantError
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_resource_check,
    only_edition_enterprise,
    setup_required,
)
from enums.cloud_plan import CloudPlan
from extensions.ext_database import db
from libs.helper import TimestampField
from libs.login import current_account_with_tenant, login_required
from models.account import Tenant, TenantStatus
from services.account_service import TenantService
from services.enterprise.enterprise_service import EnterpriseService
from services.feature_service import FeatureService
from services.file_service import FileService
from services.workspace_service import WorkspaceService

logger = logging.getLogger(__name__)
DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class WorkspaceListQuery(BaseModel):
    page: int = Field(default=1, ge=1, le=99999)
    limit: int = Field(default=20, ge=1, le=100)


class SwitchWorkspacePayload(BaseModel):
    tenant_id: str


class WorkspaceCustomConfigPayload(BaseModel):
    remove_webapp_brand: bool | None = None
    replace_webapp_logo: str | None = None


class WorkspaceInfoPayload(BaseModel):
    name: str


def reg(cls: type[BaseModel]):
    console_ns.schema_model(cls.__name__, cls.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0))


reg(WorkspaceListQuery)
reg(SwitchWorkspacePayload)
reg(WorkspaceCustomConfigPayload)
reg(WorkspaceInfoPayload)

provider_fields = {
    "provider_name": fields.String,
    "provider_type": fields.String,
    "is_valid": fields.Boolean,
    "token_is_set": fields.Boolean,
}

tenant_fields = {
    "id": fields.String,
    "name": fields.String,
    "plan": fields.String,
    "status": fields.String,
    "created_at": TimestampField,
    "role": fields.String,
    "in_trial": fields.Boolean,
    "trial_end_reason": fields.String,
    "custom_config": fields.Raw(attribute="custom_config"),
    "trial_credits": fields.Integer,
    "trial_credits_used": fields.Integer,
    "next_credit_reset_date": fields.Integer,
}

tenants_fields = {
    "id": fields.String,
    "name": fields.String,
    "plan": fields.String,
    "status": fields.String,
    "created_at": TimestampField,
    "current": fields.Boolean,
}

workspace_fields = {"id": fields.String, "name": fields.String, "status": fields.String, "created_at": TimestampField}


@console_ns.route("/workspaces")
class TenantListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        current_user, current_tenant_id = current_account_with_tenant()
        tenants = TenantService.get_join_tenants(current_user)
        tenant_dicts = []

        for tenant in tenants:
            features = FeatureService.get_features(tenant.id)

            # Create a dictionary with tenant attributes
            tenant_dict = {
                "id": tenant.id,
                "name": tenant.name,
                "status": tenant.status,
                "created_at": tenant.created_at,
                "plan": features.billing.subscription.plan if features.billing.enabled else CloudPlan.SANDBOX,
                "current": tenant.id == current_tenant_id if current_tenant_id else False,
            }

            tenant_dicts.append(tenant_dict)

        return {"workspaces": marshal(tenant_dicts, tenants_fields)}, 200


@console_ns.route("/all-workspaces")
class WorkspaceListApi(Resource):
    @console_ns.expect(console_ns.models[WorkspaceListQuery.__name__])
    @setup_required
    @admin_required
    def get(self):
        payload = request.args.to_dict(flat=True)  # type: ignore
        args = WorkspaceListQuery.model_validate(payload)

        stmt = select(Tenant).order_by(Tenant.created_at.desc())
        tenants = db.paginate(select=stmt, page=args.page, per_page=args.limit, error_out=False)
        has_more = False

        if tenants.has_next:
            has_more = True

        return {
            "data": marshal(tenants.items, workspace_fields),
            "has_more": has_more,
            "limit": args.limit,
            "page": args.page,
            "total": tenants.total,
        }, 200


@console_ns.route("/workspaces/current", endpoint="workspaces_current")
@console_ns.route("/info", endpoint="info")  # Deprecated
class TenantApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(tenant_fields)
    def post(self):
        if request.path == "/info":
            logger.warning("Deprecated URL /info was used.")

        current_user, _ = current_account_with_tenant()
        tenant = current_user.current_tenant
        if not tenant:
            raise ValueError("No current tenant")

        if tenant.status == TenantStatus.ARCHIVE:
            tenants = TenantService.get_join_tenants(current_user)
            # if there is any tenant, switch to the first one
            if len(tenants) > 0:
                TenantService.switch_tenant(current_user, tenants[0].id)
                tenant = tenants[0]
            # else, raise Unauthorized
            else:
                raise Unauthorized("workspace is archived")

        return WorkspaceService.get_tenant_info(tenant), 200


@console_ns.route("/workspaces/switch")
class SwitchWorkspaceApi(Resource):
    @console_ns.expect(console_ns.models[SwitchWorkspacePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        current_user, _ = current_account_with_tenant()
        payload = console_ns.payload or {}
        args = SwitchWorkspacePayload.model_validate(payload)

        # check if tenant_id is valid, 403 if not
        try:
            TenantService.switch_tenant(current_user, args.tenant_id)
        except Exception:
            raise AccountNotLinkTenantError("Account not link tenant")

        new_tenant = db.session.query(Tenant).get(args.tenant_id)  # Get new tenant
        if new_tenant is None:
            raise ValueError("Tenant not found")

        return {"result": "success", "new_tenant": marshal(WorkspaceService.get_tenant_info(new_tenant), tenant_fields)}


@console_ns.route("/workspaces/custom-config")
class CustomConfigWorkspaceApi(Resource):
    @console_ns.expect(console_ns.models[WorkspaceCustomConfigPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("workspace_custom")
    def post(self):
        _, current_tenant_id = current_account_with_tenant()
        payload = console_ns.payload or {}
        args = WorkspaceCustomConfigPayload.model_validate(payload)
        tenant = db.get_or_404(Tenant, current_tenant_id)

        custom_config_dict = {
            "remove_webapp_brand": args.remove_webapp_brand,
            "replace_webapp_logo": args.replace_webapp_logo
            if args.replace_webapp_logo is not None
            else tenant.custom_config_dict.get("replace_webapp_logo"),
        }

        tenant.custom_config_dict = custom_config_dict
        db.session.commit()

        return {"result": "success", "tenant": marshal(WorkspaceService.get_tenant_info(tenant), tenant_fields)}


@console_ns.route("/workspaces/custom-config/webapp-logo/upload")
class WebappLogoWorkspaceApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("workspace_custom")
    def post(self):
        current_user, _ = current_account_with_tenant()
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
                content=file.read(),
                mimetype=file.mimetype,
                user=current_user,
            )

        except services.errors.file.FileTooLargeError as file_too_large_error:
            raise FileTooLargeError(file_too_large_error.description)
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError()

        return {"id": upload_file.id}, 201


@console_ns.route("/workspaces/info")
class WorkspaceInfoApi(Resource):
    @console_ns.expect(console_ns.models[WorkspaceInfoPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    # Change workspace name
    def post(self):
        _, current_tenant_id = current_account_with_tenant()
        payload = console_ns.payload or {}
        args = WorkspaceInfoPayload.model_validate(payload)

        if not current_tenant_id:
            raise ValueError("No current tenant")
        tenant = db.get_or_404(Tenant, current_tenant_id)
        tenant.name = args.name
        db.session.commit()

        return {"result": "success", "tenant": marshal(WorkspaceService.get_tenant_info(tenant), tenant_fields)}


@console_ns.route("/workspaces/current/permission")
class WorkspacePermissionApi(Resource):
    """Get workspace permissions for the current workspace."""

    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_enterprise
    def get(self):
        """
        Get workspace permission settings.
        Returns permission flags that control workspace features like member invitations and owner transfer.
        """
        _, current_tenant_id = current_account_with_tenant()

        if not current_tenant_id:
            raise ValueError("No current tenant")

        # Get workspace permissions from enterprise service
        permission = EnterpriseService.WorkspacePermissionService.get_permission(current_tenant_id)

        return {
            "workspace_id": permission.workspace_id,
            "allow_member_invite": permission.allow_member_invite,
            "allow_owner_transfer": permission.allow_owner_transfer,
        }, 200
