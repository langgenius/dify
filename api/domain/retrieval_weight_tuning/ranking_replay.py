"""Replay of a recorded weighted-score ranking under other keyword/vector weights.

The replay mirrors ``WeightRerankRunner``: each candidate scores
``vector_weight * vector_score + keyword_weight * keyword_score``; candidates below a truthy
``score_threshold`` are dropped; the rest are ordered by score, descending and stable with
respect to recording order; a truthy ``top_n`` keeps only the first ``top_n``.

Invariant: replaying a ranking at the weights it was recorded with selects exactly the
candidates that were recorded as selected. The candidate pool does not depend on the weights,
which is what makes the replay valid for any other weights.
"""

from dataclasses import dataclass
from operator import itemgetter


@dataclass(frozen=True, slots=True)
class RecordedCandidate:
    vector_score: float
    keyword_score: float
    selected: bool


@dataclass(frozen=True, slots=True)
class RecordedRanking:
    """One recorded rerank. ``score_threshold`` and ``top_n`` None or 0 mean no threshold and no cut."""

    candidates: tuple[RecordedCandidate, ...]
    score_threshold: float | None
    top_n: int | None

    @property
    def shown(self) -> frozenset[int]:
        """Positions of the candidates that the recorded ranking returned."""
        return frozenset(position for position, candidate in enumerate(self.candidates) if candidate.selected)


def replay_selection(ranking: RecordedRanking, *, vector_weight: float, keyword_weight: float) -> frozenset[int]:
    """Return the candidate positions the ranking would return under the given weights."""
    scored = [
        (position, vector_weight * candidate.vector_score + keyword_weight * candidate.keyword_score)
        for position, candidate in enumerate(ranking.candidates)
    ]
    kept = [
        (position, score)
        for position, score in scored
        if not (ranking.score_threshold and score < ranking.score_threshold)
    ]
    ordered = sorted(kept, key=itemgetter(1), reverse=True)
    returned = ordered[: ranking.top_n] if ranking.top_n else ordered
    return frozenset(position for position, _ in returned)


def retention(ranking: RecordedRanking, *, vector_weight: float, keyword_weight: float) -> float | None:
    """Share of the originally shown candidates that the given weights still return.

    Returns None when the recorded ranking showed nothing, because retention is undefined there.
    Otherwise the result is in [0, 1] and equals 1 at the recorded weights.
    """
    shown = ranking.shown
    if not shown:
        return None
    kept = replay_selection(ranking, vector_weight=vector_weight, keyword_weight=keyword_weight)
    return len(kept & shown) / len(shown)
