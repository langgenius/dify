import random

import pytest

from domain.retrieval_weight_tuning.ranking_replay import RecordedCandidate, RecordedRanking
from domain.retrieval_weight_tuning.weight_recommendation import (
    InsufficientEvidence,
    KeepCurrentWeight,
    RatedRun,
    RecommendWeightChange,
    TuningPolicy,
    WeightRecommendation,
    recommend_vector_weight,
)

POLICY = TuningPolicy(
    grid_step=0.05,
    min_runs_per_rating=30,
    min_shift=0.1,
    stability_radius=0.1,
    min_stability=0.6,
    confidence=0.9,
    resamples=50,
)

# Shown candidate wins at every weight.
ROBUST = RecordedRanking(
    candidates=(RecordedCandidate(0.9, 0.9, True), RecordedCandidate(0.5, 0.1, False)),
    score_threshold=None,
    top_n=1,
)
# Shown at vector weight 0.7; the keyword-heavy candidate overtakes it below about 0.636.
VECTOR_FAVOURED = RecordedRanking(
    candidates=(RecordedCandidate(0.9, 0.1, True), RecordedCandidate(0.5, 0.8, False)),
    score_threshold=None,
    top_n=1,
)
NOTHING_SHOWN = RecordedRanking(candidates=(RecordedCandidate(0.1, 0.1, False),), score_threshold=0.9, top_n=1)


def _recommend(runs: list[RatedRun], current: float = 0.7) -> WeightRecommendation:
    return recommend_vector_weight(
        runs=runs,
        current_vector_weight=current,
        policy=POLICY,
        sample_index=random.Random(7).randrange,  # noqa: S311 - deterministic resampling
    )


def test_too_few_rated_runs_is_insufficient() -> None:
    runs = [RatedRun("like", (ROBUST,))] * 30 + [RatedRun("dislike", (VECTOR_FAVOURED,))] * 29

    assert _recommend(runs) == InsufficientEvidence(liked_runs=30, disliked_runs=29, required_per_rating=30)


def test_runs_that_showed_nothing_are_not_evidence() -> None:
    runs = [RatedRun("like", (ROBUST,))] * 30 + [RatedRun("dislike", (NOTHING_SHOWN,))] * 30

    assert isinstance(_recommend(runs), InsufficientEvidence)


def test_recommends_the_nearest_weight_that_keeps_liked_and_changes_disliked_results() -> None:
    runs = [RatedRun("like", (ROBUST,))] * 30 + [RatedRun("dislike", (VECTOR_FAVOURED,))] * 30

    result = _recommend(runs)

    assert isinstance(result, RecommendWeightChange)
    assert result.recommended_vector_weight == pytest.approx(0.6)
    assert result.analysis.improvement == pytest.approx(1.0)
    assert result.analysis.interval == (pytest.approx(1.0), pytest.approx(1.0))
    assert result.analysis.stability == 1.0
    assert result.analysis.affected_share == pytest.approx(0.5)


def test_keeps_current_weight_when_liked_and_disliked_results_move_together() -> None:
    runs = [RatedRun("like", (VECTOR_FAVOURED,))] * 30 + [RatedRun("dislike", (VECTOR_FAVOURED,))] * 30

    result = _recommend(runs)

    assert isinstance(result, KeepCurrentWeight)
    assert result.analysis.best_vector_weight == 0.7
    assert result.analysis.improvement == 0.0


def test_keeps_current_weight_when_the_best_weight_is_too_close() -> None:
    runs = [RatedRun("like", (ROBUST,))] * 30 + [RatedRun("dislike", (VECTOR_FAVOURED,))] * 30

    assert isinstance(_recommend(runs, current=0.65), KeepCurrentWeight)


def test_same_sampler_seed_gives_the_same_verdict() -> None:
    runs = [RatedRun("like", (ROBUST,))] * 40 + [RatedRun("dislike", (VECTOR_FAVOURED, ROBUST))] * 35

    assert _recommend(runs) == _recommend(runs)


def test_policy_rejects_invalid_values() -> None:
    with pytest.raises(ValueError, match="policy"):
        TuningPolicy(
            grid_step=0.0,
            min_runs_per_rating=30,
            min_shift=0.1,
            stability_radius=0.1,
            min_stability=0.6,
            confidence=0.9,
            resamples=50,
        )
