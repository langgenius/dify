from collections.abc import Callable, Generator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime

import pytest

from services.knowledge.resource_scope import DocumentRef
from services.knowledge.segments.contracts import SegmentIndexReconcileOutcome
from services.knowledge.task_outbox.contracts import KnowledgeTaskRetriesExhaustedError
from services.knowledge.task_outbox.execution import KnowledgeTaskExecutionLease
from tasks import index_created_segments_task as task_module


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


@dataclass
class MutationProbe:
    fail_reconcile: bool = False
    reconcile_outcome: SegmentIndexReconcileOutcome = SegmentIndexReconcileOutcome.COMPLETED
    fail_transitioned: bool = True
    reconciled: list[tuple[DocumentRef, tuple[str, ...], str]] = field(default_factory=list)
    failed: list[tuple[DocumentRef, tuple[str, ...], str, str]] = field(default_factory=list)
    repairs: list[tuple[DocumentRef, tuple[str, ...], str | None]] = field(default_factory=list)

    def reconcile_created_segments(
        self,
        document_ref: DocumentRef,
        *,
        segment_ids: Sequence[str],
        generation: str,
        job_id: str | None,
        assert_owned: Callable[[], None],
    ) -> SegmentIndexReconcileOutcome:
        assert job_id == "job-1"
        assert_owned()
        self.reconciled.append((document_ref, tuple(segment_ids), generation))
        if self.fail_reconcile:
            raise RuntimeError("vector provider unavailable")
        return self.reconcile_outcome

    def fail_created_segments(
        self,
        document_ref: DocumentRef,
        *,
        segment_ids: Sequence[str],
        generation: str,
        error: str,
    ) -> bool:
        self.failed.append((document_ref, tuple(segment_ids), generation, error))
        return self.fail_transitioned

    def enqueue_created_segments_repair(
        self,
        document_ref: DocumentRef,
        *,
        segment_ids: Sequence[str],
        batch_job_id: str | None,
    ) -> bool:
        self.repairs.append((document_ref, tuple(segment_ids), batch_job_id))
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


def test_created_segment_worker_owns_batch_completion(monkeypatch: pytest.MonkeyPatch) -> None:
    mutations = MutationProbe()
    redis = RedisStatusRecorder()
    execution_ids: list[str] = []

    @contextmanager
    def execution(outbox_id: str) -> Generator[KnowledgeTaskExecutionLease]:
        execution_ids.append(outbox_id)
        yield KnowledgeTaskExecutionLease.untracked()

    monkeypatch.setattr(task_module, "_segment_mutations", lambda: mutations)
    monkeypatch.setattr(task_module, "knowledge_task_execution", execution)
    monkeypatch.setattr(task_module, "redis_client", redis)

    task_module.index_created_segments_task.run(
        "tenant-1",
        "dataset-1",
        "document-1",
        ["segment-1", "segment-2"],
        "generation-1",
        "job-1",
        "outbox-1",
    )

    assert execution_ids == ["outbox-1"]
    assert len(mutations.reconciled) == 1
    document_ref, segment_ids, generation = mutations.reconciled[0]
    assert document_ref.dataset.tenant_id == "tenant-1"
    assert document_ref.dataset.dataset_id == "dataset-1"
    assert document_ref.document_id == "document-1"
    assert segment_ids == ("segment-1", "segment-2")
    assert generation == "generation-1"
    assert mutations.failed == []
    assert redis.values == [("segment_batch_import_job-1", 600, "completed")]


def test_recovered_created_segment_execution_persists_successor_before_exit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mutations = MutationProbe()

    @contextmanager
    def execution(_outbox_id: str) -> Generator[KnowledgeTaskExecutionLease]:
        yield _recovered_execution()

    monkeypatch.setattr(task_module, "_segment_mutations", lambda: mutations)
    monkeypatch.setattr(task_module, "knowledge_task_execution", execution)

    task_module.index_created_segments_task.run(
        "tenant-1",
        "dataset-1",
        "document-1",
        ["segment-1"],
        "stale-generation",
        "job-1",
        "outbox-1",
    )

    assert mutations.reconciled == []
    assert len(mutations.repairs) == 1
    document_ref, segment_ids, job_id = mutations.repairs[0]
    assert document_ref.dataset.tenant_id == "tenant-1"
    assert document_ref.dataset.dataset_id == "dataset-1"
    assert document_ref.document_id == "document-1"
    assert segment_ids == ("segment-1",)
    assert job_id == "job-1"


def test_retry_exhaustion_marks_only_the_intent_generation_terminal(monkeypatch: pytest.MonkeyPatch) -> None:
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
        task_module.index_created_segments_task.run(
            "tenant-1",
            "dataset-1",
            "document-1",
            ["segment-1"],
            "generation-1",
            "job-1",
            "outbox-1",
        )

    assert len(mutations.failed) == 1
    document_ref, segment_ids, generation, error = mutations.failed[0]
    assert document_ref.document_id == "document-1"
    assert segment_ids == ("segment-1",)
    assert generation == "generation-1"
    assert error == "vector provider unavailable"
    assert redis.values == [("segment_batch_import_job-1", 600, "error")]


def test_hierarchical_batch_stays_waiting_for_child_reconcile(monkeypatch: pytest.MonkeyPatch) -> None:
    mutations = MutationProbe(reconcile_outcome=SegmentIndexReconcileOutcome.WAITING)
    redis = RedisStatusRecorder()

    @contextmanager
    def execution(_outbox_id: str) -> Generator[KnowledgeTaskExecutionLease]:
        yield KnowledgeTaskExecutionLease.untracked()

    monkeypatch.setattr(task_module, "_segment_mutations", lambda: mutations)
    monkeypatch.setattr(task_module, "knowledge_task_execution", execution)
    monkeypatch.setattr(task_module, "redis_client", redis)

    task_module.index_created_segments_task.run(
        "tenant-1",
        "dataset-1",
        "document-1",
        ["segment-1"],
        "generation-1",
        "job-1",
        "outbox-1",
    )

    assert len(mutations.reconciled) == 1
    assert redis.values == []


def test_deleted_or_stale_batch_is_cancelled_with_a_terminal_ttl(monkeypatch: pytest.MonkeyPatch) -> None:
    mutations = MutationProbe(reconcile_outcome=SegmentIndexReconcileOutcome.CANCELLED)
    redis = RedisStatusRecorder()

    @contextmanager
    def execution(_outbox_id: str) -> Generator[KnowledgeTaskExecutionLease]:
        yield KnowledgeTaskExecutionLease.untracked()

    monkeypatch.setattr(task_module, "_segment_mutations", lambda: mutations)
    monkeypatch.setattr(task_module, "knowledge_task_execution", execution)
    monkeypatch.setattr(task_module, "redis_client", redis)

    task_module.index_created_segments_task.run(
        "tenant-1",
        "dataset-1",
        "document-1",
        ["segment-1"],
        "generation-1",
        "job-1",
        "outbox-1",
    )

    assert redis.values == [("segment_batch_import_job-1", 600, "error")]


def test_retry_exhaustion_does_not_overwrite_an_already_completed_batch(monkeypatch: pytest.MonkeyPatch) -> None:
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
        task_module.index_created_segments_task.run(
            "tenant-1",
            "dataset-1",
            "document-1",
            ["segment-1"],
            "generation-1",
            "job-1",
            "outbox-1",
        )

    assert len(mutations.failed) == 1
    assert redis.values == []


def test_stale_cancelled_delivery_does_not_recreate_expired_batch_status(monkeypatch: pytest.MonkeyPatch) -> None:
    mutations = MutationProbe(reconcile_outcome=SegmentIndexReconcileOutcome.CANCELLED)
    redis = RedisStatusRecorder(current=None)

    @contextmanager
    def execution(_outbox_id: str) -> Generator[KnowledgeTaskExecutionLease]:
        yield KnowledgeTaskExecutionLease.untracked()

    monkeypatch.setattr(task_module, "_segment_mutations", lambda: mutations)
    monkeypatch.setattr(task_module, "knowledge_task_execution", execution)
    monkeypatch.setattr(task_module, "redis_client", redis)

    task_module.index_created_segments_task.run(
        "tenant-1",
        "dataset-1",
        "document-1",
        ["segment-1"],
        "generation-1",
        "job-1",
        "outbox-1",
    )

    assert redis.current is None
    assert redis.values == []
