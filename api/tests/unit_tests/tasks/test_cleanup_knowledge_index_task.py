import threading
from collections.abc import Callable, Generator
from contextlib import contextmanager, nullcontext
from dataclasses import dataclass, field
from typing import cast

import pytest

import tasks.cleanup_knowledge_index_task as task_module
from services.knowledge.indexing.cleanup import DeletionIndexCleanup
from services.knowledge.indexing.locks import KnowledgeIndexingLeaseLostError, dataset_index_lock_name
from services.knowledge.resource_scope import DatasetRef
from tasks.cleanup_knowledge_index_task import cleanup_knowledge_index_task


@dataclass
class LeaseStub:
    ownership_checks: int = 0
    fail_on_check: int | None = None

    def assert_owned(self) -> None:
        self.ownership_checks += 1
        if self.ownership_checks == self.fail_on_check:
            raise KnowledgeIndexingLeaseLostError("dataset lease expired")


@dataclass
class RecordingIndexingLock:
    lease: LeaseStub = field(default_factory=LeaseStub)
    calls: list[tuple[str, int, float]] = field(default_factory=list)

    @contextmanager
    def hold(
        self,
        name: str,
        *,
        timeout: int,
        blocking_timeout: float = 0,
        expected_token: str | None = None,
    ) -> Generator[LeaseStub]:
        assert expected_token is None
        self.calls.append((name, timeout, blocking_timeout))
        yield self.lease
        self.lease.assert_owned()


@dataclass
class CoordinatedIndexingLock:
    lease: LeaseStub = field(default_factory=LeaseStub)
    mutex: threading.Lock = field(default_factory=threading.Lock)
    writer_attempted: threading.Event = field(default_factory=threading.Event)
    writer_entered: threading.Event = field(default_factory=threading.Event)
    events: list[str] = field(default_factory=list)

    @contextmanager
    def hold(
        self,
        name: str,
        *,
        timeout: int,
        blocking_timeout: float = 0,
        expected_token: str | None = None,
    ) -> Generator[LeaseStub]:
        del timeout, blocking_timeout, expected_token
        owner = threading.current_thread().name
        if owner == "vector-writer":
            self.writer_attempted.set()
        with self.mutex:
            if owner == "vector-writer":
                self.writer_entered.set()
            self.events.append(f"{owner}:acquired:{name}")
            yield self.lease
            self.lease.assert_owned()
        self.events.append(f"{owner}:released:{name}")


@dataclass
class CleanupRecorder:
    cleanups: list[DeletionIndexCleanup] = field(default_factory=list)

    def __call__(self, cleanup: DeletionIndexCleanup, **kwargs: object) -> None:
        assert callable(kwargs["new_session"])
        assert_owned = cast(Callable[[], None], kwargs["assert_owned"])
        assert_owned()
        self.cleanups.append(cleanup)


@dataclass
class RepairRepository:
    refs: list[DatasetRef] = field(default_factory=list)

    def enqueue_current_vector_repair(self, dataset_ref: DatasetRef) -> bool:
        self.refs.append(dataset_ref)
        return True


def _payload() -> dict[str, object]:
    return DeletionIndexCleanup(
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        indexing_technique="high_quality",
        index_struct='{"type":"pgvector"}',
        collection_binding_id=None,
        embedding_model_provider="provider",
        embedding_model="model",
        vector_type="pgvector",
        delete_all=True,
        refresh_billing=True,
    ).to_payload()


def test_worker_runs_detached_cleanup_and_refreshes_billing(monkeypatch: pytest.MonkeyPatch) -> None:
    execution_lease = LeaseStub()
    indexing_lock = RecordingIndexingLock()
    cleanup = CleanupRecorder()
    billing: list[str] = []
    monkeypatch.setattr(task_module, "knowledge_task_execution", lambda _outbox_id: nullcontext(execution_lease))
    monkeypatch.setattr(task_module, "_indexing_lock", lambda: indexing_lock)
    monkeypatch.setattr(task_module, "clean_deletion_index", cleanup)
    monkeypatch.setattr(task_module, "schedule_billing_vector_space_refresh", billing.append)

    cleanup_knowledge_index_task.run(_payload(), "intent-1")

    assert [item.dataset_id for item in cleanup.cleanups] == ["dataset-1"]
    assert indexing_lock.calls == [(dataset_index_lock_name("dataset-1"), 600, 600)]
    assert execution_lease.ownership_checks == 4
    assert indexing_lock.lease.ownership_checks == 4
    assert billing == ["tenant-1"]


def test_dataset_lock_serializes_recheck_and_delete_against_vector_writer(monkeypatch: pytest.MonkeyPatch) -> None:
    execution_lease = LeaseStub()
    indexing_lock = CoordinatedIndexingLock()
    writer_threads: list[threading.Thread] = []

    def cleanup(_cleanup: DeletionIndexCleanup, **kwargs: object) -> None:
        assert_owned = cast(Callable[[], None], kwargs["assert_owned"])
        indexing_lock.events.append("cleanup:recheck")

        def write_vector() -> None:
            with indexing_lock.hold(dataset_index_lock_name("dataset-1"), timeout=600):
                indexing_lock.events.append("writer:create-vector")

        writer = threading.Thread(target=write_vector, name="vector-writer")
        writer_threads.append(writer)
        writer.start()
        assert indexing_lock.writer_attempted.wait(timeout=1)
        assert not indexing_lock.writer_entered.is_set()
        assert_owned()
        indexing_lock.events.append("cleanup:delete-vector")

    monkeypatch.setattr(task_module, "knowledge_task_execution", lambda _outbox_id: nullcontext(execution_lease))
    monkeypatch.setattr(task_module, "_indexing_lock", lambda: indexing_lock)
    monkeypatch.setattr(task_module, "clean_deletion_index", cleanup)
    monkeypatch.setattr(task_module, "schedule_billing_vector_space_refresh", lambda _tenant_id: None)

    cleanup_knowledge_index_task.run(_payload(), "intent-1")
    for writer in writer_threads:
        writer.join(timeout=1)
        assert not writer.is_alive()

    assert indexing_lock.writer_entered.is_set()
    assert indexing_lock.events.index("cleanup:recheck") < indexing_lock.events.index("cleanup:delete-vector")
    assert indexing_lock.events.index("cleanup:delete-vector") < indexing_lock.events.index("writer:create-vector")


def test_lost_dataset_lease_after_delete_enqueues_repair_before_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    effects: list[str] = []
    repairs = RepairRepository()

    def cleanup(_cleanup: DeletionIndexCleanup, **kwargs: object) -> None:
        effects.append("recheck")
        cast(Callable[[], None], kwargs["assert_owned"])()
        effects.append("delete")

    monkeypatch.setattr(task_module, "knowledge_task_execution", lambda _outbox_id: nullcontext(LeaseStub()))
    monkeypatch.setattr(task_module, "clean_deletion_index", cleanup)
    monkeypatch.setattr(task_module, "_dataset_repository", lambda: repairs)
    monkeypatch.setattr(task_module, "schedule_billing_vector_space_refresh", lambda _tenant_id: None)
    lost_lock = RecordingIndexingLock(lease=LeaseStub(fail_on_check=3))
    monkeypatch.setattr(task_module, "_indexing_lock", lambda: lost_lock)

    with pytest.raises(KnowledgeIndexingLeaseLostError, match="dataset lease expired"):
        cleanup_knowledge_index_task.run(_payload(), "intent-1")

    assert effects == ["recheck", "delete"]
    assert repairs.refs == [DatasetRef("tenant-1", "dataset-1")]

    healthy_lock = RecordingIndexingLock()
    monkeypatch.setattr(task_module, "_indexing_lock", lambda: healthy_lock)
    cleanup_knowledge_index_task.run(_payload(), "intent-1")

    assert effects == ["recheck", "delete", "recheck", "delete"]
    assert repairs.refs == [DatasetRef("tenant-1", "dataset-1")]


def test_terminal_duplicate_skips_payload_parsing_and_side_effects(monkeypatch: pytest.MonkeyPatch) -> None:
    cleanup = CleanupRecorder()
    monkeypatch.setattr(task_module, "knowledge_task_execution", lambda _outbox_id: nullcontext(None))
    monkeypatch.setattr(task_module, "clean_deletion_index", cleanup)

    cleanup_knowledge_index_task.run({"invalid": "payload"}, "completed-intent")

    assert cleanup.cleanups == []


def test_worker_uses_durable_delivery_error_contract() -> None:
    assert cleanup_knowledge_index_task.acks_late is True
    assert cleanup_knowledge_index_task.reject_on_worker_lost is True
    assert cleanup_knowledge_index_task.max_retries == 5
