import importlib
import json
import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from core.rag.models.document import Document


def _build_fake_tablestore_module():
    tablestore = types.ModuleType("tablestore")

    class _BatchGetRowRequest:
        def __init__(self):
            self.items = []

        def add(self, item):
            self.items.append(item)

    class _TableInBatchGetRowItem:
        def __init__(self, table_name, rows_to_get, columns_to_get, _unused, _ver):
            self.table_name = table_name
            self.rows_to_get = rows_to_get
            self.columns_to_get = columns_to_get

    class _Row:
        def __init__(self, primary_key, attribute_columns=None):
            self.primary_key = primary_key
            self.attribute_columns = attribute_columns or []

    class _Client:
        def __init__(self, *_args):
            self.list_table = MagicMock(return_value=[])
            self.create_table = MagicMock()
            self.list_search_index = MagicMock(return_value=[])
            self.create_search_index = MagicMock()
            self.delete_search_index = MagicMock()
            self.delete_table = MagicMock()
            self.put_row = MagicMock()
            self.delete_row = MagicMock()
            self.get_row = MagicMock(return_value=(None, None, None))
            self.batch_get_row = MagicMock()
            self.search = MagicMock()

    tablestore.OTSClient = _Client
    tablestore.BatchGetRowRequest = _BatchGetRowRequest
    tablestore.TableInBatchGetRowItem = _TableInBatchGetRowItem
    tablestore.Row = _Row
    tablestore.TableMeta = lambda name, schema: ("table_meta", name, schema)
    tablestore.TableOptions = lambda: ("table_options",)
    tablestore.CapacityUnit = lambda read, write: ("capacity", read, write)
    tablestore.ReservedThroughput = lambda cap: ("reserved", cap)
    tablestore.FieldSchema = lambda *args, **kwargs: ("field", args, kwargs)
    tablestore.VectorOptions = lambda **kwargs: ("vector_options", kwargs)
    tablestore.SearchIndexMeta = lambda field_schemas: ("search_index_meta", field_schemas)
    tablestore.SearchQuery = lambda query, **kwargs: SimpleNamespace(query=query, **kwargs)
    tablestore.TermQuery = lambda key, value: ("term_query", key, value)
    tablestore.ColumnsToGet = lambda **kwargs: ("columns_to_get", kwargs)
    tablestore.KnnVectorQuery = lambda **kwargs: SimpleNamespace(**kwargs)
    tablestore.TermsQuery = lambda key, values: ("terms_query", key, values)
    tablestore.Sort = lambda **kwargs: ("sort", kwargs)
    tablestore.ScoreSort = lambda **kwargs: ("score_sort", kwargs)
    tablestore.BoolQuery = lambda **kwargs: SimpleNamespace(**kwargs)
    tablestore.MatchQuery = lambda **kwargs: ("match_query", kwargs)

    tablestore.FieldType = SimpleNamespace(TEXT="TEXT", VECTOR="VECTOR", KEYWORD="KEYWORD")
    tablestore.AnalyzerType = SimpleNamespace(MAXWORD="MAXWORD")
    tablestore.VectorDataType = SimpleNamespace(VD_FLOAT_32="VD_FLOAT_32")
    tablestore.VectorMetricType = SimpleNamespace(VM_COSINE="VM_COSINE")
    tablestore.ColumnReturnType = SimpleNamespace(SPECIFIED="SPECIFIED", ALL_FROM_INDEX="ALL_FROM_INDEX")
    tablestore.SortOrder = SimpleNamespace(DESC="DESC")
    return tablestore


@pytest.fixture
def tablestore_module(monkeypatch):
    fake_module = _build_fake_tablestore_module()
    monkeypatch.setitem(sys.modules, "tablestore", fake_module)

    import core.rag.datasource.vdb.tablestore.tablestore_vector as module

    return importlib.reload(module)


def _config(module, **overrides):
    values = {
        "access_key_id": "ak",
        "access_key_secret": "sk",
        "instance_name": "instance",
        "endpoint": "endpoint",
        "normalize_full_text_bm25_score": False,
    }
    values.update(overrides)
    return module.TableStoreConfig.model_validate(values)


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("access_key_id", "", "config ACCESS_KEY_ID is required"),
        ("access_key_secret", "", "config ACCESS_KEY_SECRET is required"),
        ("instance_name", "", "config INSTANCE_NAME is required"),
        ("endpoint", "", "config ENDPOINT is required"),
    ],
)
def test_tablestore_config_validation(tablestore_module, field, value, message):
    values = _config(tablestore_module).model_dump()
    values[field] = value
    with pytest.raises(ValidationError, match=message):
        tablestore_module.TableStoreConfig.model_validate(values)


def test_init_and_basic_delegation(tablestore_module):
    vector = tablestore_module.TableStoreVector("collection_1", _config(tablestore_module))
    assert vector.get_type() == tablestore_module.VectorType.TABLESTORE
    assert vector._table_name == "collection_1"
    assert vector._index_name == "collection_1_idx"

    vector._create_collection = MagicMock()
    vector.add_texts = MagicMock()
    docs = [Document(page_content="hello", metadata={"doc_id": "d-1"})]
    vector.create(docs, [[0.1, 0.2]])
    vector._create_collection.assert_called_once_with(2)
    vector.add_texts.assert_called_once_with(documents=docs, embeddings=[[0.1, 0.2]])

    vector.create_collection([[0.1, 0.2]])
    assert vector._create_collection.call_count == 2


def test_get_by_ids_text_exists_delete_and_wrappers(tablestore_module):
    vector = tablestore_module.TableStoreVector("collection_1", _config(tablestore_module))

    # get_by_ids
    ok_item = SimpleNamespace(
        is_ok=True,
        row=SimpleNamespace(
            attribute_columns=[("metadata", json.dumps({"doc_id": "1"}), None), ("page_content", "text-1", None)]
        ),
    )
    fail_item = SimpleNamespace(is_ok=False, row=None)
    batch_resp = SimpleNamespace(get_result_by_table=lambda _table: [ok_item, fail_item])
    vector._tablestore_client.batch_get_row.return_value = batch_resp
    docs = vector.get_by_ids(["id-1"])
    assert len(docs) == 1
    assert docs[0].page_content == "text-1"

    # text_exists
    vector._tablestore_client.get_row.return_value = (None, object(), None)
    assert vector.text_exists("id-1") is True
    vector._tablestore_client.get_row.return_value = (None, None, None)
    assert vector.text_exists("id-1") is False

    # delete wrappers
    vector._delete_row = MagicMock()
    vector.delete_by_ids([])
    vector._delete_row.assert_not_called()
    vector.delete_by_ids(["id-1", "id-2"])
    assert vector._delete_row.call_count == 2

    vector._search_by_metadata = MagicMock(return_value=["id-a"])
    assert vector.get_ids_by_metadata_field("document_id", "doc-1") == ["id-a"]
    vector.delete_by_ids = MagicMock()
    vector.delete_by_metadata_field("document_id", "doc-1")
    vector.delete_by_ids.assert_called_once_with(["id-a"])

    vector._search_by_vector = MagicMock(return_value=["vec-doc"])
    vector._search_by_full_text = MagicMock(return_value=["fts-doc"])
    assert vector.search_by_vector([0.1], top_k=2, score_threshold=0.5, document_ids_filter=["d-1"]) == ["vec-doc"]
    assert vector.search_by_full_text("query", top_k=2, score_threshold=0.3, document_ids_filter=["d-1"]) == ["fts-doc"]

    vector._delete_table_if_exist = MagicMock()
    vector.delete()
    vector._delete_table_if_exist.assert_called_once()


def test_create_collection_and_table_index_lifecycle(tablestore_module, monkeypatch):
    vector = tablestore_module.TableStoreVector("collection_1", _config(tablestore_module))
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(tablestore_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(tablestore_module.redis_client, "set", MagicMock())

    monkeypatch.setattr(tablestore_module.redis_client, "get", MagicMock(return_value=1))
    vector._create_table_if_not_exist = MagicMock()
    vector._create_search_index_if_not_exist = MagicMock()
    vector._create_collection(3)
    vector._create_table_if_not_exist.assert_not_called()

    monkeypatch.setattr(tablestore_module.redis_client, "get", MagicMock(return_value=None))
    vector._create_collection(3)
    vector._create_table_if_not_exist.assert_called_once()
    vector._create_search_index_if_not_exist.assert_called_once_with(3)
    tablestore_module.redis_client.set.assert_called_once()

    vector = tablestore_module.TableStoreVector("collection_2", _config(tablestore_module))
    vector._tablestore_client.list_table.return_value = ["collection_2"]
    assert vector._create_table_if_not_exist() is None
    vector._tablestore_client.list_table.return_value = []
    vector._create_table_if_not_exist()
    vector._tablestore_client.create_table.assert_called_once()

    vector._tablestore_client.list_search_index.return_value = [("collection_2", "collection_2_idx")]
    assert vector._create_search_index_if_not_exist(3) is None
    vector._tablestore_client.list_search_index.return_value = []
    vector._create_search_index_if_not_exist(3)
    vector._tablestore_client.create_search_index.assert_called_once()

    vector._tablestore_client.list_search_index.return_value = [("collection_2", "idx_a"), ("collection_2", "idx_b")]
    vector._delete_table_if_exist()
    assert vector._tablestore_client.delete_search_index.call_count == 2
    vector._tablestore_client.delete_table.assert_called_once_with("collection_2")

    vector._delete_search_index()
    vector._tablestore_client.delete_search_index.assert_called_with("collection_2", "collection_2_idx")


def test_write_row_and_search_helpers(tablestore_module):
    vector = tablestore_module.TableStoreVector("collection_1", _config(tablestore_module))

    vector._write_row(
        "id-1",
        {
            "page_content": "hello",
            "vector": [0.1, 0.2],
            "metadata": {"doc_id": "d-1", "document_id": "doc-1"},
        },
    )
    put_row_call = vector._tablestore_client.put_row.call_args
    assert put_row_call.args[0] == "collection_1"
    attrs = put_row_call.args[1].attribute_columns
    assert any(item[0] == "metadata_tags" for item in attrs)

    vector._delete_row("id-1")
    vector._tablestore_client.delete_row.assert_called_once()

    # metadata search pagination
    first_page = SimpleNamespace(rows=[[(("id", "row-1"),)]], next_token=b"next")
    second_page = SimpleNamespace(rows=[[(("id", "row-2"),)]], next_token=b"")
    vector._tablestore_client.search.side_effect = [first_page, second_page]
    ids = vector._search_by_metadata("document_id", "doc-1")
    assert ids == ["row-1", "row-2"]
    vector._tablestore_client.search.side_effect = None

    # vector search
    hit1 = SimpleNamespace(
        score=0.9,
        row=(
            None,
            [("page_content", "doc-a"), ("metadata", json.dumps({"doc_id": "1"})), ("vector", json.dumps([0.1]))],
        ),
    )
    hit2 = SimpleNamespace(
        score=0.2,
        row=(
            None,
            [("page_content", "doc-b"), ("metadata", json.dumps({"doc_id": "2"})), ("vector", json.dumps([0.2]))],
        ),
    )
    vector._tablestore_client.search.return_value = SimpleNamespace(search_hits=[hit1, hit2])
    docs = vector._search_by_vector([0.1], document_ids_filter=["document_id=doc-1"], top_k=2, score_threshold=0.5)
    assert len(docs) == 1
    assert docs[0].metadata["score"] == pytest.approx(0.9)

    assert tablestore_module.TableStoreVector._normalize_score_exp_decay(0) == pytest.approx(0.0)
    assert tablestore_module.TableStoreVector._normalize_score_exp_decay(100) <= 1.0

    # full text search with and without normalized score filter
    vector._normalize_full_text_bm25_score = True
    hit3 = SimpleNamespace(
        score=10.0, row=(None, [("page_content", "doc-c"), ("metadata", json.dumps({"doc_id": "3"}))])
    )
    hit4 = SimpleNamespace(
        score=0.1, row=(None, [("page_content", "doc-d"), ("metadata", json.dumps({"doc_id": "4"}))])
    )
    vector._tablestore_client.search.return_value = SimpleNamespace(search_hits=[hit3, hit4])
    docs = vector._search_by_full_text("query", document_ids_filter=["document_id=doc-1"], top_k=2, score_threshold=0.2)
    assert len(docs) == 1
    assert "score" in docs[0].metadata

    vector._normalize_full_text_bm25_score = False
    vector._tablestore_client.search.return_value = SimpleNamespace(search_hits=[hit3])
    docs = vector._search_by_full_text("query", document_ids_filter=None, top_k=2, score_threshold=0.0)
    assert len(docs) == 1
    assert "score" not in docs[0].metadata


def test_tablestore_factory_uses_existing_or_generated_collection(tablestore_module, monkeypatch):
    factory = tablestore_module.TableStoreVectorFactory()
    dataset_with_index = SimpleNamespace(
        id="dataset-1",
        index_struct_dict={"vector_store": {"class_prefix": "EXISTING_COLLECTION"}},
        index_struct=None,
    )
    dataset_without_index = SimpleNamespace(id="dataset-2", index_struct_dict=None, index_struct=None)

    monkeypatch.setattr(tablestore_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")
    monkeypatch.setattr(tablestore_module.dify_config, "TABLESTORE_ENDPOINT", "endpoint")
    monkeypatch.setattr(tablestore_module.dify_config, "TABLESTORE_INSTANCE_NAME", "instance")
    monkeypatch.setattr(tablestore_module.dify_config, "TABLESTORE_ACCESS_KEY_ID", "ak")
    monkeypatch.setattr(tablestore_module.dify_config, "TABLESTORE_ACCESS_KEY_SECRET", "sk")
    monkeypatch.setattr(tablestore_module.dify_config, "TABLESTORE_NORMALIZE_FULLTEXT_BM25_SCORE", True)

    with patch.object(tablestore_module, "TableStoreVector", return_value="vector") as vector_cls:
        result_1 = factory.init_vector(dataset_with_index, attributes=[], embeddings=MagicMock())
        result_2 = factory.init_vector(dataset_without_index, attributes=[], embeddings=MagicMock())

    assert result_1 == "vector"
    assert result_2 == "vector"
    assert vector_cls.call_args_list[0].kwargs["collection_name"] == "EXISTING_COLLECTION"
    assert vector_cls.call_args_list[1].kwargs["collection_name"] == "AUTO_COLLECTION"
    assert dataset_without_index.index_struct is not None
