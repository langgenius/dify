from flask_restful import Resource

from controllers.console import api
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from libs.login import login_required


class EndpointCreateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        pass


class EndpointListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        pass


class EndpointDeleteApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        pass


class EndpointUpdateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        pass


class EndpointEnableApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        pass


class EndpointDisableApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        pass


api.add_resource(EndpointCreateApi, "/workspaces/current/endpoints/create")
api.add_resource(EndpointListApi, "/workspaces/current/endpoints/list")
api.add_resource(EndpointDeleteApi, "/workspaces/current/endpoints/delete")
api.add_resource(EndpointUpdateApi, "/workspaces/current/endpoints/update")
api.add_resource(EndpointEnableApi, "/workspaces/current/endpoints/enable")
api.add_resource(EndpointDisableApi, "/workspaces/current/endpoints/disable")