import uuid

from flask_restx import Resource, fields, inputs, marshal, marshal_with, reqparse
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, Forbidden, abort

from controllers.console import api, console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_resource_check,
    edit_permission_required,
    enterprise_license_required,
    setup_required,
)
from core.ops.ops_trace_manager import OpsTraceManager
from extensions.ext_database import db
from fields.app_fields import app_detail_fields, app_detail_fields_with_site, app_pagination_fields
from libs.login import current_account_with_tenant, login_required
from libs.validators import validate_description_length
from models import App
from services.app_dsl_service import AppDslService, ImportMode
from services.app_service import AppService
from services.enterprise.enterprise_service import EnterpriseService
from services.feature_service import FeatureService

ALLOW_CREATE_APP_MODES = ["chat", "agent-chat", "advanced-chat", "workflow", "completion"]


@console_ns.route("/apps")
class AppListApi(Resource):
    @api.doc("list_apps")
    @api.doc(description="Get list of applications with pagination and filtering")
    @api.expect(
        api.parser()
        .add_argument("page", type=int, location="args", help="Page number (1-99999)", default=1)
        .add_argument("limit", type=int, location="args", help="Page size (1-100)", default=20)
        .add_argument(
            "mode",
            type=str,
            location="args",
            choices=["completion", "chat", "advanced-chat", "workflow", "agent-chat", "channel", "all"],
            default="all",
            help="App mode filter",
        )
        .add_argument("name", type=str, location="args", help="Filter by app name")
        .add_argument("tag_ids", type=str, location="args", help="Comma-separated tag IDs")
        .add_argument("is_created_by_me", type=bool, location="args", help="Filter by creator")
    )
    @api.response(200, "Success", app_pagination_fields)
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    def get(self):
        """Get app list"""
        current_user, current_tenant_id = current_account_with_tenant()

        def uuid_list(value):
            try:
                return [str(uuid.UUID(v)) for v in value.split(",")]
            except ValueError:
                abort(400, message="Invalid UUID format in tag_ids.")

        parser = (
            reqparse.RequestParser()
            .add_argument("page", type=inputs.int_range(1, 99999), required=False, default=1, location="args")
            .add_argument("limit", type=inputs.int_range(1, 100), required=False, default=20, location="args")
            .add_argument(
                "mode",
                type=str,
                choices=[
                    "completion",
                    "chat",
                    "advanced-chat",
                    "workflow",
                    "agent-chat",
                    "channel",
                    "all",
                ],
                default="all",
                location="args",
                required=False,
            )
            .add_argument("name", type=str, location="args", required=False)
            .add_argument("tag_ids", type=uuid_list, location="args", required=False)
            .add_argument("is_created_by_me", type=inputs.boolean, location="args", required=False)
        )

        args = parser.parse_args()

        # get app list
        app_service = AppService()
        app_pagination = app_service.get_paginate_apps(current_user.id, current_tenant_id, args)
        if not app_pagination:
            return {"data": [], "total": 0, "page": 1, "limit": 20, "has_more": False}

        if FeatureService.get_system_features().webapp_auth.enabled:
            app_ids = [str(app.id) for app in app_pagination.items]
            res = EnterpriseService.WebAppAuth.batch_get_app_access_mode_by_id(app_ids=app_ids)
            if len(res) != len(app_ids):
                raise BadRequest("Invalid app id in webapp auth")

            for app in app_pagination.items:
                if str(app.id) in res:
                    app.access_mode = res[str(app.id)].access_mode

        return marshal(app_pagination, app_pagination_fields), 200

    @api.doc("create_app")
    @api.doc(description="Create a new application")
    @api.expect(
        api.model(
            "CreateAppRequest",
            {
                "name": fields.String(required=True, description="App name"),
                "description": fields.String(description="App description (max 400 chars)"),
                "mode": fields.String(required=True, enum=ALLOW_CREATE_APP_MODES, description="App mode"),
                "icon_type": fields.String(description="Icon type"),
                "icon": fields.String(description="Icon"),
                "icon_background": fields.String(description="Icon background color"),
            },
        )
    )
    @api.response(201, "App created successfully", app_detail_fields)
    @api.response(403, "Insufficient permissions")
    @api.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(app_detail_fields)
    @cloud_edition_billing_resource_check("apps")
    @edit_permission_required
    def post(self):
        """Create app"""
        current_user, current_tenant_id = current_account_with_tenant()
        parser = (
            reqparse.RequestParser()
            .add_argument("name", type=str, required=True, location="json")
            .add_argument("description", type=validate_description_length, location="json")
            .add_argument("mode", type=str, choices=ALLOW_CREATE_APP_MODES, location="json")
            .add_argument("icon_type", type=str, location="json")
            .add_argument("icon", type=str, location="json")
            .add_argument("icon_background", type=str, location="json")
        )
        args = parser.parse_args()

        if "mode" not in args or args["mode"] is None:
            raise BadRequest("mode is required")

        app_service = AppService()
        app = app_service.create_app(current_tenant_id, args, current_user)

        return app, 201


@console_ns.route("/apps/<uuid:app_id>")
class AppApi(Resource):
    @api.doc("get_app_detail")
    @api.doc(description="Get application details")
    @api.doc(params={"app_id": "Application ID"})
    @api.response(200, "Success", app_detail_fields_with_site)
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @get_app_model
    @marshal_with(app_detail_fields_with_site)
    def get(self, app_model):
        """Get app detail"""
        app_service = AppService()

        app_model = app_service.get_app(app_model)

        if FeatureService.get_system_features().webapp_auth.enabled:
            app_setting = EnterpriseService.WebAppAuth.get_app_access_mode_by_id(app_id=str(app_model.id))
            app_model.access_mode = app_setting.access_mode

        return app_model

    @api.doc("update_app")
    @api.doc(description="Update application details")
    @api.doc(params={"app_id": "Application ID"})
    @api.expect(
        api.model(
            "UpdateAppRequest",
            {
                "name": fields.String(required=True, description="App name"),
                "description": fields.String(description="App description (max 400 chars)"),
                "icon_type": fields.String(description="Icon type"),
                "icon": fields.String(description="Icon"),
                "icon_background": fields.String(description="Icon background color"),
                "use_icon_as_answer_icon": fields.Boolean(description="Use icon as answer icon"),
                "max_active_requests": fields.Integer(description="Maximum active requests"),
            },
        )
    )
    @api.response(200, "App updated successfully", app_detail_fields_with_site)
    @api.response(403, "Insufficient permissions")
    @api.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @edit_permission_required
    @marshal_with(app_detail_fields_with_site)
    def put(self, app_model):
        """Update app"""
        parser = (
            reqparse.RequestParser()
            .add_argument("name", type=str, required=True, nullable=False, location="json")
            .add_argument("description", type=validate_description_length, location="json")
            .add_argument("icon_type", type=str, location="json")
            .add_argument("icon", type=str, location="json")
            .add_argument("icon_background", type=str, location="json")
            .add_argument("use_icon_as_answer_icon", type=bool, location="json")
            .add_argument("max_active_requests", type=int, location="json")
        )
        args = parser.parse_args()

        app_service = AppService()
        # Construct ArgsDict from parsed arguments
        from services.app_service import AppService as AppServiceType

        args_dict: AppServiceType.ArgsDict = {
            "name": args["name"],
            "description": args.get("description", ""),
            "icon_type": args.get("icon_type", ""),
            "icon": args.get("icon", ""),
            "icon_background": args.get("icon_background", ""),
            "use_icon_as_answer_icon": args.get("use_icon_as_answer_icon", False),
            "max_active_requests": args.get("max_active_requests", 0),
        }
        app_model = app_service.update_app(app_model, args_dict)

        return app_model

    @api.doc("delete_app")
    @api.doc(description="Delete application")
    @api.doc(params={"app_id": "Application ID"})
    @api.response(204, "App deleted successfully")
    @api.response(403, "Insufficient permissions")
    @get_app_model
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def delete(self, app_model):
        """Delete app"""
        app_service = AppService()
        app_service.delete_app(app_model)

        return {"result": "success"}, 204


@console_ns.route("/apps/<uuid:app_id>/copy")
class AppCopyApi(Resource):
    @api.doc("copy_app")
    @api.doc(description="Create a copy of an existing application")
    @api.doc(params={"app_id": "Application ID to copy"})
    @api.expect(
        api.model(
            "CopyAppRequest",
            {
                "name": fields.String(description="Name for the copied app"),
                "description": fields.String(description="Description for the copied app"),
                "icon_type": fields.String(description="Icon type"),
                "icon": fields.String(description="Icon"),
                "icon_background": fields.String(description="Icon background color"),
            },
        )
    )
    @api.response(201, "App copied successfully", app_detail_fields_with_site)
    @api.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @edit_permission_required
    @marshal_with(app_detail_fields_with_site)
    def post(self, app_model):
        """Copy app"""
        # The role of the current user in the ta table must be admin, owner, or editor
        current_user, _ = current_account_with_tenant()

        parser = (
            reqparse.RequestParser()
            .add_argument("name", type=str, location="json")
            .add_argument("description", type=validate_description_length, location="json")
            .add_argument("icon_type", type=str, location="json")
            .add_argument("icon", type=str, location="json")
            .add_argument("icon_background", type=str, location="json")
        )
        args = parser.parse_args()

        with Session(db.engine) as session:
            import_service = AppDslService(session)
            yaml_content = import_service.export_dsl(app_model=app_model, include_secret=True)
            result = import_service.import_app(
                account=current_user,
                import_mode=ImportMode.YAML_CONTENT,
                yaml_content=yaml_content,
                name=args.get("name"),
                description=args.get("description"),
                icon_type=args.get("icon_type"),
                icon=args.get("icon"),
                icon_background=args.get("icon_background"),
            )
            session.commit()

            stmt = select(App).where(App.id == result.app_id)
            app = session.scalar(stmt)

        return app, 201


@console_ns.route("/apps/<uuid:app_id>/export")
class AppExportApi(Resource):
    @api.doc("export_app")
    @api.doc(description="Export application configuration as DSL")
    @api.doc(params={"app_id": "Application ID to export"})
    @api.expect(
        api.parser()
        .add_argument("include_secret", type=bool, location="args", default=False, help="Include secrets in export")
        .add_argument("workflow_id", type=str, location="args", help="Specific workflow ID to export")
    )
    @api.response(
        200,
        "App exported successfully",
        api.model("AppExportResponse", {"data": fields.String(description="DSL export data")}),
    )
    @api.response(403, "Insufficient permissions")
    @get_app_model
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def get(self, app_model):
        """Export app"""
        # Add include_secret params
        parser = (
            reqparse.RequestParser()
            .add_argument("include_secret", type=inputs.boolean, default=False, location="args")
            .add_argument("workflow_id", type=str, location="args")
        )
        args = parser.parse_args()

        return {
            "data": AppDslService.export_dsl(
                app_model=app_model, include_secret=args["include_secret"], workflow_id=args.get("workflow_id")
            )
        }


@console_ns.route("/apps/<uuid:app_id>/name")
class AppNameApi(Resource):
    @api.doc("check_app_name")
    @api.doc(description="Check if app name is available")
    @api.doc(params={"app_id": "Application ID"})
    @api.expect(api.parser().add_argument("name", type=str, required=True, location="args", help="Name to check"))
    @api.response(200, "Name availability checked")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_detail_fields)
    @edit_permission_required
    def post(self, app_model):
        parser = reqparse.RequestParser().add_argument("name", type=str, required=True, location="json")
        args = parser.parse_args()

        app_service = AppService()
        app_model = app_service.update_app_name(app_model, args["name"])

        return app_model


@console_ns.route("/apps/<uuid:app_id>/icon")
class AppIconApi(Resource):
    @api.doc("update_app_icon")
    @api.doc(description="Update application icon")
    @api.doc(params={"app_id": "Application ID"})
    @api.expect(
        api.model(
            "AppIconRequest",
            {
                "icon": fields.String(required=True, description="Icon data"),
                "icon_type": fields.String(description="Icon type"),
                "icon_background": fields.String(description="Icon background color"),
            },
        )
    )
    @api.response(200, "Icon updated successfully")
    @api.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_detail_fields)
    @edit_permission_required
    def post(self, app_model):
        parser = (
            reqparse.RequestParser()
            .add_argument("icon", type=str, location="json")
            .add_argument("icon_background", type=str, location="json")
        )
        args = parser.parse_args()

        app_service = AppService()
        app_model = app_service.update_app_icon(app_model, args.get("icon") or "", args.get("icon_background") or "")

        return app_model


@console_ns.route("/apps/<uuid:app_id>/site-enable")
class AppSiteStatus(Resource):
    @api.doc("update_app_site_status")
    @api.doc(description="Enable or disable app site")
    @api.doc(params={"app_id": "Application ID"})
    @api.expect(
        api.model(
            "AppSiteStatusRequest", {"enable_site": fields.Boolean(required=True, description="Enable or disable site")}
        )
    )
    @api.response(200, "Site status updated successfully", app_detail_fields)
    @api.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_detail_fields)
    @edit_permission_required
    def post(self, app_model):
        parser = reqparse.RequestParser().add_argument("enable_site", type=bool, required=True, location="json")
        args = parser.parse_args()

        app_service = AppService()
        app_model = app_service.update_app_site_status(app_model, args["enable_site"])

        return app_model


@console_ns.route("/apps/<uuid:app_id>/api-enable")
class AppApiStatus(Resource):
    @api.doc("update_app_api_status")
    @api.doc(description="Enable or disable app API")
    @api.doc(params={"app_id": "Application ID"})
    @api.expect(
        api.model(
            "AppApiStatusRequest", {"enable_api": fields.Boolean(required=True, description="Enable or disable API")}
        )
    )
    @api.response(200, "API status updated successfully", app_detail_fields)
    @api.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_detail_fields)
    def post(self, app_model):
        # The role of the current user in the ta table must be admin or owner
        current_user, _ = current_account_with_tenant()
        if not current_user.is_admin_or_owner:
            raise Forbidden()

        parser = reqparse.RequestParser().add_argument("enable_api", type=bool, required=True, location="json")
        args = parser.parse_args()

        app_service = AppService()
        app_model = app_service.update_app_api_status(app_model, args["enable_api"])

        return app_model


@console_ns.route("/apps/<uuid:app_id>/trace")
class AppTraceApi(Resource):
    @api.doc("get_app_trace")
    @api.doc(description="Get app tracing configuration")
    @api.doc(params={"app_id": "Application ID"})
    @api.response(200, "Trace configuration retrieved successfully")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, app_id):
        """Get app trace"""
        app_trace_config = OpsTraceManager.get_app_tracing_config(app_id=app_id)

        return app_trace_config

    @api.doc("update_app_trace")
    @api.doc(description="Update app tracing configuration")
    @api.doc(params={"app_id": "Application ID"})
    @api.expect(
        api.model(
            "AppTraceRequest",
            {
                "enabled": fields.Boolean(required=True, description="Enable or disable tracing"),
                "tracing_provider": fields.String(required=True, description="Tracing provider"),
            },
        )
    )
    @api.response(200, "Trace configuration updated successfully")
    @api.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def post(self, app_id):
        # add app trace
        parser = (
            reqparse.RequestParser()
            .add_argument("enabled", type=bool, required=True, location="json")
            .add_argument("tracing_provider", type=str, required=True, location="json")
        )
        args = parser.parse_args()

        OpsTraceManager.update_app_tracing_config(
            app_id=app_id,
            enabled=args["enabled"],
            tracing_provider=args["tracing_provider"],
        )

        return {"result": "success"}
