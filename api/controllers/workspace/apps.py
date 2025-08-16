from flask import request
from flask_restful import Resource, fields, marshal_with, reqparse
from werkzeug.exceptions import NotFound

from controllers.workspace import api
from extensions.ext_database import db
from libs.login import login_required_for_workspace_api
from models.model import App

app_fields = {
    "id": fields.String,
    "name": fields.String,
    "description": fields.String,
    "mode": fields.String,
    "status": fields.String,
    "enable_site": fields.Boolean,
    "enable_api": fields.Boolean,
    "created_at": fields.DateTime(dt_format="iso8601"),
    "updated_at": fields.DateTime(dt_format="iso8601"),
    "created_by": fields.String,
    "icon": fields.String,
    "icon_background": fields.String,
    "is_public": fields.Boolean,
}

app_list_fields = {
    "data": fields.List(fields.Nested(app_fields)),
    "total": fields.Integer,
    "page": fields.Integer,
    "limit": fields.Integer,
}


class WorkspaceAppsApi(Resource):
    @login_required_for_workspace_api(["apps:read"])
    @marshal_with(app_list_fields)
    def get(self):
        """Get list of applications in workspace"""
        tenant_id = request.auth_data.get("tenant_id")

        # Parse query parameters
        parser = reqparse.RequestParser()
        parser.add_argument("page", type=int, default=1, location="args")
        parser.add_argument("limit", type=int, default=20, location="args")
        parser.add_argument("search", type=str, default="", location="args")
        parser.add_argument("status", type=str, location="args")

        args = parser.parse_args()

        # Build query
        query = db.session.query(App).filter(App.tenant_id == tenant_id)

        # Apply search filter
        if args["search"]:
            query = query.filter(App.name.ilike(f"%{args['search']}%"))

        # Apply status filter
        if args["status"]:
            query = query.filter(App.status == args["status"])

        # Get total count
        total = query.count()

        # Apply pagination
        offset = (args["page"] - 1) * args["limit"]
        apps = query.offset(offset).limit(args["limit"]).all()

        return {
            "data": [self._serialize_app(app) for app in apps],
            "total": total,
            "page": args["page"],
            "limit": args["limit"],
        }

    @login_required_for_workspace_api(["apps:write"])
    @marshal_with(app_fields)
    def post(self):
        """Create new application"""
        tenant_id = request.auth_data.get("tenant_id")
        account_id = request.auth_data.get("account_id")

        parser = reqparse.RequestParser()
        parser.add_argument("name", type=str, required=True, location="json")
        parser.add_argument("description", type=str, default="", location="json")
        parser.add_argument(
            "mode",
            type=str,
            required=True,
            location="json",
            choices=["completion", "chat", "workflow", "advanced-chat", "agent-chat"],
        )
        parser.add_argument("icon", type=str, location="json")
        parser.add_argument("icon_background", type=str, location="json")

        args = parser.parse_args()

        # Create application
        app = App(
            tenant_id=tenant_id,
            name=args["name"],
            description=args["description"],
            mode=args["mode"],
            icon=args.get("icon"),
            icon_background=args.get("icon_background"),
            enable_site=False,
            enable_api=True,
            created_by=account_id,
            updated_by=account_id,
        )

        db.session.add(app)
        db.session.commit()

        return self._serialize_app(app)

    def _serialize_app(self, app: App) -> dict:
        """Serialize app object"""
        return {
            "id": app.id,
            "name": app.name,
            "description": app.description,
            "mode": app.mode,
            "status": app.status,
            "enable_site": app.enable_site,
            "enable_api": app.enable_api,
            "created_at": app.created_at,
            "updated_at": app.updated_at,
            "created_by": app.created_by,
            "icon": app.icon,
            "icon_background": app.icon_background,
            "is_public": app.is_public,
        }


class WorkspaceAppApi(Resource):
    @login_required_for_workspace_api(["apps:read"])
    @marshal_with(app_fields)
    def get(self, app_id):
        """Get specific application"""
        tenant_id = request.auth_data.get("tenant_id")

        app = db.session.query(App).filter(App.id == app_id, App.tenant_id == tenant_id).first()

        if not app:
            raise NotFound("Application not found")

        return self._serialize_app(app)

    @login_required_for_workspace_api(["apps:write"])
    @marshal_with(app_fields)
    def put(self, app_id):
        """Update application"""
        tenant_id = request.auth_data.get("tenant_id")
        account_id = request.auth_data.get("account_id")

        parser = reqparse.RequestParser()
        parser.add_argument("name", type=str, location="json")
        parser.add_argument("description", type=str, location="json")
        parser.add_argument("icon", type=str, location="json")
        parser.add_argument("icon_background", type=str, location="json")
        parser.add_argument("enable_site", type=bool, location="json")
        parser.add_argument("enable_api", type=bool, location="json")

        args = parser.parse_args()

        app = db.session.query(App).filter(App.id == app_id, App.tenant_id == tenant_id).first()

        if not app:
            raise NotFound("Application not found")

        # Update fields
        if args.get("name"):
            app.name = args["name"]
        if args.get("description") is not None:
            app.description = args["description"]
        if args.get("icon") is not None:
            app.icon = args["icon"]
        if args.get("icon_background") is not None:
            app.icon_background = args["icon_background"]
        if args.get("enable_site") is not None:
            app.enable_site = args["enable_site"]
        if args.get("enable_api") is not None:
            app.enable_api = args["enable_api"]

        app.updated_by = account_id

        db.session.commit()

        return self._serialize_app(app)

    @login_required_for_workspace_api(["apps:admin"])
    def delete(self, app_id):
        """Delete application"""
        tenant_id = request.auth_data.get("tenant_id")

        app = db.session.query(App).filter(App.id == app_id, App.tenant_id == tenant_id).first()

        if not app:
            raise NotFound("Application not found")

        db.session.delete(app)
        db.session.commit()

        return {"message": "Application deleted successfully"}

    def _serialize_app(self, app: App) -> dict:
        """Serialize app object"""
        return {
            "id": app.id,
            "name": app.name,
            "description": app.description,
            "mode": app.mode,
            "status": app.status,
            "enable_site": app.enable_site,
            "enable_api": app.enable_api,
            "created_at": app.created_at,
            "updated_at": app.updated_at,
            "created_by": app.created_by,
            "icon": app.icon,
            "icon_background": app.icon_background,
            "is_public": app.is_public,
        }


api.add_resource(WorkspaceAppsApi, "/apps")
api.add_resource(WorkspaceAppApi, "/apps/<string:app_id>")
