"""Weighted-score retrieval traces for feedback-driven weight tuning.

A trace records the full candidate pool of every keyword/vector weighted-score rerank that one
knowledge-retrieval node execution performed, with the component scores the runner used. Joined
with message feedback through ``workflow_run_id``, traces let an offline tuner replay a ranking
under other weights without re-running retrieval.

Invariants:
- Tracing never changes retrieval results or node status: collection only reads values the runner
  already computed, and persistence failures are logged and dropped.
- Only executions that can receive message feedback are traced: chatflow apps invoked from an
  end-user surface. Debugger runs are excluded because their configuration is a moving draft.
- A trace is persisted only after retrieval succeeded, and only when it holds observations.
- Traces older than the retention window, or belonging to a deleted app, are removable in bounded
  batches.
"""

import logging
import threading
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Protocol

from core.rag.rerank.entity.weight import WeightedScoreObservation

logger = logging.getLogger(__name__)

# Values of CreditUsageAppType and InvokeFrom. They are spelled out because importing those enums
# would pull framework and persistence modules into this slice.
TRACED_APP_TYPES = frozenset({"chatflow"})
TRACED_INVOKE_SOURCES = frozenset({"service-api", "openapi", "web-app", "explore"})


@dataclass(frozen=True, slots=True)
class WeightedScoreTraceDraft:
    """One weighted-score rerank of one node execution, ready to persist."""

    tenant_id: str
    app_id: str
    workflow_id: str
    workflow_run_id: str
    node_id: str
    observation: WeightedScoreObservation


class WeightedScoreTraceStore(Protocol):
    def save_traces(self, *, tenant_id: str, app_id: str, traces: Sequence[WeightedScoreTraceDraft]) -> None:
        """Insert all ``traces`` in one transaction.

        Precondition: every draft belongs to ``tenant_id`` and ``app_id`` and ``traces`` is not empty.
        Raises ValueError when a draft has another owner; database errors propagate and nothing is written.
        """
        ...


class WeightedScoreTraceRetentionStore(Protocol):
    def delete_created_before(self, *, cutoff: datetime, limit: int) -> int:
        """Delete at most ``limit`` traces created before ``cutoff`` (naive UTC) and return how many were deleted."""
        ...

    def delete_app_traces(self, *, tenant_id: str, app_id: str, limit: int) -> int:
        """Delete at most ``limit`` traces of the app and return how many were deleted."""
        ...


@dataclass(frozen=True, slots=True)
class WeightedScoreTracePolicy:
    """Which executions to trace.

    ``sample_rate`` is the probability, in [0, 1], of tracing an eligible execution.
    """

    enabled: bool
    sample_rate: float

    def __post_init__(self) -> None:
        if not 0.0 <= self.sample_rate <= 1.0:
            raise ValueError("sample_rate must be within [0, 1]")


class WeightedScoreTraceRecorder:
    """Starts and persists weighted-score traces for knowledge-retrieval node executions."""

    def __init__(
        self,
        *,
        store: WeightedScoreTraceStore,
        policy: WeightedScoreTracePolicy,
        draw: Callable[[], float],
    ) -> None:
        """``draw`` returns a uniform sample in [0, 1) for the sampling decision."""
        self._store = store
        self._policy = policy
        self._draw = draw

    def begin(
        self,
        *,
        tenant_id: str,
        app_id: str,
        app_type: str | None,
        invoke_from: str,
        workflow_id: str,
        workflow_run_id: str,
        node_id: str,
    ) -> "CollectingWeightedScoreTrace | None":
        """Return a collecting trace when the execution is eligible and sampled, otherwise None.

        Eligible means tracing is enabled, ``app_type`` is a traced app type (None is never
        traced) and ``invoke_from`` is an end-user surface. Has no side effects besides one draw.
        """
        eligible = (
            self._policy.enabled
            and app_type in TRACED_APP_TYPES
            and invoke_from in TRACED_INVOKE_SOURCES
            and self._draw() < self._policy.sample_rate
        )
        if not eligible:
            return None
        return CollectingWeightedScoreTrace(
            recorder=self,
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            workflow_run_id=workflow_run_id,
            node_id=node_id,
        )

    def persist(self, *, tenant_id: str, app_id: str, traces: Sequence[WeightedScoreTraceDraft]) -> None:
        """Save ``traces``; an empty sequence writes nothing. Never raises: failures are logged and dropped."""
        if not traces:
            return
        try:
            self._store.save_traces(tenant_id=tenant_id, app_id=app_id, traces=traces)
        except Exception:
            logger.warning(
                "Failed to persist weighted-score traces, app_id=%s workflow_run_id=%s",
                app_id,
                traces[0].workflow_run_id,
                exc_info=True,
            )


class CollectingWeightedScoreTrace:
    """Thread-safe in-memory collector for one node execution.

    Retrieval worker threads call ``observe`` concurrently; ``commit`` hands the collected
    observations, in arrival order, to the recorder exactly once.
    """

    def __init__(
        self,
        *,
        recorder: WeightedScoreTraceRecorder,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        workflow_run_id: str,
        node_id: str,
    ) -> None:
        self._recorder = recorder
        self._tenant_id = tenant_id
        self._app_id = app_id
        self._workflow_id = workflow_id
        self._workflow_run_id = workflow_run_id
        self._node_id = node_id
        self._lock = threading.Lock()
        self._observations: list[WeightedScoreObservation] = []
        self._committed = False

    def observe(self, observation: WeightedScoreObservation) -> None:
        """Collect one observation. Observations arriving after ``commit`` are ignored."""
        with self._lock:
            if not self._committed:
                self._observations.append(observation)

    def commit(self) -> None:
        """Persist the collected observations once; later calls do nothing. Never raises."""
        with self._lock:
            observations = () if self._committed else tuple(self._observations)
            self._committed = True
        self._recorder.persist(
            tenant_id=self._tenant_id,
            app_id=self._app_id,
            traces=[
                WeightedScoreTraceDraft(
                    tenant_id=self._tenant_id,
                    app_id=self._app_id,
                    workflow_id=self._workflow_id,
                    workflow_run_id=self._workflow_run_id,
                    node_id=self._node_id,
                    observation=observation,
                )
                for observation in observations
            ],
        )


class WeightedScoreTraceRetentionService:
    """Bounded deletion of expired traces and of a deleted app's traces."""

    def __init__(
        self,
        *,
        store: WeightedScoreTraceRetentionStore,
        retention_days: int,
        now: Callable[[], datetime],
        batch_size: int,
    ) -> None:
        """``now`` returns naive UTC, matching the stored ``created_at``.

        Raises ValueError unless ``retention_days`` and ``batch_size`` are positive.
        """
        if retention_days <= 0 or batch_size <= 0:
            raise ValueError("retention_days and batch_size must be positive")
        self._store = store
        self._retention_days = retention_days
        self._now = now
        self._batch_size = batch_size

    def purge_expired(self) -> int:
        """Delete every trace older than the retention window, batch by batch, and return the total.

        Postcondition: no trace created before the cutoff computed at call start remains, unless a
        store error propagates, in which case earlier batches stay deleted.
        """
        cutoff = self._now() - timedelta(days=self._retention_days)
        return _drain(lambda: self._store.delete_created_before(cutoff=cutoff, limit=self._batch_size))

    def purge_app(self, *, tenant_id: str, app_id: str) -> int:
        """Delete every trace of the app, batch by batch, and return the total. Idempotent."""
        return _drain(lambda: self._store.delete_app_traces(tenant_id=tenant_id, app_id=app_id, limit=self._batch_size))


def _drain(delete_batch: Callable[[], int]) -> int:
    """Call ``delete_batch`` until it deletes nothing and return the sum of deleted rows."""
    total = 0
    deleted = delete_batch()
    while deleted > 0:
        total += deleted
        deleted = delete_batch()
    return total
