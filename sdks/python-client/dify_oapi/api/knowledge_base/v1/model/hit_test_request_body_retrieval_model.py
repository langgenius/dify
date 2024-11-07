from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class HitTestRequestBodyRetrievalModel(BaseModel):
    search_method: str | None = None
    reranking_enable: bool | None = None
    reranking_mode: dict | None = None
    weights: float | None = None
    top_k: int | None = None
    score_threshold_enabled: bool | None = None
    score_threshold: float | None = None

    @staticmethod
    def builder() -> HitTestRequestBodyRetrievalModelBuilder:
        return HitTestRequestBodyRetrievalModelBuilder()


class HitTestRequestBodyRetrievalModelBuilder(object):
    def __init__(self):
        self._hit_test_request_body_retrieval_model = HitTestRequestBodyRetrievalModel()

    def build(self) -> HitTestRequestBodyRetrievalModel:
        return self._hit_test_request_body_retrieval_model

    def set_search_method(
        self,
        search_method: Literal[
            "keyword_search", "semantic_search", "full_text_search", "hybrid_search"
        ],
    ):
        self._hit_test_request_body_retrieval_model.search_method = search_method
        return self

    def reranking_enable(self, reranking_enable: bool):
        self._hit_test_request_body_retrieval_model.reranking_enable = reranking_enable
        return self

    def reranking_provider_name(self, reranking_provider_name: str):
        self._hit_test_request_body_retrieval_model.reranking_mode[
            "reranking_provider_name"
        ] = reranking_provider_name
        return self

    def reranking_model_name(self, reranking_model_name: str):
        self._hit_test_request_body_retrieval_model.reranking_mode[
            "reranking_model_name"
        ] = reranking_model_name
        return self

    def weights(self, weights: float):
        self._hit_test_request_body_retrieval_model.weights = weights
        return self

    def top_k(self, top_k: int):
        self._hit_test_request_body_retrieval_model.top_k = top_k
        return self

    def score_threshold(self, score_threshold: float):
        self._hit_test_request_body_retrieval_model.score_threshold = score_threshold
        return self

    def score_threshold_enabled(self, score_threshold_enabled: bool):
        self._hit_test_request_body_retrieval_model.score_threshold_enabled = (
            score_threshold_enabled
        )
        return self
