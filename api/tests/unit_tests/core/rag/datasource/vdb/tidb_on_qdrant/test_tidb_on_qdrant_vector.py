from unittest.mock import patch

import httpx
import pytest
from qdrant_client.http import models as rest
from qdrant_client.http.exceptions import UnexpectedResponse

from core.rag.datasource.vdb.tidb_on_qdrant.tidb_on_qdrant_vector import (
    TidbOnQdrantConfig,
    TidbOnQdrantVector,
)


class TestTidbOnQdrantVectorDeleteByIds:
    """Unit tests for TidbOnQdrantVector.delete_by_ids method."""

    @pytest.fixture
    def vector_instance(self):
        """Create a TidbOnQdrantVector instance for testing."""
        config = TidbOnQdrantConfig(
            endpoint="http://localhost:6333",
            api_key="test_api_key",
        )

        with patch("core.rag.datasource.vdb.tidb_on_qdrant.tidb_on_qdrant_vector.qdrant_client.QdrantClient"):
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

    def test_delete_by_ids_with_large_batch(self, vector_instance):
        """Test deletion with a large batch of IDs."""
        # Create 1000 IDs
        ids = [f"doc_{i}" for i in range(1000)]

        vector_instance.delete_by_ids(ids)

        # Verify single delete call with all IDs
        vector_instance._client.delete.assert_called_once()
        call_args = vector_instance._client.delete.call_args

        filter_selector = call_args[1]["points_selector"]
        filter_obj = filter_selector.filter
        field_condition = filter_obj.must[0]

        # Verify all 1000 IDs are in the batch
        assert len(field_condition.match.any) == 1000
        assert "doc_0" in field_condition.match.any
        assert "doc_999" in field_condition.match.any

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
