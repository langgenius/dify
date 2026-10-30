"""Late document-status task reconciliation against current desired state."""

from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from types import ModuleType
from typing import Protocol
from unittest.mock import patch
from uuid import uuid4

import pytest
from celery.exceptions import Retry
from redis.exceptions import RedisError
from sqlalchemy.orm import Session, sessionmaker

from core.db import session_factory as session_factory_module
from core.rag.index_processor.constant.index_type import IndexStructureType
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus
from services.knowledge.indexing.locks import KnowledgeIndexingLeaseLostError, document_index_lock_name
from services.knowledge.summaries.adapters import SummaryIndexAdapter
from tasks import add_document_to_index_task as add_task_module
from tasks import remove_document_from_index_task as remove_task_module

pytestmark = pytest.mark.parametrize(
    "sqlite_session",
    [(Dataset, Document, DocumentSegment)],
    indirect=True,
)


class StatusTask(Protocol):
    autoretry_for: tuple[type[BaseException], ...]

    def run(self, document_id: str) -> object: ...


@dataclass
class RecordingLease:
    ownership_checks: int = 0

    def assert_owned(self) -> None:
        self.ownership_checks += 1


@dataclass
class RecordingLocks:
    names: list[str] = field(default_factory=list)
    lease: RecordingLease = field(default_factory=RecordingLease)

    @contextmanager
    def hold(
        self,
        name: str,
        *,
        timeout: int,
        expected_token: str | None = None,
        blocking_timeout: float = 0,
    ) -> Generator[RecordingLease]:
        assert timeout == 600
        assert expected_token is None
        assert blocking_timeout == 5
        self.names.append(name)
        yield self.lease
        self.lease.assert_owned()


class RedisAcquireFailureLocks:
    @contextmanager
    def hold(
        self,
        _name: str,
        *,
        timeout: int,
        expected_token: str | None = None,
        blocking_timeout: float = 0,
    ) -> Generator[RecordingLease]:
        del timeout, expected_token, blocking_timeout
        raise RedisError("redis unavailable")
        yield RecordingLease()


@dataclass
class RecordingRedis:
    deleted: list[str] = field(default_factory=list)

    def delete(self, name: str) -> None:
        self.deleted.append(name)


class DeleteFailureRedis:
    def delete(self, _name: str) -> None:
        raise RedisError("redis unavailable")


def _persist_document(
    session: Session,
    *,
    enabled: bool,
    archived: bool,
    segment_enabled: bool,
) -> tuple[Document, DocumentSegment]:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    dataset = Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name="Dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique="economy",
        created_by=str(uuid4()),
    )
    document = Document(
        id=str(uuid4()),
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch=str(uuid4()),
        name="Document",
        created_from=DocumentCreatedFrom.WEB,
        created_by=str(uuid4()),
        indexing_status=IndexingStatus.COMPLETED,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
        enabled=enabled,
        archived=archived,
    )
    session.add_all([dataset, document])
    segment = DocumentSegment(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document.id,
        position=1,
        content="content",
        answer=None,
        word_count=1,
        tokens=1,
        keywords=None,
        index_node_id="node-1",
        index_node_hash="hash-1",
        hit_count=0,
        enabled=segment_enabled,
        status=SegmentStatus.COMPLETED,
        created_by=document.created_by,
    )
    session.add(segment)
    session.commit()
    return document, segment


@pytest.fixture(autouse=True)
def bind_session_factory(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    monkeypatch.setattr(
        session_factory_module,
        "_session_maker",
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
    )


def test_late_add_task_skips_document_rolled_back_to_disabled(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    document, segment = _persist_document(
        sqlite_session,
        enabled=False,
        archived=False,
        segment_enabled=False,
    )
    locks = RecordingLocks()
    redis = RecordingRedis()
    monkeypatch.setattr(add_task_module, "RedisKnowledgeIndexingLock", lambda **_kwargs: locks)
    monkeypatch.setattr(add_task_module, "redis_client", redis)

    class UnexpectedProcessorFactory:
        def __init__(self, *_args: object, **_kwargs: object) -> None:
            raise AssertionError("a stale add task must not publish vectors")

    monkeypatch.setattr(add_task_module, "IndexProcessorFactory", UnexpectedProcessorFactory)
    monkeypatch.setattr(
        SummaryIndexAdapter,
        "enable_summaries_for_segments",
        lambda **_kwargs: pytest.fail("a stale add task must not enable summaries"),
    )
    add_task_module.add_document_to_index_task(document.id)

    assert locks.names == [document_index_lock_name(document.id)]
    assert redis.deleted == [f"document_{document.id}_indexing"]
    sqlite_session.expire_all()
    assert sqlite_session.get_one(DocumentSegment, segment.id).enabled is False


def test_late_remove_task_preserves_disabled_segment_on_active_document(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    document, segment = _persist_document(
        sqlite_session,
        enabled=True,
        archived=False,
        segment_enabled=False,
    )
    locks = RecordingLocks()
    redis = RecordingRedis()
    monkeypatch.setattr(remove_task_module, "RedisKnowledgeIndexingLock", lambda **_kwargs: locks)
    monkeypatch.setattr(remove_task_module, "redis_client", redis)

    class UnexpectedProcessorFactory:
        def __init__(self, *_args: object, **_kwargs: object) -> None:
            raise AssertionError("a stale remove task must not delete vectors")

    monkeypatch.setattr(remove_task_module, "IndexProcessorFactory", UnexpectedProcessorFactory)
    monkeypatch.setattr(
        SummaryIndexAdapter,
        "disable_summaries_for_segments",
        lambda **_kwargs: pytest.fail("a stale remove task must not disable summaries"),
    )
    remove_task_module.remove_document_from_index_task(document.id)

    assert locks.names == [document_index_lock_name(document.id)]
    assert redis.deleted == [f"document_{document.id}_indexing"]
    sqlite_session.expire_all()
    assert sqlite_session.get_one(DocumentSegment, segment.id).enabled is False


@pytest.mark.parametrize(
    ("module", "task"),
    [
        (add_task_module, add_task_module.add_document_to_index_task),
        (remove_task_module, remove_task_module.remove_document_from_index_task),
    ],
)
def test_status_worker_retries_redis_acquire_failure(
    monkeypatch: pytest.MonkeyPatch,
    module: ModuleType,
    task: StatusTask,
) -> None:
    monkeypatch.setattr(module, "RedisKnowledgeIndexingLock", lambda **_kwargs: RedisAcquireFailureLocks())
    with patch.object(task, "retry", side_effect=Retry()) as retry:
        with pytest.raises(Retry):
            task.run("document-1")

    retry.assert_called_once()
    assert isinstance(retry.call_args.kwargs["exc"], RedisError)
    assert KnowledgeIndexingLeaseLostError in task.autoretry_for


def test_status_worker_cache_clear_failure_does_not_retry_completed_work(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    document, _segment = _persist_document(
        sqlite_session,
        enabled=False,
        archived=False,
        segment_enabled=False,
    )
    locks = RecordingLocks()
    monkeypatch.setattr(add_task_module, "RedisKnowledgeIndexingLock", lambda **_kwargs: locks)
    monkeypatch.setattr(add_task_module, "redis_client", DeleteFailureRedis())

    add_task_module.add_document_to_index_task(document.id)

    assert locks.names == [document_index_lock_name(document.id)]
