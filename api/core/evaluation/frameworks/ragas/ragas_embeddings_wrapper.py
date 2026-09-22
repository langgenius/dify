import asyncio
from typing import Any, cast, override

from langchain_core.embeddings import Embeddings


class DifyEmbeddingsWrapper(Embeddings):
    """Bridge RAGAS embedding metrics to the tenant's default embedding model."""

    def __init__(self, tenant_id: str, user_id: str | None = None):
        super().__init__()
        self.tenant_id = tenant_id
        self.user_id = user_id
        self._model_instance: Any | None = None
        self.run_config: Any | None = None

    def _get_model_instance(self) -> Any:
        from core.model_manager import ModelManager
        from graphon.model_runtime.entities.model_entities import ModelType

        if self._model_instance is None:
            self._model_instance = ModelManager.for_tenant(
                tenant_id=self.tenant_id,
                user_id=self.user_id,
            ).get_default_model_instance(
                tenant_id=self.tenant_id,
                model_type=ModelType.TEXT_EMBEDDING,
            )
        return self._model_instance

    @staticmethod
    def _max_batch_size(model_instance: Any) -> int:
        from graphon.model_runtime.entities.model_entities import ModelPropertyKey
        from graphon.model_runtime.model_providers.base.text_embedding_model import TextEmbeddingModel

        model_type_instance = cast(TextEmbeddingModel, model_instance.model_type_instance)
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

    def embed_query(self, text: str) -> list[float]:
        return self._embed([text], is_query=True)[0]

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self._embed(texts, is_query=False)

    def set_run_config(self, run_config: Any) -> None:
        """Implement the configuration hook expected by RAGAS embedding metrics."""
        self.run_config = run_config

    async def embed_text(self, text: str, is_async: bool = True) -> list[float]:
        """Implement the RAGAS single-text helper without importing optional HF backends."""
        if is_async:
            return (await self.aembed_documents([text]))[0]
        return self.embed_documents([text])[0]

    async def embed_texts(self, texts: list[str], is_async: bool = True) -> list[list[float]]:
        """Implement the RAGAS multi-text helper without importing optional HF backends."""
        if is_async:
            return await self.aembed_documents(texts)
        return self.embed_documents(texts)

    @override
    async def aembed_query(self, text: str) -> list[float]:
        return await asyncio.to_thread(self.embed_query, text)

    @override
    async def aembed_documents(self, texts: list[str]) -> list[list[float]]:
        return await asyncio.to_thread(self.embed_documents, texts)
