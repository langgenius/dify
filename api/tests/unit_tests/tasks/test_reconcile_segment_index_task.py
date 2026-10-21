from collections.abc import Callable, Generator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime

import pytest

from services.knowledge.resource_scope import SegmentRef
from services.knowledge.segments.contracts import SegmentChildIndexCompletion, SegmentIndexReconcileOutcome
from services.knowledge.task_outbox.contracts import KnowledgeTaskRetriesExhaustedError
from services.knowledge.task_outbox.execution import KnowledgeTaskExecutionLease
from tasks import reconcile_segment_index_task as task_module


@dataclass
class MutationProbe:
    fail_reconcile: bool = False
    fail_transitioned: bool = True
    outcome: SegmentIndexReconcileOutcome = SegmentIndexReconcileOutcome.COMPLETED
    calls: list[tuple[SegmentRef, tuple[str, ...], SegmentChildIndexCompletion | None]] = field(default_factory=list)
    failed: list[tuple[SegmentRef, SegmentChildIndexCompletion, str]] = field(default_factory=list)
    repairs: list[tuple[SegmentRef, tuple[str, ...], SegmentChildIndexCompletion | None]] = field(default_factory=list)

    def reconcile_children_index(
        self,
        segment_ref: SegmentRef,
        *,
        delete_node_ids: Sequence[str],
        completion: SegmentChildIndexCompletion | None,
        assert_owned: Callable[[], None],
    ) -> SegmentIndexReconcileOutcome:
        assert_owned()
        self.calls.append((segment_ref, tuple(delete_node_ids), completion))
        if self.fail_reconcile:
            raise RuntimeError("child vector unavailable")
        return self.outcome if completion is not None else SegmentIndexReconcileOutcome.COMPLETED

    def fail_child_reconcile(
        self,
        segment_ref: SegmentRef,
        *,
        completion: SegmentChildIndexCompletion,
        error: str,
    ) -> bool:
        self.failed.append((segment_ref, completion, error))
        return self.fail_transitioned

    def enqueue_child_reconcile_repair(
        self,
        segment_ref: SegmentRef,
        *,
        delete_node_ids: Sequence[str],
        completion: SegmentChildIndexCompletion | None,
    ) -> bool:
        self.repairs.append((segment_ref, tuple(delete_node_ids), completion))
        return True


def _recovered_execution() -> KnowledgeTaskExecutionLease:
    return KnowledgeTaskExecutionLease(
        intent_id=None,
        execution_id=None,
        store=None,
        clock=datetime.now,
        lease_seconds=300,
        assert_admitted=None,
        recovered_execution=True,
    )


@dataclass
class RedisStatusRecorder:
    current: str | None = "waiting"
    values: list[tuple[str, int, str]] = field(default_factory=list)

    def register_script(self, _script: str) -> Callable[..., int]:
        def execute(*, keys: list[str], args: list[object]) -> int:
            if self.current != "waiting":
                return 0
            status = str(args[0])
            ttl_value = args[1]
            assert isinstance(ttl_value, (int, str))
            ttl = int(ttl_value)
            self.current = status
            self.values.append((keys[0], ttl, status))
            return 1

        return execute


def test_reconcile_task_uses_durable_execution_boundary(monkeypatch: pytest.MonkeyPatch) -> None:
    mutations = MutationProbe()
    execution_ids: list[str] = []

    @contextmanager
    def execution(outbox_id: str) -> Generator[KnowledgeTaskExecutionLease]:
        execution_ids.append(outbox_id)
        yield KnowledgeTaskExecutionLease.untracked()

    monkeypatch.setattr(task_module, "_segment_mutations", lambda: mutations)
    monkeypatch.setattr(task_module, "knowledge_task_execution", execution)

    task_module.reconcile_segment_index_task.run(
        "tenant-1",
        "dataset-1",
        "document-1",
        "segment-1",
        ["old-node-1", "old-node-2"],
        "outbox-1",
    )

    assert execution_ids == ["outbox-1"]
    assert len(mutations.calls) == 1
    segment_ref, delete_node_ids, completion = mutations.calls[0]
    assert segment_ref.document.dataset.tenant_id == "tenant-1"
    assert segment_ref.document.dataset.dataset_id == "dataset-1"
    assert segment_ref.document.document_id == "document-1"
    assert segment_ref.segment_id == "segment-1"
    assert delete_node_ids == ("old-node-1", "old-node-2")
    assert completion is None


def test_recovered_child_reconcile_persists_successor_before_exit(monkeypatch: pytest.MonkeyPatch) -> None:
    mutations = MutationProbe()

    @contextmanager
    def execution(_outbox_id: str) -> Generator[KnowledgeTaskExecutionLease]:
        yield _recovered_execution()

    monkeypatch.setattr(task_module, "_segment_mutations", lambda: mutations)
    monkeypatch.setattr(task_module, "knowledge_task_execution", execution)

    task_module.reconcile_segment_index_task.run(
        "tenant-1",
        "dataset-1",
        "document-1",
        "segment-1",
        ["stale-node"],
        "outbox-1",
        "stale-generation",
        ["segment-1"],
        "job-1",
    )

    assert mutations.calls == []
    assert len(mutations.repairs) == 1
    segment_ref, delete_node_ids, completion = mutations.repairs[0]
    assert segment_ref.segment_id == "segment-1"
    assert delete_node_ids == ("stale-node",)
    assert completion == SegmentChildIndexCompletion("stale-generation", ("segment-1",), "job-1")


def test_child_reconcile_completes_parent_generation_and_batch(monkeypatch: pytest.MonkeyPatch) -> None:
    mutations = MutationProbe()
    redis = RedisStatusRecorder()

    @contextmanager
    def execution(_outbox_id: str) -> Generator[KnowledgeTaskExecutionLease]:
        yield KnowledgeTaskExecutionLease.untracked()

    monkeypatch.setattr(task_module, "_segment_mutations", lambda: mutations)
    monkeypatch.setattr(task_module, "knowledge_task_execution", execution)
    monkeypatch.setattr(task_module, "redis_client", redis)

    task_module.reconcile_segment_index_task.run(
        "tenant-1",
        "dataset-1",
        "document-1",
        "segment-1",
        ["old-node"],
        "outbox-1",
        "generation-1",
        ["segment-1", "segment-2"],
        "job-1",
        False,
    )

    completion = mutations.calls[0][2]
    assert completion == SegmentChildIndexCompletion(
        "generation-1",
        ("segment-1", "segment-2"),
        "job-1",
        expected_enabled=False,
    )
    assert mutations.failed == []
    assert redis.values == [("segment_batch_import_job-1", 600, "completed")]


def test_child_reconcile_exhaustion_fails_parent_generation_and_batch(monkeypatch: pytest.MonkeyPatch) -> None:
    mutations = MutationProbe(fail_reconcile=True)
    redis = RedisStatusRecorder()

    @contextmanager
    def exhausted(_outbox_id: str) -> Generator[KnowledgeTaskExecutionLease]:
        try:
            yield KnowledgeTaskExecutionLease.untracked()
        except RuntimeError as error:
            raise KnowledgeTaskRetriesExhaustedError("retry budget exhausted") from error

    monkeypatch.setattr(task_module, "_segment_mutations", lambda: mutations)
    monkeypatch.setattr(task_module, "knowledge_task_execution", exhausted)
    monkeypatch.setattr(task_module, "redis_client", redis)

    with pytest.raises(KnowledgeTaskRetriesExhaustedError):
        task_module.reconcile_segment_index_task.run(
            "tenant-1",
            "dataset-1",
            "document-1",
            "segment-1",
            [],
            "outbox-1",
            "generation-1",
            ["segment-1"],
            "job-1",
        )

    assert len(mutations.failed) == 1
    _, completion, error = mutations.failed[0]
    assert completion.generation == "generation-1"
    assert error == "child vector unavailable"
    assert redis.values == [("segment_batch_import_job-1", 600, "error")]


def test_child_reconcile_exhaustion_does_not_overwrite_completed_batch(monkeypatch: pytest.MonkeyPatch) -> None:
    mutations = MutationProbe(fail_reconcile=True, fail_transitioned=False)
    redis = RedisStatusRecorder(current="completed")

    @contextmanager
    def exhausted(_outbox_id: str) -> Generator[KnowledgeTaskExecutionLease]:
        try:
            yield KnowledgeTaskExecutionLease.untracked()
        except RuntimeError as error:
            raise KnowledgeTaskRetriesExhaustedError("retry budget exhausted") from error

    monkeypatch.setattr(task_module, "_segment_mutations", lambda: mutations)
    monkeypatch.setattr(task_module, "knowledge_task_execution", exhausted)
    monkeypatch.setattr(task_module, "redis_client", redis)

    with pytest.raises(KnowledgeTaskRetriesExhaustedError):
        task_module.reconcile_segment_index_task.run(
            "tenant-1",
            "dataset-1",
            "document-1",
            "segment-1",
            [],
            "outbox-1",
            "generation-1",
            ["segment-1"],
            "job-1",
        )

    assert len(mutations.failed) == 1
    assert redis.values == []


def test_deleted_or_stale_child_parent_cancels_batch_with_ttl(monkeypatch: pytest.MonkeyPatch) -> None:
    mutations = MutationProbe(outcome=SegmentIndexReconcileOutcome.CANCELLED)
    redis = RedisStatusRecorder()

    @contextmanager
    def execution(_outbox_id: str) -> Generator[KnowledgeTaskExecutionLease]:
        yield KnowledgeTaskExecutionLease.untracked()

    monkeypatch.setattr(task_module, "_segment_mutations", lambda: mutations)
    monkeypatch.setattr(task_module, "knowledge_task_execution", execution)
    monkeypatch.setattr(task_module, "redis_client", redis)

    task_module.reconcile_segment_index_task.run(
        "tenant-1",
        "dataset-1",
        "document-1",
        "segment-1",
        [],
        "outbox-1",
        "generation-1",
        ["segment-1"],
        "job-1",
    )

    assert redis.values == [("segment_batch_import_job-1", 600, "error")]
