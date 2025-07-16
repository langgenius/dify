import json
from enum import StrEnum

from flask_login import current_user
from flask_restful import Resource, marshal_with, reqparse
from werkzeug.exceptions import NotFound

from controllers.console import api
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from extensions.ext_database import db
from fields.app_fields import app_server_fields
from libs.login import login_required
from models.model import AppMCPServer


class AppMCPServerStatus(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"


class AppMCPServerController(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_server_fields)
    def get(self, app_model):
        server = db.session.query(AppMCPServer).filter(AppMCPServer.app_id == app_model.id).first()
        return server

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_server_fields)
    def post(self, app_model):
        if not current_user.is_editor:
            raise NotFound()
        parser = reqparse.RequestParser()
        parser.add_argument("description", type=str, required=False, location="json")
        parser.add_argument("parameters", type=dict, required=True, location="json")
        args = parser.parse_args()

        description = args.get("description")
        if not description:
            description = app_model.description or ""

        server = AppMCPServer(
            name=app_model.name,
            description=description,
            parameters=json.dumps(args["parameters"], ensure_ascii=False),
            status=AppMCPServerStatus.ACTIVE,
            app_id=app_model.id,
            tenant_id=current_user.current_tenant_id,
            server_code=AppMCPServer.generate_server_code(16),
        )
        db.session.add(server)
        db.session.commit()
        return server

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_server_fields)
    def put(self, app_model):
        if not current_user.is_editor:
            raise NotFound()
        parser = reqparse.RequestParser()
        parser.add_argument("id", type=str, required=True, location="json")
        parser.add_argument("description", type=str, required=False, location="json")
        parser.add_argument("parameters", type=dict, required=True, location="json")
        parser.add_argument("status", type=str, required=False, location="json")
        args = parser.parse_args()
        server = db.session.query(AppMCPServer).filter(AppMCPServer.id == args["id"]).first()
        if not server:
            raise NotFound()

        description = args.get("description")
        if description is None:
            pass
        elif not description:
            server.description = app_model.description or ""
        else:
            server.description = description

        server.parameters = json.dumps(args["parameters"], ensure_ascii=False)
        if args["status"]:
            if args["status"] not in [status.value for status in AppMCPServerStatus]:
                raise ValueError("Invalid status")
            server.status = args["status"]
        db.session.commit()
        return server


class AppMCPServerRefreshController(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(app_server_fields)
    def get(self, server_id):
        if not current_user.is_editor:
            raise NotFound()
        server = (
            db.session.query(AppMCPServer)
            .filter(AppMCPServer.id == server_id)
            .filter(AppMCPServer.tenant_id == current_user.current_tenant_id)
            .first()
        )
        if not server:
            raise NotFound()
        server.server_code = AppMCPServer.generate_server_code(16)
        db.session.commit()
        return server


api.add_resource(AppMCPServerController, "/apps/<uuid:app_id>/server")
api.add_resource(AppMCPServerRefreshController, "/apps/<uuid:server_id>/server/refresh")
