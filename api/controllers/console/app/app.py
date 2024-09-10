import uuid

from flask_login import current_user
from flask_restful import Resource, inputs, marshal, marshal_with, reqparse
from werkzeug.exceptions import BadRequest, Forbidden, abort

from controllers.console import api
from controllers.console.app.wraps import get_app_model
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required, cloud_edition_billing_resource_check
from core.ops.ops_trace_manager import OpsTraceManager
from fields.app_fields import (
    app_detail_fields,
    app_detail_fields_with_site,
    app_pagination_fields,
)
from libs.login import login_required
from services.app_dsl_service import AppDslService
from services.app_service import AppService

ALLOW_CREATE_APP_MODES = ["chat", "agent-chat", "advanced-chat", "workflow", "completion"]


class AppListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        """Get app list"""

        def uuid_list(value):
            try:
                return [str(uuid.UUID(v)) for v in value.split(",")]
            except ValueError:
                abort(400, message="Invalid UUID format in tag_ids.")

        parser = reqparse.RequestParser()
        parser.add_argument("page", type=inputs.int_range(1, 99999), required=False, default=1, location="args")
        parser.add_argument("limit", type=inputs.int_range(1, 100), required=False, default=20, location="args")
        parser.add_argument(
            "mode",
            type=str,
            choices=["chat", "workflow", "agent-chat", "channel", "all"],
            default="all",
            location="args",
            required=False,
        )
        parser.add_argument("name", type=str, location="args", required=False)
        parser.add_argument("tag_ids", type=uuid_list, location="args", required=False)

        args = parser.parse_args()

        # get app list
        app_service = AppService()
        app_pagination = app_service.get_paginate_apps(current_user.current_tenant_id, args)
        if not app_pagination:
            return {"data": [], "total": 0, "page": 1, "limit": 20, "has_more": False}

        return marshal(app_pagination, app_pagination_fields)

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(app_detail_fields)
    @cloud_edition_billing_resource_check("apps")
    def post(self):
        """Create app"""
        parser = reqparse.RequestParser()
        parser.add_argument("name", type=str, required=True, location="json")
        parser.add_argument("description", type=str, location="json")
        parser.add_argument("mode", type=str, choices=ALLOW_CREATE_APP_MODES, location="json")
        parser.add_argument("icon_type", type=str, location="json")
        parser.add_argument("icon", type=str, location="json")
        parser.add_argument("icon_background", type=str, location="json")
        args = parser.parse_args()

        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        if "mode" not in args or args["mode"] is None:
            raise BadRequest("mode is required")

        app_service = AppService()
        app = app_service.create_app(current_user.current_tenant_id, args, current_user)

        return app, 201


class AppImportApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(app_detail_fields_with_site)
    @cloud_edition_billing_resource_check("apps")
    def post(self):
        """Import app"""
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("data", type=str, required=True, nullable=False, location="json")
        parser.add_argument("name", type=str, location="json")
        parser.add_argument("description", type=str, location="json")
        parser.add_argument("icon_type", type=str, location="json")
        parser.add_argument("icon", type=str, location="json")
        parser.add_argument("icon_background", type=str, location="json")
        args = parser.parse_args()

        app = AppDslService.import_and_create_new_app(
            tenant_id=current_user.current_tenant_id, data=args["data"], args=args, account=current_user
        )

        return app, 201


class AppImportFromUrlApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(app_detail_fields_with_site)
    @cloud_edition_billing_resource_check("apps")
    def post(self):
        """Import app from url"""
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("url", type=str, required=True, nullable=False, location="json")
        parser.add_argument("name", type=str, location="json")
        parser.add_argument("description", type=str, location="json")
        parser.add_argument("icon", type=str, location="json")
        parser.add_argument("icon_background", type=str, location="json")
        args = parser.parse_args()

        app = AppDslService.import_and_create_new_app_from_url(
            tenant_id=current_user.current_tenant_id, url=args["url"], args=args, account=current_user
        )

        return app, 201


class AppApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_detail_fields_with_site)
    def get(self, app_model):
        """Get app detail"""
        app_service = AppService()

        app_model = app_service.get_app(app_model)

        return app_model

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_detail_fields_with_site)
    def put(self, app_model):
        """Update app"""
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("name", type=str, required=True, nullable=False, location="json")
        parser.add_argument("description", type=str, location="json")
        parser.add_argument("icon_type", type=str, location="json")
        parser.add_argument("icon", type=str, location="json")
        parser.add_argument("icon_background", type=str, location="json")
        parser.add_argument("max_active_requests", type=int, location="json")
        parser.add_argument("use_icon_as_answer_icon", type=bool, location="json")
        args = parser.parse_args()

        app_service = AppService()
        app_model = app_service.update_app(app_model, args)

        return app_model

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    def delete(self, app_model):
        """Delete app"""
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        app_service = AppService()
        app_service.delete_app(app_model)

        return {"result": "success"}, 204


class AppCopyApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_detail_fields_with_site)
    def post(self, app_model):
        """Copy app"""
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("name", type=str, location="json")
        parser.add_argument("description", type=str, location="json")
        parser.add_argument("icon_type", type=str, location="json")
        parser.add_argument("icon", type=str, location="json")
        parser.add_argument("icon_background", type=str, location="json")
        args = parser.parse_args()

        data = AppDslService.export_dsl(app_model=app_model, include_secret=True)
        app = AppDslService.import_and_create_new_app(
            tenant_id=current_user.current_tenant_id, data=data, args=args, account=current_user
        )

        return app, 201


class AppExportApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    def get(self, app_model):
        """Export app"""
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        # Add include_secret params
        parser = reqparse.RequestParser()
        parser.add_argument("include_secret", type=inputs.boolean, default=False, location="args")
        args = parser.parse_args()

        return {"data": AppDslService.export_dsl(app_model=app_model, include_secret=args["include_secret"])}


class AppNameApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_detail_fields)
    def post(self, app_model):
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("name", type=str, required=True, location="json")
        args = parser.parse_args()

        app_service = AppService()
        app_model = app_service.update_app_name(app_model, args.get("name"))

        return app_model


class AppIconApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_detail_fields)
    def post(self, app_model):
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("icon", type=str, location="json")
        parser.add_argument("icon_background", type=str, location="json")
        args = parser.parse_args()

        app_service = AppService()
        app_model = app_service.update_app_icon(app_model, args.get("icon"), args.get("icon_background"))

        return app_model


class AppSiteStatus(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_detail_fields)
    def post(self, app_model):
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("enable_site", type=bool, required=True, location="json")
        args = parser.parse_args()

        app_service = AppService()
        app_model = app_service.update_app_site_status(app_model, args.get("enable_site"))

        return app_model


class AppApiStatus(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_detail_fields)
    def post(self, app_model):
        # The role of the current user in the ta table must be admin or owner
        if not current_user.is_admin_or_owner:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("enable_api", type=bool, required=True, location="json")
        args = parser.parse_args()

        app_service = AppService()
        app_model = app_service.update_app_api_status(app_model, args.get("enable_api"))

        return app_model


class AppTraceApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, app_id):
        """Get app trace"""
        app_trace_config = OpsTraceManager.get_app_tracing_config(app_id=app_id)

        return app_trace_config

    @setup_required
    @login_required
    @account_initialization_required
    def post(self, app_id):
        # add app trace
        if not current_user.is_admin_or_owner:
            raise Forbidden()
        parser = reqparse.RequestParser()
        parser.add_argument("enabled", type=bool, required=True, location="json")
        parser.add_argument("tracing_provider", type=str, required=True, location="json")
        args = parser.parse_args()

        OpsTraceManager.update_app_tracing_config(
            app_id=app_id,
            enabled=args["enabled"],
            tracing_provider=args["tracing_provider"],
        )

        return {"result": "success"}


api.add_resource(AppListApi, "/apps")
api.add_resource(AppImportApi, "/apps/import")
api.add_resource(AppImportFromUrlApi, "/apps/import/url")
api.add_resource(AppApi, "/apps/<uuid:app_id>")
api.add_resource(AppCopyApi, "/apps/<uuid:app_id>/copy")
api.add_resource(AppExportApi, "/apps/<uuid:app_id>/export")
api.add_resource(AppNameApi, "/apps/<uuid:app_id>/name")
api.add_resource(AppIconApi, "/apps/<uuid:app_id>/icon")
api.add_resource(AppSiteStatus, "/apps/<uuid:app_id>/site-enable")
api.add_resource(AppApiStatus, "/apps/<uuid:app_id>/api-enable")
api.add_resource(AppTraceApi, "/apps/<uuid:app_id>/trace")
