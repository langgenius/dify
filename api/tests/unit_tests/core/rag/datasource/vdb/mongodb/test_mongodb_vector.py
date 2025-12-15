
import unittest
from unittest.mock import MagicMock, patch

from pymongo.errors import (
    ConfigurationError,
    ConnectionFailure,
    OperationFailure,
    ServerSelectionTimeoutError,
    WriteError,
)

from core.rag.datasource.vdb.mongodb.mongodb_vector import MongoDBVector
from core.rag.models.document import Document


class TestMongoDBVector(unittest.TestCase):
    def setUp(self):
        self.mock_config = MagicMock()
        self.mock_config.MONGODB_CONNECT_URI = "mongodb://localhost:27017"
        self.mock_config.MONGODB_DATABASE = "test_db"
        self.mock_config.MONGODB_VECTOR_INDEX_NAME = "test_index"
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
    def test_initialization_configuration_error(self, mock_mongo_client):
        """Test initialization with invalid MongoDB configuration."""
        mock_mongo_client.side_effect = ConfigurationError("Invalid URI format")
        
        with self.assertRaises(ConfigurationError):
            MongoDBVector(self.collection_name, self.group_id, self.mock_config)

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_initialization_server_timeout(self, mock_mongo_client):
        """Test initialization with server selection timeout."""
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_client_instance.admin.command.side_effect = ServerSelectionTimeoutError(
            "Server selection timeout"
        )
        
        with self.assertRaises(ServerSelectionTimeoutError):
            MongoDBVector(self.collection_name, self.group_id, self.mock_config)

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_initialization_authentication_error(self, mock_mongo_client):
        """Test initialization with authentication failure."""
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        auth_error = OperationFailure("Authentication failed", code=18)
        mock_client_instance.admin.command.side_effect = auth_error
        
        with self.assertRaises(ConnectionFailure):
            MongoDBVector(self.collection_name, self.group_id, self.mock_config)

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_initialization_permission_error(self, mock_mongo_client):
        """Test initialization with permission denied error."""
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        perm_error = OperationFailure("not authorized", code=13)
        mock_client_instance.admin.command.side_effect = perm_error
        
        with self.assertRaises(OperationFailure):
            MongoDBVector(self.collection_name, self.group_id, self.mock_config)

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_create_collection_permission_error(self, mock_mongo_client):
        """Test collection creation with permission denied."""
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_db = MagicMock()
        mock_client_instance.__getitem__.return_value = mock_db
        mock_collection = MagicMock()
        mock_db.__getitem__.return_value = mock_collection
        
        mock_db.list_collection_names.return_value = []
        perm_error = OperationFailure("not authorized", code=13)
        mock_db.create_collection.side_effect = perm_error
        
        vector = MongoDBVector(self.collection_name, self.group_id, self.mock_config)
        
        with self.assertRaises(OperationFailure):
            vector._create_collection()

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_create_vector_index_permission_error(self, mock_mongo_client):
        """Test vector index creation with permission denied."""
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_db = MagicMock()
        mock_client_instance.__getitem__.return_value = mock_db
        mock_collection = MagicMock()
        mock_db.__getitem__.return_value = mock_collection
        
        mock_db.list_collection_names.return_value = [self.collection_name]
        perm_error = OperationFailure("not authorized", code=13)
        mock_collection.create_search_index.side_effect = perm_error
        
        vector = MongoDBVector(self.collection_name, self.group_id, self.mock_config)
        
        with self.assertRaises(OperationFailure):
            vector._create_vector_index(128)

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

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_create_vector_index_invalid_size(self, mock_mongo_client):
        """Test vector index creation with invalid vector size."""
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_db = MagicMock()
        mock_client_instance.__getitem__.return_value = mock_db
        mock_collection = MagicMock()
        mock_db.__getitem__.return_value = mock_collection
        
        vector = MongoDBVector(self.collection_name, self.group_id, self.mock_config)
        
        with self.assertRaises(ValueError):
            vector._create_vector_index(0)
        
        with self.assertRaises(ValueError):
            vector._create_vector_index(-1)

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_add_texts_permission_error(self, mock_mongo_client):
        """Test adding texts with write permission denied."""
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_db = MagicMock()
        mock_client_instance.__getitem__.return_value = mock_db
        mock_collection = MagicMock()
        mock_db.__getitem__.return_value = mock_collection
        
        perm_error = WriteError("not authorized", code=13)
        mock_collection.insert_many.side_effect = perm_error
        
        vector = MongoDBVector(self.collection_name, self.group_id, self.mock_config)
        docs = [Document(page_content="test", metadata={"doc_id": "1"})]
        embeddings = [[0.1, 0.2]]
        
        with self.assertRaises(WriteError):
            vector.add_texts(docs, embeddings)

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_add_texts_mismatch_count(self, mock_mongo_client):
        """Test adding texts with mismatched document and embedding counts."""
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_db = MagicMock()
        mock_client_instance.__getitem__.return_value = mock_db
        mock_collection = MagicMock()
        mock_db.__getitem__.return_value = mock_collection
        
        vector = MongoDBVector(self.collection_name, self.group_id, self.mock_config)
        docs = [Document(page_content="test", metadata={"doc_id": "1"})]
        embeddings = [[0.1, 0.2], [0.3, 0.4]]  # Mismatch
        
        with self.assertRaises(ValueError):
            vector.add_texts(docs, embeddings)

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_add_texts_empty_input(self, mock_mongo_client):
        """Test adding texts with empty input."""
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_db = MagicMock()
        mock_client_instance.__getitem__.return_value = mock_db
        mock_collection = MagicMock()
        mock_db.__getitem__.return_value = mock_collection
        
        vector = MongoDBVector(self.collection_name, self.group_id, self.mock_config)
        
        # Should not raise error, just return early
        vector.add_texts([], [])
        mock_collection.insert_many.assert_not_called()

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_search_by_vector_permission_error(self, mock_mongo_client):
        """Test vector search with read permission denied."""
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_db = MagicMock()
        mock_client_instance.__getitem__.return_value = mock_db
        mock_collection = MagicMock()
        mock_db.__getitem__.return_value = mock_collection
        
        perm_error = OperationFailure("not authorized", code=13)
        mock_collection.aggregate.side_effect = perm_error
        
        vector = MongoDBVector(self.collection_name, self.group_id, self.mock_config)
        
        with self.assertRaises(OperationFailure):
            vector.search_by_vector([0.1, 0.2])

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_search_by_vector_empty_query(self, mock_mongo_client):
        """Test vector search with empty query vector."""
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_db = MagicMock()
        mock_client_instance.__getitem__.return_value = mock_db
        mock_collection = MagicMock()
        mock_db.__getitem__.return_value = mock_collection
        
        vector = MongoDBVector(self.collection_name, self.group_id, self.mock_config)
        
        results = vector.search_by_vector([])
        self.assertEqual(results, [])
        mock_collection.aggregate.assert_not_called()

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_delete_by_ids_permission_error(self, mock_mongo_client):
        """Test delete by IDs with write permission denied."""
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_db = MagicMock()
        mock_client_instance.__getitem__.return_value = mock_db
        mock_collection = MagicMock()
        mock_db.__getitem__.return_value = mock_collection
        
        perm_error = OperationFailure("not authorized", code=13)
        mock_collection.delete_many.side_effect = perm_error
        
        vector = MongoDBVector(self.collection_name, self.group_id, self.mock_config)
        
        with self.assertRaises(OperationFailure):
            vector.delete_by_ids(["id1", "id2"])

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_delete_by_metadata_permission_error(self, mock_mongo_client):
        """Test delete by metadata with write permission denied."""
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_db = MagicMock()
        mock_client_instance.__getitem__.return_value = mock_db
        mock_collection = MagicMock()
        mock_db.__getitem__.return_value = mock_collection
        
        perm_error = OperationFailure("not authorized", code=13)
        mock_collection.delete_many.side_effect = perm_error
        
        vector = MongoDBVector(self.collection_name, self.group_id, self.mock_config)
        
        with self.assertRaises(OperationFailure):
            vector.delete_by_metadata_field("key", "value")

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_wait_for_index_ready_timeout(self, mock_mongo_client):
        """Test index ready wait timeout."""
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_db = MagicMock()
        mock_client_instance.__getitem__.return_value = mock_db
        mock_collection = MagicMock()
        mock_db.__getitem__.return_value = mock_collection
        
        # Mock aggregate to return index that's never ready
        mock_collection.aggregate.return_value = [
            {"queryable": False, "status": "BUILDING"}
        ]
        
        vector = MongoDBVector(self.collection_name, self.group_id, self.mock_config)
        
        with self.assertRaises(TimeoutError):
            vector._wait_for_index_ready(timeout=1)  # Short timeout for test

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_wait_for_index_ready_failed_status(self, mock_mongo_client):
        """Test index ready wait with failed index status."""
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_db = MagicMock()
        mock_client_instance.__getitem__.return_value = mock_db
        mock_collection = MagicMock()
        mock_db.__getitem__.return_value = mock_collection
        
        # Mock aggregate to return failed index
        mock_collection.aggregate.return_value = [
            {"queryable": False, "status": "FAILED", "error": "Build failed"}
        ]
        
        vector = MongoDBVector(self.collection_name, self.group_id, self.mock_config)
        
        with self.assertRaises(OperationFailure):
            vector._wait_for_index_ready(timeout=1)

    @patch("core.rag.datasource.vdb.mongodb.mongodb_vector.MongoClient")
    def test_wait_for_index_ready_permission_error(self, mock_mongo_client):
        """Test index ready wait with permission denied."""
        mock_client_instance = MagicMock()
        mock_mongo_client.return_value = mock_client_instance
        mock_db = MagicMock()
        mock_client_instance.__getitem__.return_value = mock_db
        mock_collection = MagicMock()
        mock_db.__getitem__.return_value = mock_collection
        
        perm_error = OperationFailure("not authorized", code=13)
        mock_collection.aggregate.side_effect = perm_error
        
        vector = MongoDBVector(self.collection_name, self.group_id, self.mock_config)
        
        with self.assertRaises(OperationFailure):
            vector._wait_for_index_ready(timeout=1)
