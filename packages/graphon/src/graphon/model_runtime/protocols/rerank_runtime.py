from __future__ import annotations

from abc import abstractmethod
from collections.abc import Mapping
from typing import Any, Protocol, runtime_checkable

from graphon.model_runtime.entities.rerank_entities import (
    MultimodalRerankInput,
    RerankResult,
)
from graphon.model_runtime.protocols.provider_runtime import ModelProviderRuntime


@runtime_checkable
class RerankModelRuntime(ModelProviderRuntime, Protocol):
    """Runtime surface required by rerank model wrappers."""

    @abstractmethod
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
        request_metadata: Mapping[str, object] | None = None,
    ) -> RerankResult: ...

    @abstractmethod
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
        request_metadata: Mapping[str, object] | None = None,
    ) -> RerankResult: ...
