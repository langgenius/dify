from flask_restful import Resource

from controllers.console.wraps import setup_required
from controllers.inner_api import api
from controllers.inner_api.plugin.wraps import get_user_tenant, plugin_data
from controllers.inner_api.wraps import plugin_inner_api_only
from core.file.helpers import get_signed_file_url_for_plugin
from core.model_runtime.utils.encoders import jsonable_encoder
from core.plugin.backwards_invocation.app import PluginAppBackwardsInvocation
from core.plugin.backwards_invocation.base import BaseBackwardsInvocationResponse
from core.plugin.backwards_invocation.encrypt import PluginEncrypter
from core.plugin.backwards_invocation.model import PluginModelBackwardsInvocation
from core.plugin.backwards_invocation.node import PluginNodeBackwardsInvocation
from core.plugin.backwards_invocation.tool import PluginToolBackwardsInvocation
from core.plugin.entities.request import (
    RequestFetchAppInfo,
    RequestInvokeApp,
    RequestInvokeEncrypt,
    RequestInvokeLLM,
    RequestInvokeModeration,
    RequestInvokeParameterExtractorNode,
    RequestInvokeQuestionClassifierNode,
    RequestInvokeRerank,
    RequestInvokeSpeech2Text,
    RequestInvokeSummary,
    RequestInvokeTextEmbedding,
    RequestInvokeTool,
    RequestInvokeTTS,
    RequestRequestUploadFile,
)
from core.tools.entities.tool_entities import ToolProviderType
from libs.helper import compact_generate_response
from models.account import Account, Tenant
from models.model import EndUser


class PluginInvokeLLMApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @get_user_tenant
    @plugin_data(payload_type=RequestInvokeLLM)
    def post(self, user_model: Account | EndUser, tenant_model: Tenant, payload: RequestInvokeLLM):
        def generator():
            response = PluginModelBackwardsInvocation.invoke_llm(user_model.id, tenant_model, payload)
            return PluginModelBackwardsInvocation.convert_to_event_stream(response)

        return compact_generate_response(generator())


class PluginInvokeTextEmbeddingApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @get_user_tenant
    @plugin_data(payload_type=RequestInvokeTextEmbedding)
    def post(self, user_model: Account | EndUser, tenant_model: Tenant, payload: RequestInvokeTextEmbedding):
        try:
            return jsonable_encoder(
                BaseBackwardsInvocationResponse(
                    data=PluginModelBackwardsInvocation.invoke_text_embedding(
                        user_id=user_model.id,
                        tenant=tenant_model,
                        payload=payload,
                    )
                )
            )
        except Exception as e:
            return jsonable_encoder(BaseBackwardsInvocationResponse(error=str(e)))


class PluginInvokeRerankApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @get_user_tenant
    @plugin_data(payload_type=RequestInvokeRerank)
    def post(self, user_model: Account | EndUser, tenant_model: Tenant, payload: RequestInvokeRerank):
        try:
            return jsonable_encoder(
                BaseBackwardsInvocationResponse(
                    data=PluginModelBackwardsInvocation.invoke_rerank(
                        user_id=user_model.id,
                        tenant=tenant_model,
                        payload=payload,
                    )
                )
            )
        except Exception as e:
            return jsonable_encoder(BaseBackwardsInvocationResponse(error=str(e)))


class PluginInvokeTTSApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @get_user_tenant
    @plugin_data(payload_type=RequestInvokeTTS)
    def post(self, user_model: Account | EndUser, tenant_model: Tenant, payload: RequestInvokeTTS):
        def generator():
            response = PluginModelBackwardsInvocation.invoke_tts(
                user_id=user_model.id,
                tenant=tenant_model,
                payload=payload,
            )
            return PluginModelBackwardsInvocation.convert_to_event_stream(response)

        return compact_generate_response(generator())


class PluginInvokeSpeech2TextApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @get_user_tenant
    @plugin_data(payload_type=RequestInvokeSpeech2Text)
    def post(self, user_model: Account | EndUser, tenant_model: Tenant, payload: RequestInvokeSpeech2Text):
        try:
            return jsonable_encoder(
                BaseBackwardsInvocationResponse(
                    data=PluginModelBackwardsInvocation.invoke_speech2text(
                        user_id=user_model.id,
                        tenant=tenant_model,
                        payload=payload,
                    )
                )
            )
        except Exception as e:
            return jsonable_encoder(BaseBackwardsInvocationResponse(error=str(e)))


class PluginInvokeModerationApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @get_user_tenant
    @plugin_data(payload_type=RequestInvokeModeration)
    def post(self, user_model: Account | EndUser, tenant_model: Tenant, payload: RequestInvokeModeration):
        try:
            return jsonable_encoder(
                BaseBackwardsInvocationResponse(
                    data=PluginModelBackwardsInvocation.invoke_moderation(
                        user_id=user_model.id,
                        tenant=tenant_model,
                        payload=payload,
                    )
                )
            )
        except Exception as e:
            return jsonable_encoder(BaseBackwardsInvocationResponse(error=str(e)))


class PluginInvokeToolApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @get_user_tenant
    @plugin_data(payload_type=RequestInvokeTool)
    def post(self, user_model: Account | EndUser, tenant_model: Tenant, payload: RequestInvokeTool):
        def generator():
            return PluginToolBackwardsInvocation.convert_to_event_stream(
                PluginToolBackwardsInvocation.invoke_tool(
                    tenant_id=tenant_model.id,
                    user_id=user_model.id,
                    tool_type=ToolProviderType.value_of(payload.tool_type),
                    provider=payload.provider,
                    tool_name=payload.tool,
                    tool_parameters=payload.tool_parameters,
                ),
            )

        return compact_generate_response(generator())


class PluginInvokeParameterExtractorNodeApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @get_user_tenant
    @plugin_data(payload_type=RequestInvokeParameterExtractorNode)
    def post(self, user_model: Account | EndUser, tenant_model: Tenant, payload: RequestInvokeParameterExtractorNode):
        try:
            return jsonable_encoder(
                BaseBackwardsInvocationResponse(
                    data=PluginNodeBackwardsInvocation.invoke_parameter_extractor(
                        tenant_id=tenant_model.id,
                        user_id=user_model.id,
                        parameters=payload.parameters,
                        model_config=payload.model,
                        instruction=payload.instruction,
                        query=payload.query,
                    )
                )
            )
        except Exception as e:
            return jsonable_encoder(BaseBackwardsInvocationResponse(error=str(e)))


class PluginInvokeQuestionClassifierNodeApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @get_user_tenant
    @plugin_data(payload_type=RequestInvokeQuestionClassifierNode)
    def post(self, user_model: Account | EndUser, tenant_model: Tenant, payload: RequestInvokeQuestionClassifierNode):
        try:
            return jsonable_encoder(
                BaseBackwardsInvocationResponse(
                    data=PluginNodeBackwardsInvocation.invoke_question_classifier(
                        tenant_id=tenant_model.id,
                        user_id=user_model.id,
                        query=payload.query,
                        model_config=payload.model,
                        classes=payload.classes,
                        instruction=payload.instruction,
                    )
                )
            )
        except Exception as e:
            return jsonable_encoder(BaseBackwardsInvocationResponse(error=str(e)))


class PluginInvokeAppApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @get_user_tenant
    @plugin_data(payload_type=RequestInvokeApp)
    def post(self, user_model: Account | EndUser, tenant_model: Tenant, payload: RequestInvokeApp):
        response = PluginAppBackwardsInvocation.invoke_app(
            app_id=payload.app_id,
            user_id=user_model.id,
            tenant_id=tenant_model.id,
            conversation_id=payload.conversation_id,
            query=payload.query,
            stream=payload.response_mode == "streaming",
            inputs=payload.inputs,
            files=payload.files,
        )

        return compact_generate_response(PluginAppBackwardsInvocation.convert_to_event_stream(response))


class PluginInvokeEncryptApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @get_user_tenant
    @plugin_data(payload_type=RequestInvokeEncrypt)
    def post(self, user_model: Account | EndUser, tenant_model: Tenant, payload: RequestInvokeEncrypt):
        """
        encrypt or decrypt data
        """
        try:
            return BaseBackwardsInvocationResponse(
                data=PluginEncrypter.invoke_encrypt(tenant_model, payload)
            ).model_dump()
        except Exception as e:
            return BaseBackwardsInvocationResponse(error=str(e)).model_dump()


class PluginInvokeSummaryApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @get_user_tenant
    @plugin_data(payload_type=RequestInvokeSummary)
    def post(self, user_model: Account | EndUser, tenant_model: Tenant, payload: RequestInvokeSummary):
        try:
            return BaseBackwardsInvocationResponse(
                data={
                    "summary": PluginModelBackwardsInvocation.invoke_summary(
                        user_id=user_model.id,
                        tenant=tenant_model,
                        payload=payload,
                    )
                }
            ).model_dump()
        except Exception as e:
            return BaseBackwardsInvocationResponse(error=str(e)).model_dump()


class PluginUploadFileRequestApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @get_user_tenant
    @plugin_data(payload_type=RequestRequestUploadFile)
    def post(self, user_model: Account | EndUser, tenant_model: Tenant, payload: RequestRequestUploadFile):
        # generate signed url
        url = get_signed_file_url_for_plugin(payload.filename, payload.mimetype, tenant_model.id, user_model.id)
        return BaseBackwardsInvocationResponse(data={"url": url}).model_dump()


class PluginFetchAppInfoApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @get_user_tenant
    @plugin_data(payload_type=RequestFetchAppInfo)
    def post(self, user_model: Account | EndUser, tenant_model: Tenant, payload: RequestFetchAppInfo):
        return BaseBackwardsInvocationResponse(
            data=PluginAppBackwardsInvocation.fetch_app_info(payload.app_id, tenant_model.id)
        ).model_dump()


api.add_resource(PluginInvokeLLMApi, "/invoke/llm")
api.add_resource(PluginInvokeTextEmbeddingApi, "/invoke/text-embedding")
api.add_resource(PluginInvokeRerankApi, "/invoke/rerank")
api.add_resource(PluginInvokeTTSApi, "/invoke/tts")
api.add_resource(PluginInvokeSpeech2TextApi, "/invoke/speech2text")
api.add_resource(PluginInvokeModerationApi, "/invoke/moderation")
api.add_resource(PluginInvokeToolApi, "/invoke/tool")
api.add_resource(PluginInvokeParameterExtractorNodeApi, "/invoke/parameter-extractor")
api.add_resource(PluginInvokeQuestionClassifierNodeApi, "/invoke/question-classifier")
api.add_resource(PluginInvokeAppApi, "/invoke/app")
api.add_resource(PluginInvokeEncryptApi, "/invoke/encrypt")
api.add_resource(PluginInvokeSummaryApi, "/invoke/summary")
api.add_resource(PluginUploadFileRequestApi, "/upload/file/request")
api.add_resource(PluginFetchAppInfoApi, "/fetch/app/info")
