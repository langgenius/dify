from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from importlib import import_module
from types import TracebackType
from typing import NoReturn, override
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from core.rag.models.document import Document as IndexDocument
from extensions.storage.storage_type import StorageType
from models.dataset import ChildChunk, Dataset, Document, DocumentSegment, SegmentAttachmentBinding
from models.enums import CreatorUserRole, DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus
from models.knowledge_task import KnowledgeTaskOutbox
from models.model import UploadFile
from services.knowledge.indexing.locks import KnowledgeIndexingLeaseLostError
from services.knowledge.task_outbox.contracts import KnowledgeTaskKind

vector_task_module = import_module("tasks.deal_dataset_vector_index_task")
legacy_vector_task_module = import_module("tasks.deal_dataset_index_update_task")


@dataclass
class DatasetState:
    id: str = "dataset-1"
    tenant_id: str = "tenant-1"
    indexing_technique: str = "high_quality"
    embedding_model_provider: str | None = "provider-1"
    embedding_model: str | None = "model-1"
    summary_index_setting: dict[str, object] | None = field(
        default_factory=lambda: {"enable": True, "model": "summary-model-1"}
    )


class ReadOnlySession:
    def __init__(self, dataset: DatasetState) -> None:
        self.dataset = dataset

    def __enter__(self) -> "ReadOnlySession":
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        del exc_type, exc_value, traceback

    def scalar(self, statement: object) -> DatasetState:
        del statement
        return self.dataset

    def scalars(self, statement: object) -> "EmptyScalars":
        del statement
        return EmptyScalars()

    def commit(self) -> None:
        return None


class EmptyScalars:
    def all(self) -> list[object]:
        return []


class RecordingIndexProcessor:
    def __init__(self, events: list[str]) -> None:
        self._events = events

    def clean(self, *args: object, **kwargs: object) -> None:
        del args, kwargs
        self._events.append("clean")


class RecordingIndexProcessorFactory:
    def __init__(self, index_type: object, *, processor: RecordingIndexProcessor) -> None:
        del index_type
        self._processor = processor

    def init_index_processor(self) -> RecordingIndexProcessor:
        return self._processor


@dataclass
class RecordingRebuildProcessor:
    loaded_document_ids: list[str]
    remaining_failures: int = 0

    def clean(self, *args: object, **kwargs: object) -> None:
        del args, kwargs

    def load(
        self,
        dataset: Dataset,
        documents: list[IndexDocument],
        *,
        multimodal_documents: list[object],
        with_keywords: bool,
        session: Session,
    ) -> None:
        del dataset, multimodal_documents, with_keywords, session
        document_ids = [str(document.metadata["document_id"]) for document in documents]
        self.loaded_document_ids.extend(document_ids)
        if self.remaining_failures:
            self.remaining_failures -= 1
            raise RuntimeError("vector provider unavailable")


@dataclass
class RecordingRebuildProcessorFactory:
    processor: RecordingRebuildProcessor

    def init_index_processor(self) -> RecordingRebuildProcessor:
        return self.processor


class PassiveLease:
    token = "owner-1"

    def assert_owned(self) -> None:
        return None

    def renew(self) -> bool:
        return True

    def release(self) -> bool:
        return True


class LostLock:
    @contextmanager
    def hold(self, *args: object, **kwargs: object) -> Generator[PassiveLease]:
        del args, kwargs
        raise KnowledgeIndexingLeaseLostError("expired")
        yield PassiveLease()


class LostAfterDatasetLoadLease(PassiveLease):
    @override
    def assert_owned(self) -> None:
        raise KnowledgeIndexingLeaseLostError("expired after dataset load")


class LostAfterDatasetLoadLock:
    @contextmanager
    def hold(self, *args: object, **kwargs: object) -> Generator[LostAfterDatasetLoadLease]:
        del args, kwargs
        yield LostAfterDatasetLoadLease()


class HealthyLock:
    @contextmanager
    def hold(self, *args: object, **kwargs: object) -> Generator[PassiveLease]:
        del args, kwargs
        yield PassiveLease()


@dataclass
class RecordingDatasetRepository:
    repaired: list[object]

    def enqueue_current_vector_repair(self, dataset_ref: object) -> bool:
        self.repaired.append(dataset_ref)
        return True


def test_unversioned_dataset_delivery_is_converted_before_vector_io(monkeypatch: pytest.MonkeyPatch) -> None:
    converted: list[str] = []

    class LegacyConvertingRepository:
        def __init__(self, **_kwargs: object) -> None:
            return

        def convert_legacy_vector_index_delivery(self, dataset_id: str) -> bool:
            converted.append(dataset_id)
            return True

    monkeypatch.setattr(vector_task_module.session_factory, "get_session_maker", lambda: object())
    monkeypatch.setattr(vector_task_module, "SQLAlchemyDatasetRepository", LegacyConvertingRepository)
    monkeypatch.setattr(
        vector_task_module,
        "RedisKnowledgeIndexingLock",
        lambda **_kwargs: pytest.fail("legacy delivery acquired a vector execution lock"),
    )
    monkeypatch.setattr(
        vector_task_module,
        "IndexProcessorFactory",
        lambda *_args, **_kwargs: pytest.fail("legacy delivery reached vector I/O"),
    )

    vector_task_module.deal_dataset_vector_index_task.run("dataset-1", "remove")

    assert converted == ["dataset-1"]


def test_unversioned_dataset_conversion_failure_is_not_acknowledged(monkeypatch: pytest.MonkeyPatch) -> None:
    class FailingRepository:
        def __init__(self, **_kwargs: object) -> None:
            return

        def convert_legacy_vector_index_delivery(self, _dataset_id: str) -> bool:
            raise RuntimeError("database unavailable")

    monkeypatch.setattr(vector_task_module.session_factory, "get_session_maker", lambda: object())
    monkeypatch.setattr(vector_task_module, "SQLAlchemyDatasetRepository", FailingRepository)

    with pytest.raises(RuntimeError, match="database unavailable"):
        vector_task_module.deal_dataset_vector_index_task.run("dataset-1", "add")


def _persist_current_vector_intent(
    session: Session,
    *,
    status: str,
    available_at: datetime | None = None,
    claim_id: str | None = None,
    execution_attempts: int = 0,
) -> tuple[Dataset, Document, KnowledgeTaskOutbox]:
    dataset = Dataset(
        id=str(uuid4()),
        tenant_id=str(uuid4()),
        name="Current target",
        created_by=str(uuid4()),
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        embedding_model_provider="provider-1",
        embedding_model="model-1",
    )
    document = Document(
        id=str(uuid4()),
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="document.txt",
        created_from=DocumentCreatedFrom.WEB,
        created_by=dataset.created_by,
        indexing_status=IndexingStatus.COMPLETED,
        enabled=True,
        archived=False,
    )
    intent = KnowledgeTaskOutbox(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        resource_id=dataset.id,
        task_kind=KnowledgeTaskKind.DATASET_VECTOR_INDEX_UPDATE.value,
        payload={
            "tenant_id": dataset.tenant_id,
            "dataset_id": dataset.id,
            "action": "update",
            "expected_indexing_technique": "high_quality",
            "expected_embedding_model_provider": "provider-1",
            "expected_embedding_model": "model-1",
            "regenerate_summary_vectors": True,
            "superseded": False,
        },
        status=status,
        available_at=available_at or datetime.now(UTC),
        claim_id=claim_id,
        claimed_at=datetime.now(UTC) if claim_id else None,
        execution_attempts=execution_attempts,
    )
    session.add_all([dataset, document, intent])
    session.commit()
    return dataset, document, intent


@pytest.mark.parametrize("action", ["update", "upgrade"])
def test_deployed_legacy_dataset_update_converts_without_provider_io_or_document_mutation(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    action: str,
) -> None:
    dataset, document, intent = _persist_current_vector_intent(sqlite_session, status="completed")
    monkeypatch.setattr(legacy_vector_task_module.session_factory, "get_session_maker", lambda: sqlite_session_factory)
    monkeypatch.setattr(
        legacy_vector_task_module,
        "wake_knowledge_task_dispatcher_after_commit",
        lambda _session: pytest.fail("completed current target should not wake the dispatcher"),
    )

    legacy_vector_task_module.deal_dataset_index_update_task.run(dataset.id, action)

    sqlite_session.expire_all()
    assert sqlite_session.get(Document, document.id).indexing_status == IndexingStatus.COMPLETED  # type: ignore[union-attr]
    intents = sqlite_session.scalars(
        select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.dataset_id == dataset.id)
    ).all()
    assert [row.id for row in intents] == [intent.id]
    assert intents[0].status == "completed"


def test_expired_dataset_execution_takeover_persists_current_repair_before_ack(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset, _document, expired = _persist_current_vector_intent(
        sqlite_session,
        status="executing",
        available_at=datetime.now(UTC) - timedelta(minutes=1),
        claim_id="dead-worker",
        execution_attempts=1,
    )
    stale_external_writes = ["old-worker-finished-vector-write"]
    monkeypatch.setattr(vector_task_module.session_factory, "create_session", sqlite_session_factory)
    monkeypatch.setattr(vector_task_module.session_factory, "get_session_maker", lambda: sqlite_session_factory)
    monkeypatch.setattr(vector_task_module, "wake_knowledge_task_dispatcher_after_commit", lambda _session: None)
    monkeypatch.setattr(
        vector_task_module,
        "RedisKnowledgeIndexingLock",
        lambda **_kwargs: pytest.fail("a recovered delivery replayed vector I/O"),
    )
    monkeypatch.setattr(
        vector_task_module,
        "IndexProcessorFactory",
        lambda *_args, **_kwargs: pytest.fail("a recovered delivery reached its old provider action"),
    )

    vector_task_module.deal_dataset_vector_index_task.run(
        dataset.id,
        "update",
        "high_quality",
        "provider-1",
        "model-1",
        True,
        expired.id,
        dataset.tenant_id,
    )

    assert stale_external_writes == ["old-worker-finished-vector-write"]
    sqlite_session.expire_all()
    intents = sqlite_session.scalars(
        select(KnowledgeTaskOutbox)
        .where(KnowledgeTaskOutbox.dataset_id == dataset.id)
        .order_by(KnowledgeTaskOutbox.created_at, KnowledgeTaskOutbox.id)
    ).all()
    assert len(intents) == 2
    old = next(row for row in intents if row.id == expired.id)
    repair = next(row for row in intents if row.id != expired.id)
    assert old.status == "completed"
    assert old.payload["superseded"] is True
    assert old.payload["_recovered_execution"] is True
    assert repair.status == "pending"
    assert repair.payload["action"] == "update"
    assert repair.payload["superseded"] is False


def _persist_rebuild_document(
    session: Session,
    *,
    status: IndexingStatus,
    error: str | None,
    with_segment: bool,
) -> tuple[Dataset, Document]:
    tenant_id = str(uuid4())
    actor_id = str(uuid4())
    dataset = Dataset(
        id=str(uuid4()),
        tenant_id=tenant_id,
        name="Rebuild dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=actor_id,
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        embedding_model_provider="provider-1",
        embedding_model="model-1",
    )
    document = Document(
        id=str(uuid4()),
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="document.txt",
        created_from=DocumentCreatedFrom.WEB,
        created_by=actor_id,
        indexing_status=status,
        error=error,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
        enabled=True,
        archived=False,
    )
    rows: list[object] = [dataset, document]
    if with_segment:
        rows.append(
            DocumentSegment(
                tenant_id=tenant_id,
                dataset_id=dataset.id,
                document_id=document.id,
                position=1,
                content="indexed content",
                word_count=2,
                tokens=2,
                created_by=actor_id,
                index_node_id=f"node-{document.id}",
                index_node_hash="hash",
                status=SegmentStatus.COMPLETED,
                enabled=True,
            )
        )
    session.add_all(rows)
    session.commit()
    return dataset, document


def _run_vector_rebuild(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    *,
    dataset_id: str,
    processor: RecordingRebuildProcessor,
    action: str,
) -> None:
    bind = sqlite_session.get_bind()
    monkeypatch.setattr(
        vector_task_module.session_factory,
        "create_session",
        lambda: Session(bind, expire_on_commit=False),
    )
    monkeypatch.setattr(
        vector_task_module,
        "IndexProcessorFactory",
        lambda *_args, **_kwargs: RecordingRebuildProcessorFactory(processor),
    )
    monkeypatch.setattr(
        vector_task_module,
        "get_dataset_doc_form",
        lambda *_args, **_kwargs: IndexStructureType.PARAGRAPH_INDEX,
    )
    monkeypatch.setattr(vector_task_module, "_enqueue_summary_vector_regeneration", lambda *_args: None)
    monkeypatch.setattr(vector_task_module, "wake_knowledge_task_dispatcher_after_commit", lambda _session: None)
    vector_task_module._deal_dataset_vector_index(
        dataset_id=dataset_id,
        tenant_id=None,
        action=action,
        expected_indexing_technique="high_quality",
        expected_embedding_model_provider="provider-1",
        expected_embedding_model="model-1",
        regenerate_summary_vectors=False,
        lease=PassiveLease(),
    )


@pytest.mark.parametrize("action", ["add", "update"])
def test_vector_rebuild_preserves_unrelated_extraction_error_without_segments(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    action: str,
) -> None:
    dataset, document = _persist_rebuild_document(
        sqlite_session,
        status=IndexingStatus.ERROR,
        error="source extraction failed",
        with_segment=False,
    )
    processor = RecordingRebuildProcessor([])

    _run_vector_rebuild(sqlite_session, monkeypatch, dataset_id=dataset.id, processor=processor, action=action)

    sqlite_session.expire_all()
    persisted = sqlite_session.get(Document, document.id)
    assert persisted is not None
    assert persisted.indexing_status == IndexingStatus.ERROR
    assert persisted.error == "source extraction failed"
    assert processor.loaded_document_ids == []


@pytest.mark.parametrize("action", ["add", "update"])
def test_vector_rebuild_preserves_unrelated_indexing_document(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    action: str,
) -> None:
    dataset, document = _persist_rebuild_document(
        sqlite_session,
        status=IndexingStatus.INDEXING,
        error=None,
        with_segment=True,
    )
    processor = RecordingRebuildProcessor([])

    _run_vector_rebuild(sqlite_session, monkeypatch, dataset_id=dataset.id, processor=processor, action=action)

    sqlite_session.expire_all()
    persisted = sqlite_session.get(Document, document.id)
    assert persisted is not None
    assert persisted.indexing_status == IndexingStatus.INDEXING
    assert persisted.error is None
    assert processor.loaded_document_ids == []


@pytest.mark.parametrize("action", ["add", "update"])
def test_vector_rebuild_retries_completed_document_without_owning_document_status(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    action: str,
) -> None:
    dataset, document = _persist_rebuild_document(
        sqlite_session,
        status=IndexingStatus.COMPLETED,
        error=None,
        with_segment=True,
    )
    processor = RecordingRebuildProcessor([], remaining_failures=1)

    with pytest.raises(vector_task_module.DatasetVectorIndexingError, match=document.id) as caught:
        _run_vector_rebuild(
            sqlite_session,
            monkeypatch,
            dataset_id=dataset.id,
            processor=processor,
            action=action,
        )
    assert "vector provider unavailable" in str(caught.value)

    sqlite_session.expire_all()
    persisted = sqlite_session.get(Document, document.id)
    assert persisted is not None
    assert persisted.indexing_status == IndexingStatus.COMPLETED
    assert persisted.error is None

    _run_vector_rebuild(sqlite_session, monkeypatch, dataset_id=dataset.id, processor=processor, action=action)

    sqlite_session.expire_all()
    persisted = sqlite_session.get(Document, document.id)
    assert persisted is not None
    assert persisted.indexing_status == IndexingStatus.COMPLETED
    assert persisted.error is None
    assert processor.loaded_document_ids == [document.id, document.id]


def test_rebuild_materials_include_parent_children_and_multimodal_attachments(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    tenant_id = str(uuid4())
    actor_id = str(uuid4())
    dataset = Dataset(
        tenant_id=tenant_id,
        name="Multimodal dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=actor_id,
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        is_multimodal=True,
    )
    document = Document(
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="document.txt",
        created_from=DocumentCreatedFrom.WEB,
        created_by=actor_id,
        indexing_status=IndexingStatus.COMPLETED,
        doc_form=IndexStructureType.PARENT_CHILD_INDEX,
    )
    document.id = str(uuid4())
    segment = DocumentSegment(
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=1,
        content="parent",
        word_count=1,
        tokens=1,
        created_by=actor_id,
        index_node_id="parent-node",
        index_node_hash="parent-hash",
        status=SegmentStatus.COMPLETED,
    )
    child = ChildChunk(
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        segment_id=segment.id,
        position=1,
        content="child",
        word_count=1,
        created_by=actor_id,
        index_node_id="child-node",
        index_node_hash="child-hash",
    )
    attachment = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key="attachments/image.png",
        name="image.png",
        size=10,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=actor_id,
        created_at=datetime.now(UTC),
        used=True,
    )
    binding = SegmentAttachmentBinding(
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        segment_id=segment.id,
        attachment_id=attachment.id,
    )
    sqlite_session.add_all([dataset, document, segment, attachment, binding])
    sqlite_session.commit()
    monkeypatch.setattr(vector_task_module, "get_segment_child_chunks", lambda *_args, **_kwargs: [child])

    documents, attachments = vector_task_module._build_index_materials(
        session=sqlite_session,
        dataset=dataset,
        dataset_document=document,
        segments=[segment],
    )

    assert [item.metadata["doc_id"] for item in documents] == ["parent-node"]
    assert documents[0].children is not None
    assert [item.metadata["doc_id"] for item in documents[0].children] == ["child-node"]
    assert [item.metadata["doc_id"] for item in attachments] == [attachment.id]


def test_stale_remove_does_not_touch_current_high_quality_index(monkeypatch: pytest.MonkeyPatch) -> None:
    session = ReadOnlySession(DatasetState())
    monkeypatch.setattr(vector_task_module.session_factory, "create_session", lambda: session)

    def unexpected_factory(index_type: object) -> NoReturn:
        raise AssertionError(f"stale intent reached index adapter: {index_type}")

    monkeypatch.setattr(vector_task_module, "IndexProcessorFactory", unexpected_factory)

    state_matched, dataset_ref = vector_task_module._deal_dataset_vector_index(
        dataset_id="dataset-1",
        tenant_id=None,
        action="remove",
        expected_indexing_technique="economy",
        expected_embedding_model_provider=None,
        expected_embedding_model=None,
        regenerate_summary_vectors=False,
        lease=PassiveLease(),
    )

    assert state_matched is False
    assert dataset_ref == vector_task_module.DatasetRef("tenant-1", "dataset-1")


def test_stale_redelivery_schedules_current_dataset_repair(monkeypatch: pytest.MonkeyPatch) -> None:
    repaired: list[object] = []
    session = ReadOnlySession(DatasetState())
    monkeypatch.setattr(vector_task_module.session_factory, "create_session", lambda: session)
    monkeypatch.setattr(vector_task_module.session_factory, "get_session_maker", lambda: object())
    monkeypatch.setattr(vector_task_module, "RedisKnowledgeIndexingLock", lambda **_kwargs: HealthyLock())
    monkeypatch.setattr(
        vector_task_module,
        "SQLAlchemyDatasetRepository",
        lambda **_kwargs: RecordingDatasetRepository(repaired),
    )

    def unexpected_factory(index_type: object) -> NoReturn:
        raise AssertionError(f"stale intent reached index adapter: {index_type}")

    monkeypatch.setattr(vector_task_module, "IndexProcessorFactory", unexpected_factory)

    vector_task_module.deal_dataset_vector_index_task.run(
        "dataset-1",
        "remove",
        "economy",
        None,
        None,
        False,
    )

    assert repaired == [vector_task_module.DatasetRef("tenant-1", "dataset-1")]


def test_lease_loss_schedules_current_state_repair(monkeypatch: pytest.MonkeyPatch) -> None:
    repaired: list[object] = []
    monkeypatch.setattr(vector_task_module.session_factory, "get_session_maker", lambda: object())
    monkeypatch.setattr(vector_task_module, "RedisKnowledgeIndexingLock", lambda **_kwargs: LostLock())
    monkeypatch.setattr(
        vector_task_module,
        "SQLAlchemyDatasetRepository",
        lambda **_kwargs: RecordingDatasetRepository(repaired),
    )

    vector_task_module.deal_dataset_vector_index_task.run(
        "dataset-1",
        "remove",
        "economy",
        None,
        None,
        False,
        None,
        "tenant-1",
    )

    assert repaired == [vector_task_module.DatasetRef("tenant-1", "dataset-1")]


def test_legacy_delivery_uses_loaded_dataset_owner_for_lease_loss_repair(monkeypatch: pytest.MonkeyPatch) -> None:
    repaired: list[object] = []
    session = ReadOnlySession(DatasetState())
    processor = RecordingIndexProcessor([])
    monkeypatch.setattr(vector_task_module.session_factory, "create_session", lambda: session)
    monkeypatch.setattr(vector_task_module.session_factory, "get_session_maker", lambda: object())
    monkeypatch.setattr(vector_task_module, "RedisKnowledgeIndexingLock", lambda **_kwargs: LostAfterDatasetLoadLock())
    monkeypatch.setattr(
        vector_task_module,
        "SQLAlchemyDatasetRepository",
        lambda **_kwargs: RecordingDatasetRepository(repaired),
    )
    monkeypatch.setattr(vector_task_module, "get_dataset_doc_form", lambda *_args, **_kwargs: "text_model")
    monkeypatch.setattr(
        vector_task_module,
        "IndexProcessorFactory",
        lambda index_type, **_kwargs: RecordingIndexProcessorFactory(index_type, processor=processor),
    )

    vector_task_module.deal_dataset_vector_index_task.run(
        "dataset-1",
        "remove",
        "high_quality",
        "provider-1",
        "model-1",
        False,
    )

    assert repaired == [vector_task_module.DatasetRef("tenant-1", "dataset-1")]


@pytest.mark.parametrize(
    ("action", "regenerate_summary_vectors"),
    [("update", True), ("add", False)],
)
def test_summary_rebuild_is_persisted_after_vector_rebuild_and_economy_upgrade(
    monkeypatch: pytest.MonkeyPatch,
    action: str,
    regenerate_summary_vectors: bool,
) -> None:
    events: list[str] = []
    session = ReadOnlySession(DatasetState())
    processor = RecordingIndexProcessor(events)
    monkeypatch.setattr(vector_task_module.session_factory, "create_session", lambda: session)
    monkeypatch.setattr(vector_task_module, "get_dataset_doc_form", lambda *_args, **_kwargs: "text_model")
    monkeypatch.setattr(
        vector_task_module,
        "IndexProcessorFactory",
        lambda index_type, **_kwargs: RecordingIndexProcessorFactory(index_type, processor=processor),
    )

    payloads: list[dict[str, object]] = []

    def enqueue(_session: object, **kwargs: object) -> str:
        events.append("enqueue-summary")
        payload = kwargs["payload"]
        assert isinstance(payload, dict)
        payloads.append(payload)
        return "intent-1"

    monkeypatch.setattr(vector_task_module, "enqueue_knowledge_task", enqueue)
    monkeypatch.setattr(vector_task_module, "wake_knowledge_task_dispatcher_after_commit", lambda _session: None)

    vector_task_module._deal_dataset_vector_index(
        dataset_id="dataset-1",
        tenant_id=None,
        action=action,
        expected_indexing_technique="high_quality",
        expected_embedding_model_provider="provider-1",
        expected_embedding_model="model-1",
        regenerate_summary_vectors=regenerate_summary_vectors,
        lease=PassiveLease(),
    )

    assert events == ["clean", "enqueue-summary"]
    assert payloads == [
        {
            "tenant_id": "tenant-1",
            "dataset_id": "dataset-1",
            "regenerate_reason": "embedding_model_changed",
            "regenerate_vectors_only": True,
            "expected_indexing_technique": "high_quality",
            "expected_embedding_model_provider": "provider-1",
            "expected_embedding_model": "model-1",
            "expected_summary_index_setting": {"enable": True, "model": "summary-model-1"},
        }
    ]
