from __future__ import annotations

import asyncio
import os
from typing import TYPE_CHECKING, Any, cast, override

from pydantic import BaseModel

# DeepEval reads these settings while its package is imported. Evaluation runs
# must not load process-local dotenv files or emit framework telemetry.
os.environ.setdefault("DEEPEVAL_DISABLE_DOTENV", "1")
os.environ.setdefault("DEEPEVAL_TELEMETRY_OPT_OUT", "1")

from deepeval.models import DeepEvalBaseLLM

if TYPE_CHECKING:
    from core.model_manager import ModelInstance


class DifyDeepEvalModel(DeepEvalBaseLLM):
    """Route DeepEval judge prompts through Dify's tenant-scoped model runtime."""

    def __init__(
        self,
        model_provider: str,
        model_name: str,
        tenant_id: str,
        user_id: str | None = None,
    ) -> None:
        self.model_provider = model_provider
        self.dify_model_name = model_name
        self.tenant_id = tenant_id
        self.user_id = user_id
        super().__init__(model_name)

    def load_model(self) -> Any:
        from core.plugin.impl.model_runtime_factory import create_plugin_model_manager
        from graphon.model_runtime.entities.model_entities import ModelType

        model_manager = create_plugin_model_manager(tenant_id=self.tenant_id, user_id=self.user_id)
        return model_manager.get_model_instance(
            tenant_id=self.tenant_id,
            provider=self.model_provider,
            model_type=ModelType.LLM,
            model=self.dify_model_name,
        )

    def generate(self, prompt: str, schema: type[BaseModel] | None = None) -> Any:
        """Generate text or a schema-validated response for a DeepEval prompt."""
        from graphon.model_runtime.entities.message_entities import (
            PromptMessage,
            SystemPromptMessage,
            UserPromptMessage,
        )

        prompt_messages: list[PromptMessage] = [
            SystemPromptMessage(content="You are an evaluation judge. Follow the requested output format exactly."),
            UserPromptMessage(content=prompt),
        ]
        model_instance = cast("ModelInstance", self.model)
        if schema is not None:
            from core.llm_generator.output_parser.structured_output import invoke_llm_with_structured_output

            structured_result = invoke_llm_with_structured_output(
                provider=model_instance.provider,
                model_schema=model_instance.get_model_schema(),
                model_instance=model_instance,
                prompt_messages=prompt_messages,
                json_schema=schema.model_json_schema(),
                model_parameters={"temperature": 0.0},
                stream=False,
            )
            return schema.model_validate(structured_result.structured_output)

        llm_result = model_instance.invoke_llm(
            prompt_messages=prompt_messages,
            model_parameters={"temperature": 0.0},
            stream=False,
        )
        return llm_result.message.get_text_content()

    async def a_generate(self, prompt: str, schema: type[BaseModel] | None = None) -> Any:
        return await asyncio.to_thread(self.generate, prompt, schema=schema)

    def get_model_name(self) -> str:
        return f"{self.model_provider}/{self.dify_model_name}"

    @override
    def supports_structured_outputs(self) -> bool:
        return True

    @override
    def supports_temperature(self) -> bool:
        return True
