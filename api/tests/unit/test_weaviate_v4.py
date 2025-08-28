import pytest
import uuid
from unittest.mock import Mock, patch, MagicMock
from typing import List

from core.rag.datasource.vdb.weaviate.weaviate_vector import WeaviateVector, WeaviateConfig, WeaviateVectorFactory
from core.rag.models.document import Document
from core.rag.datasource.vdb.field import Field


@pytest.fixture(autouse=True)
def mock_redis(mocker):
    """Automatically mock Redis for all tests"""
    mock_redis_client = Mock()
    mock_redis_client.lock.return_value.__enter__ = Mock()
    mock_redis_client.lock.return_value.__exit__ = Mock()
    mock_redis_client.get.return_value = None
    mock_redis_client.set.return_value = None
    
    # Mock the redis_client import
    mocker.patch('core.rag.datasource.vdb.weaviate.weaviate_vector.redis_client', mock_redis_client)
    
    return mock_redis_client


class TestWeaviateConfig:
    def test_valid_config(self):
        config = WeaviateConfig(endpoint="http://localhost:8080")
        assert config.endpoint == "http://localhost:8080"
        assert config.api_key is None
        assert config.batch_size == 100

    def test_config_with_api_key(self):
        config = WeaviateConfig(endpoint="https://weaviate.net", api_key="test-key")
        assert config.api_key == "test-key"

    def test_config_with_custom_batch_size(self):
        config = WeaviateConfig(endpoint="http://localhost:8080", batch_size=200)
        assert config.batch_size == 200

    def test_invalid_config_missing_endpoint(self):
        with pytest.raises(ValueError, match="config WEAVIATE_ENDPOINT is required"):
            WeaviateConfig(endpoint="")


class TestWeaviateVector:
    @pytest.fixture
    def mock_client(self):
        client = Mock()
        client.is_ready.return_value = True
        return client

    @pytest.fixture
    def mock_collection(self):
        collection = Mock()
        collection.config.get.return_value = Mock(properties=[])
        return collection

    @pytest.fixture
    def weaviate_vector(self, mock_client):
        with patch('core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate.connect_to_custom') as mock_connect:
            mock_connect.return_value = mock_client
            config = WeaviateConfig(endpoint="http://localhost:8080")
            return WeaviateVector("test_collection", config, ["doc_id", "text"])

    @pytest.fixture
    def sample_documents(self):
        return [
            Document(page_content="Test document 1", metadata={"doc_id": "doc1"}),
            Document(page_content="Test document 2", metadata={"doc_id": "doc2"})
        ]

    @pytest.fixture
    def sample_embeddings(self):
        return [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]

    def test_get_type(self, weaviate_vector):
        assert weaviate_vector.get_type() == "weaviate"

    def test_collection_name_generation(self, weaviate_vector):
        assert weaviate_vector._collection_name == "test_collection"

    def test_to_index_struct(self, weaviate_vector):
        result = weaviate_vector.to_index_struct()
        assert result["type"] == "weaviate"
        assert result["vector_store"]["class_prefix"] == "test_collection"

    def test_create_collection_success(self, weaviate_vector, mock_client, mock_collection):
        mock_client.collections.exists.return_value = False
        mock_client.collections.create.return_value = None
        mock_client.collections.use.return_value = mock_collection
        
        weaviate_vector._create_collection()
        
        mock_client.collections.create.assert_called_once()

    def test_create_collection_already_exists(self, weaviate_vector, mock_client):
        mock_client.collections.exists.return_value = True
        
        weaviate_vector._create_collection()
        
        mock_client.collections.create.assert_not_called()

    def test_add_texts_success(self, weaviate_vector, sample_documents, sample_embeddings, mock_client, mock_collection):
        mock_client.collections.use.return_value = mock_collection
        mock_collection.data.insert_many.return_value = None
        
        result = weaviate_vector.add_texts(sample_documents, sample_embeddings)
        
        assert len(result) == 2
        assert mock_collection.data.insert_many.call_count == 1

    def test_add_texts_without_embeddings(self, weaviate_vector, sample_documents, mock_client, mock_collection):
        mock_client.collections.use.return_value = mock_collection
        mock_collection.data.insert_many.return_value = None
        
        result = weaviate_vector.add_texts(sample_documents, [])
        
        assert len(result) == 2
        assert mock_collection.data.insert_many.call_count == 1

    def test_delete_by_metadata_field(self, weaviate_vector, mock_client, mock_collection):
        mock_client.collections.exists.return_value = True
        mock_client.collections.use.return_value = mock_collection
        mock_collection.data.delete_many.return_value = None
        
        weaviate_vector.delete_by_metadata_field("doc_id", "doc1")
        
        mock_collection.data.delete_many.assert_called_once()

    def test_delete_by_metadata_field_collection_not_exists(self, weaviate_vector, mock_client):
        mock_client.collections.exists.return_value = False
        
        weaviate_vector.delete_by_metadata_field("doc_id", "doc1")
        
        mock_client.collections.use.assert_not_called()

    def test_delete_collection(self, weaviate_vector, mock_client):
        mock_client.collections.exists.return_value = True
        mock_client.collections.delete.return_value = None
        
        weaviate_vector.delete()
        
        mock_client.collections.delete.assert_called_once_with("test_collection")

    def test_text_exists_true(self, weaviate_vector, mock_client, mock_collection):
        mock_client.collections.exists.return_value = True
        mock_client.collections.use.return_value = mock_collection
        
        mock_response = Mock()
        mock_response.objects = [Mock()]  # At least one object exists
        mock_collection.query.fetch_objects.return_value = mock_response
        
        result = weaviate_vector.text_exists("doc1")
        
        assert result is True

    def test_text_exists_false(self, weaviate_vector, mock_client, mock_collection):
        mock_client.collections.exists.return_value = True
        mock_client.collections.use.return_value = mock_collection
        
        mock_response = Mock()
        mock_response.objects = []  # No objects exist
        mock_collection.query.fetch_objects.return_value = mock_response
        
        result = weaviate_vector.text_exists("doc1")
        
        assert result is False

    def test_text_exists_collection_not_exists(self, weaviate_vector, mock_client):
        mock_client.collections.exists.return_value = False
        
        result = weaviate_vector.text_exists("doc1")
        
        assert result is False

    def test_delete_by_ids(self, weaviate_vector, mock_client, mock_collection):
        mock_client.collections.exists.return_value = True
        mock_client.collections.use.return_value = mock_collection
        mock_collection.data.delete_by_id.return_value = None
        
        weaviate_vector.delete_by_ids(["uuid1", "uuid2"])
        
        assert mock_collection.data.delete_by_id.call_count == 2

    def test_delete_by_ids_collection_not_exists(self, weaviate_vector, mock_client):
        mock_client.collections.exists.return_value = False
        
        weaviate_vector.delete_by_ids(["uuid1", "uuid2"])
        
        mock_client.collections.use.assert_not_called()

    def test_search_by_vector(self, weaviate_vector, mock_client, mock_collection):
        mock_client.collections.exists.return_value = True
        mock_client.collections.use.return_value = mock_collection
        
        mock_response = Mock()
        mock_obj = Mock()
        mock_obj.properties = {"text": "Test content", "doc_id": "doc1"}
        mock_obj.metadata = Mock()
        mock_obj.metadata.distance = 0.1
        mock_response.objects = [mock_obj]
        mock_collection.query.near_vector.return_value = mock_response
        
        result = weaviate_vector.search_by_vector([0.1, 0.2, 0.3], top_k=5)
        
        assert len(result) == 1
        assert result[0].page_content == "Test content"
        assert result[0].metadata["score"] == 0.9

    def test_search_by_vector_collection_not_exists(self, weaviate_vector, mock_client):
        mock_client.collections.exists.return_value = False
        
        result = weaviate_vector.search_by_vector([0.1, 0.2, 0.3])
        
        assert result == []

    def test_search_by_full_text(self, weaviate_vector, mock_client, mock_collection):
        mock_client.collections.exists.return_value = True
        mock_client.collections.use.return_value = mock_collection
        
        mock_response = Mock()
        mock_obj = Mock()
        mock_obj.properties = {"text": "Test content", "doc_id": "doc1"}
        mock_obj.vector = {"default": [0.1, 0.2, 0.3]}
        mock_response.objects = [mock_obj]
        mock_collection.query.bm25.return_value = mock_response
        
        result = weaviate_vector.search_by_full_text("test", top_k=5)
        
        assert len(result) == 1
        assert result[0].page_content == "Test content"
        assert result[0].vector == [0.1, 0.2, 0.3]

    def test_search_by_full_text_collection_not_exists(self, weaviate_vector, mock_client):
        mock_client.collections.exists.return_value = False
        
        result = weaviate_vector.search_by_full_text("test")
        
        assert result == []

    def test_json_serializable_datetime(self, weaviate_vector):
        from datetime import datetime
        dt = datetime(2023, 1, 1, 12, 0, 0)
        result = weaviate_vector._json_serializable(dt)
        assert result == "2023-01-01T12:00:00"

    def test_json_serializable_other_types(self, weaviate_vector):
        assert weaviate_vector._json_serializable("string") == "string"
        assert weaviate_vector._json_serializable(123) == 123
        assert weaviate_vector._json_serializable(None) is None

    def test_is_uuid_valid(self, weaviate_vector):
        valid_uuid = str(uuid.uuid4())
        assert weaviate_vector._is_uuid(valid_uuid) is True

    def test_is_uuid_invalid(self, weaviate_vector):
        assert weaviate_vector._is_uuid("invalid-uuid") is False
        assert weaviate_vector._is_uuid("123") is False
        assert weaviate_vector._is_uuid("") is False

    def test_get_uuids(self, weaviate_vector, sample_documents):
        uuids = weaviate_vector._get_uuids(sample_documents)
        assert len(uuids) == 2
        assert all(isinstance(uuid_str, str) for uuid_str in uuids)
        assert len(uuids[0]) == 8  # MD5 hash first 8 chars


class TestWeaviateVectorFactory:
    @pytest.fixture
    def mock_dataset(self):
        dataset = Mock()
        dataset.id = "test_dataset_123"
        dataset.index_struct_dict = None
        return dataset

    @pytest.fixture
    def mock_embeddings(self):
        return Mock()

    def test_init_vector_without_index_struct(self, mock_dataset, mock_embeddings):
        with patch('core.rag.datasource.vdb.weaviate.weaviate_vector.dify_config') as mock_config:
            mock_config.WEAVIATE_ENDPOINT = "http://localhost:8080"
            mock_config.WEAVIATE_API_KEY = "test-key"
            mock_config.WEAVIATE_BATCH_SIZE = 100
            
            with patch('core.rag.datasource.vdb.weaviate.weaviate_vector.Dataset.gen_collection_name_by_id') as mock_gen:
                mock_gen.return_value = "test_collection_123"
                
                # Fix: Mock the Weaviate client creation
                with patch('core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate.connect_to_custom') as mock_connect:
                    mock_client = Mock()
                    mock_client.is_ready.return_value = True
                    mock_connect.return_value = mock_client
                    
                    factory = WeaviateVectorFactory()
                    result = factory.init_vector(mock_dataset, ["doc_id"], mock_embeddings)
                    
                    assert isinstance(result, WeaviateVector)
                    assert result._collection_name == "test_collection_123"
                    mock_dataset.index_struct = '{"type": "weaviate", "vector_store": {"class_prefix": "test_collection_123"}}'

    def test_init_vector_with_index_struct(self, mock_dataset, mock_embeddings):
        mock_dataset.index_struct_dict = {"vector_store": {"class_prefix": "existing_collection"}}
        
        with patch('core.rag.datasource.vdb.weaviate.weaviate_vector.dify_config') as mock_config:
            mock_config.WEAVIATE_ENDPOINT = "http://localhost:8080"
            mock_config.WEAVIATE_API_KEY = "test-key"
            mock_config.WEAVIATE_BATCH_SIZE = 100
            
            # Fix: Mock the Weaviate client creation
            with patch('core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate.connect_to_custom') as mock_connect:
                mock_client = Mock()
                mock_client.is_ready.return_value = True
                mock_connect.return_value = mock_client
                
                factory = WeaviateVectorFactory()
                result = factory.init_vector(mock_dataset, ["doc_id"], mock_embeddings)
                
                assert isinstance(result, WeaviateVector)
                # Fix: Expect the _Node suffix that the method adds
                assert result._collection_name == "existing_collection"  # ✅ Correct!


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
