import asyncio
from typing import Any, override

from ragas.embeddings.base import BaseRagasEmbedding

from core.evaluation.base_evaluation_instance import get_evaluation_credit_usage_metadata


class DifyEmbeddingsWrapper(BaseRagasEmbedding):
    """Bridge modern Ragas metrics to the tenant's default embedding model."""

    def __init__(self, tenant_id: str, user_id: str | None = None, *, single_text_is_query: bool = False):
        super().__init__()
        self.tenant_id = tenant_id
        self.user_id = user_id
        self.single_text_is_query = single_text_is_query
        self._model_instance: Any | None = None

    def for_answer_relevancy(self) -> "DifyEmbeddingsWrapper":
        """Use query embeddings for the question and document embeddings for generated questions."""
        return DifyEmbeddingsWrapper(self.tenant_id, self.user_id, single_text_is_query=True)

    def _get_model_instance(self) -> Any:
        """Resolve and cache the tenant's default embedding model with Evaluation attribution."""
        from core.model_manager import ModelManager
        from graphon.model_runtime.entities.model_entities import ModelType

        if self._model_instance is None:
            self._model_instance = ModelManager.for_tenant(
                tenant_id=self.tenant_id,
                user_id=self.user_id,
                request_metadata=get_evaluation_credit_usage_metadata(),
            ).get_default_model_instance(
                tenant_id=self.tenant_id,
                model_type=ModelType.TEXT_EMBEDDING,
            )
        return self._model_instance

    @staticmethod
    def _max_batch_size(model_instance: Any) -> int:
        from graphon.model_runtime.entities.model_entities import ModelPropertyKey

        model_type_instance = model_instance.model_type_instance
        model_schema = model_type_instance.get_model_schema(model_instance.model_name, model_instance.credentials)
        if model_schema is None:
            return 1
        max_chunks = model_schema.model_properties.get(ModelPropertyKey.MAX_CHUNKS, 1)
        return max(1, int(max_chunks))

    def _embed(self, texts: list[str], *, is_query: bool) -> list[list[float]]:
        from core.entities.embedding_type import EmbeddingInputType

        if not texts:
            return []

        model_instance = self._get_model_instance()
        input_type = EmbeddingInputType.QUERY if is_query else EmbeddingInputType.DOCUMENT
        batch_size = self._max_batch_size(model_instance)
        embeddings: list[list[float]] = []
        for offset in range(0, len(texts), batch_size):
            result = model_instance.invoke_text_embedding(
                texts=texts[offset : offset + batch_size],
                input_type=input_type,
            )
            embeddings.extend([[float(value) for value in vector] for vector in result.embeddings])
        return embeddings

    @override
    def embed_text(self, text: str, **kwargs: Any) -> list[float]:
        return self._embed([text], is_query=self.single_text_is_query)[0]

    @override
    async def aembed_text(self, text: str, **kwargs: Any) -> list[float]:
        return await asyncio.to_thread(self.embed_text, text, **kwargs)

    @override
    def embed_texts(self, texts: list[str], **kwargs: Any) -> list[list[float]]:
        return self._embed(texts, is_query=False)

    @override
    async def aembed_texts(self, texts: list[str], **kwargs: Any) -> list[list[float]]:
        return await asyncio.to_thread(self.embed_texts, texts, **kwargs)
