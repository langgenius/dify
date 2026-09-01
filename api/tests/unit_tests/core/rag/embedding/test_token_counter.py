
from core.rag.embedding.token_counter import calculate_segment_token_counts
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.models.document import Document
from graphon.model_runtime.entities.model_entities import ModelPropertyKey
from models.dataset import Dataset


class _FakeSchema:
    def __init__(self, max_chunks: int):
        self.model_properties = {ModelPropertyKey.MAX_CHUNKS: max_chunks}


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
        embedding_model.model_type_instance.get_model_schema.return_value = _FakeSchema(max_chunks=10)
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


@patch("core.rag.embedding.token_counter.ModelManager")
def test_calculate_segment_token_counts_batches_by_max_chunks(mock_model_manager_cls):
    dataset = Mock(spec=Dataset)
    dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
    dataset.tenant_id = "tenant-1"
    dataset.embedding_model_provider = "openai"
    dataset.embedding_model = "text-embedding-3-small"
    documents = [Document(page_content=f"chunk-{i}", metadata={}) for i in range(10)]

    embedding_model = MagicMock()
    embedding_model.model_type_instance.get_model_schema.return_value = _FakeSchema(max_chunks=3)
    embedding_model.get_text_embedding_num_tokens.side_effect = lambda texts: [1] * len(texts)

    mock_model_manager_cls.for_tenant.return_value.get_model_instance.return_value = embedding_model

    result = calculate_segment_token_counts(dataset=dataset, documents=documents)

    assert result == [1] * 10
    assert embedding_model.get_text_embedding_num_tokens.call_count == 4
    call_sizes = [len(call.args[0]) for call in embedding_model.get_text_embedding_num_tokens.call_args_list]
    assert call_sizes == [3, 3, 3, 1]


@patch("core.rag.embedding.token_counter.ModelManager")
def test_calculate_segment_token_counts_splits_by_byte_size(mock_model_manager_cls):
    dataset = Mock(spec=Dataset)
    dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
    dataset.tenant_id = "tenant-1"
    dataset.embedding_model_provider = "openai"
    dataset.embedding_model = "text-embedding-3-small"

    # max_chunks allows up to 100 per batch, but each text is ~700 KB,
    # so byte-size limit (1 MB) must force a split after just 1 text per batch.
    large_text = "x" * 700_000
    documents = [Document(page_content=large_text, metadata={}) for _ in range(3)]

    embedding_model = MagicMock()
    embedding_model.model_type_instance.get_model_schema.return_value = _FakeSchema(max_chunks=100)
    embedding_model.get_text_embedding_num_tokens.side_effect = lambda texts: [1] * len(texts)

    mock_model_manager_cls.for_tenant.return_value.get_model_instance.return_value = embedding_model

    result = calculate_segment_token_counts(dataset=dataset, documents=documents)

    assert result == [1, 1, 1]
    # Each ~700 KB text alone is close to the 1 MB cap, so two of them together
    # would exceed it - each batch must contain exactly one text.
    assert embedding_model.get_text_embedding_num_tokens.call_count == 3
    call_sizes = [len(call.args[0]) for call in embedding_model.get_text_embedding_num_tokens.call_args_list]
    assert call_sizes == [1, 1, 1]
