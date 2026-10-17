"""Token counting for document segments."""

from core.model_manager import ModelManager
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.models.document import Document
from graphon.model_runtime.entities.model_entities import ModelPropertyKey, ModelType
from libs.text_batch import iter_text_batches
from models.dataset import Dataset


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
    max_chunks = embedding_model.get_model_schema().model_properties.get(ModelPropertyKey.MAX_CHUNKS, 1)
    if not isinstance(max_chunks, int) or max_chunks <= 0:
        max_chunks = 1
    texts = [document.page_content for document in documents]
    token_counts: list[int] = []
    for batch in iter_text_batches(texts, max_items=max_chunks, max_bytes=1024 * 1024):
        token_counts.extend(embedding_model.get_text_embedding_num_tokens(batch))
    return token_counts
