"""Recommend-only keyword/vector weight tuning from message feedback and retrieval weight traces.

Use case: for one app, join the current feedback on its chatflow messages with the weighted-score
traces of the same workflow runs, group the traces into tuning units, and ask the domain policy
for a verdict per unit. Nothing is applied; the report is advisory.

Business rules:
- A tuning unit is one weighted rerank of one node: (node_id, stage, dataset_id, embedding model).
  The cross-dataset stage and each dataset's own hybrid stage are tuned separately, each holding the
  other fixed, because the cross-dataset pool is the output of the per-dataset stages.
- A run's rating is its admin feedback when present, otherwise its end-user feedback, because an
  admin rating is a reviewed judgement of the same answer.
- Evidence is limited to the trace retention window and to the most recent ``max_feedback`` rows.
- The current weight of a unit is the normalised vector weight, ``v / (v + k)``, of its most recent
  trace. Units whose most recent weights are both 0 are skipped, as they have no defined balance.
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from itertools import groupby
from typing import Literal, Protocol

from domain.retrieval_weight_tuning.ranking_replay import RecordedCandidate, RecordedRanking
from domain.retrieval_weight_tuning.weight_recommendation import (
    RatedRun,
    Rating,
    TuningPolicy,
    WeightRecommendation,
    recommend_vector_weight,
)

type FeedbackSource = Literal["user", "admin"]
type TraceStage = Literal["dataset", "cross_dataset"]


@dataclass(frozen=True, slots=True)
class RunFeedbackRecord:
    workflow_run_id: str
    rating: Rating
    from_source: FeedbackSource


@dataclass(frozen=True, slots=True)
class TraceCandidateRecord:
    vector_score: float
    keyword_score: float
    selected: bool


@dataclass(frozen=True, slots=True)
class WeightTraceRecord:
    """A stored weighted-score trace. ``dataset_id`` is None exactly for the cross-dataset stage."""

    workflow_run_id: str
    node_id: str
    stage: TraceStage
    dataset_id: str | None
    embedding_provider_name: str
    embedding_model_name: str
    vector_weight: float
    keyword_weight: float
    score_threshold: float | None
    top_n: int | None
    candidates: tuple[TraceCandidateRecord, ...]
    created_at: datetime


class WeightTuningEvidenceQuery(Protocol):
    def app_exists(self, *, tenant_id: str, app_id: str) -> bool: ...

    def run_feedback(self, *, tenant_id: str, app_id: str, since: datetime, limit: int) -> Sequence[RunFeedbackRecord]:
        """Current feedback on the app's messages created at or after ``since`` (naive UTC) that have a workflow run.

        Returns at most ``limit`` rows, newest messages first. A run may appear once per feedback source.
        """
        ...

    def traces_for_runs(
        self, *, tenant_id: str, app_id: str, workflow_run_ids: Sequence[str]
    ) -> Sequence[WeightTraceRecord]:
        """The app's traces of the given runs, oldest first."""
        ...


class RetrievalWeightRecommendationError(Exception):
    """Base error of retrieval weight recommendations."""


class RecommendationAppNotFoundError(RetrievalWeightRecommendationError):
    def __init__(self) -> None:
        super().__init__("App not found.")


@dataclass(frozen=True, slots=True)
class TuningUnit:
    node_id: str
    stage: TraceStage
    dataset_id: str | None
    embedding_provider_name: str
    embedding_model_name: str


@dataclass(frozen=True, slots=True)
class UnitRecommendation:
    """Verdict for one unit. ``weights_changed_in_window`` is True when traces in the window used different weights."""

    unit: TuningUnit
    current_vector_weight: float
    weights_changed_in_window: bool
    recommendation: WeightRecommendation


@dataclass(frozen=True, slots=True)
class RetrievalWeightReport:
    app_id: str
    window_start: datetime
    rated_runs: int
    units: tuple[UnitRecommendation, ...]


class RetrievalWeightRecommendationService:
    def __init__(
        self,
        *,
        evidence: WeightTuningEvidenceQuery,
        policy: TuningPolicy,
        window_days: int,
        max_feedback: int,
        now: Callable[[], datetime],
        new_sampler: Callable[[], Callable[[int], int]],
    ) -> None:
        """``now`` returns naive UTC. ``new_sampler`` returns a fresh index sampler per report, so a
        deterministic sampler makes reports reproducible. Raises ValueError for a non-positive window or limit.
        """
        if window_days <= 0 or max_feedback <= 0:
            raise ValueError("window_days and max_feedback must be positive")
        self._evidence = evidence
        self._policy = policy
        self._window_days = window_days
        self._max_feedback = max_feedback
        self._now = now
        self._new_sampler = new_sampler

    def recommend(self, *, tenant_id: str, app_id: str) -> RetrievalWeightReport:
        """Build the advisory report for the app. Read-only.

        Raises RecommendationAppNotFoundError when the app does not belong to the tenant.
        Postcondition: one entry per tuning unit that has traces for rated runs, ordered by node,
        stage and dataset.
        """
        if not self._evidence.app_exists(tenant_id=tenant_id, app_id=app_id):
            raise RecommendationAppNotFoundError()
        window_start = self._now() - timedelta(days=self._window_days)
        ratings = _resolve_ratings(
            self._evidence.run_feedback(
                tenant_id=tenant_id, app_id=app_id, since=window_start, limit=self._max_feedback
            )
        )
        traces = (
            self._evidence.traces_for_runs(tenant_id=tenant_id, app_id=app_id, workflow_run_ids=sorted(ratings))
            if ratings
            else ()
        )
        sample_index = self._new_sampler()
        units = sorted(
            {_unit_of(trace) for trace in traces},
            key=lambda unit: (unit.node_id, unit.stage, unit.dataset_id or ""),
        )
        return RetrievalWeightReport(
            app_id=app_id,
            window_start=window_start,
            rated_runs=len(ratings),
            units=tuple(
                recommendation
                for unit in units
                if (
                    recommendation := self._recommend_unit(
                        unit=unit,
                        traces=[trace for trace in traces if _unit_of(trace) == unit],
                        ratings=ratings,
                        sample_index=sample_index,
                    )
                )
                is not None
            ),
        )

    def _recommend_unit(
        self,
        *,
        unit: TuningUnit,
        traces: Sequence[WeightTraceRecord],
        ratings: Mapping[str, Rating],
        sample_index: Callable[[int], int],
    ) -> UnitRecommendation | None:
        """Verdict for one unit; None when its most recent weights have no defined balance.

        Precondition: ``traces`` is non-empty, belongs to ``unit`` and is ordered oldest first.
        """
        latest = max(traces, key=lambda trace: trace.created_at)
        weight_sum = latest.vector_weight + latest.keyword_weight
        if weight_sum <= 0.0:
            return None
        by_run = sorted(traces, key=lambda trace: trace.workflow_run_id)
        runs = [
            RatedRun(rating=ratings[run_id], rankings=tuple(_ranking_of(trace) for trace in run_traces))
            for run_id, run_traces in groupby(by_run, key=lambda trace: trace.workflow_run_id)
        ]
        return UnitRecommendation(
            unit=unit,
            current_vector_weight=latest.vector_weight / weight_sum,
            weights_changed_in_window=len({(trace.vector_weight, trace.keyword_weight) for trace in traces}) > 1,
            recommendation=recommend_vector_weight(
                runs=runs,
                current_vector_weight=latest.vector_weight / weight_sum,
                policy=self._policy,
                sample_index=sample_index,
            ),
        )


def _resolve_ratings(feedback: Sequence[RunFeedbackRecord]) -> dict[str, Rating]:
    """One rating per run: admin feedback wins over end-user feedback."""
    user = {record.workflow_run_id: record.rating for record in feedback if record.from_source == "user"}
    admin = {record.workflow_run_id: record.rating for record in feedback if record.from_source == "admin"}
    return user | admin


def _unit_of(trace: WeightTraceRecord) -> TuningUnit:
    return TuningUnit(
        node_id=trace.node_id,
        stage=trace.stage,
        dataset_id=trace.dataset_id,
        embedding_provider_name=trace.embedding_provider_name,
        embedding_model_name=trace.embedding_model_name,
    )


def _ranking_of(trace: WeightTraceRecord) -> RecordedRanking:
    return RecordedRanking(
        candidates=tuple(
            RecordedCandidate(
                vector_score=candidate.vector_score,
                keyword_score=candidate.keyword_score,
                selected=candidate.selected,
            )
            for candidate in trace.candidates
        ),
        score_threshold=trace.score_threshold,
        top_n=trace.top_n,
    )
