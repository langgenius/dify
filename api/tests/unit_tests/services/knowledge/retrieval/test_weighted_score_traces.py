import threading
from collections.abc import Sequence
from datetime import datetime

import pytest

from core.rag.rerank.entity.weight import (
    CrossDatasetWeightedScoreStage,
    WeightedScoreCandidate,
    WeightedScoreObservation,
)
from services.knowledge.retrieval.weighted_score_traces import (
    CollectingWeightedScoreTrace,
    WeightedScoreTraceDraft,
    WeightedScoreTracePolicy,
    WeightedScoreTraceRecorder,
    WeightedScoreTraceRetentionService,
)


class _MemoryStore:
    def __init__(self, *, fail: bool = False) -> None:
        self.saved: list[WeightedScoreTraceDraft] = []
        self._fail = fail

    def save_traces(self, *, tenant_id: str, app_id: str, traces: Sequence[WeightedScoreTraceDraft]) -> None:
        if self._fail:
            raise RuntimeError("database unavailable")
        assert all(trace.tenant_id == tenant_id and trace.app_id == app_id for trace in traces)
        self.saved.extend(traces)


def _observation(final_score: float = 0.5) -> WeightedScoreObservation:
    return WeightedScoreObservation(
        stage=CrossDatasetWeightedScoreStage(),
        vector_weight=0.7,
        keyword_weight=0.3,
        embedding_provider_name="provider",
        embedding_model_name="embedding",
        score_threshold=None,
        top_n=4,
        candidates=(WeightedScoreCandidate("node-1", "doc-1", "ds-1", 0.6, 0.3, final_score, 0),),
    )


def _recorder(store: _MemoryStore, *, enabled: bool, sample_rate: float, draw: float) -> WeightedScoreTraceRecorder:
    return WeightedScoreTraceRecorder(
        store=store,
        policy=WeightedScoreTracePolicy(enabled=enabled, sample_rate=sample_rate),
        draw=lambda: draw,
    )


def _begin(
    recorder: WeightedScoreTraceRecorder, *, app_type: str | None = "chatflow", invoke_from: str = "web-app"
) -> CollectingWeightedScoreTrace | None:
    return recorder.begin(
        tenant_id="tenant",
        app_id="app",
        app_type=app_type,
        invoke_from=invoke_from,
        workflow_id="workflow",
        workflow_run_id="run",
        node_id="node",
    )


@pytest.mark.parametrize(
    ("enabled", "sample_rate", "draw", "app_type", "invoke_from"),
    [
        (False, 1.0, 0.0, "chatflow", "web-app"),
        (True, 1.0, 0.0, "workflow", "web-app"),
        (True, 1.0, 0.0, None, "web-app"),
        (True, 1.0, 0.0, "chatflow", "debugger"),
        (True, 0.25, 0.25, "chatflow", "web-app"),
    ],
)
def test_begin_skips_ineligible_or_unsampled_executions(
    enabled: bool, sample_rate: float, draw: float, app_type: str | None, invoke_from: str
) -> None:
    recorder = _recorder(_MemoryStore(), enabled=enabled, sample_rate=sample_rate, draw=draw)

    assert _begin(recorder, app_type=app_type, invoke_from=invoke_from) is None


def test_commit_persists_observations_from_concurrent_threads_once() -> None:
    store = _MemoryStore()
    trace = _begin(_recorder(store, enabled=True, sample_rate=0.5, draw=0.49))
    assert trace is not None
    threads = [threading.Thread(target=trace.observe, args=(_observation(i / 10),)) for i in range(5)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    trace.commit()
    trace.observe(_observation())
    trace.commit()

    assert len(store.saved) == 5
    assert {(draft.tenant_id, draft.app_id, draft.workflow_run_id, draft.node_id) for draft in store.saved} == {
        ("tenant", "app", "run", "node")
    }


def test_commit_without_observations_writes_nothing() -> None:
    store = _MemoryStore(fail=True)
    trace = _begin(_recorder(store, enabled=True, sample_rate=1.0, draw=0.0))
    assert trace is not None

    trace.commit()

    assert store.saved == []


def test_commit_swallows_store_failures() -> None:
    trace = _begin(_recorder(_MemoryStore(fail=True), enabled=True, sample_rate=1.0, draw=0.0))
    assert trace is not None
    trace.observe(_observation())

    trace.commit()


def test_policy_rejects_sample_rate_outside_unit_interval() -> None:
    with pytest.raises(ValueError, match="sample_rate"):
        WeightedScoreTracePolicy(enabled=True, sample_rate=1.5)


class _BatchedRetentionStore:
    def __init__(self, rows: int) -> None:
        self.rows = rows
        self.cutoffs: list[datetime] = []
        self.app_calls: list[tuple[str, str]] = []

    def _take(self, limit: int) -> int:
        taken = min(self.rows, limit)
        self.rows -= taken
        return taken

    def delete_created_before(self, *, cutoff: datetime, limit: int) -> int:
        self.cutoffs.append(cutoff)
        return self._take(limit)

    def delete_app_traces(self, *, tenant_id: str, app_id: str, limit: int) -> int:
        self.app_calls.append((tenant_id, app_id))
        return self._take(limit)


def test_purge_expired_drains_batches_with_a_fixed_cutoff() -> None:
    store = _BatchedRetentionStore(rows=5)
    service = WeightedScoreTraceRetentionService(
        store=store, retention_days=30, now=lambda: datetime(2026, 10, 30), batch_size=2
    )

    assert service.purge_expired() == 5
    assert store.rows == 0
    assert set(store.cutoffs) == {datetime(2026, 9, 30)}


def test_purge_app_drains_the_apps_traces() -> None:
    store = _BatchedRetentionStore(rows=3)
    service = WeightedScoreTraceRetentionService(
        store=store, retention_days=30, now=lambda: datetime(2026, 10, 30), batch_size=2
    )

    assert service.purge_app(tenant_id="tenant", app_id="app") == 3
    assert set(store.app_calls) == {("tenant", "app")}
