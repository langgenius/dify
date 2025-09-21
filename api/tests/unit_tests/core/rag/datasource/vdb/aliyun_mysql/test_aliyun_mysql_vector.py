import json
import unittest
from unittest.mock import MagicMock, patch, call

from core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector import AliyunMySQLVector, AliyunMySQLVectorConfig
from core.rag.models.document import Document
try:
    from mysql.connector import Error as MySQLError
except ImportError:
    # Fallback for testing environments where mysql-connector-python might not be installed
    class MySQLError(Exception):
        def __init__(self, errno, msg):
            self.errno = errno
            self.msg = msg
            super().__init__(msg)


class TestAliyunMySQLVector(unittest.TestCase):
    def setUp(self):
        self.config = AliyunMySQLVectorConfig(
            host="localhost",
            port=3306,
            user="test_user",
            password="test_password",
            database="test_db",
            min_connection=1,
            max_connection=5,
            charset="utf8mb4",
        )
        self.collection_name = "test_collection"

        # Sample documents for testing
        self.sample_documents = [
            Document(
                page_content="This is a test document about AI.",
                metadata={"doc_id": "doc1", "document_id": "dataset1", "source": "test"}
            ),
            Document(
                page_content="Another document about machine learning.",
                metadata={"doc_id": "doc2", "document_id": "dataset1", "source": "test"}
            )
        ]

        # Sample embeddings
        self.sample_embeddings = [
            [0.1, 0.2, 0.3, 0.4],
            [0.5, 0.6, 0.7, 0.8]
        ]

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.pooling.MySQLConnectionPool")
    def test_init(self, mock_pool_class):
        """Test AliyunMySQLVector initialization."""
        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        # Mock connection and cursor for vector support check
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},  # Version check
            {"vector_support": True}   # Vector support check
        ]

        aliyun_mysql_vector = AliyunMySQLVector(self.collection_name, self.config)

        self.assertEqual(aliyun_mysql_vector.collection_name, self.collection_name)
        self.assertEqual(aliyun_mysql_vector.table_name, self.collection_name.lower())
        self.assertEqual(aliyun_mysql_vector.get_type(), "aliyun_mysql")
        self.assertEqual(aliyun_mysql_vector.distance_function, "cosine")
        self.assertIsNotNone(aliyun_mysql_vector.pool)

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.pooling.MySQLConnectionPool")
    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.redis_client")
    def test_create_collection(self, mock_redis, mock_pool_class):
        """Test collection creation."""
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
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},  # Version check
            {"vector_support": True}   # Vector support check
        ]

        aliyun_mysql_vector = AliyunMySQLVector(self.collection_name, self.config)
        aliyun_mysql_vector._create_collection(768)

        # Verify SQL execution calls - should include table creation and index creation
        self.assertTrue(mock_cursor.execute.called)
        self.assertGreaterEqual(mock_cursor.execute.call_count, 3)  # CREATE TABLE + 2 indexes
        mock_redis.set.assert_called_once()

    def test_config_validation(self):
        """Test configuration validation."""
        # Test missing required fields
        with self.assertRaises(ValueError):
            AliyunMySQLVectorConfig(
                host="",  # Empty host should raise error
                port=3306,
                user="test",
                password="test",
                database="test",
                min_connection=1,
                max_connection=5,
            )


    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.pooling.MySQLConnectionPool")
    def test_vector_support_check_success(self, mock_pool_class):
        """Test successful vector support check."""
        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]

        # Should not raise an exception
        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        self.assertIsNotNone(vector_store)

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.pooling.MySQLConnectionPool")
    def test_vector_support_check_failure(self, mock_pool_class):
        """Test vector support check failure."""
        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.35"},
            {"vector_support": False}
        ]

        with self.assertRaises(ValueError) as context:
            AliyunMySQLVector(self.collection_name, self.config)

        self.assertIn("RDS MySQL Vector functions are not available", str(context.exception))

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.pooling.MySQLConnectionPool")
    def test_vector_support_check_function_error(self, mock_pool_class):
        """Test vector support check with function not found error."""
        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.return_value = {"VERSION()": "8.0.36"}
        mock_cursor.execute.side_effect = [None, MySQLError(errno=1305, msg="FUNCTION VEC_FromText does not exist")]

        with self.assertRaises(ValueError) as context:
            AliyunMySQLVector(self.collection_name, self.config)

        self.assertIn("RDS MySQL Vector functions are not available", str(context.exception))

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.pooling.MySQLConnectionPool")
    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.redis_client")
    def test_create_documents(self, mock_redis, mock_pool_class):
        """Test creating documents with embeddings."""
        # Setup mocks
        self._setup_mocks(mock_redis, mock_pool_class)

        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        result = vector_store.create(self.sample_documents, self.sample_embeddings)

        self.assertEqual(len(result), 2)
        self.assertIn("doc1", result)
        self.assertIn("doc2", result)

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.pooling.MySQLConnectionPool")
    def test_add_texts(self, mock_pool_class):
        """Test adding texts to the vector store."""
        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]

        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        result = vector_store.add_texts(self.sample_documents, self.sample_embeddings)

        self.assertEqual(len(result), 2)
        mock_cursor.executemany.assert_called_once()

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.pooling.MySQLConnectionPool")
    def test_text_exists(self, mock_pool_class):
        """Test checking if text exists."""
        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True},
            {"id": "doc1"}  # Text exists
        ]

        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        exists = vector_store.text_exists("doc1")

        self.assertTrue(exists)
        # Check that the correct SQL was executed (last call after init)
        execute_calls = mock_cursor.execute.call_args_list
        last_call = execute_calls[-1]
        self.assertIn("SELECT id FROM", last_call[0][0])
        self.assertEqual(last_call[0][1], ("doc1",))

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.pooling.MySQLConnectionPool")
    def test_text_not_exists(self, mock_pool_class):
        """Test checking if text does not exist."""
        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True},
            None  # Text does not exist
        ]

        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        exists = vector_store.text_exists("nonexistent")

        self.assertFalse(exists)

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.pooling.MySQLConnectionPool")
    def test_get_by_ids(self, mock_pool_class):
        """Test getting documents by IDs."""
        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]
        mock_cursor.__iter__ = lambda self: iter([
            {"meta": json.dumps({"doc_id": "doc1", "source": "test"}), "text": "Test document 1"},
            {"meta": json.dumps({"doc_id": "doc2", "source": "test"}), "text": "Test document 2"}
        ])

        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        docs = vector_store.get_by_ids(["doc1", "doc2"])

        self.assertEqual(len(docs), 2)
        self.assertEqual(docs[0].page_content, "Test document 1")
        self.assertEqual(docs[1].page_content, "Test document 2")

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.pooling.MySQLConnectionPool")
    def test_get_by_ids_empty_list(self, mock_pool_class):
        """Test getting documents with empty ID list."""
        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]

        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        docs = vector_store.get_by_ids([])

        self.assertEqual(len(docs), 0)

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.pooling.MySQLConnectionPool")
    def test_delete_by_ids(self, mock_pool_class):
        """Test deleting documents by IDs."""
        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]

        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        vector_store.delete_by_ids(["doc1", "doc2"])

        # Check that delete SQL was executed
        execute_calls = mock_cursor.execute.call_args_list
        delete_calls = [call for call in execute_calls if "DELETE" in str(call)]
        self.assertEqual(len(delete_calls), 1)
        delete_call = delete_calls[0]
        self.assertIn("DELETE FROM", delete_call[0][0])
        self.assertEqual(delete_call[0][1], ["doc1", "doc2"])

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.pooling.MySQLConnectionPool")
    def test_delete_by_ids_empty_list(self, mock_pool_class):
        """Test deleting with empty ID list."""
        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]

        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        vector_store.delete_by_ids([])  # Should not raise an exception

        # Verify no delete SQL was executed
        execute_calls = mock_cursor.execute.call_args_list
        delete_calls = [call for call in execute_calls if "DELETE" in str(call)]
        self.assertEqual(len(delete_calls), 0)

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.pooling.MySQLConnectionPool")
    def test_delete_by_ids_table_not_exists(self, mock_pool_class):
        """Test deleting when table doesn't exist."""
        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]
        # Simulate table doesn't exist error on delete
        def execute_side_effect(*args, **kwargs):
            if "DELETE" in args[0]:
                raise MySQLError(errno=1146, msg="Table doesn't exist")
        mock_cursor.execute.side_effect = execute_side_effect

        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        # Should not raise an exception
        vector_store.delete_by_ids(["doc1"])

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.pooling.MySQLConnectionPool")
    def test_delete_by_metadata_field(self, mock_pool_class):
        """Test deleting documents by metadata field."""
        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]

        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        vector_store.delete_by_metadata_field("document_id", "dataset1")

        # Check that the correct SQL was executed
        execute_calls = mock_cursor.execute.call_args_list
        delete_calls = [call for call in execute_calls if "DELETE" in str(call)]
        self.assertEqual(len(delete_calls), 1)
        delete_call = delete_calls[0]
        self.assertIn("JSON_UNQUOTE(JSON_EXTRACT(meta", delete_call[0][0])
        self.assertEqual(delete_call[0][1], ("$.document_id", "dataset1"))

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.pooling.MySQLConnectionPool")
    def test_search_by_vector_cosine(self, mock_pool_class):
        """Test vector search with cosine distance."""
        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]
        mock_cursor.__iter__ = lambda self: iter([
            {
                "meta": json.dumps({"doc_id": "doc1", "source": "test"}),
                "text": "Test document 1",
                "distance": 0.1
            }
        ])

        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        query_vector = [0.1, 0.2, 0.3, 0.4]
        docs = vector_store.search_by_vector(query_vector, top_k=5)

        self.assertEqual(len(docs), 1)
        self.assertEqual(docs[0].page_content, "Test document 1")
        self.assertAlmostEqual(docs[0].metadata["score"], 0.9, places=1)  # 1 - 0.1 = 0.9
        self.assertEqual(docs[0].metadata["distance"], 0.1)

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.pooling.MySQLConnectionPool")
    def test_search_by_vector_euclidean(self, mock_pool_class):
        """Test vector search with euclidean distance."""
        config = AliyunMySQLVectorConfig(
            host="localhost",
            port=3306,
            user="test_user",
            password="test_password",
            database="test_db",
            min_connection=1,
            max_connection=5,
            distance_function="euclidean"
        )

        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]
        mock_cursor.__iter__ = lambda self: iter([
            {
                "meta": json.dumps({"doc_id": "doc1", "source": "test"}),
                "text": "Test document 1",
                "distance": 2.0
            }
        ])

        vector_store = AliyunMySQLVector(self.collection_name, config)
        query_vector = [0.1, 0.2, 0.3, 0.4]
        docs = vector_store.search_by_vector(query_vector, top_k=5)

        self.assertEqual(len(docs), 1)
        self.assertAlmostEqual(docs[0].metadata["score"], 1.0/3.0, places=2)  # 1/(1+2) = 1/3

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.pooling.MySQLConnectionPool")
    def test_search_by_vector_with_filter(self, mock_pool_class):
        """Test vector search with document ID filter."""
        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]
        mock_cursor.__iter__ = lambda self: iter([])

        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        query_vector = [0.1, 0.2, 0.3, 0.4]
        docs = vector_store.search_by_vector(
            query_vector,
            top_k=5,
            document_ids_filter=["dataset1"]
        )

        # Verify the SQL contains the WHERE clause for filtering
        execute_calls = mock_cursor.execute.call_args_list
        search_calls = [call for call in execute_calls if "VEC_DISTANCE" in str(call)]
        self.assertTrue(len(search_calls) > 0)
        search_call = search_calls[0]
        self.assertIn("WHERE JSON_UNQUOTE", search_call[0][0])

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.pooling.MySQLConnectionPool")
    def test_search_by_vector_with_score_threshold(self, mock_pool_class):
        """Test vector search with score threshold."""
        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]
        mock_cursor.__iter__ = lambda self: iter([
            {
                "meta": json.dumps({"doc_id": "doc1", "source": "test"}),
                "text": "High similarity document",
                "distance": 0.1  # High similarity (score = 0.9)
            },
            {
                "meta": json.dumps({"doc_id": "doc2", "source": "test"}),
                "text": "Low similarity document",
                "distance": 0.8  # Low similarity (score = 0.2)
            }
        ])

        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        query_vector = [0.1, 0.2, 0.3, 0.4]
        docs = vector_store.search_by_vector(
            query_vector,
            top_k=5,
            score_threshold=0.5
        )

        # Only the high similarity document should be returned
        self.assertEqual(len(docs), 1)
        self.assertEqual(docs[0].page_content, "High similarity document")

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.pooling.MySQLConnectionPool")
    def test_search_by_vector_invalid_top_k(self, mock_pool_class):
        """Test vector search with invalid top_k."""
        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]

        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        query_vector = [0.1, 0.2, 0.3, 0.4]

        with self.assertRaises(ValueError):
            vector_store.search_by_vector(query_vector, top_k=0)

        with self.assertRaises(ValueError):
            vector_store.search_by_vector(query_vector, top_k="invalid")

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.pooling.MySQLConnectionPool")
    def test_search_by_full_text(self, mock_pool_class):
        """Test full-text search."""
        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]
        mock_cursor.__iter__ = lambda self: iter([
            {
                "meta": {"doc_id": "doc1", "source": "test"},
                "text": "This document contains machine learning content",
                "score": 1.5
            }
        ])

        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        docs = vector_store.search_by_full_text("machine learning", top_k=5)

        self.assertEqual(len(docs), 1)
        self.assertEqual(docs[0].page_content, "This document contains machine learning content")
        self.assertEqual(docs[0].metadata["score"], 1.5)

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.pooling.MySQLConnectionPool")
    def test_search_by_full_text_with_filter(self, mock_pool_class):
        """Test full-text search with document ID filter."""
        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]
        mock_cursor.__iter__ = lambda self: iter([])

        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        docs = vector_store.search_by_full_text(
            "machine learning",
            top_k=5,
            document_ids_filter=["dataset1"]
        )

        # Verify the SQL contains the AND clause for filtering
        execute_calls = mock_cursor.execute.call_args_list
        search_calls = [call for call in execute_calls if "MATCH" in str(call)]
        self.assertTrue(len(search_calls) > 0)
        search_call = search_calls[0]
        self.assertIn("AND JSON_UNQUOTE", search_call[0][0])

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.pooling.MySQLConnectionPool")
    def test_search_by_full_text_invalid_top_k(self, mock_pool_class):
        """Test full-text search with invalid top_k."""
        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]

        vector_store = AliyunMySQLVector(self.collection_name, self.config)

        with self.assertRaises(ValueError):
            vector_store.search_by_full_text("test", top_k=0)

        with self.assertRaises(ValueError):
            vector_store.search_by_full_text("test", top_k="invalid")

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.pooling.MySQLConnectionPool")
    def test_delete_collection(self, mock_pool_class):
        """Test deleting the entire collection."""
        # Mock the connection pool
        mock_pool = MagicMock()
        mock_pool_class.return_value = mock_pool

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_pool.get_connection.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]

        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        vector_store.delete()

        # Check that DROP TABLE SQL was executed
        execute_calls = mock_cursor.execute.call_args_list
        drop_calls = [call for call in execute_calls if "DROP TABLE" in str(call)]
        self.assertEqual(len(drop_calls), 1)
        drop_call = drop_calls[0]
        self.assertIn(f"DROP TABLE IF EXISTS {self.collection_name.lower()}", drop_call[0][0])

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.pooling.MySQLConnectionPool")
    def test_unsupported_distance_function(self, mock_pool_class):
        """Test that Pydantic validation rejects unsupported distance functions."""
        # Test that creating config with unsupported distance function raises ValidationError
        with self.assertRaises(ValueError) as context:
            AliyunMySQLVectorConfig(
                host="localhost",
                port=3306,
                user="test_user",
                password="test_password",
                database="test_db",
                min_connection=1,
                max_connection=5,
                distance_function="manhattan"  # Unsupported - not in Literal["cosine", "euclidean"]
            )
        
        # The error should be related to validation
        self.assertTrue(
            "Input should be 'cosine' or 'euclidean'" in str(context.exception) or
            "manhattan" in str(context.exception)
        )

    def _setup_mocks(self, mock_redis, mock_pool_class):
        """Helper method to setup common mocks."""
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
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]


if __name__ == "__main__":
    unittest.main()
