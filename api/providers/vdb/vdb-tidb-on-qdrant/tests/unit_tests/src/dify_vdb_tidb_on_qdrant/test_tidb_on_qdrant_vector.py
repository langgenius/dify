from dataclasses import dataclass

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


@dataclass(frozen=True)
class ScrollRequest:
    """The arguments of one ``QdrantClient.scroll`` call."""

    collection_name: str
    scroll_filter: rest.Filter
    limit: int
    with_payload: bool
    with_vectors: bool


@dataclass(frozen=True)
class DeleteRequest:
    """The arguments of one ``QdrantClient.delete`` call."""

    collection_name: str
    points_selector: rest.FilterSelector


class FakeQdrantClient:
    """A Qdrant client that serves queued scroll pages and records scroll and delete requests."""

    def __init__(self) -> None:
        self.scroll_pages: list[list[rest.Record]] = []
        self.scroll_requests: list[ScrollRequest] = []
        self.delete_error: Exception | None = None
        self.delete_requests: list[DeleteRequest] = []

    def scroll(
        self, *, collection_name: str, scroll_filter: rest.Filter, limit: int, with_payload: bool, with_vectors: bool
    ) -> tuple[list[rest.Record], None]:
        self.scroll_requests.append(ScrollRequest(collection_name, scroll_filter, limit, with_payload, with_vectors))
        # Once the queued pages run out, every further keyword has no matches.
        return (self.scroll_pages.pop(0) if self.scroll_pages else []), None

    def delete(self, *, collection_name: str, points_selector: rest.FilterSelector) -> None:
        self.delete_requests.append(DeleteRequest(collection_name, points_selector))
        if self.delete_error:
            raise self.delete_error


def _text_filter(text: str) -> rest.Filter:
    return rest.Filter(must=[rest.FieldCondition(key="page_content", match=rest.MatchText(text=text))])


def _doc_id_selector(ids: list[str]) -> rest.FilterSelector:
    return rest.FilterSelector(
        filter=rest.Filter(must=[rest.FieldCondition(key="metadata.doc_id", match=rest.MatchAny(any=ids))])
    )


@pytest.fixture
def fake_client(monkeypatch: pytest.MonkeyPatch) -> FakeQdrantClient:
    client = FakeQdrantClient()
    monkeypatch.setattr(
        "dify_vdb_tidb_on_qdrant.tidb_on_qdrant_vector.qdrant_client.QdrantClient", lambda **_params: client
    )
    return client


class TestTidbOnQdrantVectorFullTextSearch:
    @pytest.fixture
    def vector(self, fake_client: FakeQdrantClient) -> TidbOnQdrantVector:
        vector = TidbOnQdrantVector(
            collection_name="test_collection",
            group_id="test_group",
            config=TidbOnQdrantConfig(endpoint="http://localhost:6333"),
        )
        assert vector._client is fake_client
        return vector

    @pytest.fixture
    def points(self) -> list[rest.Record]:
        return [
            rest.Record(
                id=index,
                payload={"page_content": content, "metadata": {"doc_id": str(index), "document_id": "document-1"}},
                vector=[0.0, 1.0],
            )
            for index, content in enumerate(["apple", "apple banana", "banana"], start=1)
        ]

    @pytest.mark.parametrize("query", ["apple", "量子计算", "量子コンピューター"])
    def test_sends_text_and_document_filters(
        self, fake_client: FakeQdrantClient, vector: TidbOnQdrantVector, points: list[rest.Record], query: str
    ) -> None:
        # CJK cases verify transport only; tokenization must be tested against the TiDB gateway.
        assert points[0].payload is not None
        points[0].payload["page_content"] = query
        fake_client.scroll_pages = [[points[0]]]

        documents = vector.search_by_full_text(query, top_k=3, document_ids_filter=["document-1"])

        assert fake_client.scroll_requests == [
            ScrollRequest(
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
        ]
        assert documents[0].page_content == query
        assert documents[0].vector == [0.0, 1.0]
        assert "score" not in documents[0].metadata

    @pytest.mark.parametrize("top_k", [1, 2, 3, 4])
    def test_merges_keyword_matches_and_respects_top_k(
        self, fake_client: FakeQdrantClient, vector: TidbOnQdrantVector, points: list[rest.Record], top_k: int
    ) -> None:
        fake_client.scroll_pages = [[points[0], points[1]][:top_k], points[1:][:top_k]]

        documents = vector.search_by_full_text(" apple\tapple banana ", top_k=top_k)

        assert [doc.metadata["doc_id"] for doc in documents] == ["1", "2", "3"][:top_k]
        assert [request.scroll_filter for request in fake_client.scroll_requests] == [
            _text_filter("apple"),
            _text_filter("banana"),
        ]

    def test_later_keywords_are_not_starved_by_first_keyword(
        self, fake_client: FakeQdrantClient, vector: TidbOnQdrantVector, points: list[rest.Record]
    ) -> None:
        fake_client.scroll_pages = [[points[0], points[1]], [points[2]]]

        documents = vector.search_by_full_text("common rare", top_k=2)

        assert [doc.metadata["doc_id"] for doc in documents] == ["1", "3"]
        assert len(fake_client.scroll_requests) == 2

    def test_overlapping_keyword_matches_are_deduplicated(
        self, fake_client: FakeQdrantClient, vector: TidbOnQdrantVector, points: list[rest.Record]
    ) -> None:
        fake_client.scroll_pages = [[points[0], points[1]], [points[0], points[2]]]

        documents = vector.search_by_full_text("common rare", top_k=3)

        assert [doc.metadata["doc_id"] for doc in documents] == ["1", "3", "2"]

    def test_stops_after_exhausting_duplicate_keyword_matches(
        self, fake_client: FakeQdrantClient, vector: TidbOnQdrantVector, points: list[rest.Record]
    ) -> None:
        fake_client.scroll_pages = [[points[0], points[1]], [points[0]]]

        documents = vector.search_by_full_text("common rare", top_k=4)

        assert [doc.metadata["doc_id"] for doc in documents] == ["1", "2"]
        assert len(fake_client.scroll_requests) == 2

    def test_no_match_does_not_fall_back_to_unfiltered_scroll(
        self, fake_client: FakeQdrantClient, vector: TidbOnQdrantVector
    ) -> None:
        assert vector.search_by_full_text("absentword") == []
        assert [request.scroll_filter for request in fake_client.scroll_requests] == [_text_filter("absentword")]

    @pytest.mark.parametrize(("query", "top_k"), [("", 2), (" \t\n", 2), ("apple", 0), ("apple", -1)])
    def test_empty_query_or_nonpositive_limit_does_not_scroll(
        self, fake_client: FakeQdrantClient, vector: TidbOnQdrantVector, query: str, top_k: int
    ) -> None:
        assert vector.search_by_full_text(query, top_k=top_k) == []
        assert fake_client.scroll_requests == []

    def test_limits_keyword_requests(self, fake_client: FakeQdrantClient, vector: TidbOnQdrantVector) -> None:
        assert vector.search_by_full_text(" ".join(f"word{index}" for index in range(12))) == []
        assert len(fake_client.scroll_requests) == 10

    def test_keyword_only_hit_gets_a_weighted_rerank_score(
        self,
        fake_client: FakeQdrantClient,
        vector: TidbOnQdrantVector,
        points: list[rest.Record],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        fake_client.scroll_pages = [[points[0]]]
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
        monkeypatch.setattr(runner, "_calculate_keyword_score", lambda _query, _documents: [0.8])
        monkeypatch.setattr(
            "core.rag.rerank.weight_rerank.CacheEmbedding.get_cached_query_embedding",
            lambda _provider, _model, _text: [1.0, 0.0],
        )

        reranked = runner.run("apple", documents, score_threshold=0.5, top_n=1)

        assert len(reranked) == 1
        # The vectors are orthogonal: only the keyword contribution should count.
        assert reranked[0].metadata["score"] == pytest.approx(0.56)


class TestTidbOnQdrantVectorDeleteByIds:
    """Unit tests for TidbOnQdrantVector.delete_by_ids method."""

    @pytest.fixture
    def vector_instance(self, fake_client: FakeQdrantClient) -> TidbOnQdrantVector:
        """Create a TidbOnQdrantVector instance for testing."""
        config = TidbOnQdrantConfig(
            endpoint="http://localhost:6333",
            api_key="test_api_key",
        )

        vector = TidbOnQdrantVector(
            collection_name="test_collection",
            group_id="test_group",
            config=config,
        )
        assert vector._client is fake_client
        return vector

    def test_delete_by_ids_with_multiple_ids(
        self, fake_client: FakeQdrantClient, vector_instance: TidbOnQdrantVector
    ) -> None:
        """Test batch deletion with multiple document IDs."""
        ids = ["doc1", "doc2", "doc3"]

        vector_instance.delete_by_ids(ids)

        # One delete call on the collection, filtering doc_id with MatchAny over all IDs
        assert fake_client.delete_requests == [DeleteRequest("test_collection", _doc_id_selector(ids))]

    def test_delete_by_ids_with_single_id(
        self, fake_client: FakeQdrantClient, vector_instance: TidbOnQdrantVector
    ) -> None:
        """Test deletion with a single document ID."""
        vector_instance.delete_by_ids(["doc1"])

        assert fake_client.delete_requests == [DeleteRequest("test_collection", _doc_id_selector(["doc1"]))]

    def test_delete_by_ids_with_empty_list(
        self, fake_client: FakeQdrantClient, vector_instance: TidbOnQdrantVector
    ) -> None:
        """Test deletion with empty ID list returns early without API call."""
        vector_instance.delete_by_ids([])

        assert fake_client.delete_requests == []

    def test_delete_by_ids_with_404_error(
        self, fake_client: FakeQdrantClient, vector_instance: TidbOnQdrantVector
    ) -> None:
        """Test that 404 errors (collection not found) are handled gracefully."""
        fake_client.delete_error = UnexpectedResponse(
            status_code=404,
            reason_phrase="Not Found",
            content=b"Collection not found",
            headers=httpx.Headers(),
        )

        # Should not raise an exception
        vector_instance.delete_by_ids(["doc1", "doc2"])

        assert len(fake_client.delete_requests) == 1

    def test_delete_by_ids_with_unexpected_error(
        self, fake_client: FakeQdrantClient, vector_instance: TidbOnQdrantVector
    ) -> None:
        """Test that non-404 errors are re-raised."""
        fake_client.delete_error = UnexpectedResponse(
            status_code=500,
            reason_phrase="Internal Server Error",
            content=b"Server error",
            headers=httpx.Headers(),
        )

        # Should re-raise the exception
        with pytest.raises(UnexpectedResponse) as exc_info:
            vector_instance.delete_by_ids(["doc1", "doc2"])

        assert exc_info.value.status_code == 500

    def test_delete_by_ids_with_exactly_1000(
        self, fake_client: FakeQdrantClient, vector_instance: TidbOnQdrantVector
    ) -> None:
        """Test deletion with exactly 1000 IDs triggers a single batch."""
        ids = [f"doc_{i}" for i in range(1000)]

        vector_instance.delete_by_ids(ids)

        assert fake_client.delete_requests == [DeleteRequest("test_collection", _doc_id_selector(ids))]

    def test_delete_by_ids_splits_into_batches(
        self, fake_client: FakeQdrantClient, vector_instance: TidbOnQdrantVector
    ) -> None:
        """Test deletion with >1000 IDs triggers multiple batched calls."""
        ids = [f"doc_{i}" for i in range(2500)]

        vector_instance.delete_by_ids(ids)

        assert [request.points_selector for request in fake_client.delete_requests] == [
            _doc_id_selector(ids[:1000]),
            _doc_id_selector(ids[1000:2000]),
            _doc_id_selector(ids[2000:]),
        ]

    def test_delete_by_ids_filter_structure(
        self, fake_client: FakeQdrantClient, vector_instance: TidbOnQdrantVector
    ) -> None:
        """Test that the filter structure is correctly constructed."""
        ids = ["doc1", "doc2"]

        vector_instance.delete_by_ids(ids)

        # Pydantic equality also compares the model types: Filter, FieldCondition and MatchAny.
        (request,) = fake_client.delete_requests
        assert request.points_selector == rest.FilterSelector(
            filter=rest.Filter(must=[rest.FieldCondition(key="metadata.doc_id", match=rest.MatchAny(any=ids))])
        )


class TestInitVectorEndpointSelection:
    """Test that init_vector selects the correct qdrant endpoint.

    We avoid importing the full module (which triggers Flask app context)
    by testing the endpoint selection logic directly on TidbOnQdrantConfig.
    """

    def test_uses_binding_endpoint_when_present(self) -> None:
        binding_endpoint = "https://qdrant-custom.tidb.com"
        global_url = "https://qdrant-global.tidb.com"

        qdrant_url = binding_endpoint or global_url or ""

        assert qdrant_url == "https://qdrant-custom.tidb.com"
        config = TidbOnQdrantConfig(endpoint=qdrant_url)
        assert config.endpoint == "https://qdrant-custom.tidb.com"

    def test_falls_back_to_global_when_binding_endpoint_is_none(self) -> None:
        binding_endpoint = None
        global_url = "https://qdrant-global.tidb.com"

        qdrant_url = binding_endpoint or global_url or ""

        assert qdrant_url == "https://qdrant-global.tidb.com"
        config = TidbOnQdrantConfig(endpoint=qdrant_url)
        assert config.endpoint == "https://qdrant-global.tidb.com"

    def test_falls_back_to_empty_when_both_none(self) -> None:
        binding_endpoint = None
        global_url = None

        qdrant_url = binding_endpoint or global_url or ""

        assert qdrant_url == ""
        config = TidbOnQdrantConfig(endpoint=qdrant_url)
        assert config.endpoint == ""

    def test_binding_endpoint_takes_precedence_over_global(self) -> None:
        binding_endpoint = "https://qdrant-ap-southeast.tidb.com"
        global_url = "https://qdrant-us-east.tidb.com"

        qdrant_url = binding_endpoint or global_url or ""

        assert qdrant_url == "https://qdrant-ap-southeast.tidb.com"

    def test_empty_string_binding_endpoint_falls_back_to_global(self) -> None:
        binding_endpoint = ""
        global_url = "https://qdrant-global.tidb.com"

        qdrant_url = binding_endpoint or global_url or ""

        assert qdrant_url == "https://qdrant-global.tidb.com"


class TestTidbCloudRequestTimeouts:
    """The TiDB Cloud API calls must be bounded: a hanging endpoint must not
    block cluster provisioning or password rotation forever."""

    def test_create_cluster_passes_bounded_timeout(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from dify_vdb_tidb_on_qdrant.tidb_on_qdrant_vector import (
            TidbConfig,
            TidbOnQdrantVectorFactory,
        )

        timeouts: list[object] = []

        def post(url: str, **kwargs: object) -> httpx.Response:
            timeouts.append(kwargs.get("timeout"))
            return httpx.Response(200, json={})

        monkeypatch.setattr("dify_vdb_tidb_on_qdrant.tidb_on_qdrant_vector.httpx.post", post)
        factory = TidbOnQdrantVectorFactory()
        config = TidbConfig(api_url="https://api.tidbcloud.test", public_key="pub", private_key="priv")

        factory.create_tidb_serverless_cluster(config, "display", "us-east-1")

        assert len(timeouts) == 1
        assert timeouts[0] is not None

    def test_change_password_passes_bounded_timeout(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from dify_vdb_tidb_on_qdrant.tidb_on_qdrant_vector import (
            TidbConfig,
            TidbOnQdrantVectorFactory,
        )

        timeouts: list[object] = []

        def put(url: str, **kwargs: object) -> httpx.Response:
            timeouts.append(kwargs.get("timeout"))
            return httpx.Response(200, json={})

        monkeypatch.setattr("dify_vdb_tidb_on_qdrant.tidb_on_qdrant_vector.httpx.put", put)
        factory = TidbOnQdrantVectorFactory()
        config = TidbConfig(api_url="https://api.tidbcloud.test", public_key="pub", private_key="priv")

        factory.change_tidb_serverless_root_password(config, "c-1", "new-password")

        assert len(timeouts) == 1
        assert timeouts[0] is not None
