from __future__ import annotations

from collections.abc import Generator, Iterable, Sequence
from typing import IO, Any, Protocol, Union, runtime_checkable

from dify_graph.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk
from dify_graph.model_runtime.entities.message_entities import PromptMessage, PromptMessageTool
from dify_graph.model_runtime.entities.model_entities import AIModelEntity, ModelType
from dify_graph.model_runtime.entities.provider_entities import ProviderEntity
from dify_graph.model_runtime.entities.rerank_entities import MultimodalRerankInput, RerankResult
from dify_graph.model_runtime.entities.text_embedding_entities import EmbeddingInputType, EmbeddingResult


@runtime_checkable
class ModelRuntime(Protocol):
    """Port for provider discovery, schema lookup, and model execution.

    `provider` is the model runtime's canonical provider identifier. Adapters may
    derive transport-specific details from it, but those details stay outside
    this boundary.
    """

    def fetch_model_providers(self) -> Sequence[ProviderEntity]: ...

    def get_provider_icon(self, *, provider: str, icon_type: str, lang: str) -> tuple[bytes, str]: ...

    def validate_provider_credentials(self, *, provider: str, credentials: dict[str, Any]) -> None: ...

    def validate_model_credentials(
        self,
        *,
        provider: str,
        model_type: ModelType,
        model: str,
        credentials: dict[str, Any],
    ) -> None: ...

    def get_model_schema(
        self,
        *,
        provider: str,
        model_type: ModelType,
        model: str,
        credentials: dict[str, Any],
    ) -> AIModelEntity | None: ...

    def invoke_llm(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        model_parameters: dict[str, Any],
        prompt_messages: Sequence[PromptMessage],
        tools: list[PromptMessageTool] | None,
        stop: Sequence[str] | None,
        stream: bool,
    ) -> Union[LLMResult, Generator[LLMResultChunk, None, None]]: ...

    def get_llm_num_tokens(
        self,
        *,
        provider: str,
        model_type: ModelType,
        model: str,
        credentials: dict[str, Any],
        prompt_messages: Sequence[PromptMessage],
        tools: Sequence[PromptMessageTool] | None,
    ) -> int: ...

    def invoke_text_embedding(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        texts: list[str],
        input_type: EmbeddingInputType,
    ) -> EmbeddingResult: ...

    def invoke_multimodal_embedding(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        documents: list[dict[str, Any]],
        input_type: EmbeddingInputType,
    ) -> EmbeddingResult: ...

    def get_text_embedding_num_tokens(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        texts: list[str],
    ) -> list[int]: ...

    def invoke_rerank(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        query: str,
        docs: list[str],
        score_threshold: float | None,
        top_n: int | None,
    ) -> RerankResult: ...

    def invoke_multimodal_rerank(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        query: MultimodalRerankInput,
        docs: list[MultimodalRerankInput],
        score_threshold: float | None,
        top_n: int | None,
    ) -> RerankResult: ...

    def invoke_tts(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        content_text: str,
        voice: str,
    ) -> Iterable[bytes]: ...

    def get_tts_model_voices(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        language: str | None,
    ) -> Any: ...

    def invoke_speech_to_text(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        file: IO[bytes],
    ) -> str: ...

    def invoke_moderation(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        text: str,
    ) -> bool: ...
