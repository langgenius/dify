from __future__ import annotations

from collections.abc import Generator, Mapping, Sequence
from typing import Any, Protocol

from dify_graph.file import File
from dify_graph.model_runtime.entities import LLMMode, PromptMessage
from dify_graph.model_runtime.entities.llm_entities import (
    LLMResult,
    LLMResultChunk,
    LLMResultChunkWithStructuredOutput,
    LLMResultWithStructuredOutput,
)
from dify_graph.model_runtime.entities.message_entities import PromptMessageTool
from dify_graph.model_runtime.entities.model_entities import AIModelEntity


class PreparedLLMProtocol(Protocol):
    """A graph-facing LLM runtime with provider-specific setup already applied."""

    @property
    def provider(self) -> str: ...

    @property
    def model_name(self) -> str: ...

    @property
    def parameters(self) -> Mapping[str, Any]: ...

    @property
    def stop(self) -> Sequence[str] | None: ...

    def get_model_schema(self) -> AIModelEntity: ...

    def get_llm_num_tokens(self, prompt_messages: Sequence[PromptMessage]) -> int: ...

    def invoke_llm(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: Mapping[str, Any],
        tools: Sequence[PromptMessageTool] | None,
        stop: Sequence[str] | None,
        stream: bool,
    ) -> LLMResult | Generator[LLMResultChunk, None, None]: ...

    def invoke_llm_with_structured_output(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        json_schema: Mapping[str, Any],
        model_parameters: Mapping[str, Any],
        stop: Sequence[str] | None,
        stream: bool,
    ) -> LLMResultWithStructuredOutput | Generator[LLMResultChunkWithStructuredOutput, None, None]: ...

    def is_structured_output_parse_error(self, error: Exception) -> bool: ...


class PromptMessageSerializerProtocol(Protocol):
    """Port for converting compiled prompt messages into persisted process data."""

    def serialize(
        self,
        *,
        model_mode: LLMMode,
        prompt_messages: Sequence[PromptMessage],
    ) -> Any: ...


class RetrieverAttachmentLoaderProtocol(Protocol):
    """Port for resolving retriever segment attachments into graph file references."""

    def load(self, *, segment_id: str) -> Sequence[File]: ...
