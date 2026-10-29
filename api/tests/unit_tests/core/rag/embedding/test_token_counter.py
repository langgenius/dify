import json
from unittest.mock import patch

import pytest

from core.rag.embedding.token_counter import calculate_segment_token_counts
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.models.document import Document
from graphon.model_runtime.entities.model_entities import ModelPropertyKey
from models.dataset import Dataset


def test_high_quality_counts_each_document_once() -> None:
    dataset = Dataset(
        tenant_id="tenant-1",
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        embedding_model_provider="provider",
        embedding_model="model",
    )
    documents = [
        Document(page_content="first", metadata={}),
        Document(page_content="second", metadata={}),
        Document(page_content="third", metadata={}),
    ]

    with patch("core.rag.embedding.token_counter.ModelManager.for_tenant") as model_manager_factory:
        embedding_model = model_manager_factory.return_value.get_model_instance.return_value
        embedding_model.get_model_schema.return_value.model_properties = {ModelPropertyKey.MAX_CHUNKS: 10}
        embedding_model.get_text_embedding_num_tokens.return_value = [11, 22, 33]

        result = calculate_segment_token_counts(dataset=dataset, documents=documents)

    assert result == [11, 22, 33]
    model_manager_factory.assert_called_once_with(tenant_id=dataset.tenant_id)
    model_manager_factory.return_value.get_model_instance.assert_called_once()
    embedding_model.get_text_embedding_num_tokens.assert_called_once_with(["first", "second", "third"])


def test_economy_returns_zero_without_loading_model() -> None:
    dataset = Dataset(
        indexing_technique=IndexTechniqueType.ECONOMY,
    )
    documents = [
        Document(page_content="first", metadata={}),
        Document(page_content="second", metadata={}),
    ]

    with patch("core.rag.embedding.token_counter.ModelManager.for_tenant") as model_manager_factory:
        result = calculate_segment_token_counts(dataset=dataset, documents=documents)

    assert result == [0, 0]
    model_manager_factory.assert_not_called()


def test_empty_documents_return_without_loading_model() -> None:
    dataset = Dataset(
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
    )

    with patch("core.rag.embedding.token_counter.ModelManager.for_tenant") as model_manager_factory:
        result = calculate_segment_token_counts(dataset=dataset, documents=[])

    assert result == []
    model_manager_factory.assert_not_called()


@pytest.mark.parametrize("max_chunks", [2, 1, 0, -1, None])
def test_high_quality_respects_model_batch_limit(max_chunks: int | None) -> None:
    dataset = Dataset(tenant_id="tenant-1", indexing_technique=IndexTechniqueType.HIGH_QUALITY)
    documents = [Document(page_content=str(i), metadata={}) for i in range(5)]
    limit = max_chunks if max_chunks and max_chunks > 0 else 1

    with patch("core.rag.embedding.token_counter.ModelManager.for_tenant") as factory:
        model = factory.return_value.get_model_instance.return_value
        properties: dict[ModelPropertyKey, int] = {}
        if max_chunks is not None:
            properties[ModelPropertyKey.MAX_CHUNKS] = max_chunks
        model.get_model_schema.return_value.model_properties = properties
        model.get_text_embedding_num_tokens.side_effect = lambda texts: [int(text) + 10 for text in texts]

        assert calculate_segment_token_counts(dataset, documents) == [10, 11, 12, 13, 14]

    batches = [call.args[0] for call in model.get_text_embedding_num_tokens.call_args_list]
    assert all(len(batch) <= limit for batch in batches)
    assert [text for batch in batches for text in batch] == [str(i) for i in range(5)]


def test_high_quality_bounds_encoded_payload_without_changing_text() -> None:
    dataset = Dataset(tenant_id="tenant-1", indexing_technique=IndexTechniqueType.HIGH_QUALITY)
    texts = ['漢\\"\n' * 60000, "another" * 60000, "last"]
    documents = [Document(page_content=text, metadata={}) for text in texts]

    with patch("core.rag.embedding.token_counter.ModelManager.for_tenant") as factory:
        model = factory.return_value.get_model_instance.return_value
        model.get_model_schema.return_value.model_properties = {ModelPropertyKey.MAX_CHUNKS: 100}
        model.get_text_embedding_num_tokens.side_effect = lambda batch: [len(text) for text in batch]

        assert calculate_segment_token_counts(dataset, documents) == [len(text) for text in texts]

    batches = [call.args[0] for call in model.get_text_embedding_num_tokens.call_args_list]
    assert len(batches) > 1
    assert all(len(json.dumps(batch, ensure_ascii=True).encode("utf-8")) <= 1024 * 1024 for batch in batches)
    assert [text for batch in batches for text in batch] == texts


def test_high_quality_rejects_oversized_segment_before_calling_tokenizer() -> None:
    dataset = Dataset(tenant_id="tenant-1", indexing_technique=IndexTechniqueType.HIGH_QUALITY)
    documents = [Document(page_content="first", metadata={}), Document(page_content="x" * (1024 * 1024), metadata={})]

    with patch("core.rag.embedding.token_counter.ModelManager.for_tenant") as factory:
        model = factory.return_value.get_model_instance.return_value
        model.get_model_schema.return_value.model_properties = {ModelPropertyKey.MAX_CHUNKS: 100}
        with pytest.raises(ValueError, match="Text.*reduce.*chunk size"):
            calculate_segment_token_counts(dataset, documents)

    model.get_text_embedding_num_tokens.assert_not_called()
