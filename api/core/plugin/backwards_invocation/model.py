import tempfile
from binascii import hexlify, unhexlify
from collections.abc import Generator

from core.model_manager import ModelManager
from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk
from core.plugin.backwards_invocation.base import BaseBackwardsInvocation
from core.plugin.entities.request import (
    RequestInvokeLLM,
    RequestInvokeModeration,
    RequestInvokeRerank,
    RequestInvokeSpeech2Text,
    RequestInvokeTextEmbedding,
    RequestInvokeTTS,
)
from core.workflow.nodes.llm.llm_node import LLMNode
from models.account import Tenant


class PluginModelBackwardsInvocation(BaseBackwardsInvocation):
    @classmethod
    def invoke_llm(
        cls, user_id: str, tenant: Tenant, payload: RequestInvokeLLM
    ) -> Generator[LLMResultChunk, None, None] | LLMResult:
        """
        invoke llm
        """
        model_instance = ModelManager().get_model_instance(
            tenant_id=tenant.id,
            provider=payload.provider,
            model_type=payload.model_type,
            model=payload.model,
        )

        # invoke model
        response = model_instance.invoke_llm(
            prompt_messages=payload.prompt_messages,
            model_parameters=payload.model_parameters,
            tools=payload.tools,
            stop=payload.stop,
            stream=payload.stream or True,
            user=user_id,
        )

        if isinstance(response, Generator):

            def handle() -> Generator[LLMResultChunk, None, None]:
                for chunk in response:
                    if chunk.delta.usage:
                        LLMNode.deduct_llm_quota(
                            tenant_id=tenant.id, model_instance=model_instance, usage=chunk.delta.usage
                        )
                    yield chunk

            return handle()
        else:
            if response.usage:
                LLMNode.deduct_llm_quota(tenant_id=tenant.id, model_instance=model_instance, usage=response.usage)
            return response

    @classmethod
    def invoke_text_embedding(cls, user_id: str, tenant: Tenant, payload: RequestInvokeTextEmbedding):
        """
        invoke text embedding
        """
        model_instance = ModelManager().get_model_instance(
            tenant_id=tenant.id,
            provider=payload.provider,
            model_type=payload.model_type,
            model=payload.model,
        )

        # invoke model
        response = model_instance.invoke_text_embedding(
            texts=payload.texts,
            user=user_id,
        )

        return response

    @classmethod
    def invoke_rerank(cls, user_id: str, tenant: Tenant, payload: RequestInvokeRerank):
        """
        invoke rerank
        """
        model_instance = ModelManager().get_model_instance(
            tenant_id=tenant.id,
            provider=payload.provider,
            model_type=payload.model_type,
            model=payload.model,
        )

        # invoke model
        response = model_instance.invoke_rerank(
            query=payload.query,
            docs=payload.docs,
            score_threshold=payload.score_threshold,
            top_n=payload.top_n,
            user=user_id,
        )

        return response

    @classmethod
    def invoke_tts(cls, user_id: str, tenant: Tenant, payload: RequestInvokeTTS):
        """
        invoke tts
        """
        model_instance = ModelManager().get_model_instance(
            tenant_id=tenant.id,
            provider=payload.provider,
            model_type=payload.model_type,
            model=payload.model,
        )

        # invoke model
        response = model_instance.invoke_tts(
            content_text=payload.content_text,
            tenant_id=tenant.id,
            voice=payload.voice,
            user=user_id,
        )

        def handle() -> Generator[dict, None, None]:
            for chunk in response:
                yield {"result": hexlify(chunk).decode("utf-8")}

        return handle()

    @classmethod
    def invoke_speech2text(cls, user_id: str, tenant: Tenant, payload: RequestInvokeSpeech2Text):
        """
        invoke speech2text
        """
        model_instance = ModelManager().get_model_instance(
            tenant_id=tenant.id,
            provider=payload.provider,
            model_type=payload.model_type,
            model=payload.model,
        )

        # invoke model
        with tempfile.NamedTemporaryFile(suffix=".mp3", mode="wb", delete=True) as temp:
            temp.write(unhexlify(payload.file))
            temp.flush()
            temp.seek(0)

        response = model_instance.invoke_speech2text(
            file=temp,
            user=user_id,
        )

        return {
            "result": response,
        }

    @classmethod
    def invoke_moderation(cls, user_id: str, tenant: Tenant, payload: RequestInvokeModeration):
        """
        invoke moderation
        """
        model_instance = ModelManager().get_model_instance(
            tenant_id=tenant.id,
            provider=payload.provider,
            model_type=payload.model_type,
            model=payload.model,
        )

        # invoke model
        response = model_instance.invoke_moderation(
            text=payload.text,
            user=user_id,
        )

        return {
            "result": response,
        }
