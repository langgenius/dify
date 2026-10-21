from collections.abc import Generator
from contextlib import contextmanager
from datetime import datetime, timedelta
from importlib import import_module
from typing import override
from uuid import uuid4

import pytest
from sqlalchemy import update
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from enums import DeploymentEdition
from models import Account, Tenant, TenantAccountJoin
from models.account import TenantAccountRole
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus
from models.knowledge_task import KnowledgeTaskOutbox
from repositories.knowledge.task_outbox_repository import SQLAlchemyKnowledgeTaskStore, enqueue_knowledge_task
from services.knowledge.indexing.errors import DocumentIndexingGenerationChangedError
from services.knowledge.indexing.locks import KnowledgeIndexingLeaseLostError, KnowledgeIndexingLockBusyError
from services.knowledge.task_outbox.contracts import KnowledgeTaskKind, KnowledgeTaskRequeuedError
from services.knowledge.task_outbox.execution import KnowledgeTaskExecutionLease, knowledge_task_execution
from tasks.retry_document_indexing_task import _retry_document
from tests.unit_tests.config_override import config_overrides_context

retry_task_module = import_module("tasks.retry_document_indexing_task")
GENERATION = "7c36309e-7ca9-46d1-ac11-799cb3d58603"


class LostLease:
    token = "expired-owner"

    def assert_owned(self) -> None:
        raise KnowledgeIndexingLeaseLostError("expired")

    def renew(self) -> bool:
        return False

    def release(self) -> bool:
        return False


class PassiveLease:
    token = "owner"

    def assert_owned(self) -> None:
        return None

    def renew(self) -> bool:
        return True

    def release(self) -> bool:
        return True


class NoOpIndexProcessor:
    def clean(self, *args: object, **kwargs: object) -> None:
        del args, kwargs


class NoOpIndexProcessorFactory:
    def __init__(self, index_type: object) -> None:
        del index_type

    def init_index_processor(self) -> NoOpIndexProcessor:
        return NoOpIndexProcessor()


class NoOpIndexingService:
    def run(self, document_refs: list[object], **_kwargs: object) -> None:
        assert len(document_refs) == 1


class LostLock:
    @contextmanager
    def hold(self, *args: object, **kwargs: object) -> Generator[PassiveLease]:
        del args, kwargs
        raise KnowledgeIndexingLeaseLostError("expired")
        yield PassiveLease()


class HealthyLock:
    @contextmanager
    def hold(self, *args: object, **kwargs: object) -> Generator[PassiveLease]:
        del args, kwargs
        yield PassiveLease()


class SessionFactoryFake:
    def __init__(self, factory: sessionmaker[Session]) -> None:
        self._factory = factory

    def create_session(self) -> Session:
        return self._factory()

    def get_session_maker(self) -> sessionmaker[Session]:
        return self._factory


class DatasetThenBusyDocumentLock:
    def __init__(self) -> None:
        self.calls: list[tuple[str, int, str | None, float]] = []

    @contextmanager
    def hold(
        self,
        name: str,
        *,
        timeout: int,
        expected_token: str | None = None,
        blocking_timeout: float = 0,
    ) -> Generator[PassiveLease]:
        self.calls.append((name, timeout, expected_token, blocking_timeout))
        if "document-retry" in name:
            raise KnowledgeIndexingLockBusyError("previous 600-second lease is still owned")
        yield PassiveLease()


def test_busy_document_lease_requeues_delivery_in_sqlite(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant = Tenant(name="Retry tenant")
    user = Account(name="Retry user", email=f"retry-{uuid4()}@example.com")
    membership = TenantAccountJoin(
        tenant_id=tenant.id,
        account_id=user.id,
        current=True,
        role=TenantAccountRole.OWNER,
    )
    dataset = Dataset(
        id=str(uuid4()),
        tenant_id=tenant.id,
        name="Retry dataset",
        created_by=user.id,
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.ECONOMY,
        chunk_structure=IndexStructureType.PARAGRAPH_INDEX,
    )
    document = Document(
        id=str(uuid4()),
        tenant_id=tenant.id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info="{}",
        batch="retry-batch",
        name="Retry document",
        created_from=DocumentCreatedFrom.WEB,
        created_by=user.id,
        indexing_status=IndexingStatus.WAITING,
        processing_started_at=datetime(2026, 10, 19, 12, 0),
        indexing_generation=GENERATION,
        enabled=True,
        archived=False,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    sqlite_session.add_all([tenant, user, membership, dataset, document])
    intent_id = enqueue_knowledge_task(
        sqlite_session,
        kind=KnowledgeTaskKind.DOCUMENT_INDEX_RETRY,
        tenant_id=tenant.id,
        dataset_id=dataset.id,
        document_id=document.id,
        payload={
            "dataset_id": dataset.id,
            "document_ids": [document.id],
            "actor_id": user.id,
            "lock_tokens": {document.id: "producer-token"},
            "generations": {document.id: GENERATION},
            "repair": False,
        },
    )
    intent = sqlite_session.get(KnowledgeTaskOutbox, intent_id)
    assert intent is not None
    intent.status = "dispatched"
    sqlite_session.commit()

    store = SQLAlchemyKnowledgeTaskStore(session_factory=sqlite_session_factory)
    lock = DatasetThenBusyDocumentLock()
    wakes: list[str] = []

    @contextmanager
    def execution(outbox_id: str | None) -> Generator[KnowledgeTaskExecutionLease | None]:
        with knowledge_task_execution(
            outbox_id,
            store=store,
            clock=lambda: datetime(2026, 10, 19, 12, 5),
            wake=lambda: wakes.append("wake") or True,
        ) as lease:
            yield lease

    monkeypatch.setattr(retry_task_module, "session_factory", SessionFactoryFake(sqlite_session_factory))
    monkeypatch.setattr(retry_task_module, "RedisKnowledgeIndexingLock", lambda **_kwargs: lock)
    monkeypatch.setattr(retry_task_module, "knowledge_task_execution", execution)
    monkeypatch.setattr(
        retry_task_module,
        "defer_knowledge_task_before_execution",
        lambda outbox_id, *, error, delay: store.defer_task_delivery(
            intent_id=outbox_id,
            available_at=datetime(2026, 10, 19, 12, 5) + timedelta(seconds=delay),
            error=error,
        ),
    )

    with pytest.raises(KnowledgeTaskRequeuedError, match="was deferred"):
        retry_task_module.retry_document_indexing_task.run(
            dataset.id,
            [document.id],
            user.id,
            {document.id: "producer-token"},
            {document.id: GENERATION},
            False,
            intent_id,
        )

    sqlite_session.expire_all()
    persisted_intent = sqlite_session.get(KnowledgeTaskOutbox, intent_id)
    assert persisted_intent is not None
    assert persisted_intent.status == "pending"
    assert persisted_intent.last_error == "previous 600-second lease is still owned"
    assert wakes == []
    assert lock.calls == [
        (f"knowledge:indexing:dataset:{dataset.id}", 600, None, 30),
        (f"knowledge:indexing:document-retry:{document.id}", 600, "producer-token", 0),
    ]


def test_generation_fence_distinguishes_stale_from_current_duplicate(sqlite_session: Session) -> None:
    user = Account(name="Retry user", email=f"retry-{uuid4()}@example.com")
    dataset = Dataset(
        id=str(uuid4()),
        tenant_id=str(uuid4()),
        name="Retry dataset",
        created_by=user.id,
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.ECONOMY,
        chunk_structure=IndexStructureType.PARAGRAPH_INDEX,
    )
    started_at = datetime(2026, 10, 19, 12, 0)
    document = Document(
        id=str(uuid4()),
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info="{}",
        batch="retry-batch",
        name="Retry document",
        created_from=DocumentCreatedFrom.WEB,
        created_by=user.id,
        indexing_status=IndexingStatus.COMPLETED,
        processing_started_at=started_at,
        indexing_generation=GENERATION,
        enabled=True,
        archived=False,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    sqlite_session.add_all([user, dataset, document])
    sqlite_session.commit()

    stale_state_matched = _retry_document(
        session=sqlite_session,
        dataset=dataset,
        user=user,
        document_id=document.id,
        expected_generation="e1037416-5a4f-4b51-92de-5d258108f92f",
        repair=False,
        dataset_lease=PassiveLease(),
        document_lease=PassiveLease(),
    )
    current_duplicate_matched = _retry_document(
        session=sqlite_session,
        dataset=dataset,
        user=user,
        document_id=document.id,
        expected_generation=GENERATION,
        repair=False,
        dataset_lease=PassiveLease(),
        document_lease=PassiveLease(),
    )

    assert stale_state_matched is False
    assert current_duplicate_matched is True


@config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
def test_repair_redelivery_lost_lease_does_not_commit_waiting_state(sqlite_session: Session) -> None:
    user = Account(name="Retry user", email=f"retry-{uuid4()}@example.com")
    dataset = Dataset(
        id=str(uuid4()),
        tenant_id=str(uuid4()),
        name="Retry dataset",
        created_by=user.id,
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.ECONOMY,
        chunk_structure=IndexStructureType.PARAGRAPH_INDEX,
    )
    started_at = datetime(2026, 10, 19, 12, 0)
    document = Document(
        id=str(uuid4()),
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info="{}",
        batch="retry-batch",
        name="Retry document",
        created_from=DocumentCreatedFrom.WEB,
        created_by=user.id,
        indexing_status=IndexingStatus.ERROR,
        processing_started_at=started_at,
        indexing_generation=GENERATION,
        enabled=True,
        archived=False,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    sqlite_session.add_all([user, dataset, document])
    sqlite_session.commit()

    with pytest.raises(KnowledgeIndexingLeaseLostError):
        _retry_document(
            session=sqlite_session,
            dataset=dataset,
            user=user,
            document_id=document.id,
            expected_generation=GENERATION,
            repair=True,
            dataset_lease=LostLease(),
            document_lease=LostLease(),
        )

    sqlite_session.rollback()
    sqlite_session.expire_all()
    persisted = sqlite_session.get(Document, document.id)
    assert persisted is not None
    assert persisted.indexing_status == IndexingStatus.ERROR
    assert persisted.processing_started_at == started_at
    assert persisted.indexing_generation == GENERATION


@config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
def test_repair_rechecks_generation_after_acquiring_parent_lock(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = Account(name="Retry user", email=f"retry-{uuid4()}@example.com")
    dataset = Dataset(
        id=str(uuid4()),
        tenant_id=str(uuid4()),
        name="Retry dataset",
        created_by=user.id,
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.ECONOMY,
        chunk_structure=IndexStructureType.PARAGRAPH_INDEX,
    )
    document = Document(
        id=str(uuid4()),
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info="{}",
        batch="retry-batch",
        name="Retry document",
        created_from=DocumentCreatedFrom.WEB,
        created_by=user.id,
        indexing_status=IndexingStatus.ERROR,
        indexing_generation=GENERATION,
        enabled=True,
        archived=False,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    sqlite_session.add_all([user, dataset, document])
    sqlite_session.commit()
    successor_generation = str(uuid4())

    def advance_generation_before_parent_lock(session: Session, _ref: object) -> Dataset:
        session.execute(
            update(Document)
            .where(Document.id == document.id)
            .values(
                indexing_generation=successor_generation,
                indexing_status=IndexingStatus.COMPLETED,
                error=None,
            )
        )
        session.commit()
        return dataset

    monkeypatch.setattr(
        retry_task_module,
        "lock_dataset_for_child_write",
        advance_generation_before_parent_lock,
    )

    state_matched = _retry_document(
        session=sqlite_session,
        dataset=dataset,
        user=user,
        document_id=document.id,
        expected_generation=GENERATION,
        repair=True,
        dataset_lease=PassiveLease(),
        document_lease=PassiveLease(),
    )

    sqlite_session.expire_all()
    successor = sqlite_session.get(Document, document.id)
    assert state_matched is False
    assert successor is not None
    assert successor.indexing_generation == successor_generation
    assert successor.indexing_status == IndexingStatus.COMPLETED


@config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
@pytest.mark.parametrize(
    "terminal_values",
    [
        {"is_paused": True},
        {"enabled": False},
        {"archived": True},
    ],
)
def test_repair_rechecks_terminal_state_after_acquiring_parent_lock(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    terminal_values: dict[str, bool],
) -> None:
    user = Account(name="Retry user", email=f"retry-{uuid4()}@example.com")
    dataset = Dataset(
        id=str(uuid4()),
        tenant_id=str(uuid4()),
        name="Retry dataset",
        created_by=user.id,
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.ECONOMY,
        chunk_structure=IndexStructureType.PARAGRAPH_INDEX,
    )
    document = Document(
        id=str(uuid4()),
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info="{}",
        batch="retry-batch",
        name="Retry document",
        created_from=DocumentCreatedFrom.WEB,
        created_by=user.id,
        indexing_status=IndexingStatus.ERROR,
        indexing_generation=GENERATION,
        enabled=True,
        archived=False,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=1,
        content="preserve me",
        word_count=2,
        tokens=2,
        index_node_id=str(uuid4()),
        index_node_hash="preserve",
        created_by=user.id,
        status=SegmentStatus.COMPLETED,
    )
    sqlite_session.add_all([user, dataset, document, segment])
    sqlite_session.commit()

    def make_document_terminal_before_parent_lock(session: Session, _ref: object) -> Dataset:
        session.execute(update(Document).where(Document.id == document.id).values(**terminal_values))
        session.commit()
        return dataset

    monkeypatch.setattr(
        retry_task_module,
        "lock_dataset_for_child_write",
        make_document_terminal_before_parent_lock,
    )

    state_matched = _retry_document(
        session=sqlite_session,
        dataset=dataset,
        user=user,
        document_id=document.id,
        expected_generation=GENERATION,
        repair=True,
        dataset_lease=PassiveLease(),
        document_lease=PassiveLease(),
    )

    sqlite_session.expire_all()
    persisted = sqlite_session.get(Document, document.id)
    assert state_matched is True
    assert persisted is not None
    assert persisted.indexing_status == IndexingStatus.ERROR
    assert sqlite_session.get(DocumentSegment, segment.id) is not None
    persisted_terminal_values = {
        "is_paused": persisted.is_paused,
        "enabled": persisted.enabled,
        "archived": persisted.archived,
    }
    for field, value in terminal_values.items():
        assert persisted_terminal_values[field] is value


@config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
def test_legacy_repair_without_generation_binds_current_state(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = Account(name="Retry user", email=f"retry-{uuid4()}@example.com")
    dataset = Dataset(
        id=str(uuid4()),
        tenant_id=str(uuid4()),
        name="Retry dataset",
        created_by=user.id,
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.ECONOMY,
        chunk_structure=IndexStructureType.PARAGRAPH_INDEX,
    )
    document = Document(
        id=str(uuid4()),
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info="{}",
        batch="retry-batch",
        name="Retry document",
        created_from=DocumentCreatedFrom.WEB,
        created_by=user.id,
        indexing_status=IndexingStatus.ERROR,
        indexing_generation=GENERATION,
        enabled=True,
        archived=False,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    sqlite_session.add_all([user, dataset, document])
    sqlite_session.commit()
    monkeypatch.setattr(retry_task_module, "IndexProcessorFactory", NoOpIndexProcessorFactory)
    monkeypatch.setattr(
        retry_task_module,
        "build_document_indexing_service",
        lambda **_kwargs: NoOpIndexingService(),
    )

    state_matched = _retry_document(
        session=sqlite_session,
        dataset=dataset,
        user=user,
        document_id=document.id,
        expected_generation=None,
        repair=True,
        dataset_lease=PassiveLease(),
        document_lease=PassiveLease(),
    )

    sqlite_session.expire_all()
    persisted = sqlite_session.get(Document, document.id)
    assert state_matched is True
    assert persisted is not None
    assert persisted.indexing_generation not in {None, GENERATION}
    assert persisted.indexing_status == IndexingStatus.PARSING


@config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
@pytest.mark.parametrize("indexing_status", [IndexingStatus.WAITING, IndexingStatus.PARSING, IndexingStatus.ERROR])
def test_same_generation_retry_resumes_and_segment_cleanup_uses_full_owner_chain(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, indexing_status: str
) -> None:
    user = Account(name="Retry user", email=f"retry-{uuid4()}@example.com")
    dataset = Dataset(
        id=str(uuid4()),
        tenant_id=str(uuid4()),
        name="Retry dataset",
        created_by=user.id,
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.ECONOMY,
        chunk_structure=IndexStructureType.PARAGRAPH_INDEX,
    )
    started_at = datetime(2026, 10, 19, 12, 0)
    document = Document(
        id=str(uuid4()),
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info="{}",
        batch="retry-batch",
        name="Retry document",
        created_from=DocumentCreatedFrom.WEB,
        created_by=user.id,
        indexing_status=indexing_status,
        processing_started_at=started_at,
        indexing_generation=GENERATION,
        enabled=True,
        archived=False,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    owned_segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=1,
        content="owned",
        word_count=1,
        tokens=1,
        index_node_id=str(uuid4()),
        index_node_hash="owned",
        created_by=user.id,
        status=SegmentStatus.COMPLETED,
    )
    foreign_segment = DocumentSegment(
        tenant_id=str(uuid4()),
        dataset_id=str(uuid4()),
        document_id=document.id,
        position=2,
        content="foreign",
        word_count=1,
        tokens=1,
        index_node_id=str(uuid4()),
        index_node_hash="foreign",
        created_by=user.id,
        status=SegmentStatus.COMPLETED,
    )
    sqlite_session.add_all([user, dataset, document, owned_segment, foreign_segment])
    sqlite_session.commit()
    monkeypatch.setattr(retry_task_module, "IndexProcessorFactory", NoOpIndexProcessorFactory)
    monkeypatch.setattr(
        retry_task_module,
        "build_document_indexing_service",
        lambda **_kwargs: NoOpIndexingService(),
    )

    state_matched = _retry_document(
        session=sqlite_session,
        dataset=dataset,
        user=user,
        document_id=document.id,
        expected_generation=GENERATION,
        repair=False,
        dataset_lease=PassiveLease(),
        document_lease=PassiveLease(),
    )

    assert state_matched is True
    assert sqlite_session.get(DocumentSegment, owned_segment.id) is None
    assert sqlite_session.get(DocumentSegment, foreign_segment.id) is not None


@config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
@pytest.mark.parametrize("ownership_change", ["generation", "pause"])
def test_ownership_change_during_external_cleanup_preserves_successor_state(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    ownership_change: str,
) -> None:
    user = Account(name="Retry user", email=f"retry-{uuid4()}@example.com")
    dataset = Dataset(
        id=str(uuid4()),
        tenant_id=str(uuid4()),
        name="Retry dataset",
        created_by=user.id,
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.ECONOMY,
        chunk_structure=IndexStructureType.PARAGRAPH_INDEX,
    )
    document = Document(
        id=str(uuid4()),
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info="{}",
        batch="retry-batch",
        name="Retry document",
        created_from=DocumentCreatedFrom.WEB,
        created_by=user.id,
        indexing_status=IndexingStatus.ERROR,
        indexing_generation=GENERATION,
        enabled=True,
        archived=False,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=1,
        content="old content",
        word_count=2,
        tokens=2,
        index_node_id=str(uuid4()),
        index_node_hash="old",
        created_by=user.id,
        status=SegmentStatus.COMPLETED,
    )
    sqlite_session.add_all([user, dataset, document, segment])
    sqlite_session.commit()
    successor_generation = str(uuid4())

    class GenerationChangingProcessor(NoOpIndexProcessor):
        @override
        def clean(self, *args: object, **kwargs: object) -> None:
            del args, kwargs
            with Session(sqlite_session.get_bind()) as writer, writer.begin():
                successor = writer.get(Document, document.id)
                assert successor is not None
                if ownership_change == "generation":
                    successor.indexing_generation = successor_generation
                    successor.indexing_status = IndexingStatus.COMPLETED
                else:
                    successor.is_paused = True

    class GenerationChangingFactory:
        def __init__(self, index_type: object) -> None:
            del index_type

        def init_index_processor(self) -> GenerationChangingProcessor:
            return GenerationChangingProcessor()

    monkeypatch.setattr(retry_task_module, "IndexProcessorFactory", GenerationChangingFactory)

    with pytest.raises(DocumentIndexingGenerationChangedError):
        _retry_document(
            session=sqlite_session,
            dataset=dataset,
            user=user,
            document_id=document.id,
            expected_generation=GENERATION,
            repair=False,
            dataset_lease=PassiveLease(),
            document_lease=PassiveLease(),
        )

    sqlite_session.rollback()
    sqlite_session.expire_all()
    successor = sqlite_session.get(Document, document.id)
    assert successor is not None
    if ownership_change == "generation":
        assert successor.indexing_generation == successor_generation
        assert successor.indexing_status == IndexingStatus.COMPLETED
    else:
        assert successor.indexing_generation == GENERATION
        assert successor.indexing_status == IndexingStatus.WAITING
        assert successor.is_paused is True
    assert sqlite_session.get(DocumentSegment, segment.id) is not None


def test_dataset_lease_loss_schedules_document_repair(monkeypatch: pytest.MonkeyPatch) -> None:
    repairs: list[tuple[str, list[str], str]] = []
    monkeypatch.setattr(retry_task_module, "RedisKnowledgeIndexingLock", lambda **_kwargs: LostLock())

    def record_repair(*, dataset_id: str, document_ids: list[str], user_id: str) -> None:
        repairs.append((dataset_id, document_ids, user_id))

    monkeypatch.setattr(retry_task_module, "_enqueue_current_document_repairs", record_repair)

    retry_task_module.retry_document_indexing_task.run(
        "dataset-1",
        ["document-1"],
        "user-1",
        {"document-1": "producer-token"},
        {"document-1": GENERATION},
        False,
    )

    assert repairs == [("dataset-1", ["document-1"], "user-1")]


def test_repair_intent_database_failure_reaches_celery_autoretry(monkeypatch: pytest.MonkeyPatch) -> None:
    class RetryRequestedError(Exception):
        pass

    retry_errors: list[BaseException] = []
    monkeypatch.setattr(retry_task_module, "RedisKnowledgeIndexingLock", lambda **_kwargs: LostLock())

    def fail_repair(**_kwargs: object) -> None:
        raise RuntimeError("repair database unavailable")

    def request_retry(*_args: object, **kwargs: object) -> None:
        error = kwargs.get("exc")
        assert isinstance(error, BaseException)
        retry_errors.append(error)
        raise RetryRequestedError()

    monkeypatch.setattr(retry_task_module, "_enqueue_current_document_repairs", fail_repair)
    monkeypatch.setattr(retry_task_module.retry_document_indexing_task, "retry", request_retry)

    with pytest.raises(RetryRequestedError):
        retry_task_module.retry_document_indexing_task.run(
            "dataset-1",
            ["document-1"],
            "user-1",
            {"document-1": "producer-token"},
            {"document-1": GENERATION},
            False,
        )

    assert len(retry_errors) == 1
    assert str(retry_errors[0]) == "repair database unavailable"


def test_stale_document_redelivery_schedules_current_generation_repair(monkeypatch: pytest.MonkeyPatch) -> None:
    repairs: list[tuple[str, list[str], str]] = []
    monkeypatch.setattr(retry_task_module, "RedisKnowledgeIndexingLock", lambda **_kwargs: HealthyLock())
    monkeypatch.setattr(retry_task_module, "_retry_documents", lambda **_kwargs: ["document-1"])

    def record_repair(*, dataset_id: str, document_ids: list[str], user_id: str) -> None:
        repairs.append((dataset_id, document_ids, user_id))

    monkeypatch.setattr(retry_task_module, "_enqueue_current_document_repairs", record_repair)

    retry_task_module.retry_document_indexing_task.run(
        "dataset-1",
        ["document-1"],
        "user-1",
        {},
        {"document-1": GENERATION},
        False,
    )

    assert repairs == [("dataset-1", ["document-1"], "user-1")]


def test_current_document_redelivery_does_not_schedule_repair(monkeypatch: pytest.MonkeyPatch) -> None:
    repairs: list[tuple[str, list[str], str]] = []
    monkeypatch.setattr(retry_task_module, "RedisKnowledgeIndexingLock", lambda **_kwargs: HealthyLock())
    monkeypatch.setattr(retry_task_module, "_retry_documents", lambda **_kwargs: [])

    def record_repair(*, dataset_id: str, document_ids: list[str], user_id: str) -> None:
        repairs.append((dataset_id, document_ids, user_id))

    monkeypatch.setattr(retry_task_module, "_enqueue_current_document_repairs", record_repair)

    retry_task_module.retry_document_indexing_task.run(
        "dataset-1",
        ["document-1"],
        "user-1",
        {},
        {"document-1": GENERATION},
        False,
    )

    assert repairs == []
