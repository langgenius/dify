import threading

import pytest

from core.rag.entities import KeywordSetting, VectorSetting
from core.rag.rerank.entity.weight import (
    CrossDatasetWeightedScoreStage,
    DatasetWeightedScoreStage,
    WeightedScoreCandidate,
    WeightedScoreObservation,
    WeightedScoreStage,
    Weights,
    build_weighted_score_observation,
    observe_weighted_scores,
    report_weighted_score_observation,
    weighted_score_stage,
)
from extensions.otel import propagate_context

WEIGHTS = Weights(
    vector_setting=VectorSetting(
        vector_weight=0.7, embedding_provider_name="provider", embedding_model_name="embedding"
    ),
    keyword_setting=KeywordSetting(keyword_weight=0.3),
)


class _ListObserver:
    def __init__(self) -> None:
        self.observations: list[WeightedScoreObservation] = []

    def observe(self, observation: WeightedScoreObservation) -> None:
        self.observations.append(observation)


def _observation(stage: WeightedScoreStage) -> WeightedScoreObservation:
    return build_weighted_score_observation(
        stage=stage,
        weights=WEIGHTS,
        score_threshold=None,
        top_n=1,
        candidate_metadata=[{"doc_id": "node-1", "document_id": "doc-1", "dataset_id": "ds-1"}, None],
        vector_scores=[0.9, 0.1],
        keyword_scores=[0.5, 0.2],
        final_scores=[0.78, 0.13],
        selected_ranks=[0, None],
    )


def test_build_observation_keeps_every_candidate_and_the_weights_used() -> None:
    observation = _observation(DatasetWeightedScoreStage(dataset_id="ds-1"))

    assert observation.vector_weight == 0.7
    assert observation.keyword_weight == 0.3
    assert observation.embedding_model_name == "embedding"
    assert observation.candidates == (
        WeightedScoreCandidate("node-1", "doc-1", "ds-1", 0.9, 0.5, 0.78, 0),
        WeightedScoreCandidate(None, None, None, 0.1, 0.2, 0.13, None),
    )


def test_build_observation_rejects_misaligned_values() -> None:
    with pytest.raises(ValueError, match="aligned"):
        build_weighted_score_observation(
            stage=CrossDatasetWeightedScoreStage(),
            weights=WEIGHTS,
            score_threshold=None,
            top_n=None,
            candidate_metadata=[{}],
            vector_scores=[0.1, 0.2],
            keyword_scores=[0.1],
            final_scores=[0.1],
            selected_ranks=[0],
        )


@pytest.mark.parametrize(("observed", "staged"), [(False, False), (True, False), (False, True)])
def test_report_does_nothing_unless_observed_and_staged(observed: bool, staged: bool) -> None:
    observer = _ListObserver()
    builds: list[WeightedScoreStage] = []

    def build(stage: WeightedScoreStage) -> WeightedScoreObservation:
        builds.append(stage)
        return _observation(stage)

    def run() -> None:
        if staged:
            with weighted_score_stage(CrossDatasetWeightedScoreStage()):
                report_weighted_score_observation(build)
        else:
            report_weighted_score_observation(build)

    if observed:
        with observe_weighted_scores(observer):
            run()
    else:
        run()

    assert builds == []
    assert observer.observations == []


def test_report_reaches_the_observer_from_a_context_propagating_thread() -> None:
    observer = _ListObserver()
    stage = DatasetWeightedScoreStage(dataset_id="ds-1")

    def worker() -> None:
        with weighted_score_stage(stage):
            report_weighted_score_observation(_observation)

    with observe_weighted_scores(observer):
        thread = threading.Thread(target=propagate_context(worker))
        thread.start()
        thread.join()

    assert [observation.stage for observation in observer.observations] == [stage]


def test_report_swallows_build_and_observer_failures() -> None:
    class _FailingObserver:
        def observe(self, observation: WeightedScoreObservation) -> None:
            raise RuntimeError(f"store down while saving {observation.stage}")

    def failing_build(stage: WeightedScoreStage) -> WeightedScoreObservation:
        raise ValueError(f"misaligned candidates in {stage}")

    with weighted_score_stage(CrossDatasetWeightedScoreStage()):
        with observe_weighted_scores(_ListObserver()):
            report_weighted_score_observation(failing_build)
        with observe_weighted_scores(_FailingObserver()):
            report_weighted_score_observation(_observation)


def test_contexts_restore_the_previous_values_after_an_error() -> None:
    observer = _ListObserver()
    with pytest.raises(RuntimeError):
        with observe_weighted_scores(observer), weighted_score_stage(CrossDatasetWeightedScoreStage()):
            raise RuntimeError("retrieval failed")

    report_weighted_score_observation(_observation)

    assert observer.observations == []
