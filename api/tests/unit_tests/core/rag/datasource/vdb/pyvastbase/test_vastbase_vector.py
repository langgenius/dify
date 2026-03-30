import importlib
import sys
import types
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from core.rag.models.document import Document


def _build_fake_psycopg2_modules():
    psycopg2 = types.ModuleType("psycopg2")
    psycopg2.__path__ = []
    psycopg2_extras = types.ModuleType("psycopg2.extras")
    psycopg2_pool = types.ModuleType("psycopg2.pool")

    class SimpleConnectionPool:
        def __init__(self, *args, **kwargs):
            self.args = args
            self.kwargs = kwargs
            self.getconn = MagicMock()
            self.putconn = MagicMock()

    psycopg2_pool.SimpleConnectionPool = SimpleConnectionPool
    psycopg2_extras.execute_values = MagicMock()
    psycopg2.pool = psycopg2_pool
    psycopg2.extras = psycopg2_extras

    return {
        "psycopg2": psycopg2,
        "psycopg2.pool": psycopg2_pool,
        "psycopg2.extras": psycopg2_extras,
    }


@pytest.fixture
def vastbase_module(monkeypatch):
    for name, module in _build_fake_psycopg2_modules().items():
        monkeypatch.setitem(sys.modules, name, module)

    import core.rag.datasource.vdb.pyvastbase.vastbase_vector as module

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


def test_init_and_get_cursor_context_manager(vastbase_module, monkeypatch):
    pool = MagicMock()
    monkeypatch.setattr(vastbase_module.psycopg2.pool, "SimpleConnectionPool", MagicMock(return_value=pool))

    conn = MagicMock()
    cur = MagicMock()
    pool.getconn.return_value = conn
    conn.cursor.return_value = cur

    vector = vastbase_module.VastbaseVector("collection_1", _config(vastbase_module))
    assert vector.get_type() == "vastbase"
    assert vector.table_name == "embedding_collection_1"

    with vector._get_cursor() as got_cur:
        assert got_cur is cur

    cur.close.assert_called_once()
    conn.commit.assert_called_once()
    pool.putconn.assert_called_once_with(conn)


def test_create_and_add_texts(vastbase_module, monkeypatch):
    vector = vastbase_module.VastbaseVector.__new__(vastbase_module.VastbaseVector)
    vector.table_name = "embedding_collection_1"
    vector._create_collection = MagicMock()

    cursor = MagicMock()

    @contextmanager
    def _cursor_ctx():
        yield cursor

    vector._get_cursor = _cursor_ctx
    monkeypatch.setattr(vastbase_module.uuid, "uuid4", lambda: "generated-uuid")

    docs = [
        Document(page_content="a", metadata={"doc_id": "doc-a"}),
        Document(page_content="b", metadata={"document_id": "doc-b"}),
        SimpleNamespace(page_content="c", metadata=None),
    ]

    ids = vector.add_texts(docs, [[0.1], [0.2], [0.3]])
    assert ids == ["doc-a", "generated-uuid"]
    vastbase_module.psycopg2.extras.execute_values.assert_called_once()

    vector.add_texts = MagicMock(return_value=["doc-a"])
    result = vector.create(docs, [[0.1], [0.2], [0.3]])
    vector._create_collection.assert_called_once_with(1)
    assert result == ["doc-a"]


def test_text_get_delete_and_metadata_methods(vastbase_module):
    vector = vastbase_module.VastbaseVector.__new__(vastbase_module.VastbaseVector)
    vector.table_name = "embedding_collection_1"
    cursor = MagicMock()
    cursor.fetchone.return_value = ("id-1",)
    cursor.__iter__.return_value = iter([({"doc_id": "1"}, "text-1"), ({"doc_id": "2"}, "text-2")])

    @contextmanager
    def _cursor_ctx():
        yield cursor

    vector._get_cursor = _cursor_ctx

    assert vector.text_exists("id-1") is True
    docs = vector.get_by_ids(["id-1", "id-2"])
    assert len(docs) == 2
    assert docs[0].page_content == "text-1"

    vector.delete_by_ids([])
    vector.delete_by_ids(["id-1"])
    vector.delete_by_metadata_field("document_id", "doc-1")
    vector.delete()
    executed_sql = [call.args[0] for call in cursor.execute.call_args_list]
    assert any("DELETE FROM embedding_collection_1 WHERE id IN %s" in sql for sql in executed_sql)
    assert any("meta->>%s = %s" in sql for sql in executed_sql)
    assert any("DROP TABLE IF EXISTS embedding_collection_1" in sql for sql in executed_sql)


def test_search_by_vector_and_full_text(vastbase_module):
    vector = vastbase_module.VastbaseVector.__new__(vastbase_module.VastbaseVector)
    vector.table_name = "embedding_collection_1"
    cursor = MagicMock()
    cursor.__iter__.return_value = iter(
        [
            ({"doc_id": "1"}, "text-1", 0.1),
            ({"doc_id": "2"}, "text-2", 0.8),
        ]
    )

    @contextmanager
    def _cursor_ctx():
        yield cursor

    vector._get_cursor = _cursor_ctx

    with pytest.raises(ValueError, match="top_k must be a positive integer"):
        vector.search_by_vector([0.1, 0.2], top_k=0)

    docs = vector.search_by_vector([0.1, 0.2], top_k=2, score_threshold=0.5)
    assert len(docs) == 1
    assert docs[0].metadata["score"] == pytest.approx(0.9)

    with pytest.raises(ValueError, match="top_k must be a positive integer"):
        vector.search_by_full_text("hello", top_k=0)

    cursor.__iter__.return_value = iter([({"doc_id": "3"}, "full-text", 0.7)])
    full_docs = vector.search_by_full_text("hello world", top_k=2)
    assert len(full_docs) == 1
    assert full_docs[0].page_content == "full-text"


def test_create_collection_cache_and_dimension_branches(vastbase_module, monkeypatch):
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(vastbase_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(vastbase_module.redis_client, "set", MagicMock())

    vector = vastbase_module.VastbaseVector.__new__(vastbase_module.VastbaseVector)
    vector._collection_name = "collection_1"
    vector.table_name = "embedding_collection_1"
    cursor = MagicMock()

    @contextmanager
    def _cursor_ctx():
        yield cursor

    vector._get_cursor = _cursor_ctx

    monkeypatch.setattr(vastbase_module.redis_client, "get", MagicMock(return_value=1))
    vector._create_collection(3)
    cursor.execute.assert_not_called()

    monkeypatch.setattr(vastbase_module.redis_client, "get", MagicMock(return_value=None))
    vector._create_collection(17000)
    executed_sql = [call.args[0] for call in cursor.execute.call_args_list]
    assert any("CREATE TABLE IF NOT EXISTS embedding_collection_1" in sql for sql in executed_sql)
    assert all("embedding_cosine_v1_idx" not in sql for sql in executed_sql)

    cursor.execute.reset_mock()
    vector._create_collection(3)
    executed_sql = [call.args[0] for call in cursor.execute.call_args_list]
    assert any("embedding_cosine_v1_idx" in sql for sql in executed_sql)
    vastbase_module.redis_client.set.assert_called()


def test_vastbase_factory_uses_existing_or_generated_collection(vastbase_module, monkeypatch):
    factory = vastbase_module.VastbaseVectorFactory()
    dataset_with_index = SimpleNamespace(
        id="dataset-1",
        index_struct_dict={"vector_store": {"class_prefix": "EXISTING_COLLECTION"}},
        index_struct=None,
    )
    dataset_without_index = SimpleNamespace(id="dataset-2", index_struct_dict=None, index_struct=None)

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
