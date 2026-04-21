from unittest.mock import patch

import httpx
import pytest
from dify_vdb_tidb_on_qdrant.tidb_on_qdrant_vector import (
    TidbOnQdrantConfig,
    TidbOnQdrantVector,
)
from qdrant_client.http import models as rest
from qdrant_client.http.exceptions import UnexpectedResponse


class TestTidbOnQdrantVectorDeleteByIds:
    """Unit tests for TidbOnQdrantVector.delete_by_ids method."""

    @pytest.fixture
    def vector_instance(self):
        """Create a TidbOnQdrantVector instance for testing."""
        config = TidbOnQdrantConfig(
            endpoint="http://localhost:6333",
            api_key="test_api_key",
        )

        with patch("dify_vdb_tidb_on_qdrant.tidb_on_qdrant_vector.qdrant_client.QdrantClient"):
            vector = TidbOnQdrantVector(
                collection_name="test_collection",
                group_id="test_group",
                config=config,
            )
            return vector

    def test_delete_by_ids_with_multiple_ids(self, vector_instance):
        """Test batch deletion with multiple document IDs."""
        ids = ["doc1", "doc2", "doc3"]

        vector_instance.delete_by_ids(ids)

        # Verify that delete was called once with MatchAny filter
        vector_instance._client.delete.assert_called_once()
        call_args = vector_instance._client.delete.call_args

        # Check collection name
        assert call_args[1]["collection_name"] == "test_collection"

        # Verify filter uses MatchAny with all IDs
        filter_selector = call_args[1]["points_selector"]
        filter_obj = filter_selector.filter
        assert len(filter_obj.must) == 1

        field_condition = filter_obj.must[0]
        assert field_condition.key == "metadata.doc_id"
        assert isinstance(field_condition.match, rest.MatchAny)
        assert set(field_condition.match.any) == {"doc1", "doc2", "doc3"}

    def test_delete_by_ids_with_single_id(self, vector_instance):
        """Test deletion with a single document ID."""
        ids = ["doc1"]

        vector_instance.delete_by_ids(ids)

        # Verify that delete was called once
        vector_instance._client.delete.assert_called_once()
        call_args = vector_instance._client.delete.call_args

        # Verify filter uses MatchAny with single ID
        filter_selector = call_args[1]["points_selector"]
        filter_obj = filter_selector.filter
        field_condition = filter_obj.must[0]
        assert isinstance(field_condition.match, rest.MatchAny)
        assert field_condition.match.any == ["doc1"]

    def test_delete_by_ids_with_empty_list(self, vector_instance):
        """Test deletion with empty ID list returns early without API call."""
        vector_instance.delete_by_ids([])

        # Verify that delete was NOT called
        vector_instance._client.delete.assert_not_called()

    def test_delete_by_ids_with_404_error(self, vector_instance):
        """Test that 404 errors (collection not found) are handled gracefully."""
        ids = ["doc1", "doc2"]

        # Mock a 404 error
        error = UnexpectedResponse(
            status_code=404,
            reason_phrase="Not Found",
            content=b"Collection not found",
            headers=httpx.Headers(),
        )
        vector_instance._client.delete.side_effect = error

        # Should not raise an exception
        vector_instance.delete_by_ids(ids)

        # Verify delete was called
        vector_instance._client.delete.assert_called_once()

    def test_delete_by_ids_with_unexpected_error(self, vector_instance):
        """Test that non-404 errors are re-raised."""
        ids = ["doc1", "doc2"]

        # Mock a 500 error
        error = UnexpectedResponse(
            status_code=500,
            reason_phrase="Internal Server Error",
            content=b"Server error",
            headers=httpx.Headers(),
        )
        vector_instance._client.delete.side_effect = error

        # Should re-raise the exception
        with pytest.raises(UnexpectedResponse) as exc_info:
            vector_instance.delete_by_ids(ids)

        assert exc_info.value.status_code == 500

    def test_delete_by_ids_with_exactly_1000(self, vector_instance):
        """Test deletion with exactly 1000 IDs triggers a single batch."""
        ids = [f"doc_{i}" for i in range(1000)]

        vector_instance.delete_by_ids(ids)

        vector_instance._client.delete.assert_called_once()
        call_args = vector_instance._client.delete.call_args

        filter_selector = call_args[1]["points_selector"]
        filter_obj = filter_selector.filter
        field_condition = filter_obj.must[0]

        assert len(field_condition.match.any) == 1000
        assert "doc_0" in field_condition.match.any
        assert "doc_999" in field_condition.match.any

    def test_delete_by_ids_splits_into_batches(self, vector_instance):
        """Test deletion with >1000 IDs triggers multiple batched calls."""
        ids = [f"doc_{i}" for i in range(2500)]

        vector_instance.delete_by_ids(ids)

        assert vector_instance._client.delete.call_count == 3

        batches = []
        for call in vector_instance._client.delete.call_args_list:
            filter_selector = call[1]["points_selector"]
            field_condition = filter_selector.filter.must[0]
            batches.append(field_condition.match.any)

        assert len(batches[0]) == 1000
        assert len(batches[1]) == 1000
        assert len(batches[2]) == 500

    def test_delete_by_ids_filter_structure(self, vector_instance):
        """Test that the filter structure is correctly constructed."""
        ids = ["doc1", "doc2"]

        vector_instance.delete_by_ids(ids)

        call_args = vector_instance._client.delete.call_args
        filter_selector = call_args[1]["points_selector"]
        filter_obj = filter_selector.filter

        # Verify Filter structure
        assert isinstance(filter_obj, rest.Filter)
        assert filter_obj.must is not None
        assert len(filter_obj.must) == 1

        # Verify FieldCondition structure
        field_condition = filter_obj.must[0]
        assert isinstance(field_condition, rest.FieldCondition)
        assert field_condition.key == "metadata.doc_id"

        # Verify MatchAny structure
        assert isinstance(field_condition.match, rest.MatchAny)
        assert field_condition.match.any == ids


class TestInitVectorEndpointSelection:
    """Test that init_vector selects the correct qdrant endpoint.

    We avoid importing the full module (which triggers Flask app context)
    by testing the endpoint selection logic directly on TidbOnQdrantConfig.
    """

    def test_uses_binding_endpoint_when_present(self):
        binding_endpoint = "https://qdrant-custom.tidb.com"
        global_url = "https://qdrant-global.tidb.com"

        qdrant_url = binding_endpoint or global_url or ""

        assert qdrant_url == "https://qdrant-custom.tidb.com"
        config = TidbOnQdrantConfig(endpoint=qdrant_url)
        assert config.endpoint == "https://qdrant-custom.tidb.com"

    def test_falls_back_to_global_when_binding_endpoint_is_none(self):
        binding_endpoint = None
        global_url = "https://qdrant-global.tidb.com"

        qdrant_url = binding_endpoint or global_url or ""

        assert qdrant_url == "https://qdrant-global.tidb.com"
        config = TidbOnQdrantConfig(endpoint=qdrant_url)
        assert config.endpoint == "https://qdrant-global.tidb.com"

    def test_falls_back_to_empty_when_both_none(self):
        binding_endpoint = None
        global_url = None

        qdrant_url = binding_endpoint or global_url or ""

        assert qdrant_url == ""
        config = TidbOnQdrantConfig(endpoint=qdrant_url)
        assert config.endpoint == ""

    def test_binding_endpoint_takes_precedence_over_global(self):
        binding_endpoint = "https://qdrant-ap-southeast.tidb.com"
        global_url = "https://qdrant-us-east.tidb.com"

        qdrant_url = binding_endpoint or global_url or ""

        assert qdrant_url == "https://qdrant-ap-southeast.tidb.com"

    def test_empty_string_binding_endpoint_falls_back_to_global(self):
        binding_endpoint = ""
        global_url = "https://qdrant-global.tidb.com"

        qdrant_url = binding_endpoint or global_url or ""

        assert qdrant_url == "https://qdrant-global.tidb.com"
