import json

from flask_login import current_user
from libs.login import login_required
from flask_restful import Resource, abort, reqparse
from werkzeug.exceptions import Forbidden

from controllers.console import api
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required

from services.tools_manage_service import ToolManageService

class ToolProviderListApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user_id = current_user.id
        tenant_id = current_user.current_tenant_id

        return ToolManageService.list_tool_providers(user_id, tenant_id)

class ToolProviderApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user_id = current_user.id
        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument('credentials', type=dict, required=True, nullable=False, location='json')
        parser.add_argument('provider_type', type=str, required=True, nullable=False, location='json')
        parser.add_argument('provider', type=str, required=True, nullable=False, location='json')

        args = parser.parse_args()

        return ToolManageService.create_tool_provider(
            user_id,
            tenant_id,
            args['provider_type'],
            args['provider'],
            args['credentials'],
        )
    
class ToolBuiltinProviderCredentialsSchemaApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider):
        return ToolManageService.list_builtin_provider_credentails_schema(provider)

# new apis
api.add_resource(ToolProviderListApi, '/workspaces/current/tool-providers')
api.add_resource(ToolProviderApi, '/workspaces/current/tool-provider')
api.add_resource(ToolBuiltinProviderCredentialsSchemaApi, '/workspaces/current/tool-provider/builtin/<provider>/credentials_schema')