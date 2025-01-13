import logging

from flask import request
from flask_login import current_user  # type: ignore
from flask_restful import Resource, fields, inputs, marshal, marshal_with, reqparse  # type: ignore
from werkzeug.exceptions import Unauthorized

import services
from controllers.common.errors import FilenameNotExistsError
from controllers.console import api
from controllers.console.admin import admin_required
from controllers.console.datasets.error import (
    FileTooLargeError,
    NoFileUploadedError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.console.error import AccountNotLinkTenantError
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_resource_check,
    setup_required,
)
from extensions.ext_database import db
from libs.helper import TimestampField
from libs.login import login_required
from models.account import Tenant, TenantStatus
from services.account_service import TenantService
from services.file_service import FileService
from services.workspace_service import WorkspaceService

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


class TenantListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        tenants = TenantService.get_join_tenants(current_user)

        for tenant in tenants:
            if tenant.id == current_user.current_tenant_id:
                tenant.current = True  # Set current=True for current tenant
        return {"workspaces": marshal(tenants, tenants_fields)}, 200


class WorkspaceListApi(Resource):
    @setup_required
    @admin_required
    def get(self):
        parser = reqparse.RequestParser()
        parser.add_argument("page", type=inputs.int_range(1, 99999), required=False, default=1, location="args")
        parser.add_argument("limit", type=inputs.int_range(1, 100), required=False, default=20, location="args")
        args = parser.parse_args()

        tenants = Tenant.query.order_by(Tenant.created_at.desc()).paginate(page=args["page"], per_page=args["limit"])

        has_more = False
        if len(tenants.items) == args["limit"]:
            current_page_first_tenant = tenants[-1]
            rest_count = (
                db.session.query(Tenant)
                .filter(
                    Tenant.created_at < current_page_first_tenant.created_at, Tenant.id != current_page_first_tenant.id
                )
                .count()
            )

            if rest_count > 0:
                has_more = True
        total = db.session.query(Tenant).count()
        return {
            "data": marshal(tenants.items, workspace_fields),
            "has_more": has_more,
            "limit": args["limit"],
            "page": args["page"],
            "total": total,
        }, 200


class TenantApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(tenant_fields)
    def get(self):
        if request.path == "/info":
            logging.warning("Deprecated URL /info was used.")

        tenant = current_user.current_tenant

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


class SwitchWorkspaceApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("tenant_id", type=str, required=True, location="json")
        args = parser.parse_args()

        # check if tenant_id is valid, 403 if not
        try:
            TenantService.switch_tenant(current_user, args["tenant_id"])
        except Exception:
            raise AccountNotLinkTenantError("Account not link tenant")

        new_tenant = db.session.query(Tenant).get(args["tenant_id"])  # Get new tenant
        if new_tenant is None:
            raise ValueError("Tenant not found")

        return {"result": "success", "new_tenant": marshal(WorkspaceService.get_tenant_info(new_tenant), tenant_fields)}


class CustomConfigWorkspaceApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("workspace_custom")
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("remove_webapp_brand", type=bool, location="json")
        parser.add_argument("replace_webapp_logo", type=str, location="json")
        args = parser.parse_args()

        tenant = Tenant.query.filter(Tenant.id == current_user.current_tenant_id).one_or_404()

        custom_config_dict = {
            "remove_webapp_brand": args["remove_webapp_brand"],
            "replace_webapp_logo": args["replace_webapp_logo"]
            if args["replace_webapp_logo"] is not None
            else tenant.custom_config_dict.get("replace_webapp_logo"),
        }

        tenant.custom_config_dict = custom_config_dict
        db.session.commit()

        return {"result": "success", "tenant": marshal(WorkspaceService.get_tenant_info(tenant), tenant_fields)}


class WebappLogoWorkspaceApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("workspace_custom")
    def post(self):
        # get file from request
        file = request.files["file"]

        # check file
        if "file" not in request.files:
            raise NoFileUploadedError()

        if len(request.files) > 1:
            raise TooManyFilesError()

        if not file.filename:
            raise FilenameNotExistsError

        extension = file.filename.split(".")[-1]
        if extension.lower() not in {"svg", "png"}:
            raise UnsupportedFileTypeError()

        try:
            upload_file = FileService.upload_file(
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


api.add_resource(TenantListApi, "/workspaces")  # GET for getting all tenants
api.add_resource(WorkspaceListApi, "/all-workspaces")  # GET for getting all tenants
api.add_resource(TenantApi, "/workspaces/current", endpoint="workspaces_current")  # GET for getting current tenant info
api.add_resource(TenantApi, "/info", endpoint="info")  # Deprecated
api.add_resource(SwitchWorkspaceApi, "/workspaces/switch")  # POST for switching tenant
api.add_resource(CustomConfigWorkspaceApi, "/workspaces/custom-config")
api.add_resource(WebappLogoWorkspaceApi, "/workspaces/custom-config/webapp-logo/upload")
