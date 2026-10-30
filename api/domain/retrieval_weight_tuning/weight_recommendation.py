"""Recommend a vector weight for one weighted-score rerank from rated runs.

Signal: a thumbs-up says the results shown were acceptable, a thumbs-down that something about
the answer was not. Feedback rates the whole answer, not individual chunks, so the policy only
claims what that supports: a better weight keeps what liked answers were shown and changes what
disliked answers were shown.

For a candidate vector weight ``w`` (keyword weight ``1 - w``), the retention of a run is the mean
share of originally shown candidates that ``w`` still returns (see ``ranking_replay``). The
objective is ``J(w) = mean retention over liked runs - mean retention over disliked runs``.
Every run retains everything at the weights it was shown with, so ``J`` of what users saw is 0
and ``J(w)`` is the improvement over it.

Invariants:
- A change is recommended only with enough liked and disliked runs, a weight that moves by at
  least ``min_shift``, a bootstrap interval for ``J`` entirely above 0, and a best weight that is
  stable across resamples. Otherwise the verdict keeps the current weight.
- Results are reproducible: randomness comes only from the injected ``sample_index``.
"""

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Literal

from domain.retrieval_weight_tuning.ranking_replay import RecordedRanking, retention

type Rating = Literal["like", "dislike"]

# Grid weights are binary floats; comparisons of weight distances allow this much rounding.
_WEIGHT_TOLERANCE = 1e-9


@dataclass(frozen=True, slots=True)
class RatedRun:
    """The rankings one rated run produced for a single tuning unit (several when the node ran in a loop)."""

    rating: Rating
    rankings: tuple[RecordedRanking, ...]


@dataclass(frozen=True, slots=True)
class TuningPolicy:
    grid_step: float
    min_runs_per_rating: int
    min_shift: float
    stability_radius: float
    min_stability: float
    confidence: float
    resamples: int

    def __post_init__(self) -> None:
        valid = (
            0.0 < self.grid_step <= 0.5
            and self.min_runs_per_rating > 0
            and 0.0 <= self.min_shift <= 1.0
            and 0.0 <= self.stability_radius <= 1.0
            and 0.0 <= self.min_stability <= 1.0
            and 0.0 < self.confidence < 1.0
            and self.resamples > 0
        )
        if not valid:
            raise ValueError("invalid weight tuning policy")


@dataclass(frozen=True, slots=True)
class WeightAnalysis:
    """Evidence behind a verdict.

    ``curve`` pairs each evaluated vector weight with ``J``. ``improvement`` is ``J`` at the best
    weight and ``interval`` its bootstrap interval at the policy's confidence. ``stability`` is the
    share of resamples whose best weight lies within the stability radius of the best weight.
    ``affected_share`` is the share of rated runs that would lose at least one shown result.
    """

    liked_runs: int
    disliked_runs: int
    best_vector_weight: float
    curve: tuple[tuple[float, float], ...]
    improvement: float
    interval: tuple[float, float]
    stability: float
    affected_share: float


@dataclass(frozen=True, slots=True)
class InsufficientEvidence:
    liked_runs: int
    disliked_runs: int
    required_per_rating: int
    kind: Literal["insufficient_evidence"] = "insufficient_evidence"


@dataclass(frozen=True, slots=True)
class KeepCurrentWeight:
    current_vector_weight: float
    analysis: WeightAnalysis
    kind: Literal["keep_current"] = "keep_current"


@dataclass(frozen=True, slots=True)
class RecommendWeightChange:
    current_vector_weight: float
    recommended_vector_weight: float
    analysis: WeightAnalysis
    kind: Literal["recommend_change"] = "recommend_change"


type WeightRecommendation = InsufficientEvidence | KeepCurrentWeight | RecommendWeightChange


def recommend_vector_weight(
    *,
    runs: Sequence[RatedRun],
    current_vector_weight: float,
    policy: TuningPolicy,
    sample_index: Callable[[int], int],
) -> WeightRecommendation:
    """Return the verdict for one tuning unit.

    Preconditions: ``current_vector_weight`` is in [0, 1] (vector and keyword weights sum to 1);
    ``sample_index(n)`` returns a uniformly chosen integer in [0, n).
    Runs whose rankings showed nothing carry no evidence and are ignored.
    """
    if not 0.0 <= current_vector_weight <= 1.0:
        raise ValueError("current_vector_weight must be within [0, 1]")
    grid = _grid(policy.grid_step, current_vector_weight)
    rows = [(run.rating, row) for run in runs if (row := _retention_row(run, grid)) is not None]
    liked = [row for rating, row in rows if rating == "like"]
    disliked = [row for rating, row in rows if rating == "dislike"]
    if len(liked) < policy.min_runs_per_rating or len(disliked) < policy.min_runs_per_rating:
        return InsufficientEvidence(
            liked_runs=len(liked), disliked_runs=len(disliked), required_per_rating=policy.min_runs_per_rating
        )

    curve = _objective(liked, disliked, grid)
    best = _best_index(curve, grid, current_vector_weight)
    resampled = [
        _objective(_resample(liked, sample_index), _resample(disliked, sample_index), grid)
        for _ in range(policy.resamples)
    ]
    resampled_best = [grid[_best_index(sample, grid, current_vector_weight)] for sample in resampled]
    analysis = WeightAnalysis(
        liked_runs=len(liked),
        disliked_runs=len(disliked),
        best_vector_weight=grid[best],
        curve=tuple(zip(grid, curve, strict=True)),
        improvement=curve[best],
        interval=_percentile_interval([sample[best] for sample in resampled], policy.confidence),
        stability=sum(
            abs(weight - grid[best]) <= policy.stability_radius + _WEIGHT_TOLERANCE for weight in resampled_best
        )
        / policy.resamples,
        affected_share=sum(row[best] < 1.0 for _, row in rows) / len(rows),
    )
    recommend = (
        abs(analysis.best_vector_weight - current_vector_weight) >= policy.min_shift - _WEIGHT_TOLERANCE
        and analysis.interval[0] > 0.0
        and analysis.stability >= policy.min_stability
    )
    if recommend:
        return RecommendWeightChange(
            current_vector_weight=current_vector_weight,
            recommended_vector_weight=analysis.best_vector_weight,
            analysis=analysis,
        )
    return KeepCurrentWeight(current_vector_weight=current_vector_weight, analysis=analysis)


def _grid(step: float, current_vector_weight: float) -> tuple[float, ...]:
    """Evenly spaced vector weights over [0, 1], plus the current weight."""
    points = {round(index * step, 10) for index in range(math.floor(1.0 / step + _WEIGHT_TOLERANCE) + 1)}
    return tuple(sorted(points | {1.0, current_vector_weight}))


def _retention_row(run: RatedRun, grid: Sequence[float]) -> tuple[float, ...] | None:
    """Mean retention of the run's rankings at each grid weight; None when no ranking showed anything."""
    informative = [ranking for ranking in run.rankings if ranking.shown]
    if not informative:
        return None
    return tuple(
        sum(_defined_retention(ranking, weight) for ranking in informative) / len(informative) for weight in grid
    )


def _defined_retention(ranking: RecordedRanking, vector_weight: float) -> float:
    value = retention(ranking, vector_weight=vector_weight, keyword_weight=1.0 - vector_weight)
    if value is None:
        raise ValueError("retention is undefined for a ranking that showed nothing")
    return value


def _objective(
    liked: Sequence[tuple[float, ...]], disliked: Sequence[tuple[float, ...]], grid: Sequence[float]
) -> tuple[float, ...]:
    return tuple(
        sum(row[index] for row in liked) / len(liked) - sum(row[index] for row in disliked) / len(disliked)
        for index in range(len(grid))
    )


def _best_index(curve: Sequence[float], grid: Sequence[float], current_vector_weight: float) -> int:
    """Index of the highest objective; ties go to the weight closest to the current one."""
    return max(range(len(grid)), key=lambda index: (curve[index], -abs(grid[index] - current_vector_weight)))


def _resample[T](rows: Sequence[T], sample_index: Callable[[int], int]) -> list[T]:
    return [rows[sample_index(len(rows))] for _ in range(len(rows))]


def _percentile_interval(values: Sequence[float], confidence: float) -> tuple[float, float]:
    ordered = sorted(values)
    tail = (1.0 - confidence) / 2.0
    low = ordered[math.floor(tail * (len(ordered) - 1))]
    high = ordered[math.ceil((1.0 - tail) * (len(ordered) - 1))]
    return low, high
