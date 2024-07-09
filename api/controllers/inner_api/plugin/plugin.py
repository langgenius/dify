
from flask_restful import Resource, reqparse

from controllers.console.setup import setup_required
from controllers.inner_api import api
from controllers.inner_api.plugin.wraps import get_tenant
from controllers.inner_api.wraps import plugin_inner_api_only
from libs.helper import compact_generate_response
from models.account import Tenant
from services.plugin.plugin_invoke_service import PluginInvokeService


class PluginInvokeModelApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @get_tenant
    def post(self, user_id: str, tenant_model: Tenant):
        parser = reqparse.RequestParser()
        parser.add_argument('provider', type=dict, required=True, location='json')
        parser.add_argument('model', type=dict, required=True, location='json')
        parser.add_argument('parameters', type=dict, required=True, location='json')

        args = parser.parse_args()

        
        

class PluginInvokeToolApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @get_tenant
    def post(self, user_id: str, tenant_model: Tenant):
        parser = reqparse.RequestParser()
        parser.add_argument('provider', type=dict, required=True, location='json')
        parser.add_argument('tool', type=dict, required=True, location='json')
        parser.add_argument('parameters', type=dict, required=True, location='json')

        args = parser.parse_args()

        response = PluginInvokeService.invoke_tool(user_id, tenant_model, 
                                                   args['provider'], args['tool'], 
                                                   args['parameters'])
        return compact_generate_response(response)


class PluginInvokeNodeApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @get_tenant
    def post(self, user_id: str, tenant_model: Tenant):
        parser = reqparse.RequestParser()
        args = parser.parse_args()

        return {
            'message': 'success'
        }


api.add_resource(PluginInvokeModelApi, '/invoke/model')
api.add_resource(PluginInvokeToolApi, '/invoke/tool')
api.add_resource(PluginInvokeNodeApi, '/invoke/node')
