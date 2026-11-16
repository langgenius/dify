"""A recording provider for real ModelInstance and graph execution tests."""

from collections.abc import Generator, Mapping
from typing import override

from graphon.model_runtime.callbacks.base_callback import Callback
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, PromptMessage, PromptMessageTool
from graphon.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelPropertyKey, ModelType
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel


class RecordingBranchModel(LargeLanguageModel):
    """In-process provider recording prompts at the actual invocation boundary."""

    recorded: tuple[PromptMessage, ...] = ()
    fail: bool = False

    @override
    def get_model_schema(self, model: str, credentials: dict[str, object] | None = None) -> AIModelEntity:
        """Expose a chat model without provider or credential I/O."""
        return AIModelEntity(
            model=model,
            label=I18nObject(en_US="Recording"),
            model_type=ModelType.LLM,
            fetch_from=FetchFrom.PREDEFINED_MODEL,
            model_properties={ModelPropertyKey.CONTEXT_SIZE: 8192},
        )

    @override
    def get_num_tokens(
        self,
        model: str,
        credentials: dict[str, object],
        prompt_messages: list[PromptMessage],
        tools: list[PromptMessageTool] | None = None,
    ) -> int:
        """Count deterministically without modifying prompts or issuing I/O."""
        return len(prompt_messages)

    @override
    def invoke(
        self,
        model: str,
        credentials: dict[str, object],
        prompt_messages: list[PromptMessage],
        model_parameters: dict[str, object] | None = None,
        tools: list[PromptMessageTool] | None = None,
        stop: list[str] | None = None,
        stream: bool = True,
        callbacks: list[Callback] | None = None,
        *,
        request_metadata: Mapping[str, object] | None = None,
    ) -> LLMResult | Generator[LLMResultChunk]:
        """Record supplied prompts and return real blocking/chunk result objects.

        When fail is set, raise after recording to exercise failure persistence.
        No credentials, provider services or network endpoints are contacted.
        """
        self.recorded = tuple(prompt_messages)
        if self.fail:
            raise ValueError("recording provider failed")
        if stream:
            return self._chunks(model=model, prompt_messages=prompt_messages)
        return LLMResult(
            model=model,
            prompt_messages=prompt_messages,
            message=AssistantPromptMessage(content="new answer"),
            usage=LLMUsage.empty_usage(),
        )

    @staticmethod
    def _chunks(*, model: str, prompt_messages: list[PromptMessage]) -> Generator[LLMResultChunk]:
        """Emit one complete provider chunk without side effects."""
        yield LLMResultChunk(
            model=model,
            prompt_messages=prompt_messages,
            delta=LLMResultChunkDelta(
                index=0,
                message=AssistantPromptMessage(content="new answer"),
                usage=LLMUsage.empty_usage(),
            ),
        )
