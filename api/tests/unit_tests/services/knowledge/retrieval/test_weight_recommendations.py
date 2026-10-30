import random
from collections.abc import Sequence
from datetime import datetime, timedelta

import pytest

from domain.retrieval_weight_tuning.weight_recommendation import (
    InsufficientEvidence,
    RecommendWeightChange,
    TuningPolicy,
)
from services.knowledge.retrieval.weight_recommendations import (
    RecommendationAppNotFoundError,
    RetrievalWeightRecommendationService,
    RunFeedbackRecord,
    TraceCandidateRecord,
    WeightTraceRecord,
)

NOW = datetime(2026, 10, 30, 12)
POLICY = TuningPolicy(
    grid_step=0.05,
    min_runs_per_rating=2,
    min_shift=0.1,
    stability_radius=0.1,
    min_stability=0.6,
    confidence=0.9,
    resamples=20,
)
ROBUST = (TraceCandidateRecord(0.9, 0.9, True), TraceCandidateRecord(0.5, 0.1, False))
VECTOR_FAVOURED = (TraceCandidateRecord(0.9, 0.1, True), TraceCandidateRecord(0.5, 0.8, False))


def _trace(
    run_id: str,
    candidates: tuple[TraceCandidateRecord, ...],
    *,
    stage: str = "cross_dataset",
    dataset_id: str | None = None,
    vector_weight: float = 0.7,
    keyword_weight: float = 0.3,
    age_hours: int = 1,
) -> WeightTraceRecord:
    return WeightTraceRecord(
        workflow_run_id=run_id,
        node_id="knowledge",
        stage="dataset" if stage == "dataset" else "cross_dataset",
        dataset_id=dataset_id,
        embedding_provider_name="provider",
        embedding_model_name="embedding",
        vector_weight=vector_weight,
        keyword_weight=keyword_weight,
        score_threshold=None,
        top_n=1,
        candidates=candidates,
        created_at=NOW - timedelta(hours=age_hours),
    )


class _Evidence:
    def __init__(
        self, *, feedback: Sequence[RunFeedbackRecord], traces: Sequence[WeightTraceRecord], exists: bool = True
    ) -> None:
        self._feedback = feedback
        self._traces = traces
        self._exists = exists
        self.feedback_since: list[datetime] = []
        self.requested_runs: list[Sequence[str]] = []

    def app_exists(self, *, tenant_id: str, app_id: str) -> bool:
        return self._exists and (tenant_id, app_id) == ("tenant", "app")

    def run_feedback(self, *, tenant_id: str, app_id: str, since: datetime, limit: int) -> Sequence[RunFeedbackRecord]:
        assert (tenant_id, app_id, limit) == ("tenant", "app", 100)
        self.feedback_since.append(since)
        return self._feedback

    def traces_for_runs(
        self, *, tenant_id: str, app_id: str, workflow_run_ids: Sequence[str]
    ) -> Sequence[WeightTraceRecord]:
        assert (tenant_id, app_id) == ("tenant", "app")
        self.requested_runs.append(workflow_run_ids)
        return [trace for trace in self._traces if trace.workflow_run_id in workflow_run_ids]


def _service(evidence: _Evidence) -> RetrievalWeightRecommendationService:
    return RetrievalWeightRecommendationService(
        evidence=evidence,
        policy=POLICY,
        window_days=30,
        max_feedback=100,
        now=lambda: NOW,
        new_sampler=lambda: random.Random(0).randrange,  # noqa: S311 - deterministic resampling
    )


def test_unknown_app_is_rejected() -> None:
    with pytest.raises(RecommendationAppNotFoundError):
        _service(_Evidence(feedback=[], traces=[], exists=False)).recommend(tenant_id="tenant", app_id="app")


def test_no_feedback_reads_no_traces() -> None:
    evidence = _Evidence(feedback=[], traces=[])

    report = _service(evidence).recommend(tenant_id="tenant", app_id="app")

    assert (report.rated_runs, report.units, report.window_start) == (0, (), NOW - timedelta(days=30))
    assert evidence.requested_runs == []


def test_admin_rating_overrides_end_user_rating() -> None:
    feedback = [
        RunFeedbackRecord("liked-1", "like", "user"),
        RunFeedbackRecord("liked-2", "like", "user"),
        RunFeedbackRecord("disliked-1", "like", "user"),
        RunFeedbackRecord("disliked-1", "dislike", "admin"),
        RunFeedbackRecord("disliked-2", "dislike", "user"),
    ]
    traces = [
        _trace("liked-1", ROBUST),
        _trace("liked-2", ROBUST),
        _trace("disliked-1", VECTOR_FAVOURED),
        _trace("disliked-2", VECTOR_FAVOURED),
    ]

    report = _service(_Evidence(feedback=feedback, traces=traces)).recommend(tenant_id="tenant", app_id="app")

    [unit] = report.units
    assert report.rated_runs == 4
    assert isinstance(unit.recommendation, RecommendWeightChange)
    assert unit.recommendation.recommended_vector_weight == pytest.approx(0.6)


def test_stages_are_separate_units_and_current_weight_comes_from_the_latest_trace() -> None:
    feedback = [RunFeedbackRecord("run-1", "like", "user"), RunFeedbackRecord("run-2", "dislike", "user")]
    traces = [
        _trace("run-1", ROBUST, vector_weight=0.8, keyword_weight=0.2, age_hours=5),
        _trace("run-2", ROBUST, vector_weight=0.3, keyword_weight=0.3, age_hours=1),
        _trace("run-1", ROBUST, stage="dataset", dataset_id="ds-1", age_hours=5),
        _trace("run-2", ROBUST, stage="dataset", dataset_id="ds-1", vector_weight=0.0, keyword_weight=0.0),
    ]

    report = _service(_Evidence(feedback=feedback, traces=traces)).recommend(tenant_id="tenant", app_id="app")

    [cross_dataset] = report.units
    assert cross_dataset.unit.stage == "cross_dataset"
    assert cross_dataset.current_vector_weight == pytest.approx(0.5)
    assert cross_dataset.weights_changed_in_window
    assert cross_dataset.recommendation == InsufficientEvidence(liked_runs=1, disliked_runs=1, required_per_rating=2)
