import asyncio
import logging
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.outputs import ChatGeneration, LLMResult
from langchain_core.prompt_values import PromptValue

try:
    from ragas.llms.base import BaseRagasLLM
except ImportError:
    class BaseRagasLLM:  # type: ignore[no-redef]
        """Lightweight shim so the module stays importable without ragas installed."""

        def __init__(self, *args: Any, **kwargs: Any) -> None:
            del args, kwargs

        @staticmethod
        def get_temperature(n: int) -> float:
            return 0.3 if n > 1 else 1e-8

logger = logging.getLogger(__name__)


class DifyModelWrapper(BaseRagasLLM):
    """Bridge Dify model invocation to ragas and fallback LLM-as-judge flows.

    ragas can accept a custom ``BaseRagasLLM`` instance. Using one here keeps
    evaluation requests on Dify's provider stack instead of falling back to
    ragas' default OpenAI factory, which would require standalone environment
    credentials and bypass tenant-scoped model configuration.
    """

    model_provider: str
    model_name: str
    tenant_id: str
    user_id: str | None

    def __init__(self, model_provider: str, model_name: str, tenant_id: str, user_id: str | None = None):
        super().__init__()
        self.model_provider = model_provider
        self.model_name = model_name
        self.tenant_id = tenant_id
        self.user_id = user_id

    def _get_model_instance(self) -> Any:
        from core.plugin.impl.model_runtime_factory import create_plugin_model_manager
        from graphon.model_runtime.entities.model_entities import ModelType

        model_manager = create_plugin_model_manager(tenant_id=self.tenant_id, user_id=self.user_id)
        model_instance = model_manager.get_model_instance(
            tenant_id=self.tenant_id,
            provider=self.model_provider,
            model_type=ModelType.LLM,
            model=self.model_name,
        )
        return model_instance

    def invoke(self, prompt: str) -> str:
        """Invoke the configured Dify model with a plain-text evaluation prompt."""
        from graphon.model_runtime.entities.message_entities import SystemPromptMessage, UserPromptMessage

        model_instance = self._get_model_instance()
        result = model_instance.invoke_llm(
            prompt_messages=[
                SystemPromptMessage(content="You are an evaluation judge. Answer precisely and concisely."),
                UserPromptMessage(content=prompt),
            ],
            model_parameters={"temperature": 0.0},
            stream=False,
        )
        return result.message.content

    def generate_text(
        self,
        prompt: PromptValue,
        n: int = 1,
        temperature: float = 1e-8,
        stop: list[str] | None = None,
        callbacks: Any = None,
    ) -> LLMResult:
        """Implement ragas' sync LLM interface on top of Dify's model runtime."""
        del callbacks  # Dify's invocation path does not currently use LangChain callbacks here.
        prompt_messages = _convert_prompt_value(prompt)
        model_instance = self._get_model_instance()

        generations: list[list[ChatGeneration]] = [[]]
        completions = max(1, n)
        for _ in range(completions):
            result = model_instance.invoke_llm(
                prompt_messages=prompt_messages,
                model_parameters={"temperature": temperature},
                stop=stop,
                stream=False,
            )
            text = result.message.content
            generations[0].append(
                ChatGeneration(
                    text=text,
                    message=AIMessage(content=text, response_metadata={"finish_reason": "stop"}),
                    generation_info={"finish_reason": "stop"},
                )
            )

        return LLMResult(generations=generations)

    async def agenerate_text(
        self,
        prompt: PromptValue,
        n: int = 1,
        temperature: float | None = None,
        stop: list[str] | None = None,
        callbacks: Any = None,
    ) -> LLMResult:
        """Async ragas hook backed by the sync Dify invocation path."""
        return await asyncio.to_thread(
            self.generate_text,
            prompt,
            n,
            self.get_temperature(n) if temperature is None else temperature,
            stop,
            callbacks,
        )


def _convert_prompt_value(prompt: PromptValue) -> list[Any]:
    """Translate LangChain prompt values into graphon prompt messages."""
    from graphon.model_runtime.entities.message_entities import (
        AssistantPromptMessage,
        SystemPromptMessage,
        UserPromptMessage,
    )

    prompt_messages: list[Any] = []
    for message in prompt.to_messages():
        content = _message_content_to_text(message)
        if isinstance(message, SystemMessage):
            prompt_messages.append(SystemPromptMessage(content=content))
        elif isinstance(message, AIMessage):
            prompt_messages.append(AssistantPromptMessage(content=content))
        elif isinstance(message, HumanMessage):
            prompt_messages.append(UserPromptMessage(content=content))
        else:
            prompt_messages.append(UserPromptMessage(content=content))

    return prompt_messages


def _message_content_to_text(message: BaseMessage) -> str:
    """Flatten LangChain message content into a plain-text string for Dify."""
    if isinstance(message.content, str):
        return message.content

    if isinstance(message.content, list):
        parts: list[str] = []
        for block in message.content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                text = block.get("text")
                if text:
                    parts.append(str(text))
        return "\n".join(part for part in parts if part)

    return str(message.content or "")
