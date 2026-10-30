from core.rag.entities import KeywordSetting, VectorSetting
from core.rag.index_processor.constant.query_type import QueryType
from core.rag.models.document import Document
from core.rag.rerank.entity.weight import (
    DatasetWeightedScoreStage,
    WeightedScoreObservation,
    Weights,
    observe_weighted_scores,
    weighted_score_stage,
)
from core.rag.rerank.weight_rerank import WeightRerankRunner

WEIGHTS = Weights(
    vector_setting=VectorSetting(
        vector_weight=1.0, embedding_provider_name="provider", embedding_model_name="embedding"
    ),
    keyword_setting=KeywordSetting(keyword_weight=0.0),
)


class _ListObserver:
    def __init__(self) -> None:
        self.observations: list[WeightedScoreObservation] = []

    def observe(self, observation: WeightedScoreObservation) -> None:
        self.observations.append(observation)


def _documents() -> list[Document]:
    # A carried score is used as the vector component, so no embedding model is needed.
    return [
        Document(page_content="low", metadata={"doc_id": "low", "dataset_id": "ds", "score": 0.2}),
        Document(page_content="high", metadata={"doc_id": "high", "dataset_id": "ds", "score": 0.9}),
        Document(page_content="mid", metadata={"doc_id": "mid", "dataset_id": "ds", "score": 0.5}),
    ]


def test_observed_rerank_reports_the_whole_pool_and_returns_the_same_ranking() -> None:
    runner = WeightRerankRunner(tenant_id="tenant", weights=WEIGHTS)
    expected = [document.metadata["doc_id"] for document in runner.run("query", _documents(), 0.3, 1)]
    observer = _ListObserver()

    with observe_weighted_scores(observer), weighted_score_stage(DatasetWeightedScoreStage(dataset_id="ds")):
        result = runner.run("query", _documents(), score_threshold=0.3, top_n=1)

    assert [document.metadata["doc_id"] for document in result] == expected == ["high"]
    [observation] = observer.observations
    assert observation.stage == DatasetWeightedScoreStage(dataset_id="ds")
    assert (observation.score_threshold, observation.top_n) == (0.3, 1)
    assert [(c.index_node_id, c.vector_score, c.selected_rank) for c in observation.candidates] == [
        ("low", 0.2, None),
        ("high", 0.9, 0),
        ("mid", 0.5, None),
    ]


def test_image_query_rerank_is_not_reported() -> None:
    runner = WeightRerankRunner(tenant_id="tenant", weights=WEIGHTS)
    observer = _ListObserver()

    with observe_weighted_scores(observer), weighted_score_stage(DatasetWeightedScoreStage(dataset_id="ds")):
        runner.run("file-id", _documents(), query_type=QueryType.IMAGE_QUERY)

    assert observer.observations == []
