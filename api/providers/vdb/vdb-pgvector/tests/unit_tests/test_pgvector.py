from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import dify_vdb_pgvector.pgvector as pgvector_module
import pytest
from dify_vdb_pgvector.pgvector import PGVector, PGVectorConfig

from core.rag.models.document import Document


class TestPGVector:
    def setup_method(self, method):
        self.config = PGVectorConfig(
            host="localhost",
            port=5432,
            user="test_user",
            password="test_password",
            database="test_db",
            min_connection=1,
            max_connection=5,
            pg_bigm=False,
        )
        self.collection_name = "test_collection"

    @patch("dify_vdb_pgvector.pgvector.psycopg2.pool.SimpleConnectionPool")
    def test_init(self, mock_pool_class):
        """Test PGVector initialization."""
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        pgvector = PGVector(self.collection_name, self.config)

        assert pgvector._collection_name == self.collection_name
        assert pgvector.table_name == f"embedding_{self.collection_name}"
        assert pgvector.get_type() == "pgvector"
        assert pgvector.pool is not None
        assert pgvector.pg_bigm is False
        assert pgvector.index_hash is not None

    @patch("dify_vdb_pgvector.pgvector.psycopg2.pool.SimpleConnectionPool")
    def test_init_with_pg_bigm(self, mock_pool_class):
        """Test PGVector initialization with pg_bigm enabled."""
        config = PGVectorConfig(
            host="localhost",
            port=5432,
            user="test_user",
            password="test_password",
            database="test_db",
            min_connection=1,
            max_connection=5,
            pg_bigm=True,
        )
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        pgvector = PGVector(self.collection_name, config)

        assert pgvector.pg_bigm is True

    @patch("dify_vdb_pgvector.pgvector.psycopg2.pool.SimpleConnectionPool")
    @patch("dify_vdb_pgvector.pgvector.redis_client")
    def test_create_collection_basic(self, mock_redis, mock_pool_class):
        """Test basic collection creation."""
        # Mock Redis operations
        mock_lock = MagicMock()
        mock_lock.__enter__ = MagicMock()
        mock_lock.__exit__ = MagicMock()
        mock_redis.lock.return_value = mock_lock
        mock_redis.get.return_value = None
        mock_redis.set.return_value = None

        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        # Mock connection and cursor
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.getconn.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.return_value = [1]  # vector extension exists

        pgvector = PGVector(self.collection_name, self.config)
        pgvector._create_collection(1536)

        # Verify SQL execution calls
        assert mock_cursor.execute.called

        # Check that CREATE TABLE was called with correct dimension
        create_table_calls = [call for call in mock_cursor.execute.call_args_list if "CREATE TABLE" in str(call)]
        assert len(create_table_calls) == 1
        assert "vector(1536)" in create_table_calls[0][0][0]

        # Check that CREATE INDEX was called (dimension <= 2000)
        create_index_calls = [
            call for call in mock_cursor.execute.call_args_list if "CREATE INDEX" in str(call) and "hnsw" in str(call)
        ]
        assert len(create_index_calls) == 1

        # Verify Redis cache was set
        mock_redis.set.assert_called_once()

    @patch("dify_vdb_pgvector.pgvector.psycopg2.pool.SimpleConnectionPool")
    @patch("dify_vdb_pgvector.pgvector.redis_client")
    def test_create_collection_with_large_dimension(self, mock_redis, mock_pool_class):
        """Test collection creation with dimension > 2000 (no HNSW index)."""
        # Mock Redis operations
        mock_lock = MagicMock()
        mock_lock.__enter__ = MagicMock()
        mock_lock.__exit__ = MagicMock()
        mock_redis.lock.return_value = mock_lock
        mock_redis.get.return_value = None
        mock_redis.set.return_value = None

        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        # Mock connection and cursor
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.getconn.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.return_value = [1]  # vector extension exists

        pgvector = PGVector(self.collection_name, self.config)
        pgvector._create_collection(3072)  # Dimension > 2000

        # Check that CREATE TABLE was called
        create_table_calls = [call for call in mock_cursor.execute.call_args_list if "CREATE TABLE" in str(call)]
        assert len(create_table_calls) == 1
        assert "vector(3072)" in create_table_calls[0][0][0]

        # Check that HNSW index was NOT created (dimension > 2000)
        hnsw_index_calls = [call for call in mock_cursor.execute.call_args_list if "hnsw" in str(call)]
        assert len(hnsw_index_calls) == 0

    @patch("dify_vdb_pgvector.pgvector.psycopg2.pool.SimpleConnectionPool")
    @patch("dify_vdb_pgvector.pgvector.redis_client")
    def test_create_collection_with_pg_bigm(self, mock_redis, mock_pool_class):
        """Test collection creation with pg_bigm enabled."""
        config = PGVectorConfig(
            host="localhost",
            port=5432,
            user="test_user",
            password="test_password",
            database="test_db",
            min_connection=1,
            max_connection=5,
            pg_bigm=True,
        )

        # Mock Redis operations
        mock_lock = MagicMock()
        mock_lock.__enter__ = MagicMock()
        mock_lock.__exit__ = MagicMock()
        mock_redis.lock.return_value = mock_lock
        mock_redis.get.return_value = None
        mock_redis.set.return_value = None

        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        # Mock connection and cursor
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.getconn.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.return_value = [1]  # vector extension exists

        pgvector = PGVector(self.collection_name, config)
        pgvector._create_collection(1536)

        # Check that pg_bigm index was created
        bigm_index_calls = [call for call in mock_cursor.execute.call_args_list if "gin_bigm_ops" in str(call)]
        assert len(bigm_index_calls) == 1

    @patch("dify_vdb_pgvector.pgvector.psycopg2.pool.SimpleConnectionPool")
    @patch("dify_vdb_pgvector.pgvector.redis_client")
    def test_create_collection_creates_vector_extension(self, mock_redis, mock_pool_class):
        """Test that vector extension is created if it doesn't exist."""
        # Mock Redis operations
        mock_lock = MagicMock()
        mock_lock.__enter__ = MagicMock()
        mock_lock.__exit__ = MagicMock()
        mock_redis.lock.return_value = mock_lock
        mock_redis.get.return_value = None
        mock_redis.set.return_value = None

        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        # Mock connection and cursor
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.getconn.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        # First call: vector extension doesn't exist
        mock_cursor.fetchone.return_value = None

        pgvector = PGVector(self.collection_name, self.config)
        pgvector._create_collection(1536)

        # Check that CREATE EXTENSION was called
        create_extension_calls = [
            call for call in mock_cursor.execute.call_args_list if "CREATE EXTENSION vector" in str(call)
        ]
        assert len(create_extension_calls) == 1

    @patch("dify_vdb_pgvector.pgvector.psycopg2.pool.SimpleConnectionPool")
    @patch("dify_vdb_pgvector.pgvector.redis_client")
    def test_create_collection_with_cache_hit(self, mock_redis, mock_pool_class):
        """Test that collection creation is skipped when cache exists."""
        # Mock Redis operations - cache exists
        mock_lock = MagicMock()
        mock_lock.__enter__ = MagicMock()
        mock_lock.__exit__ = MagicMock()
        mock_redis.lock.return_value = mock_lock
        mock_redis.get.return_value = 1  # Cache exists

        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        # Mock connection and cursor
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.getconn.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor

        pgvector = PGVector(self.collection_name, self.config)
        pgvector._create_collection(1536)

        # Check that no SQL was executed (early return due to cache)
        assert mock_cursor.execute.call_count == 0

    @patch("dify_vdb_pgvector.pgvector.psycopg2.pool.SimpleConnectionPool")
    @patch("dify_vdb_pgvector.pgvector.redis_client")
    def test_create_collection_with_redis_lock(self, mock_redis, mock_pool_class):
        """Test that Redis lock is used during collection creation."""
        # Mock Redis operations
        mock_lock = MagicMock()
        mock_lock.__enter__ = MagicMock()
        mock_lock.__exit__ = MagicMock()
        mock_redis.lock.return_value = mock_lock
        mock_redis.get.return_value = None
        mock_redis.set.return_value = None

        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        # Mock connection and cursor
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.getconn.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.return_value = [1]  # vector extension exists

        pgvector = PGVector(self.collection_name, self.config)
        pgvector._create_collection(1536)

        # Verify Redis lock was acquired with correct lock name
        mock_redis.lock.assert_called_once_with("vector_indexing_test_collection_lock", timeout=20)

        # Verify lock context manager was entered and exited
        mock_lock.__enter__.assert_called_once()
        mock_lock.__exit__.assert_called_once()

    @patch("dify_vdb_pgvector.pgvector.psycopg2.pool.SimpleConnectionPool")
    def test_get_cursor_context_manager(self, mock_pool_class):
        """Test that _get_cursor properly manages connection lifecycle."""
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.getconn.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor

        pgvector = PGVector(self.collection_name, self.config)

        with pgvector._get_cursor() as cur:
            assert cur == mock_cursor

        # Verify connection lifecycle methods were called
        mock_pool.getconn.assert_called_once()
        mock_cursor.close.assert_called_once()
        mock_conn.commit.assert_called_once()
        mock_pool.putconn.assert_called_once_with(mock_conn)


@pytest.mark.parametrize(
    "invalid_config_override",
    [
        {"host": ""},  # Test empty host
        {"port": 0},  # Test invalid port
        {"user": ""},  # Test empty user
        {"password": ""},  # Test empty password
        {"database": ""},  # Test empty database
        {"min_connection": 0},  # Test invalid min_connection
        {"max_connection": 0},  # Test invalid max_connection
        {"min_connection": 10, "max_connection": 5},  # Test min > max
    ],
)
def test_config_validation_parametrized(invalid_config_override):
    """Test configuration validation for various invalid inputs using parametrize."""
    config = {
        "host": "localhost",
        "port": 5432,
        "user": "test_user",
        "password": "test_password",
        "database": "test_db",
        "min_connection": 1,
        "max_connection": 5,
    }
    config.update(invalid_config_override)

    with pytest.raises(ValueError):
        PGVectorConfig(**config)


def test_create_delegates_collection_creation_and_insert():
    vector = PGVector.__new__(PGVector)
    vector._create_collection = MagicMock()
    vector.add_texts = MagicMock(return_value=["doc-a"])
    docs = [Document(page_content="hello", metadata={"doc_id": "doc-a"})]

    result = vector.create(docs, [[0.1, 0.2]])

    assert result == ["doc-a"]
    vector._create_collection.assert_called_once_with(2)
    vector.add_texts.assert_called_once_with(docs, [[0.1, 0.2]])


def test_add_texts_uses_execute_values_and_returns_ids(monkeypatch: pytest.MonkeyPatch):
    vector = PGVector.__new__(PGVector)
    vector.table_name = "embedding_collection_1"

    cursor = MagicMock()

    @contextmanager
    def _cursor_ctx():
        yield cursor

    vector._get_cursor = _cursor_ctx
    monkeypatch.setattr(pgvector_module.uuid, "uuid4", lambda: "generated-uuid")
    execute_values = MagicMock()
    monkeypatch.setattr(pgvector_module.psycopg2.extras, "execute_values", execute_values)

    docs = [
        Document(page_content="a", metadata={"doc_id": "doc-a"}),
        Document(page_content="b", metadata={"document_id": "doc-b"}),
        SimpleNamespace(page_content="c", metadata=None),
    ]
    ids = vector.add_texts(docs, [[0.1], [0.2], [0.3]])

    assert ids == ["doc-a", "generated-uuid"]
    execute_values.assert_called_once()


def test_text_get_and_delete_methods():
    vector = PGVector.__new__(PGVector)
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

    vector.delete_by_metadata_field("document_id", "doc-1")
    vector.delete()
    executed_sql = [call.args[0] for call in cursor.execute.call_args_list]
    assert any("meta->>%s = %s" in sql for sql in executed_sql)
    assert any("DROP TABLE IF EXISTS embedding_collection_1" in sql for sql in executed_sql)


def test_delete_by_ids_handles_empty_undefined_table_and_generic_exception(monkeypatch: pytest.MonkeyPatch):
    vector = PGVector.__new__(PGVector)
    vector.table_name = "embedding_collection_1"
    cursor = MagicMock()

    @contextmanager
    def _cursor_ctx():
        yield cursor

    vector._get_cursor = _cursor_ctx
    vector.delete_by_ids([])
    cursor.execute.assert_not_called()

    class _UndefinedTableError(Exception):
        pass

    monkeypatch.setattr(pgvector_module.psycopg2.errors, "UndefinedTable", _UndefinedTableError)
    cursor.execute.side_effect = _UndefinedTableError("missing")
    vector.delete_by_ids(["doc-1"])

    cursor.execute.side_effect = RuntimeError("boom")
    with pytest.raises(RuntimeError, match="boom"):
        vector.delete_by_ids(["doc-1"])


def test_search_by_vector_supports_filter_and_threshold():
    vector = PGVector.__new__(PGVector)
    vector.table_name = "embedding_collection_1"
    cursor = MagicMock()
    cursor.__iter__.return_value = iter([({"doc_id": "1"}, "text-1", 0.1), ({"doc_id": "2"}, "text-2", 0.8)])

    @contextmanager
    def _cursor_ctx():
        yield cursor

    vector._get_cursor = _cursor_ctx

    with pytest.raises(ValueError, match="top_k must be a positive integer"):
        vector.search_by_vector([0.1], top_k=0)

    docs = vector.search_by_vector([0.1, 0.2], top_k=2, score_threshold=0.5, document_ids_filter=["d-1"])
    assert len(docs) == 1
    assert docs[0].metadata["score"] == pytest.approx(0.9)
    sql = cursor.execute.call_args.args[0]
    assert "meta->>'document_id' in ('d-1')" in sql


def test_search_by_full_text_branches_for_bigm_and_standard():
    vector = PGVector.__new__(PGVector)
    vector.table_name = "embedding_collection_1"
    cursor = MagicMock()
    cursor.__iter__.return_value = iter([({"doc_id": "1"}, "text-1", 0.7)])

    @contextmanager
    def _cursor_ctx():
        yield cursor

    vector._get_cursor = _cursor_ctx

    with pytest.raises(ValueError, match="top_k must be a positive integer"):
        vector.search_by_full_text("hello", top_k=0)

    vector.pg_bigm = False
    docs = vector.search_by_full_text("hello world", top_k=2, document_ids_filter=["d-1"])
    assert len(docs) == 1
    assert docs[0].metadata["score"] == pytest.approx(0.7)
    standard_sql = cursor.execute.call_args.args[0]
    assert "to_tsvector(text) @@ plainto_tsquery(%s)" in standard_sql

    cursor.execute.reset_mock()
    cursor.__iter__.return_value = iter([({"doc_id": "2"}, "text-2", 0.6)])
    vector.pg_bigm = True
    vector.search_by_full_text("hello world", top_k=2, document_ids_filter=["d-2"])
    assert "SET pg_bigm.similarity_limit TO 0.000001" in cursor.execute.call_args_list[0].args[0]
    assert "bigm_similarity" in cursor.execute.call_args_list[1].args[0]


def test_pgvector_factory_initializes_expected_collection_name(monkeypatch: pytest.MonkeyPatch):
    factory = pgvector_module.PGVectorFactory()
    dataset_with_index = SimpleNamespace(
        id="dataset-1",
        index_struct_dict={"vector_store": {"class_prefix": "EXISTING_COLLECTION"}},
        index_struct=None,
    )
    dataset_without_index = SimpleNamespace(id="dataset-2", index_struct_dict=None, index_struct=None)

    monkeypatch.setattr(pgvector_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")
    monkeypatch.setattr(pgvector_module.dify_config, "PGVECTOR_HOST", "localhost")
    monkeypatch.setattr(pgvector_module.dify_config, "PGVECTOR_PORT", 5432)
    monkeypatch.setattr(pgvector_module.dify_config, "PGVECTOR_USER", "postgres")
    monkeypatch.setattr(pgvector_module.dify_config, "PGVECTOR_PASSWORD", "secret")
    monkeypatch.setattr(pgvector_module.dify_config, "PGVECTOR_DATABASE", "postgres")
    monkeypatch.setattr(pgvector_module.dify_config, "PGVECTOR_MIN_CONNECTION", 1)
    monkeypatch.setattr(pgvector_module.dify_config, "PGVECTOR_MAX_CONNECTION", 5)
    monkeypatch.setattr(pgvector_module.dify_config, "PGVECTOR_PG_BIGM", False)

    with patch.object(pgvector_module, "PGVector", return_value="vector") as vector_cls:
        result_1 = factory.init_vector(dataset_with_index, attributes=[], embeddings=MagicMock())
        result_2 = factory.init_vector(dataset_without_index, attributes=[], embeddings=MagicMock())

    assert result_1 == "vector"
    assert result_2 == "vector"
    assert vector_cls.call_args_list[0].kwargs["collection_name"] == "EXISTING_COLLECTION"
    assert vector_cls.call_args_list[1].kwargs["collection_name"] == "AUTO_COLLECTION"
    assert dataset_without_index.index_struct is not None
