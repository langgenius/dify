import importlib
import json
import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from core.rag.models.document import Document


def _build_fake_hologres_modules():
    holo_module = types.ModuleType("holo_search_sdk")
    holo_types_module = types.ModuleType("holo_search_sdk.types")

    holo_types_module.BaseQuantizationType = str
    holo_types_module.DistanceType = str
    holo_types_module.TokenizerType = str

    def _connect(**kwargs):
        client = MagicMock()
        client.kwargs = kwargs
        client.connect = MagicMock()
        client.check_table_exist = MagicMock(return_value=False)
        client.open_table = MagicMock(return_value=MagicMock())
        client.execute = MagicMock(return_value=[])
        client.drop_table = MagicMock()
        return client

    holo_module.connect = MagicMock(side_effect=_connect)

    return {
        "holo_search_sdk": holo_module,
        "holo_search_sdk.types": holo_types_module,
    }


@pytest.fixture
def hologres_module(monkeypatch):
    for name, module in _build_fake_hologres_modules().items():
        monkeypatch.setitem(sys.modules, name, module)

    import core.rag.datasource.vdb.hologres.hologres_vector as module

    return importlib.reload(module)


def _valid_config(module):
    return module.HologresVectorConfig(
        host="localhost",
        port=80,
        database="dify",
        access_key_id="ak",
        access_key_secret="sk",
        schema_name="public",
        tokenizer="jieba",
        distance_method="Cosine",
        base_quantization_type="rabitq",
        max_degree=64,
        ef_construction=400,
    )


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("host", "", "config HOLOGRES_HOST is required"),
        ("database", "", "config HOLOGRES_DATABASE is required"),
        ("access_key_id", "", "config HOLOGRES_ACCESS_KEY_ID is required"),
        ("access_key_secret", "", "config HOLOGRES_ACCESS_KEY_SECRET is required"),
    ],
)
def test_hologres_config_validation(hologres_module, field, value, message):
    values = _valid_config(hologres_module).model_dump()
    values[field] = value

    with pytest.raises(ValidationError, match=message):
        hologres_module.HologresVectorConfig.model_validate(values)


def test_init_client_and_get_type(hologres_module):
    vector = hologres_module.HologresVector("Collection_One", _valid_config(hologres_module))

    hologres_module.holo.connect.assert_called_once_with(
        host="localhost",
        port=80,
        database="dify",
        access_key_id="ak",
        access_key_secret="sk",
        schema="public",
    )
    vector._client.connect.assert_called_once()
    assert vector.table_name == "embedding_collection_one"
    assert vector.get_type() == hologres_module.VectorType.HOLOGRES


def test_create_delegates_collection_creation_and_upsert(hologres_module):
    vector = hologres_module.HologresVector("collection_one", _valid_config(hologres_module))
    vector._create_collection = MagicMock()
    vector.add_texts = MagicMock()
    docs = [Document(page_content="hello", metadata={"doc_id": "seg-1"})]

    result = vector.create(docs, [[0.1, 0.2]])

    assert result is None
    vector._create_collection.assert_called_once_with(2)
    vector.add_texts.assert_called_once_with(docs, [[0.1, 0.2]])


def test_add_texts_returns_empty_for_empty_documents(hologres_module):
    vector = hologres_module.HologresVector("collection_one", _valid_config(hologres_module))

    assert vector.add_texts([], []) == []
    vector._client.open_table.assert_not_called()


def test_add_texts_batches_and_serializes_metadata(hologres_module):
    vector = hologres_module.HologresVector("collection_one", _valid_config(hologres_module))
    table = vector._client.open_table.return_value
    documents = [
        Document(page_content=f"doc-{i}", metadata={"doc_id": f"id-{i}", "document_id": f"document-{i}"})
        for i in range(100)
    ]
    documents.append(SimpleNamespace(page_content="doc-100", metadata=None))
    embeddings = [[float(i)] for i in range(len(documents))]

    ids = vector.add_texts(documents, embeddings)

    assert ids[:2] == ["id-0", "id-1"]
    assert ids[-1] == ""
    assert len(ids) == 101
    assert vector._client.open_table.call_count == 2
    assert table.upsert_multi.call_count == 2
    first_call = table.upsert_multi.call_args_list[0].kwargs
    second_call = table.upsert_multi.call_args_list[1].kwargs
    assert first_call["index_column"] == "id"
    assert first_call["column_names"] == ["id", "text", "meta", "embedding"]
    assert first_call["update_columns"] == ["text", "meta", "embedding"]
    assert len(first_call["values"]) == 100
    assert json.loads(first_call["values"][0][2]) == {"doc_id": "id-0", "document_id": "document-0"}
    assert second_call["values"][0][0] == ""
    assert second_call["values"][0][2] == "{}"


def test_text_exists_handles_missing_and_present_tables(hologres_module):
    vector = hologres_module.HologresVector("collection_one", _valid_config(hologres_module))
    vector._client.check_table_exist.side_effect = [False, True]
    vector._client.execute.return_value = [(1,)]

    assert vector.text_exists("seg-1") is False
    assert vector.text_exists("seg-1") is True
    vector._client.execute.assert_called_once()


def test_get_ids_by_metadata_field_returns_ids_or_none(hologres_module):
    vector = hologres_module.HologresVector("collection_one", _valid_config(hologres_module))
    vector._client.execute.side_effect = [[("id-1",), ("id-2",)], []]

    assert vector.get_ids_by_metadata_field("document_id", "doc-1") == ["id-1", "id-2"]
    assert vector.get_ids_by_metadata_field("document_id", "doc-1") is None


def test_delete_by_ids_branches(hologres_module):
    vector = hologres_module.HologresVector("collection_one", _valid_config(hologres_module))

    vector.delete_by_ids([])
    vector._client.check_table_exist.assert_not_called()

    vector._client.check_table_exist.return_value = False
    vector.delete_by_ids(["id-1"])
    vector._client.execute.assert_not_called()

    vector._client.check_table_exist.return_value = True
    vector.delete_by_ids(["id-1", "id-2"])
    vector._client.execute.assert_called_once()


def test_delete_by_metadata_field_branches(hologres_module):
    vector = hologres_module.HologresVector("collection_one", _valid_config(hologres_module))
    vector._client.check_table_exist.return_value = False

    vector.delete_by_metadata_field("document_id", "doc-1")
    vector._client.execute.assert_not_called()

    vector._client.check_table_exist.return_value = True
    vector.delete_by_metadata_field("document_id", "doc-1")
    vector._client.execute.assert_called_once()


def test_search_by_vector_returns_empty_when_table_missing(hologres_module):
    vector = hologres_module.HologresVector("collection_one", _valid_config(hologres_module))
    vector._client.check_table_exist.return_value = False

    assert vector.search_by_vector([0.1, 0.2]) == []


def test_search_by_vector_applies_filter_and_processes_results(hologres_module):
    vector = hologres_module.HologresVector("collection_one", _valid_config(hologres_module))
    vector._client.check_table_exist.return_value = True
    table = vector._client.open_table.return_value
    query = MagicMock()
    table.search_vector.return_value = query
    query.select.return_value = query
    query.limit.return_value = query
    query.where.return_value = query
    query.fetchall.return_value = [
        (0.2, "seg-1", "doc-1", '{"doc_id":"seg-1","document_id":"doc-1"}'),
        (0.9, "seg-2", "doc-2", {"doc_id": "seg-2", "document_id": "doc-2"}),
    ]

    docs = vector.search_by_vector(
        [0.1, 0.2],
        top_k=2,
        score_threshold=0.5,
        document_ids_filter=["doc-1"],
    )

    assert len(docs) == 1
    assert docs[0].page_content == "doc-1"
    assert docs[0].metadata["doc_id"] == "seg-1"
    assert docs[0].metadata["score"] == pytest.approx(0.8)
    table.search_vector.assert_called_once()
    query.where.assert_called_once()


def test_search_by_full_text_returns_empty_when_table_missing(hologres_module):
    vector = hologres_module.HologresVector("collection_one", _valid_config(hologres_module))
    vector._client.check_table_exist.return_value = False

    assert vector.search_by_full_text("query") == []


def test_search_by_full_text_applies_filter_and_processes_results(hologres_module):
    vector = hologres_module.HologresVector("collection_one", _valid_config(hologres_module))
    vector._client.check_table_exist.return_value = True
    table = vector._client.open_table.return_value
    search_query = MagicMock()
    table.search_text.return_value = search_query
    search_query.limit.return_value = search_query
    search_query.where.return_value = search_query
    search_query.fetchall.return_value = [
        ("seg-1", "doc-1", '{"doc_id":"seg-1"}', [0.1], 0.95),
        ("seg-2", "doc-2", {"doc_id": "seg-2"}, [0.2], 0.7),
    ]

    docs = vector.search_by_full_text("query", top_k=2, document_ids_filter=["doc-1"])

    assert len(docs) == 2
    assert docs[0].metadata["doc_id"] == "seg-1"
    assert docs[0].metadata["score"] == pytest.approx(0.95)
    assert docs[1].metadata["score"] == pytest.approx(0.7)
    table.search_text.assert_called_once()
    search_query.where.assert_called_once()


def test_delete_handles_existing_and_missing_tables(hologres_module):
    vector = hologres_module.HologresVector("collection_one", _valid_config(hologres_module))
    vector._client.check_table_exist.side_effect = [False, True]

    vector.delete()
    vector._client.drop_table.assert_not_called()

    vector.delete()
    vector._client.drop_table.assert_called_once_with(vector.table_name)


def test_create_collection_returns_early_when_cache_hits(hologres_module, monkeypatch):
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = False
    monkeypatch.setattr(hologres_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(hologres_module.redis_client, "get", MagicMock(return_value=1))
    monkeypatch.setattr(hologres_module.redis_client, "set", MagicMock())

    vector = hologres_module.HologresVector("collection_one", _valid_config(hologres_module))
    vector._create_collection(3)

    vector._client.check_table_exist.assert_not_called()
    hologres_module.redis_client.set.assert_not_called()


def test_create_collection_creates_table_and_indexes(hologres_module, monkeypatch):
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = False
    monkeypatch.setattr(hologres_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(hologres_module.redis_client, "get", MagicMock(return_value=None))
    monkeypatch.setattr(hologres_module.redis_client, "set", MagicMock())
    monkeypatch.setattr(hologres_module.time, "sleep", MagicMock())

    vector = hologres_module.HologresVector("collection_one", _valid_config(hologres_module))
    vector._client.check_table_exist.side_effect = [False, False, True]
    table = vector._client.open_table.return_value

    vector._create_collection(3)

    vector._client.execute.assert_called_once()
    table.set_vector_index.assert_called_once_with(
        column="embedding",
        distance_method="Cosine",
        base_quantization_type="rabitq",
        max_degree=64,
        ef_construction=400,
        use_reorder=True,
    )
    table.create_text_index.assert_called_once_with(
        index_name="ft_idx_collection_one",
        column="text",
        tokenizer="jieba",
    )
    hologres_module.redis_client.set.assert_called_once()


def test_create_collection_raises_when_table_never_becomes_ready(hologres_module, monkeypatch):
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = False
    monkeypatch.setattr(hologres_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(hologres_module.redis_client, "get", MagicMock(return_value=None))
    monkeypatch.setattr(hologres_module.redis_client, "set", MagicMock())
    monkeypatch.setattr(hologres_module.time, "sleep", MagicMock())

    vector = hologres_module.HologresVector("collection_one", _valid_config(hologres_module))
    vector._client.check_table_exist.side_effect = [False] + [False] * 15

    with pytest.raises(RuntimeError, match="was not ready after 30s"):
        vector._create_collection(3)

    hologres_module.redis_client.set.assert_not_called()


def test_hologres_factory_uses_existing_or_generated_collection(hologres_module, monkeypatch):
    factory = hologres_module.HologresVectorFactory()
    dataset_with_index = SimpleNamespace(
        id="dataset-1",
        index_struct_dict={"vector_store": {"class_prefix": "existing_collection"}},
        index_struct=None,
    )
    dataset_without_index = SimpleNamespace(id="dataset-2", index_struct_dict=None, index_struct=None)

    monkeypatch.setattr(hologres_module.Dataset, "gen_collection_name_by_id", lambda _id: "generated_collection")
    monkeypatch.setattr(hologres_module.dify_config, "HOLOGRES_HOST", "127.0.0.1")
    monkeypatch.setattr(hologres_module.dify_config, "HOLOGRES_PORT", 80)
    monkeypatch.setattr(hologres_module.dify_config, "HOLOGRES_DATABASE", "dify")
    monkeypatch.setattr(hologres_module.dify_config, "HOLOGRES_ACCESS_KEY_ID", "ak")
    monkeypatch.setattr(hologres_module.dify_config, "HOLOGRES_ACCESS_KEY_SECRET", "sk")
    monkeypatch.setattr(hologres_module.dify_config, "HOLOGRES_SCHEMA", "public")
    monkeypatch.setattr(hologres_module.dify_config, "HOLOGRES_TOKENIZER", "jieba")
    monkeypatch.setattr(hologres_module.dify_config, "HOLOGRES_DISTANCE_METHOD", "Cosine")
    monkeypatch.setattr(hologres_module.dify_config, "HOLOGRES_BASE_QUANTIZATION_TYPE", "rabitq")
    monkeypatch.setattr(hologres_module.dify_config, "HOLOGRES_MAX_DEGREE", 64)
    monkeypatch.setattr(hologres_module.dify_config, "HOLOGRES_EF_CONSTRUCTION", 400)

    with patch.object(hologres_module, "HologresVector", return_value="vector") as vector_cls:
        result_1 = factory.init_vector(dataset_with_index, attributes=[], embeddings=MagicMock())
        result_2 = factory.init_vector(dataset_without_index, attributes=[], embeddings=MagicMock())

    assert result_1 == "vector"
    assert result_2 == "vector"
    assert vector_cls.call_args_list[0].kwargs["collection_name"] == "existing_collection"
    assert vector_cls.call_args_list[1].kwargs["collection_name"] == "generated_collection"
    generated_config = vector_cls.call_args_list[1].kwargs["config"]
    assert generated_config.host == "127.0.0.1"
    assert generated_config.database == "dify"
    assert generated_config.access_key_id == "ak"
    assert json.loads(dataset_without_index.index_struct) == {
        "type": hologres_module.VectorType.HOLOGRES,
        "vector_store": {"class_prefix": "generated_collection"},
    }
