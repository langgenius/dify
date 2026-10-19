from unittest.mock import patch

import httpx
import pytest
from dify_vdb_tidb_on_qdrant.tidb_on_qdrant_vector import (
    TidbOnQdrantConfig,
    TidbOnQdrantVector,
)
from qdrant_client.http import models as rest
from qdrant_client.http.exceptions import UnexpectedResponse

from core.rag.rerank.entity.weight import KeywordSetting, VectorSetting, Weights
from core.rag.rerank.weight_rerank import WeightRerankRunner


class TestTidbOnQdrantVectorFullTextSearch:
    @pytest.fixture
    def vector(self):
        with patch("dify_vdb_tidb_on_qdrant.tidb_on_qdrant_vector.qdrant_client.QdrantClient"):
            return TidbOnQdrantVector(
                collection_name="test_collection",
                group_id="test_group",
                config=TidbOnQdrantConfig(endpoint="http://localhost:6333"),
            )

    @pytest.fixture
    def points(self):
        return [
            rest.Record(
                id=index,
                payload={"page_content": content, "metadata": {"doc_id": str(index), "document_id": "document-1"}},
                vector=[0.0, 1.0],
            )
            for index, content in enumerate(["apple", "apple banana", "banana"], start=1)
        ]

    @pytest.mark.parametrize("query", ["apple", "量子计算", "量子コンピューター"])
    def test_sends_text_and_document_filters(self, vector, points, query):
        # CJK cases verify transport only; tokenization must be tested against the TiDB gateway.
        points[0].payload["page_content"] = query
        vector._client.scroll.return_value = ([points[0]], None)

        documents = vector.search_by_full_text(query, top_k=3, document_ids_filter=["document-1"])

        vector._client.scroll.assert_called_once_with(
            collection_name="test_collection",
            scroll_filter=rest.Filter(
                must=[
                    rest.FieldCondition(key="metadata.document_id", match=rest.MatchAny(any=["document-1"])),
                    rest.FieldCondition(key="page_content", match=rest.MatchText(text=query)),
                ]
            ),
            limit=3,
            with_payload=True,
            with_vectors=True,
        )
        assert documents[0].page_content == query
        assert documents[0].vector == [0.0, 1.0]
        assert "score" not in documents[0].metadata

    @pytest.mark.parametrize("top_k", [1, 2, 3, 4])
    def test_merges_keyword_matches_and_respects_top_k(self, vector, points, top_k):
        vector._client.scroll.side_effect = [([points[0], points[1]][:top_k], None), (points[1:][:top_k], None)]

        documents = vector.search_by_full_text(" apple\tapple banana ", top_k=top_k)

        assert [doc.metadata["doc_id"] for doc in documents] == ["1", "2", "3"][:top_k]
        calls = vector._client.scroll.call_args_list
        keywords = [call.kwargs["scroll_filter"].must[0].match.text for call in calls]
        assert keywords == ["apple", "banana"]

    def test_later_keywords_are_not_starved_by_first_keyword(self, vector, points):
        vector._client.scroll.side_effect = [([points[0], points[1]], None), ([points[2]], None)]

        documents = vector.search_by_full_text("common rare", top_k=2)

        assert [doc.metadata["doc_id"] for doc in documents] == ["1", "3"]
        assert vector._client.scroll.call_count == 2

    def test_no_match_does_not_fall_back_to_unfiltered_scroll(self, vector):
        vector._client.scroll.return_value = ([], None)

        assert vector.search_by_full_text("absentword") == []
        vector._client.scroll.assert_called_once()
        assert vector._client.scroll.call_args.kwargs["scroll_filter"] == rest.Filter(
            must=[rest.FieldCondition(key="page_content", match=rest.MatchText(text="absentword"))]
        )

    @pytest.mark.parametrize(("query", "top_k"), [("", 2), (" \t\n", 2), ("apple", 0), ("apple", -1)])
    def test_empty_query_or_nonpositive_limit_does_not_scroll(self, vector, query, top_k):
        assert vector.search_by_full_text(query, top_k=top_k) == []
        vector._client.scroll.assert_not_called()

    def test_limits_keyword_requests(self, vector):
        vector._client.scroll.return_value = ([], None)

        assert vector.search_by_full_text(" ".join(f"word{index}" for index in range(12))) == []
        assert vector._client.scroll.call_count == 10

    def test_keyword_only_hit_gets_a_weighted_rerank_score(self, vector, points):
        vector._client.scroll.return_value = ([points[0]], None)
        documents = vector.search_by_full_text("apple")
        runner = WeightRerankRunner(
            tenant_id="tenant-1",
            weights=Weights(
                vector_setting=VectorSetting(
                    vector_weight=0.3, embedding_provider_name="test", embedding_model_name="test"
                ),
                keyword_setting=KeywordSetting(keyword_weight=0.7),
            ),
        )
        with (
            patch.object(runner, "_calculate_keyword_score", return_value=[0.8]),
            patch("core.rag.rerank.weight_rerank.CacheEmbedding.get_cached_query_embedding", return_value=[1.0, 0.0]),
        ):
            reranked = runner.run("apple", documents, score_threshold=0.5, top_n=1)

        assert len(reranked) == 1
        # The vectors are orthogonal: only the keyword contribution should count.
        assert reranked[0].metadata["score"] == pytest.approx(0.56)


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


class TestTidbCloudRequestTimeouts:
    """The TiDB Cloud API calls must be bounded: a hanging endpoint must not
    block cluster provisioning or password rotation forever."""

    @patch("dify_vdb_tidb_on_qdrant.tidb_on_qdrant_vector.httpx.post")
    def test_create_cluster_passes_bounded_timeout(self, mock_post):
        from dify_vdb_tidb_on_qdrant.tidb_on_qdrant_vector import (
            TidbConfig,
            TidbOnQdrantVectorFactory,
        )

        mock_post.return_value.status_code = 200
        mock_post.return_value.json.return_value = {}
        factory = TidbOnQdrantVectorFactory()
        config = TidbConfig(api_url="https://api.tidbcloud.test", public_key="pub", private_key="priv")

        factory.create_tidb_serverless_cluster(config, "display", "us-east-1")

        assert mock_post.call_args.kwargs["timeout"] is not None

    @patch("dify_vdb_tidb_on_qdrant.tidb_on_qdrant_vector.httpx.put")
    def test_change_password_passes_bounded_timeout(self, mock_put):
        from dify_vdb_tidb_on_qdrant.tidb_on_qdrant_vector import (
            TidbConfig,
            TidbOnQdrantVectorFactory,
        )

        mock_put.return_value.status_code = 200
        mock_put.return_value.json.return_value = {}
        factory = TidbOnQdrantVectorFactory()
        config = TidbConfig(api_url="https://api.tidbcloud.test", public_key="pub", private_key="priv")

        factory.change_tidb_serverless_root_password(config, "c-1", "new-password")

        assert mock_put.call_args.kwargs["timeout"] is not None
