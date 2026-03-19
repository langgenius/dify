"""Unit tests for Weaviate vector database implementation.

Focuses on verifying that doc_type is properly handled in:
- Collection schema creation (_create_collection)
- Property migration (_ensure_properties / _maybe_ensure_properties)
- Proactive schema migration on first access per collection per process
- Vector search result metadata (search_by_vector)
- Full-text search result metadata (search_by_full_text)
"""

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from core.rag.datasource.vdb.weaviate import weaviate_vector as weaviate_vector_module
from core.rag.datasource.vdb.weaviate.weaviate_vector import WeaviateConfig, WeaviateVector
from core.rag.models.document import Document


class TestWeaviateVector(unittest.TestCase):
    """Tests for WeaviateVector class with focus on doc_type metadata handling."""

    def setUp(self):
        weaviate_vector_module._weaviate_client = None
        weaviate_vector_module._ensured_collections.clear()
        self.config = WeaviateConfig(
            endpoint="http://localhost:8080",
            api_key="test-key",
            batch_size=100,
        )
        self.collection_name = "Test_Collection_Node"
        self.attributes = ["doc_id", "dataset_id", "document_id", "doc_hash", "doc_type"]

    def tearDown(self):
        weaviate_vector_module._weaviate_client = None
        weaviate_vector_module._ensured_collections.clear()

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

        # Verify collection is marked as ensured after _create_collection
        assert self.collection_name in weaviate_vector_module._ensured_collections

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
        result = wv._ensure_properties()

        # Verify add_property was called and includes doc_type
        add_calls = mock_col.config.add_property.call_args_list
        added_names = [call.args[0].name for call in add_calls]
        assert "doc_type" in added_names, f"doc_type should be added to existing collection, added: {added_names}"
        assert result is True

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
        result = wv._ensure_properties()

        # No properties should be added
        mock_col.config.add_property.assert_not_called()
        assert result is True

    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate")
    def test_ensure_properties_returns_false_on_failure(self, mock_weaviate_module):
        """_ensure_properties should return False when add_property fails."""
        mock_client = MagicMock()
        mock_client.is_ready.return_value = True
        mock_weaviate_module.connect_to_custom.return_value = mock_client

        mock_client.collections.exists.return_value = True
        mock_col = MagicMock()
        mock_client.collections.use.return_value = mock_col

        # Schema missing doc_type → will attempt add_property
        existing_props = [
            SimpleNamespace(name="text"),
            SimpleNamespace(name="document_id"),
            SimpleNamespace(name="doc_id"),
            SimpleNamespace(name="chunk_index"),
        ]
        mock_cfg = MagicMock()
        mock_cfg.properties = existing_props
        mock_col.config.get.return_value = mock_cfg

        # Simulate Weaviate failure during add_property
        mock_col.config.add_property.side_effect = Exception("Weaviate unavailable")

        wv = WeaviateVector(
            collection_name=self.collection_name,
            config=self.config,
            attributes=self.attributes,
        )
        result = wv._ensure_properties()

        assert result is False, "Should return False when property addition fails"

    # ------------------------------------------------------------------ #
    #  _maybe_ensure_properties: proactive migration with process cache   #
    # ------------------------------------------------------------------ #

    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate")
    def test_maybe_ensure_properties_calls_ensure_on_first_access(self, mock_weaviate_module):
        """First call to _maybe_ensure_properties should delegate to _ensure_properties."""
        mock_client = MagicMock()
        mock_client.is_ready.return_value = True
        mock_weaviate_module.connect_to_custom.return_value = mock_client

        wv = WeaviateVector(
            collection_name=self.collection_name,
            config=self.config,
            attributes=self.attributes,
        )
        wv._ensure_properties = MagicMock(return_value=True)

        wv._maybe_ensure_properties()

        wv._ensure_properties.assert_called_once()
        assert self.collection_name in weaviate_vector_module._ensured_collections

    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate")
    def test_maybe_ensure_properties_skips_on_second_access(self, mock_weaviate_module):
        """Subsequent calls to _maybe_ensure_properties should be no-ops."""
        mock_client = MagicMock()
        mock_client.is_ready.return_value = True
        mock_weaviate_module.connect_to_custom.return_value = mock_client

        wv = WeaviateVector(
            collection_name=self.collection_name,
            config=self.config,
            attributes=self.attributes,
        )
        wv._ensure_properties = MagicMock(return_value=True)

        # First call — should invoke _ensure_properties
        wv._maybe_ensure_properties()
        # Second call — should be a no-op
        wv._maybe_ensure_properties()

        wv._ensure_properties.assert_called_once()

    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate")
    def test_maybe_ensure_properties_retries_on_failure(self, mock_weaviate_module):
        """When _ensure_properties returns False, the collection should NOT be cached.

        The next call must retry _ensure_properties so that transient failures
        (e.g. Weaviate temporarily unavailable) don't permanently prevent migration.
        """
        mock_client = MagicMock()
        mock_client.is_ready.return_value = True
        mock_weaviate_module.connect_to_custom.return_value = mock_client

        wv = WeaviateVector(
            collection_name=self.collection_name,
            config=self.config,
            attributes=self.attributes,
        )
        # First call fails
        wv._ensure_properties = MagicMock(side_effect=[False, True])

        wv._maybe_ensure_properties()
        assert self.collection_name not in weaviate_vector_module._ensured_collections

        # Second call succeeds → now cached
        wv._maybe_ensure_properties()
        assert self.collection_name in weaviate_vector_module._ensured_collections
        assert wv._ensure_properties.call_count == 2

    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate")
    def test_maybe_ensure_properties_independent_per_collection(self, mock_weaviate_module):
        """Different collections should each get their own one-time check."""
        mock_client = MagicMock()
        mock_client.is_ready.return_value = True
        mock_weaviate_module.connect_to_custom.return_value = mock_client

        wv1 = WeaviateVector(
            collection_name="Collection_A",
            config=self.config,
            attributes=self.attributes,
        )
        wv2 = WeaviateVector(
            collection_name="Collection_B",
            config=self.config,
            attributes=self.attributes,
        )
        wv1._ensure_properties = MagicMock(return_value=True)
        wv2._ensure_properties = MagicMock(return_value=True)

        wv1._maybe_ensure_properties()
        wv2._maybe_ensure_properties()

        wv1._ensure_properties.assert_called_once()
        wv2._ensure_properties.assert_called_once()
        assert "Collection_A" in weaviate_vector_module._ensured_collections
        assert "Collection_B" in weaviate_vector_module._ensured_collections

    # ------------------------------------------------------------------ #
    #  search_by_vector                                                   #
    # ------------------------------------------------------------------ #

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

        # Pre-populate schema so _maybe_ensure_properties is a no-op
        mock_cfg = MagicMock()
        mock_cfg.properties = [
            SimpleNamespace(name="text"),
            SimpleNamespace(name="document_id"),
            SimpleNamespace(name="doc_id"),
            SimpleNamespace(name="doc_type"),
            SimpleNamespace(name="chunk_index"),
        ]
        mock_col.config.get.return_value = mock_cfg

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
    def test_search_by_vector_calls_maybe_ensure_properties(self, mock_weaviate_module):
        """search_by_vector should proactively call _maybe_ensure_properties."""
        mock_client = MagicMock()
        mock_client.is_ready.return_value = True
        mock_weaviate_module.connect_to_custom.return_value = mock_client

        mock_client.collections.exists.return_value = True
        mock_col = MagicMock()
        mock_client.collections.use.return_value = mock_col

        mock_obj = MagicMock()
        mock_obj.properties = {"text": "hello", "doc_id": "id_1"}
        mock_obj.metadata.distance = 0.2
        mock_result = MagicMock()
        mock_result.objects = [mock_obj]
        mock_col.query.near_vector.return_value = mock_result

        wv = WeaviateVector(
            collection_name=self.collection_name,
            config=self.config,
            attributes=self.attributes,
        )
        wv._maybe_ensure_properties = MagicMock()
        wv.search_by_vector(query_vector=[0.1] * 128, top_k=1)

        wv._maybe_ensure_properties.assert_called_once()

    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate")
    def test_search_by_vector_migrates_schema_on_first_access_to_old_collection(self, mock_weaviate_module):
        """search_by_vector on a pre-upgrade collection should proactively add missing properties."""
        mock_client = MagicMock()
        mock_client.is_ready.return_value = True
        mock_weaviate_module.connect_to_custom.return_value = mock_client

        mock_client.collections.exists.return_value = True
        mock_col = MagicMock()
        mock_client.collections.use.return_value = mock_col

        mock_obj = MagicMock()
        mock_obj.properties = {"text": "hello world", "doc_id": "id_1"}
        mock_obj.metadata.distance = 0.2
        mock_result = MagicMock()
        mock_result.objects = [mock_obj]
        mock_col.query.near_vector.return_value = mock_result

        # Schema is missing doc_type
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
        docs = wv.search_by_vector(query_vector=[0.1] * 128, top_k=1)

        # Verify doc_type was added proactively
        add_calls = mock_col.config.add_property.call_args_list
        added_names = [call.args[0].name for call in add_calls]
        assert "doc_type" in added_names
        assert len(docs) == 1
        # Only one query call (no retry needed with proactive approach)
        assert mock_col.query.near_vector.call_count == 1

    # ------------------------------------------------------------------ #
    #  search_by_full_text                                                #
    # ------------------------------------------------------------------ #

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

        # Pre-populate schema
        mock_cfg = MagicMock()
        mock_cfg.properties = [
            SimpleNamespace(name="text"),
            SimpleNamespace(name="document_id"),
            SimpleNamespace(name="doc_id"),
            SimpleNamespace(name="doc_type"),
            SimpleNamespace(name="chunk_index"),
        ]
        mock_col.config.get.return_value = mock_cfg

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
    def test_search_by_full_text_calls_maybe_ensure_properties(self, mock_weaviate_module):
        """search_by_full_text should proactively call _maybe_ensure_properties."""
        mock_client = MagicMock()
        mock_client.is_ready.return_value = True
        mock_weaviate_module.connect_to_custom.return_value = mock_client

        mock_client.collections.exists.return_value = True
        mock_col = MagicMock()
        mock_client.collections.use.return_value = mock_col

        mock_obj = MagicMock()
        mock_obj.properties = {"text": "hello", "doc_id": "id_1"}
        mock_obj.vector = {"default": [0.1] * 128}
        mock_result = MagicMock()
        mock_result.objects = [mock_obj]
        mock_col.query.bm25.return_value = mock_result

        wv = WeaviateVector(
            collection_name=self.collection_name,
            config=self.config,
            attributes=self.attributes,
        )
        wv._maybe_ensure_properties = MagicMock()
        wv.search_by_full_text(query="hello", top_k=1)

        wv._maybe_ensure_properties.assert_called_once()

    # ------------------------------------------------------------------ #
    #  text_exists                                                        #
    # ------------------------------------------------------------------ #

    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate")
    def test_text_exists_calls_maybe_ensure_properties(self, mock_weaviate_module):
        """text_exists should proactively call _maybe_ensure_properties."""
        mock_client = MagicMock()
        mock_client.is_ready.return_value = True
        mock_weaviate_module.connect_to_custom.return_value = mock_client

        mock_client.collections.exists.return_value = True
        mock_col = MagicMock()
        mock_client.collections.use.return_value = mock_col

        mock_result = MagicMock()
        mock_result.objects = []
        mock_col.query.fetch_objects.return_value = mock_result

        wv = WeaviateVector(
            collection_name=self.collection_name,
            config=self.config,
            attributes=self.attributes,
        )
        wv._maybe_ensure_properties = MagicMock()
        wv.text_exists("some_doc_id")

        wv._maybe_ensure_properties.assert_called_once()

    # ------------------------------------------------------------------ #
    #  delete_by_metadata_field                                           #
    # ------------------------------------------------------------------ #

    @patch("core.rag.datasource.vdb.weaviate.weaviate_vector.weaviate")
    def test_delete_by_metadata_field_calls_maybe_ensure_properties(self, mock_weaviate_module):
        """delete_by_metadata_field should proactively call _maybe_ensure_properties."""
        mock_client = MagicMock()
        mock_client.is_ready.return_value = True
        mock_weaviate_module.connect_to_custom.return_value = mock_client

        mock_client.collections.exists.return_value = True
        mock_col = MagicMock()
        mock_client.collections.use.return_value = mock_col

        wv = WeaviateVector(
            collection_name=self.collection_name,
            config=self.config,
            attributes=self.attributes,
        )
        wv._maybe_ensure_properties = MagicMock()
        wv.delete_by_metadata_field("annotation_id", "ann_123")

        wv._maybe_ensure_properties.assert_called_once()

    # ------------------------------------------------------------------ #
    #  add_texts                                                          #
    # ------------------------------------------------------------------ #

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


if __name__ == "__main__":
    unittest.main()
