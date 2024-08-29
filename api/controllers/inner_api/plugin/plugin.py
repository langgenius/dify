import time

from flask_restful import Resource, reqparse

from controllers.console.setup import setup_required
from controllers.inner_api import api
from controllers.inner_api.plugin.wraps import get_tenant, plugin_data
from controllers.inner_api.wraps import plugin_inner_api_only
from core.plugin.backwards_invocation.app import PluginAppBackwardsInvocation
from core.plugin.backwards_invocation.model import PluginModelBackwardsInvocation
from core.plugin.entities.request import (
    RequestInvokeApp,
    RequestInvokeLLM,
    RequestInvokeModeration,
    RequestInvokeNode,
    RequestInvokeRerank,
    RequestInvokeSpeech2Text,
    RequestInvokeTextEmbedding,
    RequestInvokeTool,
    RequestInvokeTTS,
)
from core.tools.entities.tool_entities import ToolInvokeMessage
from libs.helper import compact_generate_response
from models.account import Tenant


class PluginInvokeLLMApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @get_tenant
    @plugin_data(payload_type=RequestInvokeLLM)
    def post(self, user_id: str, tenant_model: Tenant, payload: RequestInvokeLLM):
        def generator():
            response = PluginModelBackwardsInvocation.invoke_llm(user_id, tenant_model, payload)
            return PluginModelBackwardsInvocation.convert_to_event_stream(response)

        return compact_generate_response(generator())

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
    def post(self, user_id: str, tenant_model: Tenant, payload: RequestInvokeTool):
        def generator():
            for i in range(10):
                time.sleep(0.1)
                yield (
                    ToolInvokeMessage(
                        type=ToolInvokeMessage.MessageType.TEXT,
                        message=ToolInvokeMessage.TextMessage(text='helloworld'),
                    )
                    .model_dump_json()
                    .encode()
                    + b'\n\n'
                )

        return compact_generate_response(generator())


class PluginInvokeNodeApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @get_tenant
    @plugin_data(payload_type=RequestInvokeNode)
    def post(self, user_id: str, tenant_model: Tenant, payload: RequestInvokeNode):
        pass

class PluginInvokeAppApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @get_tenant
    @plugin_data(payload_type=RequestInvokeApp)
    def post(self, user_id: str, tenant_model: Tenant, payload: RequestInvokeApp):
        parser = reqparse.RequestParser()
        args = parser.parse_args()

        response = PluginAppBackwardsInvocation.invoke_app(
            app_id=payload.app_id,
            user_id=user_id,
            tenant_id=tenant_model.id,
            conversation_id=payload.conversation_id,
            query=payload.query,
            stream=payload.stream,
            inputs=payload.inputs,
            files=payload.files
        )
        
        return compact_generate_response(
            PluginAppBackwardsInvocation.convert_to_event_stream(response)
        )

api.add_resource(PluginInvokeLLMApi, '/invoke/llm')
api.add_resource(PluginInvokeTextEmbeddingApi, '/invoke/text-embedding')
api.add_resource(PluginInvokeRerankApi, '/invoke/rerank')
api.add_resource(PluginInvokeTTSApi, '/invoke/tts')
api.add_resource(PluginInvokeSpeech2TextApi, '/invoke/speech2text')
api.add_resource(PluginInvokeModerationApi, '/invoke/moderation')
api.add_resource(PluginInvokeToolApi, '/invoke/tool')
api.add_resource(PluginInvokeNodeApi, '/invoke/node')
api.add_resource(PluginInvokeAppApi, '/invoke/app')
