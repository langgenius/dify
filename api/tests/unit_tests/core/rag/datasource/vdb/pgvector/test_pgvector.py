import unittest
from unittest.mock import MagicMock, patch

import pytest

from core.rag.datasource.vdb.pgvector.pgvector import (
    PGVector,
    PGVectorConfig,
)


class TestPGVector(unittest.TestCase):
    def setUp(self):
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

    @patch("core.rag.datasource.vdb.pgvector.pgvector.psycopg2.pool.SimpleConnectionPool")
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

    @patch("core.rag.datasource.vdb.pgvector.pgvector.psycopg2.pool.SimpleConnectionPool")
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

    @patch("core.rag.datasource.vdb.pgvector.pgvector.psycopg2.pool.SimpleConnectionPool")
    @patch("core.rag.datasource.vdb.pgvector.pgvector.redis_client")
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

    @patch("core.rag.datasource.vdb.pgvector.pgvector.psycopg2.pool.SimpleConnectionPool")
    @patch("core.rag.datasource.vdb.pgvector.pgvector.redis_client")
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

    @patch("core.rag.datasource.vdb.pgvector.pgvector.psycopg2.pool.SimpleConnectionPool")
    @patch("core.rag.datasource.vdb.pgvector.pgvector.redis_client")
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

    @patch("core.rag.datasource.vdb.pgvector.pgvector.psycopg2.pool.SimpleConnectionPool")
    @patch("core.rag.datasource.vdb.pgvector.pgvector.redis_client")
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

    @patch("core.rag.datasource.vdb.pgvector.pgvector.psycopg2.pool.SimpleConnectionPool")
    @patch("core.rag.datasource.vdb.pgvector.pgvector.redis_client")
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

    @patch("core.rag.datasource.vdb.pgvector.pgvector.psycopg2.pool.SimpleConnectionPool")
    @patch("core.rag.datasource.vdb.pgvector.pgvector.redis_client")
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

    @patch("core.rag.datasource.vdb.pgvector.pgvector.psycopg2.pool.SimpleConnectionPool")
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


if __name__ == "__main__":
    unittest.main()
