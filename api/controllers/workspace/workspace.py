from flask import request
from flask_restful import Resource, fields, marshal_with, reqparse
from werkzeug.exceptions import NotFound

from controllers.workspace import api
from extensions.ext_database import db
from libs.login import login_required_for_workspace_api
from models.account import Tenant, TenantAccountJoin
from models.model import App

workspace_info_fields = {
    "id": fields.String,
    "name": fields.String,
    "created_at": fields.DateTime(dt_format="iso8601"),
    "updated_at": fields.DateTime(dt_format="iso8601"),
    "status": fields.String,
    "member_count": fields.Integer,
    "app_count": fields.Integer,
}


class WorkspaceInfoApi(Resource):
    @login_required_for_workspace_api(["workspace:read"])
    @marshal_with(workspace_info_fields)
    def get(self):
        """Get workspace information"""
        tenant_id = request.auth_data.get("tenant_id")

        # Get tenant information
        tenant = db.session.query(Tenant).filter(Tenant.id == tenant_id).first()
        if not tenant:
            raise NotFound("Workspace not found")

        # Get member count (count joins for this tenant)
        member_count = db.session.query(TenantAccountJoin).filter(TenantAccountJoin.tenant_id == tenant_id).count()

        # Get app count
        app_count = db.session.query(App).filter(App.tenant_id == tenant_id).count()

        return {
            "id": tenant.id,
            "name": tenant.name,
            "created_at": tenant.created_at,
            "updated_at": tenant.updated_at,
            "status": tenant.status,
            "member_count": member_count,
            "app_count": app_count,
        }

    @login_required_for_workspace_api(["workspace:write"])
    @marshal_with(workspace_info_fields)
    def put(self):
        """Update workspace information"""
        tenant_id = request.auth_data.get("tenant_id")

        parser = reqparse.RequestParser()
        parser.add_argument("name", type=str, location="json")

        args = parser.parse_args()

        # Get tenant
        tenant = db.session.query(Tenant).filter(Tenant.id == tenant_id).first()
        if not tenant:
            raise NotFound("Workspace not found")

        # Update fields if provided
        if args.get("name"):
            tenant.name = args["name"]

        db.session.commit()

        # Get updated stats
        member_count = db.session.query(TenantAccountJoin).filter(TenantAccountJoin.tenant_id == tenant_id).count()
        app_count = db.session.query(App).filter(App.tenant_id == tenant_id).count()

        return {
            "id": tenant.id,
            "name": tenant.name,
            "created_at": tenant.created_at,
            "updated_at": tenant.updated_at,
            "status": tenant.status,
            "member_count": member_count,
            "app_count": app_count,
        }


api.add_resource(WorkspaceInfoApi, "/info")
