from flask_restful import Resource, reqparse

from controllers.console.setup import setup_required
from controllers.inner_api import api
from controllers.inner_api.plugin.wraps import get_tenant, plugin_data
from controllers.inner_api.wraps import plugin_inner_api_only
from core.plugin.entities.request import RequestInvokeLLM, RequestInvokeModeration, RequestInvokeRerank, RequestInvokeSpeech2Text, RequestInvokeTTS, RequestInvokeTextEmbedding, RequestInvokeTool
from libs.helper import compact_generate_response
from models.account import Tenant
from services.plugin.plugin_invoke_service import PluginInvokeService


class PluginInvokeLLMApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @get_tenant
    @plugin_data(payload_type=RequestInvokeLLM)
    def post(self, user_id: str, tenant_model: Tenant, payload: RequestInvokeLLM):
        pass

class PluginInvokeTextEmbeddingApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @get_tenant
    @plugin_data(payload_type=RequestInvokeTextEmbedding)
    def post(self, user_id: str, tenant_model: Tenant, payload: RequestInvokeTextEmbedding):
        pass

class PluginInvokeRerankApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @get_tenant
    @plugin_data(payload_type=RequestInvokeRerank)
    def post(self, user_id: str, tenant_model: Tenant, payload: RequestInvokeRerank):
        pass

class PluginInvokeTTSApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @get_tenant
    @plugin_data(payload_type=RequestInvokeTTS)
    def post(self, user_id: str, tenant_model: Tenant, payload: RequestInvokeTTS):
        pass

class PluginInvokeSpeech2TextApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @get_tenant
    @plugin_data(payload_type=RequestInvokeSpeech2Text)
    def post(self, user_id: str, tenant_model: Tenant, payload: RequestInvokeSpeech2Text):
        pass

class PluginInvokeModerationApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @get_tenant
    @plugin_data(payload_type=RequestInvokeModeration)
    def post(self, user_id: str, tenant_model: Tenant, payload: RequestInvokeModeration):
        pass

class PluginInvokeToolApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @get_tenant
    @plugin_data(payload_type=RequestInvokeTool)
    def post(self, user_id: str, tenant_model: Tenant):
        parser = reqparse.RequestParser()
        parser.add_argument('provider', type=dict, required=True, location='json')
        parser.add_argument('tool', type=dict, required=True, location='json')
        parser.add_argument('parameters', type=dict, required=True, location='json')

        args = parser.parse_args()

        response = PluginInvokeService.invoke_tool(
            user_id, tenant_model, args['provider'], args['tool'], args['parameters']
        )
        return compact_generate_response(response)


class PluginInvokeNodeApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @get_tenant
    def post(self, user_id: str, tenant_model: Tenant):
        parser = reqparse.RequestParser()
        args = parser.parse_args()

        return {'message': 'success'}


api.add_resource(PluginInvokeLLMApi, '/invoke/llm')
api.add_resource(PluginInvokeTextEmbeddingApi, '/invoke/text-embedding')
api.add_resource(PluginInvokeRerankApi, '/invoke/rerank')
api.add_resource(PluginInvokeTTSApi, '/invoke/tts')
api.add_resource(PluginInvokeSpeech2TextApi, '/invoke/speech2text')
api.add_resource(PluginInvokeModerationApi, '/invoke/moderation')
api.add_resource(PluginInvokeToolApi, '/invoke/tool')
api.add_resource(PluginInvokeNodeApi, '/invoke/node')
