
import unittest
from unittest.mock import MagicMock, patch

from pymongo.errors import ConnectionFailure, OperationFailure, ServerSelectionTimeoutError

from core.rag.datasource.vdb.mongodb.mongodb_vector import MongoDBVector
from core.rag.models.document import Document


class TestMongoDBVector(unittest.TestCase):
    def setUp(self):
        self.mock_config = MagicMock()
        self.mock_config.MONGODB_CONNECT_URI = "mongodb://localhost:27017"
        self.mock_config.MONGODB_DATABASE = "test_db"
        self.mock_config.MONGODB_VECTOR_INDEX_NAME = "test_index"
        self.mock_config.MONGODB_CONNECTION_RETRY_ATTEMPTS = 3
        self.mock_config.MONGODB_CONNECTION_RETRY_BACKOFF_BASE = 1.0
        self.mock_config.MONGODB_CONNECTION_RETRY_MAX_WAIT = 30.0
        self.mock_config.MONGODB_INDEX_READY_TIMEOUT = 300
        self.mock_config.MONGODB_INDEX_READY_CHECK_DELAY = 1.0
        self.mock_config.MONGODB_INDEX_READY_MAX_DELAY = 10.0
        self.collection_name = "test_collection"
        self.group_id = "test_group"

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_initialization_success(self, mock_mongo_client):
        """Test successful MongoDBVector initialization."""
        # Setup mock
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_client_instance.admin.command.return_value = {"ok": 1}
        
        # Act
        vector = MongoDBVector(self.collection_name, self.group_id, self.mock_config)
        
        # Assert
        mock_mongo_client.assert_called_once_with("mongodb://localhost:27017", serverSelectionTimeoutMS=5000)
        mock_client_instance.admin.command.assert_called_with('ping')
        self.assertIsNotNone(vector)

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_initialization_failure(self, mock_mongo_client):
        """Test initialization failure with connection error."""
        # Setup mock to raise connection failure
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_client_instance.admin.command.side_effect = ConnectionFailure("Connection failed")
        
        # Act & Assert
        with self.assertRaises(ConnectionFailure):
            MongoDBVector(self.collection_name, self.group_id, self.mock_config)

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_initialization_server_timeout(self, mock_mongo_client):
        """Test initialization failure with server selection timeout."""
        # Setup mock to raise server selection timeout
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_client_instance.admin.command.side_effect = ServerSelectionTimeoutError("Server selection timeout")
        
        # Act & Assert
        with self.assertRaises(ServerSelectionTimeoutError):
            MongoDBVector(self.collection_name, self.group_id, self.mock_config)

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_create_collection_and_index(self, mock_mongo_client):
        """Test collection and index creation."""
        # Setup mock
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_client_instance.admin.command.return_value = {"ok": 1}
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
        mock_db.create_collection.assert_called_once_with(self.collection_name)
        mock_collection.create_search_index.assert_called_once()
        mock_collection.insert_many.assert_called_once()

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_add_texts(self, mock_mongo_client):
        """Test adding texts to collection."""
        # Setup mock
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_client_instance.admin.command.return_value = {"ok": 1}
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
        mock_collection.insert_many.assert_called_once()
        call_args = mock_collection.insert_many.call_args[0][0]
        self.assertEqual(len(call_args), 1)
        self.assertEqual(call_args[0]["text"], "test")
        self.assertEqual(call_args[0]["group_id"], self.group_id)

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_search_by_vector(self, mock_mongo_client):
        """Test vector search functionality."""
        # Setup mock
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_client_instance.admin.command.return_value = {"ok": 1}
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
        # Setup mock
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_client_instance.admin.command.return_value = {"ok": 1}
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
        
        # Act
        vector = MongoDBVector(self.collection_name, self.group_id, self.mock_config)
        vector._create_vector_index(128)
        
        # Assert - should not raise an error
        mock_collection.create_search_index.assert_called_once()
