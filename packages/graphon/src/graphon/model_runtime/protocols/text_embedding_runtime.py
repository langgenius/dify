from __future__ import annotations

from abc import abstractmethod
from collections.abc import Mapping
from typing import Any, Protocol, runtime_checkable

from graphon.model_runtime.entities.text_embedding_entities import (
    EmbeddingInputType,
    EmbeddingResult,
)
from graphon.model_runtime.protocols.provider_runtime import ModelProviderRuntime


@runtime_checkable
class TextEmbeddingModelRuntime(ModelProviderRuntime, Protocol):
    """Runtime surface required by text and multimodal embedding wrappers."""

    @abstractmethod
    def invoke_text_embedding(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        texts: list[str],
        input_type: EmbeddingInputType,
        request_metadata: Mapping[str, object] | None = None,
    ) -> EmbeddingResult: ...

    @abstractmethod
    def invoke_multimodal_embedding(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        documents: list[dict[str, Any]],
        input_type: EmbeddingInputType,
        request_metadata: Mapping[str, object] | None = None,
    ) -> EmbeddingResult: ...

    @abstractmethod
    def get_text_embedding_num_tokens(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        texts: list[str],
    ) -> list[int]: ...
