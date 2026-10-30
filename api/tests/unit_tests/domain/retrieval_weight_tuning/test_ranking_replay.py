from itertools import starmap

import pytest

from core.rag.entities import KeywordSetting, VectorSetting
from core.rag.models.document import Document
from core.rag.rerank.entity.weight import (
    CrossDatasetWeightedScoreStage,
    WeightedScoreObservation,
    Weights,
    observe_weighted_scores,
    weighted_score_stage,
)
from core.rag.rerank.weight_rerank import WeightRerankRunner
from domain.retrieval_weight_tuning.ranking_replay import (
    RecordedCandidate,
    RecordedRanking,
    replay_selection,
    retention,
)


def _ranking(
    *scores: tuple[float, float, bool], threshold: float | None = None, top_n: int | None = None
) -> RecordedRanking:
    return RecordedRanking(
        candidates=tuple(starmap(RecordedCandidate, scores)),
        score_threshold=threshold,
        top_n=top_n,
    )


def test_replay_applies_threshold_then_top_n() -> None:
    ranking = _ranking((0.9, 0.0, True), (0.1, 0.9, False), (0.6, 0.6, False), threshold=0.4, top_n=1)

    assert replay_selection(ranking, vector_weight=1.0, keyword_weight=0.0) == {0}
    assert replay_selection(ranking, vector_weight=0.0, keyword_weight=1.0) == {1}
    assert replay_selection(ranking, vector_weight=0.5, keyword_weight=0.5) == {2}


def test_replay_breaks_ties_by_recording_order() -> None:
    ranking = _ranking((0.5, 0.5, False), (0.5, 0.5, True), top_n=1)

    assert replay_selection(ranking, vector_weight=0.5, keyword_weight=0.5) == {0}


def test_retention_is_undefined_when_nothing_was_shown() -> None:
    assert retention(_ranking((0.1, 0.1, False)), vector_weight=0.5, keyword_weight=0.5) is None


def test_retention_counts_shown_candidates_still_returned() -> None:
    ranking = _ranking((0.9, 0.1, True), (0.8, 0.1, True), (0.1, 0.9, False), top_n=2)

    assert retention(ranking, vector_weight=1.0, keyword_weight=0.0) == 1.0
    assert retention(ranking, vector_weight=0.0, keyword_weight=1.0) == 0.5


class _Collector:
    def __init__(self) -> None:
        self.observations: list[WeightedScoreObservation] = []

    def observe(self, observation: WeightedScoreObservation) -> None:
        self.observations.append(observation)


@pytest.mark.parametrize(("threshold", "top_n"), [(None, 2), (0.45, None), (0.45, 1)])
def test_replay_at_recorded_weights_reproduces_the_runner(threshold: float | None, top_n: int | None) -> None:
    weights = Weights(
        vector_setting=VectorSetting(vector_weight=0.6, embedding_provider_name="p", embedding_model_name="m"),
        keyword_setting=KeywordSetting(keyword_weight=0.4),
    )
    documents = [
        Document(page_content="python language guide", metadata={"doc_id": "a", "score": 0.81}),
        Document(page_content="snakes in the wild", metadata={"doc_id": "b", "score": 0.42}),
        Document(page_content="python programming language tips", metadata={"doc_id": "c", "score": 0.66}),
        Document(page_content="unrelated text", metadata={"doc_id": "d", "score": 0.3}),
    ]
    collector = _Collector()
    with observe_weighted_scores(collector), weighted_score_stage(CrossDatasetWeightedScoreStage()):
        WeightRerankRunner(tenant_id="tenant", weights=weights).run(
            "python language", documents, score_threshold=threshold, top_n=top_n
        )

    [observation] = collector.observations
    ranking = RecordedRanking(
        candidates=tuple(
            RecordedCandidate(c.vector_score, c.keyword_score, c.selected_rank is not None)
            for c in observation.candidates
        ),
        score_threshold=observation.score_threshold,
        top_n=observation.top_n,
    )
    assert replay_selection(ranking, vector_weight=0.6, keyword_weight=0.4) == ranking.shown
