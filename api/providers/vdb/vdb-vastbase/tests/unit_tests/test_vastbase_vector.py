import hashlib
import importlib
import json
import sys
import types
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from core.rag.models.document import Document
from models.dataset import Dataset


def _build_fake_psycopg2_modules():
    psycopg2 = types.ModuleType("psycopg2")
    psycopg2.__path__ = []
    psycopg2_extras = types.ModuleType("psycopg2.extras")
    psycopg2_pool = types.ModuleType("psycopg2.pool")
    psycopg2_errors = types.ModuleType("psycopg2.errors")

    class SimpleConnectionPool:
        def __init__[**P](self, *args: P.args, **kwargs: P.kwargs):
            self.args = args
            self.kwargs = kwargs
            self.getconn = MagicMock()
            self.putconn = MagicMock()

    class UndefinedTableError(Exception):
        pass

    psycopg2_pool.SimpleConnectionPool = SimpleConnectionPool
    psycopg2_extras.execute_values = MagicMock()
    psycopg2_errors.UndefinedTable = UndefinedTableError

    psycopg2.pool = psycopg2_pool
    psycopg2.extras = psycopg2_extras
    psycopg2.errors = psycopg2_errors
    return {
        "psycopg2": psycopg2,
        "psycopg2.pool": psycopg2_pool,
        "psycopg2.extras": psycopg2_extras,
        "psycopg2.errors": psycopg2_errors,
    }


@pytest.fixture
def vastbase_module(monkeypatch: pytest.MonkeyPatch):
    for name, module in _build_fake_psycopg2_modules().items():
        monkeypatch.setitem(sys.modules, name, module)

    import dify_vdb_vastbase.vastbase_vector as module

    return importlib.reload(module)


def _config(module):
    return module.VastbaseVectorConfig(
        host="localhost",
        port=5432,
        user="dify",
        password="secret",
        database="dify",
        min_connection=1,
        max_connection=5,
    )


def _cursor_ctx(cursor):
    @contextmanager
    def _ctx():
        yield cursor

    return _ctx


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("host", "", "config VASTBASE_HOST is required"),
        ("port", 0, "config VASTBASE_PORT is required"),
        ("user", "", "config VASTBASE_USER is required"),
        ("password", "", "config VASTBASE_PASSWORD is required"),
        ("database", "", "config VASTBASE_DATABASE is required"),
        ("min_connection", 0, "config VASTBASE_MIN_CONNECTION is required"),
        ("max_connection", 0, "config VASTBASE_MAX_CONNECTION is required"),
    ],
)
def test_vastbase_config_validation(vastbase_module, field, value, message):
    values = _config(vastbase_module).model_dump()
    values[field] = value

    with pytest.raises(ValidationError, match=message):
        vastbase_module.VastbaseVectorConfig.model_validate(values)


def test_vastbase_config_rejects_invalid_connection_window(vastbase_module):
    with pytest.raises(ValidationError, match="VASTBASE_MIN_CONNECTION should less than VASTBASE_MAX_CONNECTION"):
        vastbase_module.VastbaseVectorConfig.model_validate(
            {
                "host": "localhost",
                "port": 5432,
                "user": "dify",
                "password": "secret",
                "database": "dify",
                "min_connection": 6,
                "max_connection": 5,
            }
        )


def test_init_sets_table_name_index_hash_and_type(vastbase_module, monkeypatch: pytest.MonkeyPatch):
    pool = MagicMock()
    monkeypatch.setattr(vastbase_module.psycopg2.pool, "SimpleConnectionPool", MagicMock(return_value=pool))

    vector = vastbase_module.VastbaseVector("collection_1", _config(vastbase_module))

    assert vector.table_name == "embedding_collection_1"
    assert vector.get_type() == "vastbase"
    assert vector.pool is pool
    assert vector.index_hash == hashlib.md5(b"embedding_collection_1").hexdigest()[:8]


def test_get_cursor_closes_commits_and_returns_connection(vastbase_module):
    vector = vastbase_module.VastbaseVector.__new__(vastbase_module.VastbaseVector)
    pool = MagicMock()
    conn = MagicMock()
    cur = MagicMock()
    pool.getconn.return_value = conn
    conn.cursor.return_value = cur
    vector.pool = pool

    with vector._get_cursor() as got_cur:
        assert got_cur is cur

    cur.close.assert_called_once()
    conn.commit.assert_called_once()
    pool.putconn.assert_called_once_with(conn)


def test_create_calls_collection_insert_and_index(vastbase_module):
    vector = vastbase_module.VastbaseVector.__new__(vastbase_module.VastbaseVector)
    vector._create_collection = MagicMock()
    vector.add_texts = MagicMock(return_value=["seg-1"])
    vector._create_index = MagicMock()
    docs = [Document(page_content="text", metadata={"doc_id": "seg-1"})]

    result = vector.create(docs, [[0.1, 0.2]])

    vector._create_collection.assert_called_once_with(2)
    vector.add_texts.assert_called_once_with(docs, [[0.1, 0.2]])
    vector._create_index.assert_called_once_with(2)
    assert result == ["seg-1"]


def test_add_texts_uses_execute_values(vastbase_module, monkeypatch: pytest.MonkeyPatch):
    pool = MagicMock()
    monkeypatch.setattr(vastbase_module.psycopg2.pool, "SimpleConnectionPool", MagicMock(return_value=pool))
    vector = vastbase_module.VastbaseVector("collection_1", _config(vastbase_module))
    cursor = MagicMock()
    vastbase_module.psycopg2.extras.execute_values.reset_mock()
    vector._get_cursor = _cursor_ctx(cursor)

    docs = [
        Document(page_content="text-1", metadata={"doc_id": "seg-1", "document_id": "d-1"}),
        SimpleNamespace(page_content="text-2", metadata=None),
    ]
    monkeypatch.setattr(vastbase_module.uuid, "uuid4", lambda: "generated-uuid")

    ids = vector.add_texts(docs, [[0.1], [0.2]])

    assert ids == ["seg-1"]
    vastbase_module.psycopg2.extras.execute_values.assert_called_once()


def test_text_exists_and_get_by_ids(vastbase_module):
    vector = vastbase_module.VastbaseVector.__new__(vastbase_module.VastbaseVector)
    vector.table_name = "embedding_collection_1"
    cursor = MagicMock()
    cursor.fetchone.return_value = ("seg-1",)
    cursor.__iter__.return_value = iter([({"doc_id": "1"}, "text-1"), ({"doc_id": "2"}, "text-2")])
    vector._get_cursor = _cursor_ctx(cursor)

    assert vector.text_exists("seg-1") is True
    docs = vector.get_by_ids(["seg-1", "seg-2"])
    assert len(docs) == 2
    assert docs[0].page_content == "text-1"


def test_delete_and_metadata_field_queries(vastbase_module):
    vector = vastbase_module.VastbaseVector.__new__(vastbase_module.VastbaseVector)
    vector.table_name = "embedding_collection_1"
    cursor = MagicMock()
    vector._get_cursor = _cursor_ctx(cursor)

    vector.delete_by_ids(["seg-1", "seg-2"])
    vector.delete_by_metadata_field("document_id", "doc-1")
    vector.delete()

    sql = [call.args[0] for call in cursor.execute.call_args_list]
    assert any("DELETE FROM embedding_collection_1 WHERE id IN %s" in query for query in sql)
    assert any("meta->>%s = %s" in query for query in sql)
    assert any("DROP TABLE IF EXISTS embedding_collection_1" in query for query in sql)


def test_delete_by_ids_short_circuits_with_empty_input(vastbase_module):
    vector = vastbase_module.VastbaseVector.__new__(vastbase_module.VastbaseVector)
    vector._get_cursor = MagicMock()

    vector.delete_by_ids([])

    vector._get_cursor.assert_not_called()


def test_delete_by_ids_swallows_undefined_table(vastbase_module):
    vector = vastbase_module.VastbaseVector.__new__(vastbase_module.VastbaseVector)
    vector.table_name = "embedding_collection_1"
    cursor = MagicMock()
    cursor.execute.side_effect = vastbase_module.psycopg2.errors.UndefinedTable("missing")
    vector._get_cursor = _cursor_ctx(cursor)

    # Should not raise even though the table does not exist.
    vector.delete_by_ids(["seg-1"])


def test_search_by_vector_validates_top_k(vastbase_module):
    vector = vastbase_module.VastbaseVector.__new__(vastbase_module.VastbaseVector)
    with pytest.raises(ValueError, match="top_k must be a positive integer"):
        vector.search_by_vector([0.1, 0.2], top_k=0)


def test_search_by_vector_applies_threshold_and_metadata_filter(vastbase_module):
    vector = vastbase_module.VastbaseVector.__new__(vastbase_module.VastbaseVector)
    vector.table_name = "embedding_collection_1"
    cursor = MagicMock()
    cursor.__iter__.return_value = iter(
        [
            ({"doc_id": "1"}, "text-1", 0.1),
            ({"doc_id": "2"}, "text-2", 0.6),
        ]
    )
    vector._get_cursor = _cursor_ctx(cursor)

    docs = vector.search_by_vector([0.1, 0.2], top_k=2, score_threshold=0.5, document_ids_filter=["doc-a", "doc-b"])

    assert len(docs) == 1
    assert docs[0].metadata["score"] == pytest.approx(0.9)
    sql, params = cursor.execute.call_args.args
    assert "embedding <=> %s AS distance" in sql
    assert "WHERE meta->>'document_id' IN %s" in sql
    assert params[1] == ("doc-a", "doc-b")


def test_search_by_vector_without_filter_omits_where_clause(vastbase_module):
    vector = vastbase_module.VastbaseVector.__new__(vastbase_module.VastbaseVector)
    vector.table_name = "embedding_collection_1"
    cursor = MagicMock()
    cursor.__iter__.return_value = iter([({"doc_id": "1"}, "text-1", 0.2)])
    vector._get_cursor = _cursor_ctx(cursor)

    docs = vector.search_by_vector([0.1, 0.2], top_k=4)

    assert len(docs) == 1
    sql, params = cursor.execute.call_args.args
    assert "WHERE" not in sql
    assert params == [json.dumps([0.1, 0.2])]


def test_search_by_full_text_validates_top_k(vastbase_module):
    vector = vastbase_module.VastbaseVector.__new__(vastbase_module.VastbaseVector)
    with pytest.raises(ValueError, match="top_k must be a positive integer"):
        vector.search_by_full_text("query", top_k=0)


def test_search_by_full_text_uses_bm25_and_metadata_filter(vastbase_module):
    vector = vastbase_module.VastbaseVector.__new__(vastbase_module.VastbaseVector)
    vector.table_name = "embedding_collection_1"
    cursor = MagicMock()
    cursor.__iter__.return_value = iter([({"doc_id": "3"}, "full-text", 0.7)])
    vector._get_cursor = _cursor_ctx(cursor)

    docs = vector.search_by_full_text("hello world", top_k=2, document_ids_filter=["doc-a"])

    assert len(docs) == 1
    assert docs[0].page_content == "full-text"
    assert docs[0].metadata["score"] == pytest.approx(0.7)
    sql, params = cursor.execute.call_args.args
    assert "bm25_score()" in sql
    assert "WHERE text @~@ %s" in sql
    assert "AND meta->>'document_id' IN %s" in sql
    assert params == ["hello world", ("doc-a",)]


def test_create_collection_cache_and_create_path(vastbase_module, monkeypatch: pytest.MonkeyPatch):
    pool = MagicMock()
    monkeypatch.setattr(vastbase_module.psycopg2.pool, "SimpleConnectionPool", MagicMock(return_value=pool))
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(vastbase_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(vastbase_module.redis_client, "set", MagicMock())

    vector = vastbase_module.VastbaseVector("collection_1", _config(vastbase_module))
    cursor = MagicMock()
    vector._get_cursor = _cursor_ctx(cursor)

    monkeypatch.setattr(vastbase_module.redis_client, "get", MagicMock(return_value=1))
    vector._create_collection(1536)
    cursor.execute.assert_not_called()

    monkeypatch.setattr(vastbase_module.redis_client, "get", MagicMock(return_value=None))
    vector._create_collection(1536)
    sql = [call.args[0] for call in cursor.execute.call_args_list]
    assert any("CREATE TABLE IF NOT EXISTS embedding_collection_1" in query for query in sql)
    assert any("floatvector(1536)" in query for query in sql)
    vastbase_module.redis_client.set.assert_called_once()


def _index_vector(vastbase_module, monkeypatch, *, cache_hit=False):
    pool = MagicMock()
    monkeypatch.setattr(vastbase_module.psycopg2.pool, "SimpleConnectionPool", MagicMock(return_value=pool))
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(vastbase_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(vastbase_module.redis_client, "get", MagicMock(return_value=1 if cache_hit else None))
    monkeypatch.setattr(vastbase_module.redis_client, "set", MagicMock())
    vector = vastbase_module.VastbaseVector("collection_1", _config(vastbase_module))
    cursor = MagicMock()
    vector._get_cursor = _cursor_ctx(cursor)
    return vector, cursor


def test_create_index_builds_graph_and_fulltext_indexes(vastbase_module, monkeypatch: pytest.MonkeyPatch):
    vector, cursor = _index_vector(vastbase_module, monkeypatch)

    vector._create_index(1536)

    sql = [call.args[0] for call in cursor.execute.call_args_list]
    assert any("USING graph_index (embedding floatvector_cosine_ops)" in query for query in sql)
    assert any("USING fulltext (text)" in query for query in sql)
    assert not any("USING hnsw" in query for query in sql)
    vastbase_module.redis_client.set.assert_called_once()


def test_create_index_skips_graph_index_for_large_dimension(vastbase_module, monkeypatch: pytest.MonkeyPatch):
    vector, cursor = _index_vector(vastbase_module, monkeypatch)

    vector._create_index(vastbase_module.MAX_GRAPH_INDEX_DIMENSION + 1)

    sql = [call.args[0] for call in cursor.execute.call_args_list]
    assert not any("graph_index" in query for query in sql)
    # Full-text index is dimension independent and still created.
    assert any("USING fulltext (text)" in query for query in sql)


def test_create_index_returns_early_on_cache_hit(vastbase_module, monkeypatch: pytest.MonkeyPatch):
    vector, cursor = _index_vector(vastbase_module, monkeypatch, cache_hit=True)

    vector._create_index(1536)

    cursor.execute.assert_not_called()
    vastbase_module.redis_client.set.assert_not_called()


def test_vastbase_factory_uses_existing_or_generated_collection(vastbase_module, monkeypatch: pytest.MonkeyPatch):
    factory = vastbase_module.VastbaseVectorFactory()
    dataset_with_index = Dataset(
        id="dataset-1", index_struct=json.dumps({"vector_store": {"class_prefix": "EXISTING_COLLECTION"}})
    )
    dataset_without_index = Dataset(id="dataset-2")

    monkeypatch.setattr(vastbase_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")
    monkeypatch.setattr(vastbase_module.dify_config, "VASTBASE_HOST", "localhost")
    monkeypatch.setattr(vastbase_module.dify_config, "VASTBASE_PORT", 5432)
    monkeypatch.setattr(vastbase_module.dify_config, "VASTBASE_USER", "dify")
    monkeypatch.setattr(vastbase_module.dify_config, "VASTBASE_PASSWORD", "secret")
    monkeypatch.setattr(vastbase_module.dify_config, "VASTBASE_DATABASE", "dify")
    monkeypatch.setattr(vastbase_module.dify_config, "VASTBASE_MIN_CONNECTION", 1)
    monkeypatch.setattr(vastbase_module.dify_config, "VASTBASE_MAX_CONNECTION", 5)

    with patch.object(vastbase_module, "VastbaseVector", return_value="vector") as vector_cls:
        result_1 = factory.init_vector(dataset_with_index, attributes=[], embeddings=MagicMock())
        result_2 = factory.init_vector(dataset_without_index, attributes=[], embeddings=MagicMock())

    assert result_1 == "vector"
    assert result_2 == "vector"
    assert vector_cls.call_args_list[0].kwargs["collection_name"] == "EXISTING_COLLECTION"
    assert vector_cls.call_args_list[1].kwargs["collection_name"] == "AUTO_COLLECTION"
    assert dataset_without_index.index_struct is not None
