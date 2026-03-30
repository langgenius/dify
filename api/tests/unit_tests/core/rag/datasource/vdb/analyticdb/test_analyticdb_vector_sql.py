from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock

import psycopg2.errors
import pytest

import core.rag.datasource.vdb.analyticdb.analyticdb_vector_sql as sql_module
from core.rag.datasource.vdb.analyticdb.analyticdb_vector_sql import (
    AnalyticdbVectorBySql,
    AnalyticdbVectorBySqlConfig,
)
from core.rag.models.document import Document


def _config_values() -> dict:
    return {
        "host": "localhost",
        "port": 5432,
        "account": "account",
        "account_password": "password",
        "min_connection": 1,
        "max_connection": 2,
        "namespace": "dify",
    }


@pytest.mark.parametrize(
    ("field", "value", "error_message"),
    [
        ("host", "", "ANALYTICDB_HOST"),
        ("port", 0, "ANALYTICDB_PORT"),
        ("account", "", "ANALYTICDB_ACCOUNT"),
        ("account_password", "", "ANALYTICDB_PASSWORD"),
        ("min_connection", 0, "ANALYTICDB_MIN_CONNECTION"),
        ("max_connection", 0, "ANALYTICDB_MAX_CONNECTION"),
    ],
)
def test_sql_config_required_fields(field, value, error_message):
    values = _config_values()
    values[field] = value

    with pytest.raises(ValueError, match=error_message):
        AnalyticdbVectorBySqlConfig.model_validate(values)


def test_sql_config_rejects_min_connection_greater_than_max_connection():
    values = _config_values()
    values["min_connection"] = 10
    values["max_connection"] = 2

    with pytest.raises(ValueError, match="ANALYTICDB_MIN_CONNECTION should less than ANALYTICDB_MAX_CONNECTION"):
        AnalyticdbVectorBySqlConfig.model_validate(values)


def test_initialize_skips_when_cache_exists(monkeypatch):
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(sql_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(sql_module.redis_client, "get", MagicMock(return_value=1))
    monkeypatch.setattr(sql_module.redis_client, "set", MagicMock())

    vector = AnalyticdbVectorBySql.__new__(AnalyticdbVectorBySql)
    vector.config = AnalyticdbVectorBySqlConfig(**_config_values())
    vector._initialize_vector_database = MagicMock()

    vector._initialize()

    vector._initialize_vector_database.assert_not_called()


def test_initialize_runs_when_cache_is_missing(monkeypatch):
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(sql_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(sql_module.redis_client, "get", MagicMock(return_value=None))
    monkeypatch.setattr(sql_module.redis_client, "set", MagicMock())

    vector = AnalyticdbVectorBySql.__new__(AnalyticdbVectorBySql)
    vector.config = AnalyticdbVectorBySqlConfig(**_config_values())
    vector._initialize_vector_database = MagicMock()

    vector._initialize()

    vector._initialize_vector_database.assert_called_once()
    sql_module.redis_client.set.assert_called_once()


def test_create_connection_pool_uses_psycopg2_pool(monkeypatch):
    vector = AnalyticdbVectorBySql.__new__(AnalyticdbVectorBySql)
    vector.config = AnalyticdbVectorBySqlConfig(**_config_values())
    vector.databaseName = "knowledgebase"

    pool_instance = MagicMock()
    monkeypatch.setattr(sql_module.psycopg2.pool, "SimpleConnectionPool", MagicMock(return_value=pool_instance))

    pool = vector._create_connection_pool()

    assert pool is pool_instance
    sql_module.psycopg2.pool.SimpleConnectionPool.assert_called_once()


def test_get_cursor_context_manager_handles_connection_lifecycle():
    vector = AnalyticdbVectorBySql.__new__(AnalyticdbVectorBySql)
    cursor = MagicMock()
    connection = MagicMock()
    connection.cursor.return_value = cursor
    pool = MagicMock()
    pool.getconn.return_value = connection
    vector.pool = pool

    with vector._get_cursor() as cur:
        assert cur is cursor

    cursor.close.assert_called_once()
    connection.commit.assert_called_once()
    pool.putconn.assert_called_once_with(connection)


def test_add_texts_inserts_only_documents_with_metadata(monkeypatch):
    vector = AnalyticdbVectorBySql.__new__(AnalyticdbVectorBySql)
    vector.table_name = "dify.collection"

    cursor = MagicMock()

    @contextmanager
    def _cursor_context():
        yield cursor

    vector._get_cursor = _cursor_context

    monkeypatch.setattr(sql_module.uuid, "uuid4", lambda: "prefix-id")
    monkeypatch.setattr(sql_module.psycopg2.extras, "execute_batch", MagicMock())

    docs = [
        Document(page_content="doc 1", metadata={"doc_id": "d1", "document_id": "doc-1"}),
        SimpleNamespace(page_content="doc 2", metadata=None),
    ]
    vector.add_texts(docs, [[0.1, 0.2], [0.2, 0.3]])

    execute_args = sql_module.psycopg2.extras.execute_batch.call_args.args
    assert execute_args[0] is cursor
    assert len(execute_args[2]) == 1


def test_text_exists_returns_true_and_false_based_on_query_result():
    vector = AnalyticdbVectorBySql.__new__(AnalyticdbVectorBySql)
    vector.table_name = "dify.collection"
    cursor = MagicMock()

    @contextmanager
    def _cursor_context():
        yield cursor

    vector._get_cursor = _cursor_context

    cursor.fetchone.return_value = ("row",)
    assert vector.text_exists("d1") is True

    cursor.fetchone.return_value = None
    assert vector.text_exists("d1") is False


def test_delete_by_ids_handles_empty_input_and_missing_table_error():
    vector = AnalyticdbVectorBySql.__new__(AnalyticdbVectorBySql)
    vector.table_name = "dify.collection"
    cursor = MagicMock()

    @contextmanager
    def _cursor_context():
        yield cursor

    vector._get_cursor = _cursor_context
    vector.delete_by_ids([])
    cursor.execute.assert_not_called()

    cursor.execute.side_effect = psycopg2.errors.UndefinedTable("relation does not exist")
    vector.delete_by_ids(["d1"])


def test_delete_by_metadata_field_handles_missing_table_error():
    vector = AnalyticdbVectorBySql.__new__(AnalyticdbVectorBySql)
    vector.table_name = "dify.collection"
    cursor = MagicMock()

    @contextmanager
    def _cursor_context():
        yield cursor

    vector._get_cursor = _cursor_context
    cursor.execute.side_effect = psycopg2.errors.UndefinedTable("relation does not exist")
    vector.delete_by_metadata_field("document_id", "doc-1")


@pytest.mark.parametrize("invalid_top_k", [0, "x", -1])
def test_search_by_vector_validates_top_k(invalid_top_k):
    vector = AnalyticdbVectorBySql.__new__(AnalyticdbVectorBySql)
    vector.table_name = "dify.collection"

    with pytest.raises(ValueError, match="top_k must be a positive integer"):
        vector.search_by_vector([0.1, 0.2], top_k=invalid_top_k)


def test_search_by_vector_returns_documents_above_threshold():
    vector = AnalyticdbVectorBySql.__new__(AnalyticdbVectorBySql)
    vector.table_name = "dify.collection"
    cursor = MagicMock()
    cursor.__iter__.return_value = iter(
        [
            ("id1", [1.0], 0.8, "content 1", {"doc_id": "id1", "document_id": "doc-1"}),
            ("id2", [2.0], 0.3, "content 2", {"doc_id": "id2", "document_id": "doc-2"}),
        ]
    )

    @contextmanager
    def _cursor_context():
        yield cursor

    vector._get_cursor = _cursor_context

    docs = vector.search_by_vector([0.1, 0.2], top_k=2, score_threshold=0.5, document_ids_filter=["doc-1"])

    assert len(docs) == 1
    assert docs[0].page_content == "content 1"
    assert docs[0].metadata["score"] == 0.8


@pytest.mark.parametrize("invalid_top_k", [0, "x", -1])
def test_search_by_full_text_validates_top_k(invalid_top_k):
    vector = AnalyticdbVectorBySql.__new__(AnalyticdbVectorBySql)
    vector.table_name = "dify.collection"

    with pytest.raises(ValueError, match="top_k must be a positive integer"):
        vector.search_by_full_text("query", top_k=invalid_top_k)


def test_search_by_full_text_returns_documents():
    vector = AnalyticdbVectorBySql.__new__(AnalyticdbVectorBySql)
    vector.table_name = "dify.collection"
    cursor = MagicMock()
    cursor.__iter__.return_value = iter(
        [
            ("id1", [1.0], "content 1", {"doc_id": "id1", "document_id": "doc-1"}, 0.9),
        ]
    )

    @contextmanager
    def _cursor_context():
        yield cursor

    vector._get_cursor = _cursor_context
    docs = vector.search_by_full_text("query", top_k=1, document_ids_filter=["doc-1"])

    assert len(docs) == 1
    assert docs[0].metadata["score"] == 0.9
    assert docs[0].page_content == "content 1"


def test_delete_drops_table():
    vector = AnalyticdbVectorBySql.__new__(AnalyticdbVectorBySql)
    vector.table_name = "dify.collection"
    cursor = MagicMock()

    @contextmanager
    def _cursor_context():
        yield cursor

    vector._get_cursor = _cursor_context
    vector.delete()

    cursor.execute.assert_called_once()


def test_init_normalizes_collection_name_and_creates_pool_when_missing(monkeypatch):
    config = AnalyticdbVectorBySqlConfig(**_config_values())
    created_pool = MagicMock()

    monkeypatch.setattr(AnalyticdbVectorBySql, "_initialize", MagicMock())
    monkeypatch.setattr(AnalyticdbVectorBySql, "_create_connection_pool", MagicMock(return_value=created_pool))

    vector = AnalyticdbVectorBySql("My_Collection", config)

    assert vector._collection_name == "my_collection"
    assert vector.table_name == "dify.my_collection"
    assert vector.databaseName == "knowledgebase"
    assert vector.pool is created_pool


def test_initialize_vector_database_handles_existing_database_and_search_config(monkeypatch):
    vector = AnalyticdbVectorBySql.__new__(AnalyticdbVectorBySql)
    vector.config = AnalyticdbVectorBySqlConfig(**_config_values())
    vector.databaseName = "knowledgebase"

    bootstrap_cursor = MagicMock()
    bootstrap_connection = MagicMock()
    bootstrap_connection.cursor.return_value = bootstrap_cursor
    bootstrap_cursor.execute.side_effect = RuntimeError("database already exists")
    monkeypatch.setattr(sql_module.psycopg2, "connect", MagicMock(return_value=bootstrap_connection))

    worker_cursor = MagicMock()
    worker_connection = MagicMock()
    worker_cursor.connection = worker_connection

    def _execute(sql, *args, **kwargs):
        if "CREATE TEXT SEARCH CONFIGURATION zh_cn" in sql:
            raise RuntimeError("already exists")

    worker_cursor.execute.side_effect = _execute
    pooled_connection = MagicMock()
    pooled_connection.cursor.return_value = worker_cursor
    pool = MagicMock()
    pool.getconn.return_value = pooled_connection
    vector._create_connection_pool = MagicMock(return_value=pool)

    vector._initialize_vector_database()

    bootstrap_cursor.close.assert_called_once()
    bootstrap_connection.close.assert_called_once()
    vector._create_connection_pool.assert_called_once()
    assert any(
        "CREATE OR REPLACE FUNCTION public.to_tsquery_from_text" in call.args[0]
        for call in worker_cursor.execute.call_args_list
    )
    assert any("CREATE SCHEMA IF NOT EXISTS dify" in call.args[0] for call in worker_cursor.execute.call_args_list)


def test_initialize_vector_database_raises_runtime_error_when_zhparser_fails(monkeypatch):
    vector = AnalyticdbVectorBySql.__new__(AnalyticdbVectorBySql)
    vector.config = AnalyticdbVectorBySqlConfig(**_config_values())
    vector.databaseName = "knowledgebase"

    bootstrap_cursor = MagicMock()
    bootstrap_connection = MagicMock()
    bootstrap_connection.cursor.return_value = bootstrap_cursor
    monkeypatch.setattr(sql_module.psycopg2, "connect", MagicMock(return_value=bootstrap_connection))

    worker_cursor = MagicMock()
    worker_connection = MagicMock()
    worker_cursor.connection = worker_connection
    worker_cursor.execute.side_effect = RuntimeError("zhparser unavailable")

    pooled_connection = MagicMock()
    pooled_connection.cursor.return_value = worker_cursor
    pool = MagicMock()
    pool.getconn.return_value = pooled_connection
    vector._create_connection_pool = MagicMock(return_value=pool)

    with pytest.raises(RuntimeError, match="Failed to create zhparser extension"):
        vector._initialize_vector_database()

    worker_connection.rollback.assert_called_once()


def test_create_collection_if_not_exists_creates_table_indexes_and_cache(monkeypatch):
    vector = AnalyticdbVectorBySql.__new__(AnalyticdbVectorBySql)
    vector.config = AnalyticdbVectorBySqlConfig(**_config_values())
    vector._collection_name = "collection"
    vector.table_name = "dify.collection"

    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(sql_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(sql_module.redis_client, "get", MagicMock(return_value=None))
    monkeypatch.setattr(sql_module.redis_client, "set", MagicMock())

    cursor = MagicMock()

    @contextmanager
    def _cursor_context():
        yield cursor

    vector._get_cursor = _cursor_context

    vector._create_collection_if_not_exists(embedding_dimension=3)

    assert any("CREATE TABLE IF NOT EXISTS dify.collection" in call.args[0] for call in cursor.execute.call_args_list)
    assert any("CREATE INDEX collection_embedding_idx" in call.args[0] for call in cursor.execute.call_args_list)
    sql_module.redis_client.set.assert_called_once()


def test_create_collection_if_not_exists_raises_for_non_existing_error(monkeypatch):
    vector = AnalyticdbVectorBySql.__new__(AnalyticdbVectorBySql)
    vector.config = AnalyticdbVectorBySqlConfig(**_config_values())
    vector._collection_name = "collection"
    vector.table_name = "dify.collection"

    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(sql_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(sql_module.redis_client, "get", MagicMock(return_value=None))
    monkeypatch.setattr(sql_module.redis_client, "set", MagicMock())

    cursor = MagicMock()
    cursor.execute.side_effect = RuntimeError("permission denied")

    @contextmanager
    def _cursor_context():
        yield cursor

    vector._get_cursor = _cursor_context

    with pytest.raises(RuntimeError, match="permission denied"):
        vector._create_collection_if_not_exists(embedding_dimension=3)


def test_delete_methods_raise_when_error_is_not_missing_table():
    vector = AnalyticdbVectorBySql.__new__(AnalyticdbVectorBySql)
    vector.table_name = "dify.collection"
    cursor = MagicMock()

    @contextmanager
    def _cursor_context():
        yield cursor

    vector._get_cursor = _cursor_context

    cursor.execute.side_effect = RuntimeError("unexpected delete failure")
    with pytest.raises(RuntimeError, match="unexpected delete failure"):
        vector.delete_by_ids(["doc-1"])

    cursor.execute.side_effect = RuntimeError("unexpected metadata failure")
    with pytest.raises(RuntimeError, match="unexpected metadata failure"):
        vector.delete_by_metadata_field("document_id", "doc-1")
