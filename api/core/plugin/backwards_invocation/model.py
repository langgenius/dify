from collections.abc import Generator

from core.model_manager import ModelManager
from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk
from core.plugin.backwards_invocation.base import BaseBackwardsInvocation
from core.plugin.entities.request import RequestInvokeLLM
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
    
    