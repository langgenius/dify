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
def opengauss_module(monkeypatch: pytest.MonkeyPatch):
    for name, module in _build_fake_psycopg2_modules().items():
        monkeypatch.setitem(sys.modules, name, module)

    import dify_vdb_opengauss.opengauss as module

    return importlib.reload(module)


def _config(module, *, enable_pq=False):
    return module.OpenGaussConfig(
        host="localhost",
        port=6600,
        user="postgres",
        password="password",
        database="dify",
        min_connection=1,
        max_connection=5,
        enable_pq=enable_pq,
    )


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("host", "", "config OPENGAUSS_HOST is required"),
        ("port", 0, "config OPENGAUSS_PORT is required"),
        ("user", "", "config OPENGAUSS_USER is required"),
        ("password", "", "config OPENGAUSS_PASSWORD is required"),
        ("database", "", "config OPENGAUSS_DATABASE is required"),
        ("min_connection", 0, "config OPENGAUSS_MIN_CONNECTION is required"),
        ("max_connection", 0, "config OPENGAUSS_MAX_CONNECTION is required"),
    ],
)
def test_opengauss_config_validation(opengauss_module, field, value, message):
    values = _config(opengauss_module).model_dump()
    values[field] = value

    with pytest.raises(ValidationError, match=message):
        opengauss_module.OpenGaussConfig.model_validate(values)


def test_opengauss_config_validation_rejects_min_greater_than_max(opengauss_module):
    values = _config(opengauss_module).model_dump()
    values["min_connection"] = 6
    values["max_connection"] = 5

    with pytest.raises(ValidationError, match="OPENGAUSS_MIN_CONNECTION should less than OPENGAUSS_MAX_CONNECTION"):
        opengauss_module.OpenGaussConfig.model_validate(values)


def test_init_sets_table_name_and_vector_type(opengauss_module, monkeypatch: pytest.MonkeyPatch):
    pool = MagicMock()
    monkeypatch.setattr(opengauss_module.psycopg2.pool, "SimpleConnectionPool", MagicMock(return_value=pool))

    vector = opengauss_module.OpenGauss("collection_1", _config(opengauss_module))

    assert vector.table_name == "embedding_collection_1"
    assert vector.get_type() == "opengauss"
    assert vector.pool is pool


def test_create_index_with_pq_executes_pq_sql(opengauss_module, monkeypatch: pytest.MonkeyPatch):
    pool = MagicMock()
    monkeypatch.setattr(opengauss_module.psycopg2.pool, "SimpleConnectionPool", MagicMock(return_value=pool))

    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(opengauss_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(opengauss_module.redis_client, "get", MagicMock(return_value=None))
    monkeypatch.setattr(opengauss_module.redis_client, "set", MagicMock())

    vector = opengauss_module.OpenGauss("collection_1", _config(opengauss_module, enable_pq=True))
    cursor = MagicMock()

    @contextmanager
    def _cursor_ctx():
        yield cursor

    vector._get_cursor = _cursor_ctx
    vector._create_index(1536)

    executed_sql = [call.args[0] for call in cursor.execute.call_args_list]
    assert any("enable_pq=on" in sql for sql in executed_sql)
    assert any("SET hnsw_earlystop_threshold = 320" in sql for sql in executed_sql)
    opengauss_module.redis_client.set.assert_called_once()


def test_create_index_skips_index_sql_for_large_dimension(opengauss_module, monkeypatch: pytest.MonkeyPatch):
    pool = MagicMock()
    monkeypatch.setattr(opengauss_module.psycopg2.pool, "SimpleConnectionPool", MagicMock(return_value=pool))

    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(opengauss_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(opengauss_module.redis_client, "get", MagicMock(return_value=None))
    monkeypatch.setattr(opengauss_module.redis_client, "set", MagicMock())

    vector = opengauss_module.OpenGauss("collection_1", _config(opengauss_module, enable_pq=False))
    cursor = MagicMock()

    @contextmanager
    def _cursor_ctx():
        yield cursor

    vector._get_cursor = _cursor_ctx
    vector._create_index(3072)

    cursor.execute.assert_not_called()
    opengauss_module.redis_client.set.assert_called_once()


def test_search_by_vector_validates_top_k(opengauss_module):
    vector = opengauss_module.OpenGauss.__new__(opengauss_module.OpenGauss)

    with pytest.raises(ValueError, match="top_k must be a positive integer"):
        vector.search_by_vector([0.1, 0.2], top_k=0)


def test_delete_by_ids_short_circuits_with_empty_input(opengauss_module, monkeypatch: pytest.MonkeyPatch):
    pool = MagicMock()
    monkeypatch.setattr(opengauss_module.psycopg2.pool, "SimpleConnectionPool", MagicMock(return_value=pool))
    vector = opengauss_module.OpenGauss("collection_1", _config(opengauss_module))
    vector._get_cursor = MagicMock()

    vector.delete_by_ids([])

    vector._get_cursor.assert_not_called()


def test_get_cursor_closes_commits_and_returns_connection(opengauss_module):
    vector = opengauss_module.OpenGauss.__new__(opengauss_module.OpenGauss)
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


def test_create_calls_collection_insert_and_index(opengauss_module):
    vector = opengauss_module.OpenGauss.__new__(opengauss_module.OpenGauss)
    vector._create_collection = MagicMock()
    vector.add_texts = MagicMock()
    vector._create_index = MagicMock()
    docs = [Document(page_content="text", metadata={"doc_id": "seg-1"})]

    vector.create(docs, [[0.1, 0.2]])

    vector._create_collection.assert_called_once_with(2)
    vector.add_texts.assert_called_once_with(docs, [[0.1, 0.2]])
    vector._create_index.assert_called_once_with(2)


def test_create_index_returns_early_on_cache_hit(opengauss_module, monkeypatch: pytest.MonkeyPatch):
    pool = MagicMock()
    monkeypatch.setattr(opengauss_module.psycopg2.pool, "SimpleConnectionPool", MagicMock(return_value=pool))

    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(opengauss_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(opengauss_module.redis_client, "get", MagicMock(return_value=1))
    monkeypatch.setattr(opengauss_module.redis_client, "set", MagicMock())

    vector = opengauss_module.OpenGauss("collection_1", _config(opengauss_module))
    vector._get_cursor = MagicMock()

    vector._create_index(1536)

    vector._get_cursor.assert_not_called()
    opengauss_module.redis_client.set.assert_not_called()


def test_create_index_without_pq_executes_standard_index_sql(opengauss_module, monkeypatch: pytest.MonkeyPatch):
    pool = MagicMock()
    monkeypatch.setattr(opengauss_module.psycopg2.pool, "SimpleConnectionPool", MagicMock(return_value=pool))

    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(opengauss_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(opengauss_module.redis_client, "get", MagicMock(return_value=None))
    monkeypatch.setattr(opengauss_module.redis_client, "set", MagicMock())

    vector = opengauss_module.OpenGauss("collection_1", _config(opengauss_module, enable_pq=False))
    cursor = MagicMock()

    @contextmanager
    def _cursor_ctx():
        yield cursor

    vector._get_cursor = _cursor_ctx
    vector._create_index(1536)

    sql = [call.args[0] for call in cursor.execute.call_args_list]
    assert any("embedding_cosine_embedding_collection_1_idx" in query for query in sql)


def test_add_texts_uses_execute_values(opengauss_module, monkeypatch: pytest.MonkeyPatch):
    pool = MagicMock()
    monkeypatch.setattr(opengauss_module.psycopg2.pool, "SimpleConnectionPool", MagicMock(return_value=pool))
    vector = opengauss_module.OpenGauss("collection_1", _config(opengauss_module))
    cursor = MagicMock()
    opengauss_module.psycopg2.extras.execute_values.reset_mock()

    @contextmanager
    def _cursor_ctx():
        yield cursor

    vector._get_cursor = _cursor_ctx
    docs = [
        Document(page_content="text-1", metadata={"doc_id": "seg-1", "document_id": "d-1"}),
        SimpleNamespace(page_content="text-2", metadata=None),
    ]
    monkeypatch.setattr(opengauss_module.uuid, "uuid4", lambda: "generated-uuid")

    ids = vector.add_texts(docs, [[0.1], [0.2]])

    assert ids == ["seg-1"]
    opengauss_module.psycopg2.extras.execute_values.assert_called_once()


def test_text_exists_and_get_by_ids(opengauss_module):
    vector = opengauss_module.OpenGauss.__new__(opengauss_module.OpenGauss)
    vector.table_name = "embedding_collection_1"
    cursor = MagicMock()
    cursor.fetchone.return_value = ("seg-1",)
    cursor.__iter__.return_value = iter([({"doc_id": "1"}, "text-1"), ({"doc_id": "2"}, "text-2")])

    @contextmanager
    def _cursor_ctx():
        yield cursor

    vector._get_cursor = _cursor_ctx

    assert vector.text_exists("seg-1") is True
    docs = vector.get_by_ids(["seg-1", "seg-2"])
    assert len(docs) == 2
    assert docs[0].page_content == "text-1"


def test_delete_and_metadata_field_queries(opengauss_module):
    vector = opengauss_module.OpenGauss.__new__(opengauss_module.OpenGauss)
    vector.table_name = "embedding_collection_1"
    cursor = MagicMock()

    @contextmanager
    def _cursor_ctx():
        yield cursor

    vector._get_cursor = _cursor_ctx

    vector.delete_by_ids(["seg-1", "seg-2"])
    vector.delete_by_metadata_field("document_id", "doc-1")
    vector.delete()

    sql = [call.args[0] for call in cursor.execute.call_args_list]
    assert any("DELETE FROM embedding_collection_1 WHERE id IN %s" in query for query in sql)
    assert any("meta->>%s = %s" in query for query in sql)
    assert any("DROP TABLE IF EXISTS embedding_collection_1" in query for query in sql)


def test_search_by_vector_and_full_text(opengauss_module):
    vector = opengauss_module.OpenGauss.__new__(opengauss_module.OpenGauss)
    vector.table_name = "embedding_collection_1"
    cursor = MagicMock()
    cursor.__iter__.return_value = iter(
        [
            ({"doc_id": "1"}, "text-1", 0.1),
            ({"doc_id": "2"}, "text-2", 0.6),
        ]
    )

    @contextmanager
    def _cursor_ctx():
        yield cursor

    vector._get_cursor = _cursor_ctx

    docs = vector.search_by_vector([0.1, 0.2], top_k=2, score_threshold=0.5)
    assert len(docs) == 1
    assert docs[0].metadata["score"] == pytest.approx(0.9)

    cursor.__iter__.return_value = iter([({"doc_id": "3"}, "full-text", 0.8)])
    full_docs = vector.search_by_full_text("hello world", top_k=2)
    assert len(full_docs) == 1
    assert full_docs[0].page_content == "full-text"


def test_search_by_full_text_validates_top_k(opengauss_module):
    vector = opengauss_module.OpenGauss.__new__(opengauss_module.OpenGauss)
    with pytest.raises(ValueError, match="top_k must be a positive integer"):
        vector.search_by_full_text("query", top_k=0)


def test_create_collection_cache_and_create_path(opengauss_module, monkeypatch: pytest.MonkeyPatch):
    pool = MagicMock()
    monkeypatch.setattr(opengauss_module.psycopg2.pool, "SimpleConnectionPool", MagicMock(return_value=pool))
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(opengauss_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(opengauss_module.redis_client, "set", MagicMock())

    vector = opengauss_module.OpenGauss("collection_1", _config(opengauss_module))
    cursor = MagicMock()

    @contextmanager
    def _cursor_ctx():
        yield cursor

    vector._get_cursor = _cursor_ctx

    monkeypatch.setattr(opengauss_module.redis_client, "get", MagicMock(return_value=1))
    vector._create_collection(1536)
    cursor.execute.assert_not_called()

    monkeypatch.setattr(opengauss_module.redis_client, "get", MagicMock(return_value=None))
    vector._create_collection(1536)
    cursor.execute.assert_called_once()
    opengauss_module.redis_client.set.assert_called_once()


def test_opengauss_factory_uses_existing_or_generated_collection(opengauss_module, monkeypatch: pytest.MonkeyPatch):
    factory = opengauss_module.OpenGaussFactory()
    dataset_with_index = SimpleNamespace(
        id="dataset-1",
        index_struct_dict={"vector_store": {"class_prefix": "EXISTING_COLLECTION"}},
        index_struct=None,
    )
    dataset_without_index = SimpleNamespace(id="dataset-2", index_struct_dict=None, index_struct=None)

    monkeypatch.setattr(opengauss_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")
    monkeypatch.setattr(opengauss_module.dify_config, "OPENGAUSS_HOST", "localhost")
    monkeypatch.setattr(opengauss_module.dify_config, "OPENGAUSS_PORT", 6600)
    monkeypatch.setattr(opengauss_module.dify_config, "OPENGAUSS_USER", "postgres")
    monkeypatch.setattr(opengauss_module.dify_config, "OPENGAUSS_PASSWORD", "password")
    monkeypatch.setattr(opengauss_module.dify_config, "OPENGAUSS_DATABASE", "dify")
    monkeypatch.setattr(opengauss_module.dify_config, "OPENGAUSS_MIN_CONNECTION", 1)
    monkeypatch.setattr(opengauss_module.dify_config, "OPENGAUSS_MAX_CONNECTION", 5)
    monkeypatch.setattr(opengauss_module.dify_config, "OPENGAUSS_ENABLE_PQ", False)

    with patch.object(opengauss_module, "OpenGauss", return_value="vector") as vector_cls:
        result_1 = factory.init_vector(dataset_with_index, attributes=[], embeddings=MagicMock())
        result_2 = factory.init_vector(dataset_without_index, attributes=[], embeddings=MagicMock())

    assert result_1 == "vector"
    assert result_2 == "vector"
    assert vector_cls.call_args_list[0].kwargs["collection_name"] == "EXISTING_COLLECTION"
    assert vector_cls.call_args_list[1].kwargs["collection_name"] == "AUTO_COLLECTION"
    assert dataset_without_index.index_struct is not None
