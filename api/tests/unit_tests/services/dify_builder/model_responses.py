"""Text completions returned by deterministic Builder model transports."""

from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage


def text_result(text: str) -> LLMResult:
    return LLMResult(model="model", message=AssistantPromptMessage(content=text), usage=LLMUsage.empty_usage())
