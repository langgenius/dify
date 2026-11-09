"""Regression for #42996: BM25-only hits have no vector but must not break weighted reranking.

Vector stores that answer full-text queries with ``include_vector=False`` return
documents with ``vector=None``. ``WeightRerankRunner`` used to feed that straight
into ``np.array`` / ``np.dot``, which raised TypeError for a lexical-only match
before the keyword score could be combined. These tests pin the guard.
"""

from types import SimpleNamespace
from unittest.mock import patch

from core.rag.models.document import Document
from core.rag.rerank.weight_rerank import WeightRerankRunner


def _setting():
    return SimpleNamespace(embedding_provider_name="provider", embedding_model_name="model")


def _vectorless_hit():
    return Document(page_content="rotating kubernetes ingress tls certificates", metadata={"doc_id": "d1"})


def test_cosine_score_is_zero_for_document_without_vector():
    runner = WeightRerankRunner(tenant_id="tenant", weights=SimpleNamespace())
    with patch("core.rag.rerank.weight_rerank.CacheEmbedding") as cache:
        cache.get_cached_query_embedding.return_value = [1.0, 0.0]
        scores = runner._calculate_cosine("tenant", "tls", [_vectorless_hit()], _setting())
    assert scores == [0.0]
    cache.get_cached_query_embedding.assert_not_called()


def test_weighted_hybrid_keeps_bm25_only_hit():
    weights = SimpleNamespace(
        vector_setting=SimpleNamespace(vector_weight=0.5, **_setting().__dict__),
        keyword_setting=SimpleNamespace(keyword_weight=0.5),
    )
    runner = WeightRerankRunner(tenant_id="tenant", weights=weights)
    hit = _vectorless_hit()
    with (
        patch("core.rag.rerank.weight_rerank.CacheEmbedding") as cache,
        patch.object(runner, "_calculate_keyword_score", return_value=[1.0]),
    ):
        cache.get_cached_query_embedding.return_value = [1.0, 0.0]
        result = runner.run("tls", [hit])
    assert len(result) == 1
    assert result[0].metadata["score"] == 0.5
    cache.get_cached_query_embedding.assert_not_called()


def test_document_with_score_still_uses_its_score():
    runner = WeightRerankRunner(tenant_id="tenant", weights=SimpleNamespace())
    scored = Document(page_content="vector hit", metadata={"doc_id": "d2", "score": 0.9})
    vector = Document(page_content="vector hit", metadata={"doc_id": "d3"}, vector=[1.0, 0.0])
    with patch("core.rag.rerank.weight_rerank.CacheEmbedding") as cache:
        cache.get_cached_query_embedding.return_value = [1.0, 0.0]
        scores = runner._calculate_cosine("tenant", "tls", [scored, vector], _setting())
    assert scores[0] == 0.9
    assert scores[1] == 1.0
