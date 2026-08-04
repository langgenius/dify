"""Token counting for document segments."""

from collections.abc import Iterator
from typing import cast

from core.model_manager import ModelManager
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.models.document import Document
from graphon.model_runtime.entities.model_entities import ModelPropertyKey, ModelType
from graphon.model_runtime.model_providers.base.text_embedding_model import TextEmbeddingModel
from models.dataset import Dataset

# Keeps a single batch well under typical proxy/plugin-daemon body-size limits,
# even when max_chunks alone would allow bundling more text together.
_MAX_BATCH_BYTES = 1 * 1024 * 1024  # 1 MB


def _iter_batches(texts: list[str], max_chunks: int) -> Iterator[list[str]]:
    """Yield batches bounded by both item count (max_chunks) and total UTF-8 byte size."""
    batch: list[str] = []
    batch_bytes = 0

    for text in texts:
        text_bytes = len(text.encode("utf-8"))

        if batch and (len(batch) >= max_chunks or batch_bytes + text_bytes > _MAX_BATCH_BYTES):
            yield batch
            batch = []
            batch_bytes = 0

        batch.append(text)
        batch_bytes += text_bytes

    if batch:
        yield batch


def calculate_segment_token_counts(dataset: Dataset, documents: list[Document]) -> list[int]:
    """Return one token count per document, invoking the embedding model only for high-quality indexes."""
    if not documents:
        return []

    if dataset.indexing_technique != IndexTechniqueType.HIGH_QUALITY:
        return [0] * len(documents)

    model_manager = ModelManager.for_tenant(tenant_id=dataset.tenant_id)
    embedding_model = model_manager.get_model_instance(
        tenant_id=dataset.tenant_id,
        provider=dataset.embedding_model_provider,
        model_type=ModelType.TEXT_EMBEDDING,
        model=dataset.embedding_model,
    )

    texts = [document.page_content for document in documents]

    model_type_instance = cast(TextEmbeddingModel, embedding_model.model_type_instance)
    model_schema = model_type_instance.get_model_schema(embedding_model.model_name, embedding_model.credentials)
    max_chunks = (
        model_schema.model_properties[ModelPropertyKey.MAX_CHUNKS]
        if model_schema and ModelPropertyKey.MAX_CHUNKS in model_schema.model_properties
        else 1
    )

    token_counts: list[int] = []
    for batch_texts in _iter_batches(texts, max_chunks):
        token_counts.extend(embedding_model.get_text_embedding_num_tokens(batch_texts))

    return token_counts
