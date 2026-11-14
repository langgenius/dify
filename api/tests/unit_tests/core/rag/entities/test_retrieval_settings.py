"""Unit tests for ``core.rag.entities.retrieval_settings``.

Negative cases use ``model_validate`` because dify's strict
``pyrefly type-check-core`` also checks the test tree: constructing a pydantic
model with missing fields or ``None`` for a model-typed field is a *static*
error, even though the behaviour under test is a runtime ``ValidationError``.
"""

import pytest
from pydantic import ValidationError

from core.rag.entities.retrieval_settings import (
    KeywordSetting,
    RerankingModelConfig,
    VectorSetting,
    WeightedScoreConfig,
)


def test_reranking_config_accepts_provider_model_alias() -> None:
    cfg = RerankingModelConfig(provider="cohere", model="rerank-v3")
    assert cfg.reranking_provider_name == "cohere"
    assert cfg.reranking_model_name == "rerank-v3"
    # properties expose the canonical names
    assert cfg.provider == "cohere"
    assert cfg.model == "rerank-v3"


def test_reranking_config_populate_by_name() -> None:
    # with populate_by_name=True the field names are also accepted
    cfg = RerankingModelConfig(reranking_provider_name="x", reranking_model_name="y")
    assert cfg.provider == "x"
    assert cfg.model == "y"


def test_reranking_config_requires_both_fields() -> None:
    with pytest.raises(ValidationError):
        RerankingModelConfig.model_validate({"provider": "cohere"})
    with pytest.raises(ValidationError):
        RerankingModelConfig.model_validate({"model": "rerank-v3"})


def test_vector_setting_required_fields() -> None:
    with pytest.raises(ValidationError):
        VectorSetting.model_validate({"vector_weight": 0.7})
    vs = VectorSetting(vector_weight=0.7, embedding_provider_name="openai", embedding_model_name="text-embed-3")
    assert vs.vector_weight == 0.7
    assert vs.embedding_provider_name == "openai"
    assert vs.embedding_model_name == "text-embed-3"


def test_keyword_setting_required() -> None:
    with pytest.raises(ValidationError):
        KeywordSetting.model_validate({})
    ks = KeywordSetting(keyword_weight=0.3)
    assert ks.keyword_weight == 0.3


def test_weighted_score_config_nested() -> None:
    cfg = WeightedScoreConfig(
        vector_setting=VectorSetting(vector_weight=0.6, embedding_provider_name="p", embedding_model_name="m"),
        keyword_setting=KeywordSetting(keyword_weight=0.4),
    )
    assert cfg.vector_setting.vector_weight == 0.6
    assert cfg.keyword_setting.keyword_weight == 0.4


def test_weighted_score_config_requires_both() -> None:
    with pytest.raises(ValidationError):
        WeightedScoreConfig.model_validate({"vector_setting": None})


def test_model_validate_matches_constructor() -> None:
    payload = {
        "vector_setting": {"vector_weight": 0.6, "embedding_provider_name": "p", "embedding_model_name": "m"},
        "keyword_setting": {"keyword_weight": 0.4},
    }
    assert WeightedScoreConfig.model_validate(payload) == WeightedScoreConfig(
        vector_setting=VectorSetting(vector_weight=0.6, embedding_provider_name="p", embedding_model_name="m"),
        keyword_setting=KeywordSetting(keyword_weight=0.4),
    )
