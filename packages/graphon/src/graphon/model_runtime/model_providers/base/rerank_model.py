from collections.abc import Mapping

from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.entities.rerank_entities import (
    MultimodalRerankInput,
    RerankResult,
)
from graphon.model_runtime.model_providers.base.ai_model import AIModel
from graphon.model_runtime.protocols.rerank_runtime import RerankModelRuntime


class RerankModel(AIModel[RerankModelRuntime]):
    """Base Model class for rerank model."""

    model_type: ModelType = ModelType.RERANK

    def invoke(
        self,
        model: str,
        credentials: dict,
        query: str,
        docs: list[str],
        score_threshold: float | None = None,
        top_n: int | None = None,
        *,
        request_metadata: Mapping[str, object] | None = None,
    ) -> RerankResult:
        """Invoke the rerank model for text inputs."""
        try:
            return self.model_runtime.invoke_rerank(
                provider=self.provider,
                model=model,
                credentials=credentials,
                query=query,
                docs=docs,
                score_threshold=score_threshold,
                top_n=top_n,
                request_metadata=request_metadata,
            )
        except Exception as e:
            raise self._transform_invoke_error(e) from e

    def invoke_multimodal_rerank(
        self,
        model: str,
        credentials: dict,
        query: MultimodalRerankInput,
        docs: list[MultimodalRerankInput],
        score_threshold: float | None = None,
        top_n: int | None = None,
        *,
        request_metadata: Mapping[str, object] | None = None,
    ) -> RerankResult:
        """Invoke the rerank model for multimodal inputs."""
        try:
            return self.model_runtime.invoke_multimodal_rerank(
                provider=self.provider,
                model=model,
                credentials=credentials,
                query=query,
                docs=docs,
                score_threshold=score_threshold,
                top_n=top_n,
                request_metadata=request_metadata,
            )
        except Exception as e:
            raise self._transform_invoke_error(e) from e
