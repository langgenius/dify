"""Weighted-score rerank settings and the hook that observes weighted-score candidate pools.

Observation is opt-in per execution context. A caller installs an observer with
``observe_weighted_scores`` and each weighted-score call site labels its stage with
``weighted_score_stage``. ``WeightRerankRunner`` reports an observation only when both are
present, so retrieval outside an observed context (hit testing, Easy UI apps, indexing) is
unchanged. Thread pools in the retrieval path run under ``propagate_context``, which copies
both context variables into worker threads; the observer object itself is shared, so it must
accept concurrent ``observe`` calls.
"""

import logging
from collections.abc import Callable, Generator, Sequence
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Literal, Protocol

from pydantic import BaseModel

from core.rag.entities import KeywordSetting, VectorSetting

logger = logging.getLogger(__name__)


class Weights(BaseModel):
    """Model for weighted rerank."""

    vector_setting: VectorSetting

    keyword_setting: KeywordSetting


@dataclass(frozen=True, slots=True)
class DatasetWeightedScoreStage:
    """Hybrid search inside one dataset, weighted by that dataset's ``retrieval_model`` weights."""

    dataset_id: str
    kind: Literal["dataset"] = "dataset"


@dataclass(frozen=True, slots=True)
class CrossDatasetWeightedScoreStage:
    """Merge of several datasets' results, weighted by the caller's multiple-retrieval weights."""

    kind: Literal["cross_dataset"] = "cross_dataset"


type WeightedScoreStage = DatasetWeightedScoreStage | CrossDatasetWeightedScoreStage


@dataclass(frozen=True, slots=True)
class WeightedScoreCandidate:
    """One deduplicated candidate as the weighted-score runner scored it.

    ``vector_score`` is the vector component the runner used: a score the document already
    carried (the retriever's similarity, or the previous stage's blended score in a
    cross-dataset stage) or a freshly computed cosine similarity.
    ``index_node_id``, ``document_id`` and ``dataset_id`` are None when the document carries no
    such metadata (for example external knowledge results).
    ``selected_rank`` is the 0-based position in the runner's output, or None when the
    candidate was dropped by the score threshold or the ``top_n`` cut.
    """

    index_node_id: str | None
    document_id: str | None
    dataset_id: str | None
    vector_score: float
    keyword_score: float
    final_score: float
    selected_rank: int | None


@dataclass(frozen=True, slots=True)
class WeightedScoreObservation:
    """The complete candidate pool of one weighted-score rerank, enough to replay it under other weights.

    Invariant: ``candidates`` holds every candidate the runner scored, in scoring order,
    including those it did not return. ``score_threshold`` None or 0 means no threshold;
    ``top_n`` None or 0 means no cut.
    """

    stage: WeightedScoreStage
    vector_weight: float
    keyword_weight: float
    embedding_provider_name: str
    embedding_model_name: str
    score_threshold: float | None
    top_n: int | None
    candidates: tuple[WeightedScoreCandidate, ...]


class WeightedScoreObserver(Protocol):
    def observe(self, observation: WeightedScoreObservation) -> None:
        """Accept one observation. May be called concurrently from retrieval worker threads; must not raise."""
        ...


_observer: ContextVar[WeightedScoreObserver | None] = ContextVar("weighted_score_observer", default=None)
_stage: ContextVar[WeightedScoreStage | None] = ContextVar("weighted_score_stage", default=None)


@contextmanager
def observe_weighted_scores(observer: WeightedScoreObserver) -> Generator[None]:
    """Report weighted-score reranks run in this context (and threads that copy it) to ``observer``.

    Postcondition: the previous observer is restored on exit, including on error.
    """
    token = _observer.set(observer)
    try:
        yield
    finally:
        _observer.reset(token)


@contextmanager
def weighted_score_stage(stage: WeightedScoreStage) -> Generator[None]:
    """Label weighted-score reranks run in this context with ``stage``.

    Postcondition: the previous stage is restored on exit, including on error.
    """
    token = _stage.set(stage)
    try:
        yield
    finally:
        _stage.reset(token)


def build_weighted_score_observation(
    *,
    stage: WeightedScoreStage,
    weights: Weights,
    score_threshold: float | None,
    top_n: int | None,
    candidate_metadata: Sequence[dict | None],
    vector_scores: Sequence[float],
    keyword_scores: Sequence[float],
    final_scores: Sequence[float],
    selected_ranks: Sequence[int | None],
) -> WeightedScoreObservation:
    """Build an observation from the runner's per-candidate values.

    Precondition: all per-candidate sequences have the same length and order.
    Raises ValueError when they do not, so a misaligned pool is never recorded.
    """
    lengths = {
        len(candidate_metadata),
        len(vector_scores),
        len(keyword_scores),
        len(final_scores),
        len(selected_ranks),
    }
    if len(lengths) != 1:
        raise ValueError("weighted-score candidate values must be aligned")
    return WeightedScoreObservation(
        stage=stage,
        vector_weight=weights.vector_setting.vector_weight,
        keyword_weight=weights.keyword_setting.keyword_weight,
        embedding_provider_name=weights.vector_setting.embedding_provider_name,
        embedding_model_name=weights.vector_setting.embedding_model_name,
        score_threshold=score_threshold,
        top_n=top_n,
        candidates=tuple(
            WeightedScoreCandidate(
                index_node_id=_metadata_text(metadata, "doc_id"),
                document_id=_metadata_text(metadata, "document_id"),
                dataset_id=_metadata_text(metadata, "dataset_id"),
                vector_score=float(vector_score),
                keyword_score=float(keyword_score),
                final_score=float(final_score),
                selected_rank=selected_rank,
            )
            for metadata, vector_score, keyword_score, final_score, selected_rank in zip(
                candidate_metadata, vector_scores, keyword_scores, final_scores, selected_ranks, strict=True
            )
        ),
    )


def report_weighted_score_observation(build: Callable[[WeightedScoreStage], WeightedScoreObservation]) -> None:
    """Report an observation when this context is observed and staged; otherwise do nothing.

    ``build`` is only called when an observation will be reported, so unobserved retrieval pays
    nothing. Observation must never change retrieval results: a failure while building or
    reporting is logged and swallowed, and the caller's ranking is unaffected.
    """
    observer = _observer.get()
    stage = _stage.get()
    if observer is not None and stage is not None:
        try:
            observer.observe(build(stage))
        except Exception:
            logger.warning("Failed to report weighted-score observation", exc_info=True)


def _metadata_text(metadata: dict | None, key: str) -> str | None:
    value = metadata.get(key) if metadata is not None else None
    return str(value) if value is not None else None
