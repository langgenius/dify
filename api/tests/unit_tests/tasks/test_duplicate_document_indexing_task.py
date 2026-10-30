"""Duplicate-indexing task tests for the established tenant queue contract."""

from __future__ import annotations

from collections.abc import Callable, Generator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import override
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

import tasks.duplicate_document_indexing_task as task_module
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from enums import DeploymentEdition
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from services.knowledge.entities.resource_scope import DatasetRef, DocumentRef
from services.knowledge.indexing.locks import (
    KnowledgeIndexingLease,
    KnowledgeIndexingLeaseLostError,
    document_index_lock_name,
)
from tasks.duplicate_document_indexing_task import (
    _duplicate_document_indexing_task,
    _duplicate_document_indexing_task_with_tenant_queue,
    duplicate_document_indexing_task,
    normal_duplicate_document_indexing_task,
    priority_duplicate_document_indexing_task,
)
from tests.unit_tests.config_override import apply_config_overrides


@dataclass
class _DuplicateQueueStub:
    pending: list[dict[str, object]]
    pull_counts: list[int] = field(default_factory=list)
    waiting_marks: int = 0
    deleted: bool = False

    def pull_tasks(self, *, count: int) -> list[dict[str, object]]:
        self.pull_counts.append(count)
        return self.pending

    def set_task_waiting_time(self) -> None:
        self.waiting_marks += 1

    def delete_task_key(self) -> None:
        self.deleted = True


@dataclass
class _DuplicateQueueFactory:
    queue: _DuplicateQueueStub
    calls: list[tuple[str, str]] = field(default_factory=list)

    def __call__(self, tenant_id: str, queue_name: str) -> _DuplicateQueueStub:
        self.calls.append((tenant_id, queue_name))
        return self.queue


@dataclass
class _DelayedTaskStub:
    calls: list[dict[str, object]] = field(default_factory=list)

    def __call__(self, tenant_id: str, dataset_id: str, document_ids: Sequence[str]) -> None:
        del tenant_id, dataset_id, document_ids
        raise AssertionError("queue handoff must use delay instead of calling the task directly")

    def delay(self, **kwargs: object) -> None:
        self.calls.append(kwargs)


@dataclass
class _IndexingServiceStub:
    calls: list[list[DocumentRef]] = field(default_factory=list)
    lease_keys: list[set[str]] = field(default_factory=list)
    on_run: Callable[[], None] | None = None

    def run(
        self,
        refs: Sequence[DocumentRef],
        *,
        owned_leases: Mapping[str, KnowledgeIndexingLease] | None = None,
    ) -> None:
        if self.on_run is not None:
            self.on_run()
        self.calls.append(list(refs))
        self.lease_keys.append(set(owned_leases or ()))


class _OwnedLease:
    token = "test-owner"

    @staticmethod
    def assert_owned() -> None:
        return None

    @staticmethod
    def renew() -> bool:
        return True

    @staticmethod
    def release() -> bool:
        return True


class _LostAfterCleanupLease(_OwnedLease):
    def __init__(self) -> None:
        self._checks = 0

    @override
    def assert_owned(self) -> None:
        self._checks += 1
        if self._checks == 2:
            raise KnowledgeIndexingLeaseLostError("ownership changed after cleanup")


class _IndexingLockStub:
    def __init__(self) -> None:
        self.calls: list[tuple[str, int, float]] = []
        self.active_names: set[str] = set()

    @contextmanager
    def hold(
        self,
        name: str,
        *,
        timeout: int,
        blocking_timeout: float,
    ) -> Generator[_OwnedLease]:
        self.calls.append((name, timeout, blocking_timeout))
        self.active_names.add(name)
        try:
            yield _OwnedLease()
        finally:
            self.active_names.remove(name)


@dataclass
class _IndexProcessorStub:
    clean_calls: int = 0
    on_clean: Callable[[], None] | None = None

    def clean(self, *_args: object, **_kwargs: object) -> None:
        self.clean_calls += 1
        if self.on_clean is not None:
            self.on_clean()


@dataclass
class _IndexProcessorFactoryStub:
    processor: _IndexProcessorStub

    def init_index_processor(self) -> _IndexProcessorStub:
        return self.processor


@pytest.fixture
def tenant_id() -> str:
    return str(uuid4())


@pytest.fixture
def dataset_id() -> str:
    return str(uuid4())


@pytest.fixture
def document_ids() -> list[str]:
    return [str(uuid4()), str(uuid4())]


@pytest.fixture(autouse=True)
def indexing_locks(monkeypatch: pytest.MonkeyPatch) -> _IndexingLockStub:
    locks = _IndexingLockStub()
    monkeypatch.setattr(task_module, "RedisKnowledgeIndexingLock", lambda **_kwargs: locks)
    return locks


def _persist_rows(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    document_ids: list[str],
) -> None:
    creator_id = str(uuid4())
    session.add(
        Dataset(
            id=dataset_id,
            tenant_id=tenant_id,
            name="Duplicate dataset",
            data_source_type=DataSourceType.UPLOAD_FILE,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            embedding_model_provider="openai",
            embedding_model="text-embedding-3-small",
            created_by=creator_id,
        )
    )
    session.add_all(
        Document(
            id=document_id,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            position=position,
            data_source_type=DataSourceType.UPLOAD_FILE,
            batch="batch-1",
            name=f"document-{position}.txt",
            created_from=DocumentCreatedFrom.WEB,
            created_by=creator_id,
            indexing_status=IndexingStatus.WAITING,
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
        )
        for position, document_id in enumerate(document_ids, start=1)
    )
    session.commit()


def _assert_active_locks(locks: _IndexingLockStub, expected_names: set[str]) -> None:
    assert locks.active_names == expected_names


def test_legacy_entrypoint_executes_duplicate_core(
    monkeypatch: pytest.MonkeyPatch,
    dataset_id: str,
    document_ids: list[str],
) -> None:
    calls: list[tuple[str, list[str]]] = []

    def execute(actual_dataset_id: str, actual_document_ids: Sequence[str]) -> None:
        calls.append((actual_dataset_id, list(actual_document_ids)))

    monkeypatch.setattr("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task", execute)

    duplicate_document_indexing_task.run(dataset_id, document_ids)

    assert calls == [(dataset_id, document_ids)]


def test_queue_wrapper_runs_current_work_and_dispatches_waiting_work(
    monkeypatch: pytest.MonkeyPatch,
    tenant_id: str,
    dataset_id: str,
    document_ids: list[str],
) -> None:
    execute_calls: list[tuple[str, list[str]]] = []

    def execute(actual_dataset_id: str, actual_document_ids: Sequence[str]) -> None:
        execute_calls.append((actual_dataset_id, list(actual_document_ids)))

    task = _DelayedTaskStub()
    next_document_ids = [str(uuid4())]
    queue = _DuplicateQueueStub(
        pending=[
            {
                "tenant_id": tenant_id,
                "dataset_id": dataset_id,
                "document_ids": next_document_ids,
            }
        ]
    )
    queue_factory = _DuplicateQueueFactory(queue)
    monkeypatch.setattr("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task", execute)
    monkeypatch.setattr("tasks.duplicate_document_indexing_task.TenantIsolatedTaskQueue", queue_factory)

    _duplicate_document_indexing_task_with_tenant_queue(
        tenant_id,
        dataset_id,
        document_ids,
        task,
    )

    assert execute_calls == [(dataset_id, document_ids)]
    assert queue_factory.calls == [(tenant_id, "duplicate_document_indexing")]
    assert len(queue.pull_counts) == 1
    assert queue.waiting_marks == 1
    assert task.calls == [{"tenant_id": tenant_id, "dataset_id": dataset_id, "document_ids": next_document_ids}]


@pytest.mark.parametrize("task", [normal_duplicate_document_indexing_task, priority_duplicate_document_indexing_task])
def test_celery_entrypoints_use_established_three_argument_message(
    monkeypatch: pytest.MonkeyPatch,
    tenant_id: str,
    dataset_id: str,
    document_ids: list[str],
    task: object,
) -> None:
    calls: list[tuple[str, str, list[str], object]] = []

    def delegate(
        actual_tenant_id: str, actual_dataset_id: str, actual_document_ids: Sequence[str], actual_task: object
    ) -> None:
        calls.append((actual_tenant_id, actual_dataset_id, list(actual_document_ids), actual_task))

    monkeypatch.setattr(
        "tasks.duplicate_document_indexing_task._duplicate_document_indexing_task_with_tenant_queue",
        delegate,
    )

    task.run(tenant_id, dataset_id, document_ids)  # type: ignore[attr-defined]

    assert calls == [(tenant_id, dataset_id, document_ids, task)]


def test_missing_dataset_returns_before_index_processor_lookup(
    monkeypatch: pytest.MonkeyPatch,
    dataset_id: str,
    document_ids: list[str],
) -> None:
    def unexpected_processor(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("index processor must not be constructed for a missing dataset")

    def unexpected_runner(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("indexing service must not be constructed for a missing dataset")

    monkeypatch.setattr("tasks.duplicate_document_indexing_task.IndexProcessorFactory", unexpected_processor)
    monkeypatch.setattr("tasks.duplicate_document_indexing_task.build_document_indexing_service", unexpected_runner)

    _duplicate_document_indexing_task(dataset_id, document_ids)


def test_duplicate_core_marks_documents_parsing_and_uses_owner_scoped_refs(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tenant_id: str,
    dataset_id: str,
    document_ids: list[str],
    indexing_locks: _IndexingLockStub,
) -> None:
    _persist_rows(
        sqlite_session,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_ids=document_ids[:1],
    )
    document = sqlite_session.get_one(Document, document_ids[0])
    sqlite_session.add(
        DocumentSegment(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=document.id,
            position=1,
            content="old segment",
            word_count=2,
            tokens=2,
            created_by=document.created_by,
            index_node_id="old-node",
        )
    )
    sqlite_session.commit()
    expected_lock_names = {document_index_lock_name(document_id) for document_id in document_ids}
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    processor = _IndexProcessorStub(on_clean=lambda: _assert_active_locks(indexing_locks, expected_lock_names))
    monkeypatch.setattr(
        "tasks.duplicate_document_indexing_task.IndexProcessorFactory",
        lambda _index_type: _IndexProcessorFactoryStub(processor),
    )
    runner = _IndexingServiceStub(on_run=lambda: _assert_active_locks(indexing_locks, expected_lock_names))
    monkeypatch.setattr(
        "tasks.duplicate_document_indexing_task.build_document_indexing_service",
        lambda **_kwargs: runner,
    )

    _duplicate_document_indexing_task(dataset_id, document_ids)

    assert runner.calls == [[DatasetRef(tenant_id, dataset_id).document(document_ids[0])]]
    assert runner.lease_keys == [{document_ids[0]}]
    assert processor.clean_calls == 1
    assert [name for name, _timeout, _blocking_timeout in indexing_locks.calls] == sorted(expected_lock_names)
    assert indexing_locks.active_names == set()
    sqlite_session.expire_all()
    document = sqlite_session.get(Document, document_ids[0])
    assert document is not None
    assert document.indexing_status == IndexingStatus.PARSING
    assert document.processing_started_at is not None


def test_duplicate_lease_loss_after_cleanup_preserves_retryable_state(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tenant_id: str,
    dataset_id: str,
    document_ids: list[str],
) -> None:
    document_id = document_ids[0]
    _persist_rows(
        sqlite_session,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_ids=[document_id],
    )
    document = sqlite_session.get_one(Document, document_id)
    sqlite_session.add(
        DocumentSegment(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=document.id,
            position=1,
            content="old segment",
            word_count=2,
            tokens=2,
            created_by=document.created_by,
            index_node_id="old-node",
        )
    )
    sqlite_session.commit()
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    processor = _IndexProcessorStub()
    monkeypatch.setattr(
        task_module,
        "IndexProcessorFactory",
        lambda _index_type: _IndexProcessorFactoryStub(processor),
    )
    runner = _IndexingServiceStub()
    monkeypatch.setattr(task_module, "build_document_indexing_service", lambda **_kwargs: runner)

    with pytest.raises(KnowledgeIndexingLeaseLostError):
        task_module._run_duplicate_document_indexing_task(
            dataset_id,
            [document_id],
            leases={document_id: _LostAfterCleanupLease()},
        )

    assert processor.clean_calls == 1
    assert runner.calls == []
    sqlite_session.expire_all()
    persisted = sqlite_session.get_one(Document, document_id)
    assert persisted.indexing_status == IndexingStatus.WAITING
    assert persisted.error is None
    assert sqlite_session.scalars(select(DocumentSegment).where(DocumentSegment.document_id == document_id)).all()
