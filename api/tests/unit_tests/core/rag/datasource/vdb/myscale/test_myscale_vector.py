import importlib
import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from core.rag.models.document import Document


def _build_fake_clickhouse_connect_module():
    clickhouse_connect = types.ModuleType("clickhouse_connect")

    class QueryResult:
        def __init__(self, rows=None, named_rows=None):
            self.row_count = len(rows or [])
            self.result_rows = rows or []
            self._named_rows = named_rows or []

        def named_results(self):
            return self._named_rows

    class Client:
        def __init__(self):
            self.command = MagicMock()
            self.query = MagicMock(return_value=QueryResult())

    client = Client()

    def get_client(**_kwargs):
        return client

    clickhouse_connect.get_client = get_client
    clickhouse_connect.QueryResult = QueryResult
    clickhouse_connect._fake_client = client
    return clickhouse_connect


@pytest.fixture
def myscale_module(monkeypatch):
    fake_module = _build_fake_clickhouse_connect_module()
    monkeypatch.setitem(sys.modules, "clickhouse_connect", fake_module)

    import core.rag.datasource.vdb.myscale.myscale_vector as module

    return importlib.reload(module)


def _config(module):
    return module.MyScaleConfig(
        host="localhost",
        port=8123,
        user="default",
        password="",
        database="dify",
        fts_params="",
    )


def test_escape_str_replaces_backslash_and_quote(myscale_module):
    escaped = myscale_module.MyScaleVector.escape_str(r"text\with'special")
    assert escaped == "text with special"


def test_search_raises_for_invalid_top_k(myscale_module):
    vector = myscale_module.MyScaleVector("collection_1", _config(myscale_module))
    with pytest.raises(ValueError, match="top_k must be a positive integer"):
        vector._search("distance(vector, [0.1, 0.2])", myscale_module.SortOrder.ASC, top_k=0)


def test_search_builds_where_clause_for_cosine_threshold(myscale_module):
    vector = myscale_module.MyScaleVector("collection_1", _config(myscale_module))
    vector._client.query.return_value = myscale_module.get_client().query.return_value.__class__(
        named_rows=[{"text": "doc-1", "vector": [0.1, 0.2], "metadata": {"doc_id": "seg-1"}}]
    )

    docs = vector._search("distance(vector, [0.1, 0.2])", myscale_module.SortOrder.ASC, top_k=1, score_threshold=0.2)

    assert len(docs) == 1
    sql = vector._client.query.call_args.args[0]
    assert "WHERE dist < 0.8" in sql


def test_delete_by_ids_short_circuits_on_empty_list(myscale_module):
    vector = myscale_module.MyScaleVector("collection_1", _config(myscale_module))
    vector._client.command.reset_mock()

    vector.delete_by_ids([])
    vector._client.command.assert_not_called()


def test_factory_initializes_lower_case_collection_name(myscale_module, monkeypatch):
    factory = myscale_module.MyScaleVectorFactory()
    dataset_with_index = SimpleNamespace(
        id="dataset-1",
        index_struct_dict={"vector_store": {"class_prefix": "EXISTING_COLLECTION"}},
        index_struct=None,
    )
    dataset_without_index = SimpleNamespace(id="dataset-2", index_struct_dict=None, index_struct=None)

    monkeypatch.setattr(myscale_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")
    monkeypatch.setattr(myscale_module.dify_config, "MYSCALE_HOST", "localhost")
    monkeypatch.setattr(myscale_module.dify_config, "MYSCALE_PORT", 8123)
    monkeypatch.setattr(myscale_module.dify_config, "MYSCALE_USER", "default")
    monkeypatch.setattr(myscale_module.dify_config, "MYSCALE_PASSWORD", "")
    monkeypatch.setattr(myscale_module.dify_config, "MYSCALE_DATABASE", "dify")
    monkeypatch.setattr(myscale_module.dify_config, "MYSCALE_FTS_PARAMS", "")

    with patch.object(myscale_module, "MyScaleVector", return_value="vector") as vector_cls:
        result_1 = factory.init_vector(dataset_with_index, attributes=[], embeddings=MagicMock())
        result_2 = factory.init_vector(dataset_without_index, attributes=[], embeddings=MagicMock())

    assert result_1 == "vector"
    assert result_2 == "vector"
    assert vector_cls.call_args_list[0].kwargs["collection_name"] == "existing_collection"
    assert vector_cls.call_args_list[1].kwargs["collection_name"] == "auto_collection"
    assert dataset_without_index.index_struct is not None


def test_init_and_get_type_set_expected_defaults(myscale_module):
    vector = myscale_module.MyScaleVector("collection_1", _config(myscale_module))

    assert vector.get_type() == "myscale"
    assert vector._vec_order == myscale_module.SortOrder.ASC
    vector._client.command.assert_called_with("SET allow_experimental_object_type=1")


def test_create_calls_create_collection_and_add_texts(myscale_module):
    vector = myscale_module.MyScaleVector("collection_1", _config(myscale_module))
    vector._create_collection = MagicMock()
    vector.add_texts = MagicMock(return_value=["seg-1"])
    docs = [Document(page_content="hello", metadata={"doc_id": "seg-1"})]

    result = vector.create(docs, [[0.1, 0.2]])

    assert result == ["seg-1"]
    vector._create_collection.assert_called_once_with(2)
    vector.add_texts.assert_called_once()


def test_create_collection_builds_expected_sql(myscale_module):
    config = myscale_module.MyScaleConfig(
        host="localhost",
        port=8123,
        user="default",
        password="",
        database="dify",
        fts_params="tokenizer=unicode",
    )
    vector = myscale_module.MyScaleVector("collection_1", config)
    vector._client.command.reset_mock()

    vector._create_collection(3)

    assert vector._client.command.call_count == 2
    sql = vector._client.command.call_args_list[1].args[0]
    assert "CREATE TABLE IF NOT EXISTS dify.collection_1" in sql
    assert "CONSTRAINT cons_vec_len CHECK length(vector) = 3" in sql
    assert "INDEX text_idx text TYPE fts('tokenizer=unicode')" in sql


def test_add_texts_inserts_rows_and_returns_ids(myscale_module, monkeypatch):
    vector = myscale_module.MyScaleVector("collection_1", _config(myscale_module))
    monkeypatch.setattr(myscale_module.uuid, "uuid4", lambda: "generated-uuid")
    docs = [
        Document(page_content=r"te'xt\1", metadata={"doc_id": "doc-a", "document_id": "d-1"}),
        Document(page_content="text-2", metadata={"document_id": "d-2"}),
        SimpleNamespace(page_content="text-3", metadata=None),
    ]

    ids = vector.add_texts(docs, [[0.1], [0.2], [0.3]])

    assert ids == ["doc-a", "generated-uuid"]
    sql = vector._client.command.call_args.args[0]
    assert "INSERT INTO dify.collection_1" in sql
    assert "te xt 1" in sql


def test_text_exists_and_metadata_operations(myscale_module):
    vector = myscale_module.MyScaleVector("collection_1", _config(myscale_module))
    vector._client.query.return_value = SimpleNamespace(row_count=1, result_rows=[("id-1",), ("id-2",)])

    assert vector.text_exists("id-1") is True
    assert vector.get_ids_by_metadata_field("document_id", "doc-1") == ["id-1", "id-2"]

    vector.delete_by_ids(["id-1", "id-2"])
    vector.delete_by_metadata_field("document_id", "doc-1")
    assert vector._client.command.call_count >= 2


def test_search_delegation_methods(myscale_module):
    vector = myscale_module.MyScaleVector("collection_1", _config(myscale_module))
    vector._search = MagicMock(return_value=["result"])

    result_vector = vector.search_by_vector([0.1, 0.2], top_k=2)
    result_text = vector.search_by_full_text("hello", top_k=2)

    assert result_vector == ["result"]
    assert result_text == ["result"]
    assert vector._search.call_count == 2


def test_search_with_document_filter_and_exception(myscale_module):
    vector = myscale_module.MyScaleVector("collection_1", _config(myscale_module))
    vector._client.query.return_value = SimpleNamespace(
        named_results=lambda: [{"text": "doc", "vector": [0.1], "metadata": {"doc_id": "1"}}]
    )

    docs = vector._search(
        "distance(vector, [0.1])",
        myscale_module.SortOrder.ASC,
        top_k=2,
        document_ids_filter=["doc-1", "doc-2"],
    )
    assert len(docs) == 1
    sql = vector._client.query.call_args.args[0]
    assert "metadata['document_id'] in ('doc-1', 'doc-2')" in sql

    vector._client.query.side_effect = RuntimeError("boom")
    assert vector._search("distance(vector, [0.1])", myscale_module.SortOrder.ASC, top_k=1) == []


def test_delete_drops_table(myscale_module):
    vector = myscale_module.MyScaleVector("collection_1", _config(myscale_module))
    vector._client.command.reset_mock()

    vector.delete()

    vector._client.command.assert_called_once_with("DROP TABLE IF EXISTS dify.collection_1")
