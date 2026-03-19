"""Unit tests for Weaviate vector database implementation.

Focuses on verifying that doc_type is properly handled in:
- Collection schema creation (_create_collection)
- Property migration (_ensure_properties)
- Vector search result metadata (search_by_vector)
- Full-text search result metadata (search_by_full_text)
"""

import datetime
import json
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from core.rag.datasource.vdb.weaviate import weaviate_vector as weaviate_vector_module
from core.rag.datasource.vdb.weaviate.weaviate_vector import WeaviateConfig, WeaviateVector
from core.rag.models.document import Document


class TestWeaviateVector(unittest.TestCase):
    """Tests for WeaviateVector class with focus on doc_type metadata handling."""

    def setUp(self):
        weaviate_vector_module._weaviate_client = None
        self.config = WeaviateConfig(
            endpoint="http://localhost:8080",
            api_key="test-key",
            batch_size=100,
        )
        self.collection_name = "Test_Collection_Node"
        self.attributes = ["doc_id", "dataset_id", "document_id", "doc_hash", "doc_type"]

    def tearDown(self):
        weaviate_vector_module._weaviate_client = None

    def test_config_requires_endpoint(self):
        with pytest.raises(ValueError, match="config WEAVIATE_ENDPOINT is required"):
            WeaviateConfig(endpoint="")

    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate")
    def _create_weaviate_vector(self, mock_weaviate_module):
        """Helper to create a WeaviateVector instance with mocked client."""
        mock_client = MagicMock()
        mock_client.is_ready.return_value = True
        mock_weaviate_module.connect_to_custom.return_value = mock_client

        wv = WeaviateVector(
            collection_name=self.collection_name,
            config=self.config,
            attributes=self.attributes,
        )
        return wv, mock_client

    def test_shutdown_client_logs_debug_when_close_fails(self):
        mock_client = MagicMock()
        mock_client.close.side_effect = RuntimeError("close failed")
        weaviate_vector_module._weaviate_client = mock_client

        with patch.object(weaviate_vector_module.logger, "debug") as mock_debug:
            weaviate_vector_module._shutdown_weaviate_client()

        assert weaviate_vector_module._weaviate_client is None
        mock_client.close.assert_called_once()
        mock_debug.assert_called_once()

    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate.connect_to_custom")
    def test_init_client_reuses_cached_client_without_reconnect(self, mock_connect):
        cached_client = MagicMock()
        cached_client.is_ready.return_value = True
        weaviate_vector_module._weaviate_client = cached_client

        wv = WeaviateVector.__new__(WeaviateVector)

        client = wv._init_client(self.config)

        assert client is cached_client
        mock_connect.assert_not_called()

    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate.connect_to_custom")
    def test_init_client_reuses_cached_client_after_lock_recheck(self, mock_connect):
        cached_client = MagicMock()
        cached_client.is_ready.side_effect = [False, True]
        weaviate_vector_module._weaviate_client = cached_client

        wv = WeaviateVector.__new__(WeaviateVector)

        client = wv._init_client(self.config)

        assert client is cached_client
        mock_connect.assert_not_called()

    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.Auth.api_key", return_value="auth-token")
    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate.connect_to_custom")
    def test_init_client_parses_custom_grpc_endpoint_without_scheme(self, mock_connect, mock_api_key):
        mock_client = MagicMock()
        mock_client.is_ready.return_value = True
        mock_connect.return_value = mock_client

        wv = WeaviateVector.__new__(WeaviateVector)
        config = WeaviateConfig(
            endpoint="https://weaviate.example.com",
            grpc_endpoint="grpc.example.com:6000",
            api_key="test-key",
            batch_size=50,
        )

        client = wv._init_client(config)

        assert client is mock_client
        assert mock_connect.call_args.kwargs == {
            "http_host": "weaviate.example.com",
            "http_port": 443,
            "http_secure": True,
            "grpc_host": "grpc.example.com",
            "grpc_port": 6000,
            "grpc_secure": False,
            "auth_credentials": "auth-token",
            "skip_init_checks": True,
        }
        mock_api_key.assert_called_once_with("test-key")

    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate.connect_to_custom")
    def test_init_client_raises_when_database_not_ready(self, mock_connect):
        mock_client = MagicMock()
        mock_client.is_ready.return_value = False
        mock_connect.return_value = mock_client

        wv = WeaviateVector.__new__(WeaviateVector)

        with pytest.raises(ConnectionError, match="Vector database is not ready"):
            wv._init_client(self.config)

    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate")
    def test_init(self, mock_weaviate_module):
        """Test WeaviateVector initialization stores attributes including doc_type."""
        mock_client = MagicMock()
        mock_client.is_ready.return_value = True
        mock_weaviate_module.connect_to_custom.return_value = mock_client

        wv = WeaviateVector(
            collection_name=self.collection_name,
            config=self.config,
            attributes=self.attributes,
        )

        assert wv._collection_name == self.collection_name
        assert "doc_type" in wv._attributes

    def test_get_type_and_to_index_struct(self):
        wv = WeaviateVector.__new__(WeaviateVector)
        wv._collection_name = self.collection_name

        assert wv.get_type() == weaviate_vector_module.VectorType.WEAVIATE
        assert wv.to_index_struct() == {
            "type": weaviate_vector_module.VectorType.WEAVIATE,
            "vector_store": {"class_prefix": self.collection_name},
        }

    def test_get_collection_name_uses_existing_class_prefix_and_appends_suffix(self):
        dataset = SimpleNamespace(index_struct_dict={"vector_store": {"class_prefix": "ExistingCollection"}}, id="ds-1")
        wv = WeaviateVector.__new__(WeaviateVector)

        assert wv.get_collection_name(dataset) == "ExistingCollection_Node"

    def test_get_collection_name_generates_name_from_dataset_id(self):
        dataset = SimpleNamespace(index_struct_dict=None, id="ds-2")
        wv = WeaviateVector.__new__(WeaviateVector)

        with patch.object(weaviate_vector_module.Dataset, "gen_collection_name_by_id", return_value="Generated_Node"):
            assert wv.get_collection_name(dataset) == "Generated_Node"

    def test_create_calls_collection_setup_then_add_texts(self):
        doc = Document(page_content="hello", metadata={})
        wv = WeaviateVector.__new__(WeaviateVector)
        wv._create_collection = MagicMock()
        wv.add_texts = MagicMock()

        wv.create([doc], [[0.1, 0.2]])

        wv._create_collection.assert_called_once()
        wv.add_texts.assert_called_once_with([doc], [[0.1, 0.2]])

    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.redis_client")
    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.dify_config")
    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate")
    def test_create_collection_includes_doc_type_property(self, mock_weaviate_module, mock_dify_config, mock_redis):
        """Test that _create_collection defines doc_type in the schema properties."""
        # Mock Redis
        mock_lock = MagicMock()
        mock_lock.__enter__ = MagicMock()
        mock_lock.__exit__ = MagicMock()
        mock_redis.lock.return_value = mock_lock
        mock_redis.get.return_value = None
        mock_redis.set.return_value = None

        # Mock dify_config
        mock_dify_config.WEAVIATE_TOKENIZATION = None

        # Mock client
        mock_client = MagicMock()
        mock_client.is_ready.return_value = True
        mock_weaviate_module.connect_to_custom.return_value = mock_client
        mock_client.collections.exists.return_value = False

        # Mock _ensure_properties to avoid side effects
        mock_col = MagicMock()
        mock_client.collections.use.return_value = mock_col
        mock_cfg = MagicMock()
        mock_cfg.properties = []
        mock_col.config.get.return_value = mock_cfg

        wv = WeaviateVector(
            collection_name=self.collection_name,
            config=self.config,
            attributes=self.attributes,
        )
        wv._create_collection()

        # Verify collections.create was called
        mock_client.collections.create.assert_called_once()

        # Extract properties from the create call
        call_kwargs = mock_client.collections.create.call_args
        properties = call_kwargs.kwargs.get("properties")

        # Verify doc_type is among the defined properties
        property_names = [p.name for p in properties]
        assert "doc_type" in property_names, (
            f"doc_type should be in collection schema properties, got: {property_names}"
        )

    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.redis_client")
    def test_create_collection_returns_early_when_cache_key_exists(self, mock_redis):
        mock_lock = MagicMock()
        mock_lock.__enter__ = MagicMock()
        mock_lock.__exit__ = MagicMock()
        mock_redis.lock.return_value = mock_lock
        mock_redis.get.return_value = 1

        wv = WeaviateVector.__new__(WeaviateVector)
        wv._collection_name = self.collection_name
        wv._client = MagicMock()
        wv._ensure_properties = MagicMock()

        wv._create_collection()

        wv._client.collections.exists.assert_not_called()
        wv._ensure_properties.assert_not_called()
        mock_redis.set.assert_not_called()

    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.redis_client")
    def test_create_collection_logs_and_reraises_errors(self, mock_redis):
        mock_lock = MagicMock()
        mock_lock.__enter__ = MagicMock()
        mock_lock.__exit__ = MagicMock(return_value=False)
        mock_redis.lock.return_value = mock_lock
        mock_redis.get.return_value = None

        wv = WeaviateVector.__new__(WeaviateVector)
        wv._collection_name = self.collection_name
        wv._client = MagicMock()
        wv._client.collections.exists.side_effect = RuntimeError("create failed")

        with patch.object(weaviate_vector_module.logger, "exception") as mock_exception:
            with pytest.raises(RuntimeError, match="create failed"):
                wv._create_collection()

        mock_exception.assert_called_once()

    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate")
    def test_ensure_properties_adds_missing_doc_type(self, mock_weaviate_module):
        """Test that _ensure_properties adds doc_type when it's missing from existing schema."""
        mock_client = MagicMock()
        mock_client.is_ready.return_value = True
        mock_weaviate_module.connect_to_custom.return_value = mock_client

        # Collection exists but doc_type property is missing
        mock_client.collections.exists.return_value = True
        mock_col = MagicMock()
        mock_client.collections.use.return_value = mock_col

        # Simulate existing properties WITHOUT doc_type
        existing_props = [
            SimpleNamespace(name="text"),
            SimpleNamespace(name="document_id"),
            SimpleNamespace(name="doc_id"),
            SimpleNamespace(name="chunk_index"),
        ]
        mock_cfg = MagicMock()
        mock_cfg.properties = existing_props
        mock_col.config.get.return_value = mock_cfg

        wv = WeaviateVector(
            collection_name=self.collection_name,
            config=self.config,
            attributes=self.attributes,
        )
        wv._ensure_properties()

        # Verify add_property was called and includes doc_type
        add_calls = mock_col.config.add_property.call_args_list
        added_names = [call.args[0].name for call in add_calls]
        assert "doc_type" in added_names, f"doc_type should be added to existing collection, added: {added_names}"

    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate")
    def test_ensure_properties_adds_all_missing_core_properties(self, mock_weaviate_module):
        mock_client = MagicMock()
        mock_client.is_ready.return_value = True
        mock_weaviate_module.connect_to_custom.return_value = mock_client
        mock_client.collections.exists.return_value = True
        mock_col = MagicMock()
        mock_client.collections.use.return_value = mock_col
        mock_cfg = MagicMock()
        mock_cfg.properties = [SimpleNamespace(name="text")]
        mock_col.config.get.return_value = mock_cfg

        wv = WeaviateVector(
            collection_name=self.collection_name,
            config=self.config,
            attributes=self.attributes,
        )
        wv._ensure_properties()

        add_calls = mock_col.config.add_property.call_args_list
        added_names = [call.args[0].name for call in add_calls]
        assert added_names == ["document_id", "doc_id", "doc_type", "chunk_index"]

    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate")
    def test_ensure_properties_skips_existing_doc_type(self, mock_weaviate_module):
        """Test that _ensure_properties does not add doc_type when it already exists."""
        mock_client = MagicMock()
        mock_client.is_ready.return_value = True
        mock_weaviate_module.connect_to_custom.return_value = mock_client

        mock_client.collections.exists.return_value = True
        mock_col = MagicMock()
        mock_client.collections.use.return_value = mock_col

        # Simulate existing properties WITH doc_type already present
        existing_props = [
            SimpleNamespace(name="text"),
            SimpleNamespace(name="document_id"),
            SimpleNamespace(name="doc_id"),
            SimpleNamespace(name="doc_type"),
            SimpleNamespace(name="chunk_index"),
        ]
        mock_cfg = MagicMock()
        mock_cfg.properties = existing_props
        mock_col.config.get.return_value = mock_cfg

        wv = WeaviateVector(
            collection_name=self.collection_name,
            config=self.config,
            attributes=self.attributes,
        )
        wv._ensure_properties()

        # No properties should be added
        mock_col.config.add_property.assert_not_called()

    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate")
    def test_ensure_properties_logs_warning_when_property_addition_fails(self, mock_weaviate_module):
        mock_client = MagicMock()
        mock_client.is_ready.return_value = True
        mock_weaviate_module.connect_to_custom.return_value = mock_client
        mock_client.collections.exists.return_value = True
        mock_col = MagicMock()
        mock_client.collections.use.return_value = mock_col
        mock_cfg = MagicMock()
        mock_cfg.properties = []
        mock_col.config.get.return_value = mock_cfg
        mock_col.config.add_property.side_effect = RuntimeError("cannot add")

        wv = WeaviateVector(
            collection_name=self.collection_name,
            config=self.config,
            attributes=self.attributes,
        )

        with patch.object(weaviate_vector_module.logger, "warning") as mock_warning:
            wv._ensure_properties()

        assert mock_warning.call_count == 4

    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate")
    def test_search_by_vector_returns_doc_type_in_metadata(self, mock_weaviate_module):
        """Test that search_by_vector returns doc_type in document metadata.

        This is the core bug fix verification: when doc_type is in _attributes,
        it should appear in return_properties and thus be included in results.
        """
        mock_client = MagicMock()
        mock_client.is_ready.return_value = True
        mock_weaviate_module.connect_to_custom.return_value = mock_client

        mock_client.collections.exists.return_value = True
        mock_col = MagicMock()
        mock_client.collections.use.return_value = mock_col

        # Simulate search result with doc_type in properties
        mock_obj = MagicMock()
        mock_obj.properties = {
            "text": "image content description",
            "doc_id": "upload_file_id_123",
            "dataset_id": "dataset_1",
            "document_id": "doc_1",
            "doc_hash": "hash_abc",
            "doc_type": "image",
        }
        mock_obj.metadata.distance = 0.1

        mock_result = MagicMock()
        mock_result.objects = [mock_obj]
        mock_col.query.near_vector.return_value = mock_result

        wv = WeaviateVector(
            collection_name=self.collection_name,
            config=self.config,
            attributes=self.attributes,
        )
        docs = wv.search_by_vector(query_vector=[0.1] * 128, top_k=1)

        # Verify doc_type is in return_properties
        call_kwargs = mock_col.query.near_vector.call_args
        return_props = call_kwargs.kwargs.get("return_properties")
        assert "doc_type" in return_props, f"doc_type should be in return_properties, got: {return_props}"

        # Verify doc_type is in result metadata
        assert len(docs) == 1
        assert docs[0].metadata.get("doc_type") == "image"

    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate")
    def test_search_by_vector_uses_document_filter_and_default_distance(self, mock_weaviate_module):
        mock_client = MagicMock()
        mock_client.is_ready.return_value = True
        mock_weaviate_module.connect_to_custom.return_value = mock_client
        mock_client.collections.exists.return_value = True
        mock_col = MagicMock()
        mock_client.collections.use.return_value = mock_col

        mock_obj = MagicMock()
        mock_obj.properties = {
            "text": "fallback distance result",
            "document_id": "doc-1",
            "doc_id": "segment-1",
        }
        mock_obj.metadata = None

        mock_result = MagicMock()
        mock_result.objects = [mock_obj]
        mock_col.query.near_vector.return_value = mock_result

        wv = WeaviateVector(
            collection_name=self.collection_name,
            config=self.config,
            attributes=self.attributes,
        )
        docs = wv.search_by_vector(
            query_vector=[0.2] * 3,
            document_ids_filter=["doc-1"],
            top_k=2,
            score_threshold=-1,
        )

        assert len(docs) == 1
        assert docs[0].metadata["score"] == 0.0
        assert mock_col.query.near_vector.call_args.kwargs["filters"] is not None

    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate")
    def test_search_by_vector_returns_empty_when_collection_is_missing(self, mock_weaviate_module):
        mock_client = MagicMock()
        mock_client.is_ready.return_value = True
        mock_weaviate_module.connect_to_custom.return_value = mock_client
        mock_client.collections.exists.return_value = False

        wv = WeaviateVector(
            collection_name=self.collection_name,
            config=self.config,
            attributes=self.attributes,
        )

        assert wv.search_by_vector(query_vector=[0.1] * 3) == []

    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate")
    def test_search_by_full_text_returns_doc_type_in_metadata(self, mock_weaviate_module):
        """Test that search_by_full_text also returns doc_type in document metadata."""
        mock_client = MagicMock()
        mock_client.is_ready.return_value = True
        mock_weaviate_module.connect_to_custom.return_value = mock_client

        mock_client.collections.exists.return_value = True
        mock_col = MagicMock()
        mock_client.collections.use.return_value = mock_col

        # Simulate BM25 search result with doc_type
        mock_obj = MagicMock()
        mock_obj.properties = {
            "text": "image content description",
            "doc_id": "upload_file_id_456",
            "doc_type": "image",
        }
        mock_obj.vector = {"default": [0.1] * 128}

        mock_result = MagicMock()
        mock_result.objects = [mock_obj]
        mock_col.query.bm25.return_value = mock_result

        wv = WeaviateVector(
            collection_name=self.collection_name,
            config=self.config,
            attributes=self.attributes,
        )
        docs = wv.search_by_full_text(query="image", top_k=1)

        # Verify doc_type is in return_properties
        call_kwargs = mock_col.query.bm25.call_args
        return_props = call_kwargs.kwargs.get("return_properties")
        assert "doc_type" in return_props, (
            f"doc_type should be in return_properties for BM25 search, got: {return_props}"
        )

        # Verify doc_type is in result metadata
        assert len(docs) == 1
        assert docs[0].metadata.get("doc_type") == "image"

    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate")
    def test_search_by_full_text_uses_document_filter(self, mock_weaviate_module):
        mock_client = MagicMock()
        mock_client.is_ready.return_value = True
        mock_weaviate_module.connect_to_custom.return_value = mock_client
        mock_client.collections.exists.return_value = True
        mock_col = MagicMock()
        mock_client.collections.use.return_value = mock_col

        mock_obj = MagicMock()
        mock_obj.properties = {"text": "bm25 result", "doc_id": "segment-1"}
        mock_obj.vector = [0.3, 0.4]

        mock_result = MagicMock()
        mock_result.objects = [mock_obj]
        mock_col.query.bm25.return_value = mock_result

        wv = WeaviateVector(
            collection_name=self.collection_name,
            config=self.config,
            attributes=self.attributes,
        )
        docs = wv.search_by_full_text(query="bm25", document_ids_filter=["doc-1"])

        assert len(docs) == 1
        assert docs[0].vector == [0.3, 0.4]
        assert mock_col.query.bm25.call_args.kwargs["filters"] is not None

    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate")
    def test_search_by_full_text_returns_empty_when_collection_is_missing(self, mock_weaviate_module):
        mock_client = MagicMock()
        mock_client.is_ready.return_value = True
        mock_weaviate_module.connect_to_custom.return_value = mock_client
        mock_client.collections.exists.return_value = False

        wv = WeaviateVector(
            collection_name=self.collection_name,
            config=self.config,
            attributes=self.attributes,
        )

        assert wv.search_by_full_text(query="missing") == []

    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate")
    def test_add_texts_stores_doc_type_in_properties(self, mock_weaviate_module):
        """Test that add_texts includes doc_type from document metadata in stored properties."""
        mock_client = MagicMock()
        mock_client.is_ready.return_value = True
        mock_weaviate_module.connect_to_custom.return_value = mock_client

        mock_col = MagicMock()
        mock_client.collections.use.return_value = mock_col

        # Create a document with doc_type metadata (as produced by multimodal indexing)
        doc = Document(
            page_content="an image of a cat",
            metadata={
                "doc_id": "upload_file_123",
                "doc_type": "image",
                "dataset_id": "ds_1",
                "document_id": "doc_1",
                "doc_hash": "hash_xyz",
            },
        )

        wv = WeaviateVector(
            collection_name=self.collection_name,
            config=self.config,
            attributes=self.attributes,
        )

        # Mock batch context manager
        mock_batch = MagicMock()
        mock_batch.__enter__ = MagicMock(return_value=mock_batch)
        mock_batch.__exit__ = MagicMock(return_value=False)
        mock_col.batch.dynamic.return_value = mock_batch

        wv.add_texts(documents=[doc], embeddings=[[0.1] * 128])

        # Verify batch.add_object was called with doc_type in properties
        mock_batch.add_object.assert_called_once()
        call_kwargs = mock_batch.add_object.call_args
        stored_props = call_kwargs.kwargs.get("properties")
        assert stored_props.get("doc_type") == "image", f"doc_type should be stored in properties, got: {stored_props}"

    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate")
    def test_add_texts_falls_back_to_random_uuid_and_serializes_datetime_metadata(self, mock_weaviate_module):
        mock_client = MagicMock()
        mock_client.is_ready.return_value = True
        mock_weaviate_module.connect_to_custom.return_value = mock_client
        mock_col = MagicMock()
        mock_client.collections.use.return_value = mock_col

        mock_batch = MagicMock()
        mock_batch.__enter__ = MagicMock(return_value=mock_batch)
        mock_batch.__exit__ = MagicMock(return_value=False)
        mock_col.batch.dynamic.return_value = mock_batch

        created_at = datetime.datetime(2024, 1, 2, 3, 4, 5, tzinfo=datetime.UTC)
        doc = Document(page_content="text", metadata={"created_at": created_at})

        wv = WeaviateVector(
            collection_name=self.collection_name,
            config=self.config,
            attributes=self.attributes,
        )

        with (
            patch.object(wv, "_get_uuids", return_value=["not-a-uuid"]),
            patch("core.rag.datasource.vdb.weaviate.weaviate_vector._uuid.uuid4", return_value="fallback-uuid"),
        ):
            ids = wv.add_texts(documents=[doc], embeddings=[[]])

        assert ids == ["fallback-uuid"]
        call_kwargs = mock_batch.add_object.call_args
        assert call_kwargs.kwargs["uuid"] == "fallback-uuid"
        assert call_kwargs.kwargs["vector"] is None
        assert call_kwargs.kwargs["properties"]["created_at"] == created_at.isoformat()

    def test_is_uuid_handles_invalid_values(self):
        wv = WeaviateVector.__new__(WeaviateVector)

        assert wv._is_uuid("123e4567-e89b-12d3-a456-426614174000") is True
        assert wv._is_uuid("not-a-uuid") is False

    def test_delete_by_metadata_field_returns_when_collection_is_missing(self):
        wv = WeaviateVector.__new__(WeaviateVector)
        wv._collection_name = self.collection_name
        wv._client = MagicMock()
        wv._client.collections.exists.return_value = False

        wv.delete_by_metadata_field("doc_id", "segment-1")

        wv._client.collections.use.assert_not_called()

    def test_delete_by_metadata_field_deletes_matching_objects(self):
        wv = WeaviateVector.__new__(WeaviateVector)
        wv._collection_name = self.collection_name
        wv._client = MagicMock()
        wv._client.collections.exists.return_value = True
        mock_col = MagicMock()
        wv._client.collections.use.return_value = mock_col

        wv.delete_by_metadata_field("doc_id", "segment-1")

        mock_col.data.delete_many.assert_called_once()

    def test_delete_removes_collection_when_present(self):
        wv = WeaviateVector.__new__(WeaviateVector)
        wv._collection_name = self.collection_name
        wv._client = MagicMock()
        wv._client.collections.exists.return_value = True

        wv.delete()

        wv._client.collections.delete.assert_called_once_with(self.collection_name)

    def test_text_exists_handles_missing_and_present_documents(self):
        wv = WeaviateVector.__new__(WeaviateVector)
        wv._collection_name = self.collection_name
        wv._client = MagicMock()
        wv._client.collections.exists.side_effect = [False, True]
        mock_col = MagicMock()
        wv._client.collections.use.return_value = mock_col
        mock_col.query.fetch_objects.return_value = SimpleNamespace(objects=[SimpleNamespace()])

        assert wv.text_exists("segment-1") is False
        assert wv.text_exists("segment-1") is True

    def test_delete_by_ids_handles_missing_collections_and_404s(self):
        class FakeUnexpectedStatusCodeError(Exception):
            def __init__(self, status_code):
                super().__init__(f"status={status_code}")
                self.status_code = status_code

        wv = WeaviateVector.__new__(WeaviateVector)
        wv._collection_name = self.collection_name
        wv._client = MagicMock()
        wv._client.collections.exists.side_effect = [False, True]
        mock_col = MagicMock()
        wv._client.collections.use.return_value = mock_col
        mock_col.data.delete_by_id.side_effect = [FakeUnexpectedStatusCodeError(404), None]

        with patch.object(weaviate_vector_module, "UnexpectedStatusCodeError", FakeUnexpectedStatusCodeError):
            wv.delete_by_ids(["ignored"])
            wv.delete_by_ids(["missing-id", "ok-id"])

        assert mock_col.data.delete_by_id.call_count == 2

    def test_delete_by_ids_reraises_non_404_errors(self):
        class FakeUnexpectedStatusCodeError(Exception):
            def __init__(self, status_code):
                super().__init__(f"status={status_code}")
                self.status_code = status_code

        wv = WeaviateVector.__new__(WeaviateVector)
        wv._collection_name = self.collection_name
        wv._client = MagicMock()
        wv._client.collections.exists.return_value = True
        mock_col = MagicMock()
        wv._client.collections.use.return_value = mock_col
        mock_col.data.delete_by_id.side_effect = FakeUnexpectedStatusCodeError(500)

        with patch.object(weaviate_vector_module, "UnexpectedStatusCodeError", FakeUnexpectedStatusCodeError):
            with pytest.raises(FakeUnexpectedStatusCodeError, match="status=500"):
                wv.delete_by_ids(["bad-id"])

    def test_json_serializable_converts_datetime(self):
        wv = WeaviateVector.__new__(WeaviateVector)
        created_at = datetime.datetime(2024, 1, 2, 3, 4, 5, tzinfo=datetime.UTC)

        assert wv._json_serializable(created_at) == created_at.isoformat()
        assert wv._json_serializable("plain") == "plain"


class TestVectorDefaultAttributes(unittest.TestCase):
    """Tests for Vector class default attributes list."""

    @patch("core.rag.datasource.vdb.vector_factory.Vector._get_embeddings")
    @patch("core.rag.datasource.vdb.vector_factory.Vector._init_vector")
    def test_default_attributes_include_doc_type(self, mock_init_vector, mock_get_embeddings):
        """Test that Vector class default attributes include doc_type."""
        from core.rag.datasource.vdb.vector_factory import Vector

        mock_get_embeddings.return_value = MagicMock()
        mock_init_vector.return_value = MagicMock()

        mock_dataset = MagicMock()
        mock_dataset.index_struct_dict = None

        vector = Vector(dataset=mock_dataset)

        assert "doc_type" in vector._attributes, f"doc_type should be in default attributes, got: {vector._attributes}"


class TestWeaviateVectorFactory(unittest.TestCase):
    def test_init_vector_uses_existing_dataset_index_struct(self):
        dataset = SimpleNamespace(
            id="dataset-1",
            index_struct_dict={"vector_store": {"class_prefix": "ExistingCollection_Node"}},
            index_struct=None,
        )
        attributes = ["doc_id"]

        with (
            patch.object(weaviate_vector_module.dify_config, "WEAVIATE_ENDPOINT", "http://localhost:8080"),
            patch.object(weaviate_vector_module.dify_config, "WEAVIATE_GRPC_ENDPOINT", "localhost:50051"),
            patch.object(weaviate_vector_module.dify_config, "WEAVIATE_API_KEY", "api-key"),
            patch.object(weaviate_vector_module.dify_config, "WEAVIATE_BATCH_SIZE", 88),
            patch(
                "core.rag.datasource.vdb.weaviate.weaviate_vector.WeaviateVector", return_value="vector"
            ) as mock_vector,
        ):
            factory = weaviate_vector_module.WeaviateVectorFactory()
            result = factory.init_vector(dataset, attributes, MagicMock())

        assert result == "vector"
        config = mock_vector.call_args.kwargs["config"]
        assert mock_vector.call_args.kwargs["collection_name"] == "ExistingCollection_Node"
        assert mock_vector.call_args.kwargs["attributes"] == attributes
        assert config.endpoint == "http://localhost:8080"
        assert config.grpc_endpoint == "localhost:50051"
        assert config.api_key == "api-key"
        assert config.batch_size == 88
        assert dataset.index_struct is None

    def test_init_vector_generates_collection_and_updates_index_struct(self):
        dataset = SimpleNamespace(id="dataset-2", index_struct_dict=None, index_struct=None)
        attributes = ["doc_id", "doc_type"]

        with (
            patch.object(weaviate_vector_module.dify_config, "WEAVIATE_ENDPOINT", "http://localhost:8080"),
            patch.object(weaviate_vector_module.dify_config, "WEAVIATE_GRPC_ENDPOINT", ""),
            patch.object(weaviate_vector_module.dify_config, "WEAVIATE_API_KEY", None),
            patch.object(weaviate_vector_module.dify_config, "WEAVIATE_BATCH_SIZE", 100),
            patch.object(
                weaviate_vector_module.Dataset,
                "gen_collection_name_by_id",
                return_value="GeneratedCollection_Node",
            ),
            patch(
                "core.rag.datasource.vdb.weaviate.weaviate_vector.WeaviateVector", return_value="vector"
            ) as mock_vector,
        ):
            factory = weaviate_vector_module.WeaviateVectorFactory()
            result = factory.init_vector(dataset, attributes, MagicMock())

        assert result == "vector"
        assert mock_vector.call_args.kwargs["collection_name"] == "GeneratedCollection_Node"
        assert json.loads(dataset.index_struct) == {
            "type": weaviate_vector_module.VectorType.WEAVIATE,
            "vector_store": {"class_prefix": "GeneratedCollection_Node"},
        }


if __name__ == "__main__":
    unittest.main()
