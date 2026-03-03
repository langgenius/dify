import logging
from typing import Any

logger = logging.getLogger(__name__)


class DifyModelWrapper:
    """Wraps Dify's model invocation interface for use by RAGAS as an LLM judge.

    RAGAS requires an LLM to compute certain metrics (faithfulness, answer_relevancy, etc.).
    This wrapper bridges Dify's ModelInstance to a callable that RAGAS can use.
    """

    def __init__(self, model_provider: str, model_name: str, tenant_id: str):
        self.model_provider = model_provider
        self.model_name = model_name
        self.tenant_id = tenant_id

    def _get_model_instance(self) -> Any:
        from core.model_manager import ModelManager
        from core.model_runtime.entities.model_entities import ModelType

        model_manager = ModelManager()
        model_instance = model_manager.get_model_instance(
            tenant_id=self.tenant_id,
            provider=self.model_provider,
            model_type=ModelType.LLM,
            model=self.model_name,
        )
        return model_instance

    def invoke(self, prompt: str) -> str:
        """Invoke the model with a text prompt and return the text response."""
        from core.model_runtime.entities.message_entities import (
            SystemPromptMessage,
            UserPromptMessage,
        )

        model_instance = self._get_model_instance()
        result = model_instance.invoke_llm(
            prompt_messages=[
                SystemPromptMessage(content="You are an evaluation judge. Answer precisely and concisely."),
                UserPromptMessage(content=prompt),
            ],
            model_parameters={"temperature": 0.0, "max_tokens": 2048},
            stream=False,
        )
        return result.message.content
