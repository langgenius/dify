
import unittest
from unittest.mock import MagicMock, patch

from pymongo.errors import ConnectionFailure, OperationFailure, ServerSelectionTimeoutError

from core.rag.datasource.vdb.mongodb.mongodb_vector import (
    MongoDBVector,
    _sanitize_uri_for_logging,
)
from core.rag.models.document import Document


class TestMongoDBVector(unittest.TestCase):
    def setUp(self):
        self.mock_config = MagicMock()
        self.mock_config.MONGODB_CONNECT_URI = "mongodb://localhost:27017"
        self.mock_config.MONGODB_DATABASE = "test_db"
        self.mock_config.MONGODB_VECTOR_INDEX_NAME = "test_index"
        self.mock_config.MONGODB_SERVER_SELECTION_TIMEOUT_MS = 5000
        self.mock_config.MONGODB_CONNECTION_RETRY_ATTEMPTS = 3
        self.mock_config.MONGODB_CONNECTION_RETRY_BACKOFF_BASE = 1.0
        self.mock_config.MONGODB_CONNECTION_RETRY_MAX_WAIT = 30.0
        self.collection_name = "test_collection"
        self.group_id = "test_group"

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_initialization_success(self, mock_mongo_client):
        # Setup mock
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        
        # Act
        vector = MongoDBVector(self.collection_name, self.group_id, self.mock_config)
        
        # Assert
        mock_mongo_client.assert_called_with("mongodb://localhost:27017", serverSelectionTimeoutMS=5000)
        mock_client_instance.admin.command.assert_called_with('ping')
        self.assertIsNotNone(vector)

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_initialization_failure(self, mock_mongo_client):
        # Setup mock to raise connection failure
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_client_instance.admin.command.side_effect = ConnectionFailure("Connection failed")
        
        # Act & Assert
        with self.assertRaises(ConnectionFailure):
            MongoDBVector(self.collection_name, self.group_id, self.mock_config)

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_initialization_with_retries_disabled(self, mock_mongo_client):
        """Test initialization when retries are disabled (0 attempts)."""
        # Setup mock
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_client_instance.admin.command.side_effect = ConnectionFailure("Connection failed")
        
        # Configure to disable retries
        self.mock_config.MONGODB_CONNECTION_RETRY_ATTEMPTS = 0
        
        # Act & Assert - should fail immediately without retries
        with self.assertRaises(ConnectionFailure):
            MongoDBVector(self.collection_name, self.group_id, self.mock_config)
        
        # Verify ping was only called once (no retries)
        self.assertEqual(mock_client_instance.admin.command.call_count, 1)

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_create_collection_and_index(self, mock_mongo_client):
        # Setup mock
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_db = MagicMock()
        mock_client_instance.__getitem__.return_value = mock_db
        mock_collection = MagicMock()
        mock_db.__getitem__.return_value = mock_collection
        
        # Setup db.list_collection_names to return empty list first
        mock_db.list_collection_names.return_value = []
        
        # Setup aggregate for wait_for_index_ready
        mock_collection.aggregate.return_value = [
            {"queryable": True, "status": "READY"}
        ]

        # Act
        vector = MongoDBVector(self.collection_name, self.group_id, self.mock_config)
        docs = [Document(page_content="test", metadata={"doc_id": "1"})]
        embeddings = [[0.1, 0.2]]
        vector.create(docs, embeddings)

        # Assert
        mock_db.create_collection.assert_called_with(self.collection_name)
        mock_collection.create_search_index.assert_called()
        mock_collection.insert_many.assert_called()

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_add_texts(self, mock_mongo_client):
        # Setup mock
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_db = MagicMock()
        mock_client_instance.__getitem__.return_value = mock_db
        mock_collection = MagicMock()
        mock_db.__getitem__.return_value = mock_collection

        # Act
        vector = MongoDBVector(self.collection_name, self.group_id, self.mock_config)
        docs = [Document(page_content="test", metadata={"doc_id": "1"})]
        embeddings = [[0.1, 0.2]]
        vector.add_texts(docs, embeddings)

        # Assert
        mock_collection.insert_many.assert_called()
        call_args = mock_collection.insert_many.call_args[0][0]
        self.assertEqual(len(call_args), 1)
        self.assertEqual(call_args[0]["text"], "test")
        self.assertEqual(call_args[0]["group_id"], self.group_id)

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_search_by_vector(self, mock_mongo_client):
        # Setup mock
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_db = MagicMock()
        mock_client_instance.__getitem__.return_value = mock_db
        mock_collection = MagicMock()
        mock_db.__getitem__.return_value = mock_collection
        
        # Mock aggregate return
        mock_collection.aggregate.return_value = [
            {"text": "result1", "metadata": {"doc_id": "1"}, "score": 0.9}
        ]

        # Act
        vector = MongoDBVector(self.collection_name, self.group_id, self.mock_config)
        results = vector.search_by_vector([0.1, 0.2])

        # Assert
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].page_content, "result1")
        self.assertEqual(results[0].metadata["score"], 0.9)

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_create_vector_index_already_exists(self, mock_mongo_client):
        """Test vector index creation when index already exists."""
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_db = MagicMock()
        mock_client_instance.__getitem__.return_value = mock_db
        mock_collection = MagicMock()
        mock_db.__getitem__.return_value = mock_collection
        
        mock_db.list_collection_names.return_value = [self.collection_name]
        index_exists_error = OperationFailure("IndexAlreadyExists", code=68)
        mock_collection.create_search_index.side_effect = index_exists_error
        mock_collection.aggregate.return_value = [
            {"queryable": True, "status": "READY"}
        ]
        
        vector = MongoDBVector(self.collection_name, self.group_id, self.mock_config)
        
        # Should not raise an error
        vector._create_vector_index(128)
        mock_collection.create_search_index.assert_called_once()

    def test_sanitize_uri_with_credentials(self):
        """Test URI sanitization with credentials."""
        uri = "mongodb://user:password@host:27017/database"
        sanitized = _sanitize_uri_for_logging(uri)
        self.assertIn("user", sanitized)
        self.assertIn("***", sanitized)
        self.assertNotIn("password", sanitized)
        self.assertIn("host", sanitized)

    def test_sanitize_uri_without_credentials(self):
        """Test URI sanitization without credentials."""
        uri = "mongodb://host:27017/database"
        sanitized = _sanitize_uri_for_logging(uri)
        self.assertIn("host", sanitized)
        self.assertIn("mongodb://", sanitized)

    def test_sanitize_uri_mongodb_srv(self):
        """Test URI sanitization for mongodb+srv:// scheme."""
        uri = "mongodb+srv://user:password@cluster.mongodb.net/database"
        sanitized = _sanitize_uri_for_logging(uri)
        self.assertIn("user", sanitized)
        self.assertIn("***", sanitized)
        self.assertNotIn("password", sanitized)
        self.assertIn("mongodb+srv://", sanitized)

    def test_sanitize_uri_malformed(self):
        """Test URI sanitization with malformed URIs."""
        # Missing scheme
        sanitized = _sanitize_uri_for_logging("host:27017")
        self.assertEqual(sanitized, "***")
        
        # Empty string
        sanitized = _sanitize_uri_for_logging("")
        self.assertEqual(sanitized, "***")
        
        # None
        sanitized = _sanitize_uri_for_logging(None)
        self.assertEqual(sanitized, "***")

    def test_sanitize_uri_with_query_params(self):
        """Test URI sanitization with query parameters."""
        uri = "mongodb://user:password@host:27017/database?retryWrites=true&w=majority"
        sanitized = _sanitize_uri_for_logging(uri)
        self.assertIn("***", sanitized)
        self.assertNotIn("password", sanitized)
        self.assertIn("retryWrites", sanitized)

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_initialization_with_invalid_uri_config(self, mock_mongo_client):
        """Test initialization when URI config raises ValueError."""
        # Configure mock to raise ValueError when MONGODB_CONNECT_URI is accessed
        def raise_value_error(*args, **kwargs):
            raise ValueError("Invalid MongoDB configuration")
        
        # Use PropertyMock to make the property raise an error
        from unittest.mock import PropertyMock
        with patch.object(type(self.mock_config), 'MONGODB_CONNECT_URI', new_callable=PropertyMock, side_effect=ValueError("Invalid MongoDB configuration")):
            # Act & Assert
            with self.assertRaises(ValueError) as context:
                MongoDBVector(self.collection_name, self.group_id, self.mock_config)
            self.assertIn("Invalid MongoDB configuration", str(context.exception))

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_initialization_with_mongodb_client_error(self, mock_mongo_client):
        """Test initialization when MongoClient creation fails."""
        mock_mongo_client.side_effect = Exception("Client creation failed")
        
        # Act & Assert
        with self.assertRaises(ValueError) as context:
            MongoDBVector(self.collection_name, self.group_id, self.mock_config)
        self.assertIn("Failed to create MongoDB client", str(context.exception))

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_check_connection_with_retries(self, mock_mongo_client):
        """Test connection check with retries."""
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_db = MagicMock()
        mock_client_instance.__getitem__.return_value = mock_db
        mock_collection = MagicMock()
        mock_db.__getitem__.return_value = mock_collection
        
        # First two attempts fail, third succeeds
        mock_client_instance.admin.command.side_effect = [
            ConnectionFailure("Connection failed"),
            ConnectionFailure("Connection failed"),
            None,  # Success
        ]
        
        # Act
        vector = MongoDBVector(self.collection_name, self.group_id, self.mock_config)
        
        # Assert - should succeed after retries
        self.assertIsNotNone(vector)
        self.assertEqual(mock_client_instance.admin.command.call_count, 3)

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_check_connection_with_server_selection_timeout(self, mock_mongo_client):
        """Test connection check with ServerSelectionTimeoutError."""
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_client_instance.admin.command.side_effect = ServerSelectionTimeoutError("Timeout")
        
        # Act & Assert
        with self.assertRaises(ServerSelectionTimeoutError):
            MongoDBVector(self.collection_name, self.group_id, self.mock_config)

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_check_connection_with_invalid_retry_config(self, mock_mongo_client):
        """Test connection check with invalid retry configuration."""
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_db = MagicMock()
        mock_client_instance.__getitem__.return_value = mock_db
        mock_collection = MagicMock()
        mock_db.__getitem__.return_value = mock_collection
        
        # Invalid retry attempts (negative)
        self.mock_config.MONGODB_CONNECTION_RETRY_ATTEMPTS = -1
        
        # Act & Assert
        with self.assertRaises(ValueError) as context:
            MongoDBVector(self.collection_name, self.group_id, self.mock_config)
        self.assertIn("MONGODB_CONNECTION_RETRY_ATTEMPTS", str(context.exception))
