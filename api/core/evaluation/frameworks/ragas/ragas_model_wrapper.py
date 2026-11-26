import asyncio
from typing import Any, TypeVar, override

from pydantic import BaseModel
from ragas.llms.base import InstructorBaseRagasLLM

from core.evaluation.base_evaluation_instance import get_evaluation_credit_usage_metadata
from libs.structured_output_schema import to_strict_json_schema

_OutputT = TypeVar("_OutputT", bound=BaseModel)


class DifyModelWrapper(InstructorBaseRagasLLM):
    """Run Ragas judge prompts on the tenant's configured Dify model."""

    def __init__(self, model_provider: str, model_name: str, tenant_id: str, user_id: str | None = None):
        self.model_provider = model_provider
        self.model_name = model_name
        self.tenant_id = tenant_id
        self.user_id = user_id

    def _get_model_instance(self) -> Any:
        """Resolve the configured judge model with Evaluation credit attribution."""
        from core.plugin.impl.model_runtime_factory import create_plugin_model_manager
        from graphon.model_runtime.entities.model_entities import ModelType

        model_manager = create_plugin_model_manager(tenant_id=self.tenant_id, user_id=self.user_id)
        return model_manager.get_model_instance(
            tenant_id=self.tenant_id,
            provider=self.model_provider,
            model_type=ModelType.LLM,
            model=self.model_name,
            request_metadata=get_evaluation_credit_usage_metadata(),
        )

    @staticmethod
    def _prompt_messages(prompt: str) -> list[Any]:
        from graphon.model_runtime.entities.message_entities import SystemPromptMessage, UserPromptMessage

        return [
            SystemPromptMessage(content="You are an evaluation judge. Follow the requested output format exactly."),
            UserPromptMessage(content=prompt),
        ]

    def invoke(self, prompt: str) -> str:
        """Support the Dify-owned Agent judge's plain-text fallback."""
        result = self._get_model_instance().invoke_llm(
            prompt_messages=self._prompt_messages(prompt),
            model_parameters={"temperature": 0.0},
            stream=False,
        )
        return result.message.get_text_content()

    @override
    def generate(self, prompt: str, response_model: type[_OutputT]) -> _OutputT:
        """Generate a schema-validated result through Dify's model runtime."""
        from core.llm_generator.output_parser.structured_output import invoke_llm_with_structured_output

        model_instance = self._get_model_instance()
        result = invoke_llm_with_structured_output(
            provider=model_instance.provider,
            model_schema=model_instance.get_model_schema(),
            model_instance=model_instance,
            prompt_messages=self._prompt_messages(prompt),
            json_schema=to_strict_json_schema(response_model.model_json_schema()),
            model_parameters={"temperature": 0.0},
            stream=False,
        )
        return response_model.model_validate(result.structured_output)

    @override
    async def agenerate(self, prompt: str, response_model: type[_OutputT]) -> _OutputT:
        return await asyncio.to_thread(self.generate, prompt, response_model)
