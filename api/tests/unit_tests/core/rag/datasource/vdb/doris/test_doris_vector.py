"""
Comprehensive unit tests for Apache Doris vector database implementation.

Tests cover:
- DorisConfig validation
- DorisConnectionPool
- DorisVector CRUD operations
- Vector search and full-text search
- StreamLoad functionality
- Error handling
"""

import unittest
from unittest.mock import MagicMock, patch

import pytest

from core.rag.datasource.vdb.doris.doris_vector import (
    DorisConfig,
    DorisConnectionPool,
    DorisVector,
    DorisVectorFactory,
)
from core.rag.models.document import Document


class TestDorisConfig(unittest.TestCase):
    """Tests for DorisConfig validation."""

    def test_valid_config(self):
        """Test that valid config is accepted."""
        config = DorisConfig(
            host="localhost",
            port=9030,
            user="root",
            password="password",
            database="test_db",
            max_connection=5,
        )
        assert config.host == "localhost"
        assert config.port == 9030
        assert config.enable_text_search is True  # default
        assert config.text_search_analyzer == "english"  # default
        assert config.streamload_port == 8030  # default
        assert config.streamload_scheme == "http"  # default
        assert config.streamload_max_filter_ratio == 0.1  # default
        assert config.table_replication_num == 1  # default
        assert config.table_buckets == 10  # default

    def test_missing_host_raises_error(self):
        """Test that missing host raises ValueError."""
        with pytest.raises(ValueError, match="DORIS_HOST is required"):
            DorisConfig(
                host="",
                port=9030,
                user="root",
                password="password",
                database="test_db",
                max_connection=5,
            )

    def test_missing_user_raises_error(self):
        """Test that missing user raises ValueError."""
        with pytest.raises(ValueError, match="DORIS_USER is required"):
            DorisConfig(
                host="localhost",
                port=9030,
                user="",
                password="password",
                database="test_db",
                max_connection=5,
            )

    def test_missing_password_raises_error(self):
        """Test that missing password raises ValueError."""
        with pytest.raises(ValueError, match="DORIS_PASSWORD is required"):
            DorisConfig(
                host="localhost",
                port=9030,
                user="root",
                password="",
                database="test_db",
                max_connection=5,
            )

    def test_missing_database_raises_error(self):
        """Test that missing database raises ValueError."""
        with pytest.raises(ValueError, match="DORIS_DATABASE is required"):
            DorisConfig(
                host="localhost",
                port=9030,
                user="root",
                password="password",
                database="",
                max_connection=5,
            )

    def test_custom_text_search_settings(self):
        """Test custom text search settings."""
        config = DorisConfig(
            host="localhost",
            port=9030,
            user="root",
            password="password",
            database="test_db",
            max_connection=5,
            enable_text_search=False,
            text_search_analyzer="chinese",
            streamload_port=8030,
        )
        assert config.enable_text_search is False
        assert config.text_search_analyzer == "chinese"
        assert config.streamload_port == 8030

    def test_invalid_analyzer_raises_error(self):
        """Test that invalid text_search_analyzer raises ValueError."""
        with pytest.raises(ValueError, match="must be one of"):
            DorisConfig(
                host="localhost",
                port=9030,
                user="root",
                password="password",
                database="test_db",
                max_connection=5,
                text_search_analyzer="invalid_analyzer",
            )

    def test_invalid_scheme_raises_error(self):
        """Test that invalid streamload_scheme raises ValueError."""
        with pytest.raises(ValueError, match="must be 'http' or 'https'"):
            DorisConfig(
                host="localhost",
                port=9030,
                user="root",
                password="password",
                database="test_db",
                max_connection=5,
                streamload_scheme="ftp",
            )

    def test_custom_table_properties(self):
        """Test custom table replication and bucket settings."""
        config = DorisConfig(
            host="localhost",
            port=9030,
            user="root",
            password="password",
            database="test_db",
            max_connection=5,
            table_replication_num=3,
            table_buckets=20,
        )
        assert config.table_replication_num == 3
        assert config.table_buckets == 20

    def test_https_scheme(self):
        """Test that https scheme is accepted."""
        config = DorisConfig(
            host="localhost",
            port=9030,
            user="root",
            password="password",
            database="test_db",
            max_connection=5,
            streamload_scheme="https",
        )
        assert config.streamload_scheme == "https"


class TestDorisConnectionPool(unittest.TestCase):
    """Tests for DorisConnectionPool."""

    def setUp(self):
        self.config = DorisConfig(
            host="localhost",
            port=9030,
            user="root",
            password="test_password",
            database="test_db",
            max_connection=5,
        )

    @patch("core.rag.datasource.vdb.doris.doris_vector.pooling.MySQLConnectionPool")
    def test_pool_initialization(self, mock_pool_class):
        """Test connection pool initialization."""
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        pool = DorisConnectionPool(self.config)

        mock_pool_class.assert_called_once()
        call_kwargs = mock_pool_class.call_args[1]
        assert call_kwargs["host"] == "localhost"
        assert call_kwargs["port"] == 9030
        assert call_kwargs["user"] == "root"
        assert call_kwargs["database"] == "test_db"
        assert call_kwargs["pool_size"] == 5

    @patch("core.rag.datasource.vdb.doris.doris_vector.pooling.MySQLConnectionPool")
    def test_get_connection(self, mock_pool_class):
        """Test getting a connection from pool."""
        mock_pool = MagicMock()
        mock_conn = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_pool_class.return_value = mock_pool

        pool = DorisConnectionPool(self.config)
        conn = pool.get_connection()

        assert conn == mock_conn
        mock_pool.get_connection.assert_called_once()


class TestDorisVector(unittest.TestCase):
    """Tests for DorisVector operations."""

    def setUp(self):
        self.config = DorisConfig(
            host="localhost",
            port=9030,
            user="root",
            password="test_password",
            database="test_db",
            max_connection=5,
            enable_text_search=True,
            text_search_analyzer="english",
            streamload_port=8030,
        )
        self.collection_name = "test_collection"
        self.attributes = []

        # Sample documents for testing
        self.sample_documents = [
            Document(
                page_content="This is a test document about AI.",
                metadata={"doc_id": "doc1", "document_id": "dataset1", "source": "test"},
            ),
            Document(
                page_content="Another document about machine learning.",
                metadata={"doc_id": "doc2", "document_id": "dataset1", "source": "test"},
            ),
        ]

        # Sample embeddings (4-dimensional for testing)
        self.sample_embeddings = [[0.1, 0.2, 0.3, 0.4], [0.5, 0.6, 0.7, 0.8]]

    @patch("core.rag.datasource.vdb.doris.doris_vector.DorisConnectionPool")
    def test_init(self, mock_pool_class):
        """Test DorisVector initialization."""
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        doris_vector = DorisVector(self.collection_name, self.config, self.attributes)

        assert doris_vector.collection_name == self.collection_name
        assert doris_vector.table_name == f"embedding_{self.collection_name}"
        assert doris_vector.get_type() == "doris"
        assert doris_vector._pool is not None

    @patch("core.rag.datasource.vdb.doris.doris_vector.DorisConnectionPool")
    def test_get_type(self, mock_pool_class):
        """Test get_type returns 'doris'."""
        mock_pool_class.return_value = MagicMock()

        doris_vector = DorisVector(self.collection_name, self.config, self.attributes)

        assert doris_vector.get_type() == "doris"

    @patch("core.rag.datasource.vdb.doris.doris_vector.DorisConnectionPool")
    @patch("core.rag.datasource.vdb.doris.doris_vector.redis_client")
    def test_create_collection_with_vector_index(self, mock_redis, mock_pool_class):
        """Test that collection creation includes proper ANN vector index."""
        # Mock Redis operations
        mock_redis.lock.return_value.__enter__ = MagicMock()
        mock_redis.lock.return_value.__exit__ = MagicMock()
        mock_redis.get.return_value = None
        mock_redis.set.return_value = None

        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        # Mock connection and cursor
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock()

        doris_vector = DorisVector(self.collection_name, self.config, self.attributes)

        # Create collection with dimension 4
        dimension = 4
        doris_vector._create_collection(dimension)

        # Verify execute was called with USE, CREATE TABLE and CREATE INDEX
        execute_calls = mock_cursor.execute.call_args_list

        # Check that we have at least 3 execute calls (USE + table + vector index)
        assert len(execute_calls) >= 3, f"Expected at least 3 execute calls, got {len(execute_calls)}"

        # Extract SQL statements from calls (first call is USE database)
        create_table_sql = execute_calls[1][0][0]
        create_index_sql = execute_calls[2][0][0]

        # Verify CREATE TABLE
        assert "CREATE TABLE IF NOT EXISTS" in create_table_sql
        assert "embedding ARRAY<FLOAT> NOT NULL" in create_table_sql
        assert "ENGINE=OLAP" in create_table_sql

        # Verify CREATE INDEX with ANN
        assert "CREATE INDEX IF NOT EXISTS" in create_index_sql
        assert "USING ANN" in create_index_sql
        assert '"index_type" = "hnsw"' in create_index_sql
        assert '"metric_type" = "l2_distance"' in create_index_sql
        assert f'"dim" = "{dimension}"' in create_index_sql

        # Verify Redis cache was set
        mock_redis.set.assert_called_once()

    @patch("core.rag.datasource.vdb.doris.doris_vector.DorisConnectionPool")
    @patch("core.rag.datasource.vdb.doris.doris_vector.redis_client")
    def test_create_collection_with_text_index(self, mock_redis, mock_pool_class):
        """Test that collection creation includes inverted index for text search."""
        # Mock Redis operations
        mock_redis.lock.return_value.__enter__ = MagicMock()
        mock_redis.lock.return_value.__exit__ = MagicMock()
        mock_redis.get.return_value = None
        mock_redis.set.return_value = None

        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        # Mock connection and cursor
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock()

        # Create DorisVector with text search enabled
        doris_vector = DorisVector(self.collection_name, self.config, self.attributes)

        # Create collection
        dimension = 4
        doris_vector._create_collection(dimension)

        # Verify execute was called at least 5 times:
        # USE + table + vector index + SHOW ALTER (wait) + text index
        execute_calls = mock_cursor.execute.call_args_list
        assert len(execute_calls) >= 5, f"Expected at least 5 execute calls for text search, got {len(execute_calls)}"

        # Find the text index SQL (should be the last CREATE INDEX with INVERTED)
        text_index_sql = None
        for call in execute_calls:
            sql = call[0][0]
            if "USING INVERTED" in sql:
                text_index_sql = sql
                break

        # Verify CREATE INDEX for text search was found
        assert text_index_sql is not None, "Text index SQL not found"
        assert "CREATE INDEX IF NOT EXISTS" in text_index_sql
        assert "USING INVERTED" in text_index_sql
        assert '"parser" = "english"' in text_index_sql
        assert '"support_phrase" = "true"' in text_index_sql

    @patch("core.rag.datasource.vdb.doris.doris_vector.DorisConnectionPool")
    @patch("core.rag.datasource.vdb.doris.doris_vector.redis_client")
    def test_create_collection_uses_cache(self, mock_redis, mock_pool_class):
        """Test that collection creation is skipped if already cached."""
        # Mock Redis to return cached value
        mock_redis.lock.return_value.__enter__ = MagicMock()
        mock_redis.lock.return_value.__exit__ = MagicMock()
        mock_redis.get.return_value = 1  # Already cached

        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        doris_vector = DorisVector(self.collection_name, self.config, self.attributes)

        # Create collection
        dimension = 4
        doris_vector._create_collection(dimension)

        # Verify no connection was attempted (cache hit)
        mock_pool.get_connection.assert_not_called()

    @patch("core.rag.datasource.vdb.doris.doris_vector.DorisConnectionPool")
    @patch("core.rag.datasource.vdb.doris.doris_vector.redis_client")
    def test_text_exists(self, mock_redis, mock_pool_class):
        """Test text_exists method."""
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.return_value = {"id": "doc1"}

        doris_vector = DorisVector(self.collection_name, self.config, self.attributes)
        result = doris_vector.text_exists("doc1")

        assert result is True
        # Execute is called twice: USE database + SELECT query
        assert mock_cursor.execute.call_count == 2
        call_sql = mock_cursor.execute.call_args_list[1][0][0]
        assert "SELECT id FROM" in call_sql
        assert "WHERE id = %s" in call_sql

    @patch("core.rag.datasource.vdb.doris.doris_vector.DorisConnectionPool")
    @patch("core.rag.datasource.vdb.doris.doris_vector.redis_client")
    def test_text_not_exists(self, mock_redis, mock_pool_class):
        """Test text_exists returns False when document doesn't exist."""
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.return_value = None

        doris_vector = DorisVector(self.collection_name, self.config, self.attributes)
        result = doris_vector.text_exists("nonexistent_doc")

        assert result is False

    @patch("core.rag.datasource.vdb.doris.doris_vector.DorisConnectionPool")
    @patch("core.rag.datasource.vdb.doris.doris_vector.redis_client")
    def test_delete_by_ids(self, mock_redis, mock_pool_class):
        """Test delete_by_ids method."""
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor

        doris_vector = DorisVector(self.collection_name, self.config, self.attributes)
        doris_vector.delete_by_ids(["doc1", "doc2"])

        # Execute is called twice: USE database + DELETE query
        assert mock_cursor.execute.call_count == 2
        call_sql = mock_cursor.execute.call_args_list[1][0][0]
        assert "DELETE FROM" in call_sql
        assert "id IN" in call_sql

    @patch("core.rag.datasource.vdb.doris.doris_vector.DorisConnectionPool")
    @patch("core.rag.datasource.vdb.doris.doris_vector.redis_client")
    def test_delete_by_metadata_field(self, mock_redis, mock_pool_class):
        """Test delete_by_metadata_field method."""
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor

        doris_vector = DorisVector(self.collection_name, self.config, self.attributes)
        doris_vector.delete_by_metadata_field("document_id", "dataset1")

        # Execute is called twice: USE database + DELETE query
        assert mock_cursor.execute.call_count == 2
        call_sql = mock_cursor.execute.call_args_list[1][0][0]
        assert "DELETE FROM" in call_sql
        assert "JSON_EXTRACT(meta, %s)" in call_sql

    @patch("core.rag.datasource.vdb.doris.doris_vector.DorisConnectionPool")
    @patch("core.rag.datasource.vdb.doris.doris_vector.redis_client")
    def test_delete_collection(self, mock_redis, mock_pool_class):
        """Test delete method drops the table."""
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor

        doris_vector = DorisVector(self.collection_name, self.config, self.attributes)
        doris_vector.delete()

        # Execute is called twice: USE database + DROP TABLE query
        assert mock_cursor.execute.call_count == 2
        call_sql = mock_cursor.execute.call_args_list[1][0][0]
        assert "DROP TABLE IF EXISTS" in call_sql

    @patch("core.rag.datasource.vdb.doris.doris_vector.DorisConnectionPool")
    @patch("core.rag.datasource.vdb.doris.doris_vector.redis_client")
    def test_search_by_vector(self, mock_redis, mock_pool_class):
        """Test search_by_vector method."""
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor

        # Mock search results (dictionary format since cursor is created with dictionary=True)
        mock_cursor.fetchall.return_value = [
            {"meta": '{"doc_id": "doc1", "source": "test"}', "text": "Test content", "distance": 0.05},
        ]

        doris_vector = DorisVector(self.collection_name, self.config, self.attributes)
        results = doris_vector.search_by_vector(
            query_vector=[0.1, 0.2, 0.3, 0.4],
            top_k=5,
        )

        assert len(results) == 1
        assert results[0].metadata["doc_id"] == "doc1"
        # Execute is called twice: USE database + SELECT query
        assert mock_cursor.execute.call_count == 2
        call_sql = mock_cursor.execute.call_args_list[1][0][0]
        assert "cosine_distance" in call_sql

    @patch("core.rag.datasource.vdb.doris.doris_vector.DorisConnectionPool")
    @patch("core.rag.datasource.vdb.doris.doris_vector.redis_client")
    def test_search_by_full_text(self, mock_redis, mock_pool_class):
        """Test search_by_full_text method."""
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor

        # Mock search results (dictionary format since cursor is created with dictionary=True)
        mock_cursor.fetchall.return_value = [
            {"meta": '{"doc_id": "doc1", "source": "test"}', "text": "Test content about AI", "relevance": 2.5},
        ]

        doris_vector = DorisVector(self.collection_name, self.config, self.attributes)
        results = doris_vector.search_by_full_text(
            query="AI test",
            top_k=5,
        )

        assert len(results) == 1
        assert results[0].metadata["doc_id"] == "doc1"
        # Execute is called twice: USE database + SELECT query
        assert mock_cursor.execute.call_count == 2
        call_sql = mock_cursor.execute.call_args_list[1][0][0]
        assert "MATCH_ANY" in call_sql

    @patch("core.rag.datasource.vdb.doris.doris_vector.DorisConnectionPool")
    @patch("core.rag.datasource.vdb.doris.doris_vector.redis_client")
    @patch("core.rag.datasource.vdb.doris.doris_vector.httpx.Client")
    def test_streamload(self, mock_httpx_client, mock_redis, mock_pool_class):
        """Test _streamload method for data insertion."""
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        # Mock HTTP client for StreamLoad
        mock_client_instance = MagicMock()
        mock_httpx_client.return_value.__enter__ = MagicMock(return_value=mock_client_instance)
        mock_httpx_client.return_value.__exit__ = MagicMock()

        mock_response = MagicMock()
        mock_response.json.return_value = {"Status": "Success", "NumberLoadedRows": 2}
        mock_client_instance.put.return_value = mock_response

        doris_vector = DorisVector(self.collection_name, self.config, self.attributes)

        # Prepare test data
        data = [
            {"doc_id": "doc1", "text": "content1", "embedding": [0.1, 0.2]},
            {"doc_id": "doc2", "text": "content2", "embedding": [0.3, 0.4]},
        ]

        doris_vector._streamload(data)

        mock_client_instance.put.assert_called_once()
        call_kwargs = mock_client_instance.put.call_args
        assert "Content-Type" in str(call_kwargs) or call_kwargs[1].get("headers", {}).get("Content-Type")


class TestDorisVectorFactory(unittest.TestCase):
    """Tests for DorisVectorFactory."""

    @patch("core.rag.datasource.vdb.doris.doris_vector.DorisConnectionPool")
    @patch("core.rag.datasource.vdb.doris.doris_vector.dify_config")
    def test_factory_creates_vector_from_dataset(self, mock_dify_config, mock_pool_class):
        """Test factory creates DorisVector from dataset with dify_config."""
        mock_pool_class.return_value = MagicMock()
        mock_dify_config.DORIS_HOST = "localhost"
        mock_dify_config.DORIS_PORT = 9030
        mock_dify_config.DORIS_USER = "root"
        mock_dify_config.DORIS_PASSWORD = "password"
        mock_dify_config.DORIS_DATABASE = "test_db"
        mock_dify_config.DORIS_MAX_CONNECTION = 5
        mock_dify_config.DORIS_ENABLE_TEXT_SEARCH = True
        mock_dify_config.DORIS_TEXT_SEARCH_ANALYZER = "english"
        mock_dify_config.DORIS_STREAMLOAD_PORT = 8030
        mock_dify_config.DORIS_STREAMLOAD_SCHEME = "http"
        mock_dify_config.DORIS_STREAMLOAD_MAX_FILTER_RATIO = 0.1
        mock_dify_config.DORIS_TABLE_REPLICATION_NUM = 1
        mock_dify_config.DORIS_TABLE_BUCKETS = 10

        # Create mock dataset
        mock_dataset = MagicMock()
        mock_dataset.id = "test-dataset-id"
        mock_dataset.index_struct_dict = None

        # Create mock embeddings
        mock_embeddings = MagicMock()

        factory = DorisVectorFactory()
        vector = factory.init_vector(mock_dataset, [], mock_embeddings)

        assert isinstance(vector, DorisVector)
        assert vector._config.host == "localhost"
        assert vector._config.port == 9030
        assert vector._config.database == "test_db"


if __name__ == "__main__":
    unittest.main()
