from unittest.mock import Mock, patch

from core.rag.embedding.token_counter import calculate_segment_token_counts
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.models.document import Document
from models.dataset import Dataset


def test_high_quality_counts_each_document_once() -> None:
    dataset = Mock(spec=Dataset)
    dataset.tenant_id = "tenant-1"
    dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
    dataset.embedding_model_provider = "provider"
    dataset.embedding_model = "model"
    documents = [
        Document(page_content="first", metadata={}),
        Document(page_content="second", metadata={}),
        Document(page_content="third", metadata={}),
    ]

    with patch("core.rag.embedding.token_counter.ModelManager.for_tenant") as model_manager_factory:
        embedding_model = model_manager_factory.return_value.get_model_instance.return_value
        embedding_model.get_text_embedding_num_tokens.return_value = [11, 22, 33]

        result = calculate_segment_token_counts(dataset=dataset, documents=documents)

    assert result == [11, 22, 33]
    model_manager_factory.assert_called_once_with(tenant_id=dataset.tenant_id)
    model_manager_factory.return_value.get_model_instance.assert_called_once()
    embedding_model.get_text_embedding_num_tokens.assert_called_once_with(["first", "second", "third"])


def test_economy_returns_zero_without_loading_model() -> None:
    dataset = Mock(spec=Dataset)
    dataset.indexing_technique = IndexTechniqueType.ECONOMY
    documents = [
        Document(page_content="first", metadata={}),
        Document(page_content="second", metadata={}),
    ]

    with patch("core.rag.embedding.token_counter.ModelManager.for_tenant") as model_manager_factory:
        result = calculate_segment_token_counts(dataset=dataset, documents=documents)

    assert result == [0, 0]
    model_manager_factory.assert_not_called()


def test_empty_documents_return_without_loading_model() -> None:
    dataset = Mock(spec=Dataset)
    dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY

    with patch("core.rag.embedding.token_counter.ModelManager.for_tenant") as model_manager_factory:
        result = calculate_segment_token_counts(dataset=dataset, documents=[])

    assert result == []
    model_manager_factory.assert_not_called()
