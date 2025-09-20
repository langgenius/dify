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

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.connect")
    def test_init(self, mock_connect):
        """Test AliyunMySQLVector initialization."""
        # Mock the cursor and connection for vector support check
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},  # Version check
            {"vector_support": True}   # Vector support check
        ]
        mock_connect.return_value = mock_conn
        
        aliyun_mysql_vector = AliyunMySQLVector(self.collection_name, self.config)

        self.assertEqual(aliyun_mysql_vector.collection_name, self.collection_name)
        self.assertEqual(aliyun_mysql_vector.table_name, self.collection_name.lower())
        self.assertEqual(aliyun_mysql_vector.get_type(), "aliyun_mysql")
        self.assertEqual(aliyun_mysql_vector.distance_function, "cosine")
        # PyMySQL connections are created on demand, not pooled
        self.assertIsNone(aliyun_mysql_vector.pool)

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.connect")
    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.redis_client")
    def test_create_collection(self, mock_redis, mock_connect):
        """Test collection creation."""
        # Mock Redis operations
        mock_redis.lock.return_value.__enter__ = MagicMock()
        mock_redis.lock.return_value.__exit__ = MagicMock()
        mock_redis.get.return_value = None
        mock_redis.set.return_value = None

        # Mock database connection and cursor
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},  # Version check
            {"vector_support": True}   # Vector support check
        ]
        mock_connect.return_value = mock_conn

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

        # Test min_connection > max_connection
        with self.assertRaises(ValueError):
            AliyunMySQLVectorConfig(
                host="localhost",
                port=3306,
                user="test",
                password="test",
                database="test",
                min_connection=10,
                max_connection=5,  # Should be greater than min_connection
            )

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.connect")
    def test_vector_support_check_success(self, mock_connect):
        """Test successful vector support check."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]
        mock_connect.return_value = mock_conn
        
        # Should not raise an exception
        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        self.assertIsNotNone(vector_store)

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.connect")
    def test_vector_support_check_failure(self, mock_connect):
        """Test vector support check failure."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.35"},
            {"vector_support": False}
        ]
        mock_connect.return_value = mock_conn
        
        with self.assertRaises(ValueError) as context:
            AliyunMySQLVector(self.collection_name, self.config)
        
        self.assertIn("RDS MySQL Vector functions are not available", str(context.exception))

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.connect")
    def test_vector_support_check_function_error(self, mock_connect):
        """Test vector support check with function not found error."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.return_value = {"VERSION()": "8.0.36"}
        mock_cursor.execute.side_effect = [None, MySQLError(errno=1305, msg="FUNCTION VEC_FromText does not exist")]
        mock_connect.return_value = mock_conn
        
        with self.assertRaises(ValueError) as context:
            AliyunMySQLVector(self.collection_name, self.config)
        
        self.assertIn("RDS MySQL Vector functions are not available", str(context.exception))

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.connect")
    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.redis_client")
    def test_create_documents(self, mock_redis, mock_connect):
        """Test creating documents with embeddings."""
        # Setup mocks
        self._setup_mocks(mock_redis, mock_connect)
        
        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        result = vector_store.create(self.sample_documents, self.sample_embeddings)
        
        self.assertEqual(len(result), 2)
        self.assertIn("doc1", result)
        self.assertIn("doc2", result)

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.connect")
    def test_add_texts(self, mock_connect):
        """Test adding texts to the vector store."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]
        mock_connect.return_value = mock_conn
        
        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        result = vector_store.add_texts(self.sample_documents, self.sample_embeddings)
        
        self.assertEqual(len(result), 2)
        mock_cursor.executemany.assert_called_once()

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.connect")
    def test_text_exists(self, mock_connect):
        """Test checking if text exists."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True},
            {"id": "doc1"}  # Text exists
        ]
        mock_connect.return_value = mock_conn
        
        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        exists = vector_store.text_exists("doc1")
        
        self.assertTrue(exists)
        mock_cursor.execute.assert_called_with(
            f"SELECT id FROM {self.collection_name.lower()} WHERE id = %s", ("doc1",)
        )

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.connect")
    def test_text_not_exists(self, mock_connect):
        """Test checking if text does not exist."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True},
            None  # Text does not exist
        ]
        mock_connect.return_value = mock_conn
        
        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        exists = vector_store.text_exists("nonexistent")
        
        self.assertFalse(exists)

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.connect")
    def test_get_by_ids(self, mock_connect):
        """Test getting documents by IDs."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]
        mock_cursor.__iter__ = lambda self: iter([
            {"meta": json.dumps({"doc_id": "doc1", "source": "test"}), "text": "Test document 1"},
            {"meta": json.dumps({"doc_id": "doc2", "source": "test"}), "text": "Test document 2"}
        ])
        mock_connect.return_value = mock_conn
        
        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        docs = vector_store.get_by_ids(["doc1", "doc2"])
        
        self.assertEqual(len(docs), 2)
        self.assertEqual(docs[0].page_content, "Test document 1")
        self.assertEqual(docs[1].page_content, "Test document 2")

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.connect")
    def test_get_by_ids_empty_list(self, mock_connect):
        """Test getting documents with empty ID list."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]
        mock_connect.return_value = mock_conn
        
        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        docs = vector_store.get_by_ids([])
        
        self.assertEqual(len(docs), 0)

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.connect")
    def test_delete_by_ids(self, mock_connect):
        """Test deleting documents by IDs."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]
        mock_connect.return_value = mock_conn
        
        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        vector_store.delete_by_ids(["doc1", "doc2"])
        
        expected_sql = f"DELETE FROM {self.collection_name.lower()} WHERE id IN (%s,%s)"
        mock_cursor.execute.assert_called_with(expected_sql, ["doc1", "doc2"])

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.connect")
    def test_delete_by_ids_empty_list(self, mock_connect):
        """Test deleting with empty ID list."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]
        mock_connect.return_value = mock_conn
        
        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        vector_store.delete_by_ids([])  # Should not raise an exception
        
        # Verify no delete SQL was executed
        delete_calls = [call for call in mock_cursor.execute.call_args_list 
                       if "DELETE" in str(call)]
        self.assertEqual(len(delete_calls), 0)

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.connect")
    def test_delete_by_ids_table_not_exists(self, mock_connect):
        """Test deleting when table doesn't exist."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]
        # Simulate table doesn't exist error
        mock_cursor.execute.side_effect = [None, None, MySQLError(errno=1146, msg="Table doesn't exist")]
        mock_connect.return_value = mock_conn
        
        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        # Should not raise an exception
        vector_store.delete_by_ids(["doc1"])

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.connect")
    def test_delete_by_metadata_field(self, mock_connect):
        """Test deleting documents by metadata field."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]
        mock_connect.return_value = mock_conn
        
        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        vector_store.delete_by_metadata_field("document_id", "dataset1")
        
        expected_sql = f"DELETE FROM {self.collection_name.lower()} WHERE JSON_UNQUOTE(JSON_EXTRACT(meta, %s)) = %s"
        mock_cursor.execute.assert_called_with(expected_sql, ("$.document_id", "dataset1"))

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.connect")
    def test_search_by_vector_cosine(self, mock_connect):
        """Test vector search with cosine distance."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
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
        mock_connect.return_value = mock_conn
        
        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        query_vector = [0.1, 0.2, 0.3, 0.4]
        docs = vector_store.search_by_vector(query_vector, top_k=5)
        
        self.assertEqual(len(docs), 1)
        self.assertEqual(docs[0].page_content, "Test document 1")
        self.assertAlmostEqual(docs[0].metadata["score"], 0.9, places=1)  # 1 - 0.1 = 0.9
        self.assertEqual(docs[0].metadata["distance"], 0.1)

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.connect")
    def test_search_by_vector_euclidean(self, mock_connect):
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
        
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
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
        mock_connect.return_value = mock_conn
        
        vector_store = AliyunMySQLVector(self.collection_name, config)
        query_vector = [0.1, 0.2, 0.3, 0.4]
        docs = vector_store.search_by_vector(query_vector, top_k=5)
        
        self.assertEqual(len(docs), 1)
        self.assertAlmostEqual(docs[0].metadata["score"], 1.0/3.0, places=2)  # 1/(1+2) = 1/3

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.connect")
    def test_search_by_vector_with_filter(self, mock_connect):
        """Test vector search with document ID filter."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]
        mock_cursor.__iter__ = lambda self: iter([])
        mock_connect.return_value = mock_conn
        
        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        query_vector = [0.1, 0.2, 0.3, 0.4]
        docs = vector_store.search_by_vector(
            query_vector, 
            top_k=5, 
            document_ids_filter=["dataset1"]
        )
        
        # Verify the SQL contains the WHERE clause for filtering
        sql_calls = [call[0][0] for call in mock_cursor.execute.call_args_list if "SELECT" in call[0][0]]
        self.assertTrue(any("WHERE JSON_UNQUOTE" in sql for sql in sql_calls))

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.connect")
    def test_search_by_vector_with_score_threshold(self, mock_connect):
        """Test vector search with score threshold."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
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
        mock_connect.return_value = mock_conn
        
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

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.connect")
    def test_search_by_vector_invalid_top_k(self, mock_connect):
        """Test vector search with invalid top_k."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]
        mock_connect.return_value = mock_conn
        
        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        query_vector = [0.1, 0.2, 0.3, 0.4]
        
        with self.assertRaises(ValueError):
            vector_store.search_by_vector(query_vector, top_k=0)
        
        with self.assertRaises(ValueError):
            vector_store.search_by_vector(query_vector, top_k="invalid")

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.connect")
    def test_search_by_full_text(self, mock_connect):
        """Test full-text search."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
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
        mock_connect.return_value = mock_conn
        
        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        docs = vector_store.search_by_full_text("machine learning", top_k=5)
        
        self.assertEqual(len(docs), 1)
        self.assertEqual(docs[0].page_content, "This document contains machine learning content")
        self.assertEqual(docs[0].metadata["score"], 1.5)

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.connect")
    def test_search_by_full_text_with_filter(self, mock_connect):
        """Test full-text search with document ID filter."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]
        mock_cursor.__iter__ = lambda self: iter([])
        mock_connect.return_value = mock_conn
        
        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        docs = vector_store.search_by_full_text(
            "machine learning", 
            top_k=5, 
            document_ids_filter=["dataset1"]
        )
        
        # Verify the SQL contains the AND clause for filtering
        sql_calls = [call[0][0] for call in mock_cursor.execute.call_args_list if "MATCH" in call[0][0]]
        self.assertTrue(any("AND JSON_UNQUOTE" in sql for sql in sql_calls))

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.connect")
    def test_search_by_full_text_invalid_top_k(self, mock_connect):
        """Test full-text search with invalid top_k."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]
        mock_connect.return_value = mock_conn
        
        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        
        with self.assertRaises(ValueError):
            vector_store.search_by_full_text("test", top_k=0)
        
        with self.assertRaises(ValueError):
            vector_store.search_by_full_text("test", top_k="invalid")

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.connect")
    def test_delete_collection(self, mock_connect):
        """Test deleting the entire collection."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]
        mock_connect.return_value = mock_conn
        
        vector_store = AliyunMySQLVector(self.collection_name, self.config)
        vector_store.delete()
        
        expected_sql = f"DROP TABLE IF EXISTS {self.collection_name.lower()}"
        mock_cursor.execute.assert_called_with(expected_sql)

    def test_unsupported_distance_function(self):
        """Test initialization with unsupported distance function."""
        config = AliyunMySQLVectorConfig(
            host="localhost",
            port=3306,
            user="test_user",
            password="test_password",
            database="test_db",
            min_connection=1,
            max_connection=5,
            distance_function="manhattan"  # Unsupported
        )
        
        with patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.mysql.connector.connect") as mock_connect:
            mock_conn = MagicMock()
            mock_cursor = MagicMock()
            mock_conn.cursor.return_value = mock_cursor
            mock_cursor.fetchone.side_effect = [
                {"VERSION()": "8.0.36"},
                {"vector_support": True}
            ]
            mock_connect.return_value = mock_conn
            
            with self.assertRaises(ValueError) as context:
                AliyunMySQLVector(self.collection_name, config)
            
            self.assertIn("Unsupported distance function", str(context.exception))

    def _setup_mocks(self, mock_redis, mock_connect):
        """Helper method to setup common mocks."""
        # Mock Redis operations
        mock_redis.lock.return_value.__enter__ = MagicMock()
        mock_redis.lock.return_value.__exit__ = MagicMock()
        mock_redis.get.return_value = None
        mock_redis.set.return_value = None

        # Mock database connection and cursor
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            {"VERSION()": "8.0.36"},
            {"vector_support": True}
        ]
        mock_connect.return_value = mock_conn


if __name__ == "__main__":
    unittest.main()
