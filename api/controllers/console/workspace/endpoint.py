from flask_login import current_user
from flask_restful import Resource, reqparse
from werkzeug.exceptions import Forbidden

from controllers.console import api
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from libs.login import login_required
from services.plugin.endpoint_service import EndpointService


class EndpointCreateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user = current_user
        if not user.is_admin_or_owner:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("plugin_unique_identifier", type=str, required=True)
        parser.add_argument("settings", type=dict, required=True)
        parser.add_argument("name", type=str, required=True)
        args = parser.parse_args()

        plugin_unique_identifier = args["plugin_unique_identifier"]
        settings = args["settings"]
        name = args["name"]

        return EndpointService.create_endpoint(
            tenant_id=user.current_tenant_id,
            user_id=user.id,
            plugin_unique_identifier=plugin_unique_identifier,
            name=name,
            settings=settings,
        )


class EndpointListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user = current_user

        return EndpointService.list_endpoints(
            tenant_id=user.current_tenant_id,
            user_id=user.id,
        )


class EndpointDeleteApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user = current_user

        parser = reqparse.RequestParser()
        parser.add_argument("endpoint_id", type=str, required=True)
        args = parser.parse_args()

        endpoint_id = args["endpoint_id"]

        return EndpointService.delete_endpoint(
            tenant_id=user.current_tenant_id, user_id=user.id, endpoint_id=endpoint_id
        )


class EndpointUpdateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user = current_user

        parser = reqparse.RequestParser()
        parser.add_argument("endpoint_id", type=str, required=True)
        parser.add_argument("settings", type=dict, required=True)
        parser.add_argument("name", type=str, required=True)
        args = parser.parse_args()

        endpoint_id = args["endpoint_id"]
        settings = args["settings"]
        name = args["name"]

        return EndpointService.update_endpoint(
            tenant_id=user.current_tenant_id,
            user_id=user.id,
            endpoint_id=endpoint_id,
            name=name,
            settings=settings,
        )


class EndpointEnableApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user = current_user

        parser = reqparse.RequestParser()
        parser.add_argument("endpoint_id", type=str, required=True)
        args = parser.parse_args()

        endpoint_id = args["endpoint_id"]

        return EndpointService.enable_endpoint(
            tenant_id=user.current_tenant_id, user_id=user.id, endpoint_id=endpoint_id
        )


class EndpointDisableApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user = current_user

        parser = reqparse.RequestParser()
        parser.add_argument("endpoint_id", type=str, required=True)
        args = parser.parse_args()

        endpoint_id = args["endpoint_id"]

        return EndpointService.disable_endpoint(
            tenant_id=user.current_tenant_id, user_id=user.id, endpoint_id=endpoint_id
        )


api.add_resource(EndpointCreateApi, "/workspaces/current/endpoints/create")
api.add_resource(EndpointListApi, "/workspaces/current/endpoints/list")
api.add_resource(EndpointDeleteApi, "/workspaces/current/endpoints/delete")
api.add_resource(EndpointUpdateApi, "/workspaces/current/endpoints/update")
api.add_resource(EndpointEnableApi, "/workspaces/current/endpoints/enable")
api.add_resource(EndpointDisableApi, "/workspaces/current/endpoints/disable")
