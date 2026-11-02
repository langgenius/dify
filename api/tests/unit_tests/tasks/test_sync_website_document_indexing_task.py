"""Website sync owner isolation using the current indexing port."""

import uuid
from collections.abc import Generator, Sequence
from contextlib import AbstractContextManager, contextmanager, nullcontext
from importlib import import_module
from typing import override
from unittest.mock import MagicMock, patch

import pytest
from celery.exceptions import Retry
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.models.document import Document as IndexDocument
from enums import DeploymentEdition
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, Document, DocumentSegment, SegmentAttachmentBinding
from models.enums import DataSourceType, IndexingStatus, SegmentStatus
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.segment_repository import SQLAlchemySegmentRepository
from services.extraction.contracts import ExtractionResult
from services.knowledge.entities.resource_scope import DocumentRef
from services.knowledge.indexing.contracts import IndexingDocument
from services.knowledge.indexing.execution import DocumentIndexingService, IndexingTransformResult
from services.knowledge.indexing.locks import (
    KnowledgeIndexingLeaseLostError,
    KnowledgeIndexingLockBusyError,
)
from tasks.sync_website_document_indexing_task import sync_website_document_indexing_task
from tests.helpers.unit.config_override import config_overrides_context
from tests.helpers.unit.model_factories import make_dataset, make_document, make_upload_file

MODULE = import_module("tasks.sync_website_document_indexing_task")


class _RecordingLease:
    def __init__(self, values: dict[str, str], name: str, token: str) -> None:
        self._values = values
        self._name = name
        self.token = token

    def assert_owned(self) -> None:
        if self._values.get(self._name) != self.token:
            raise KnowledgeIndexingLeaseLostError(self._name)

    def renew(self) -> bool:
        return self._values.get(self._name) == self.token

    def release(self) -> bool:
        if self._values.get(self._name) != self.token:
            return False
        self._values.pop(self._name)
        return True


class _LoseOwnershipOnCheckLease(_RecordingLease):
    def __init__(self, values: dict[str, str], name: str, token: str, *, lose_on_check: int) -> None:
        super().__init__(values, name, token)
        self._ownership_checks = 0
        self._lose_on_check = lose_on_check

    @override
    def assert_owned(self) -> None:
        self._ownership_checks += 1
        if self._ownership_checks == self._lose_on_check:
            raise KnowledgeIndexingLeaseLostError(self.token)
        super().assert_owned()


class _RecordingLocks:
    def __init__(self, values: dict[str, str]) -> None:
        self._values = values
        self._next_token = 1

    @contextmanager
    def hold(
        self,
        name: str,
        *,
        timeout: int,
        expected_token: str | None = None,
        blocking_timeout: float = 0,
    ) -> Generator[_RecordingLease]:
        assert timeout == 600
        assert blocking_timeout == 0
        current = self._values.get(name)
        if expected_token is None:
            if current is not None:
                raise KnowledgeIndexingLockBusyError(name)
        elif current is not None and current != expected_token:
            raise KnowledgeIndexingLockBusyError(name)
        token = f"worker-{self._next_token}"
        self._next_token += 1
        self._values[name] = token
        lease = _RecordingLease(self._values, name, token)
        try:
            yield lease
            lease.assert_owned()
        finally:
            lease.release()


class _InMemoryIndexingLock:
    """Full lock-port fake for a service invocation that receives an owned lease."""

    @staticmethod
    def _lease(name: str) -> _RecordingLease:
        values = {name: "in-memory-owner"}
        return _RecordingLease(values, name, "in-memory-owner")

    def try_acquire(self, name: str, *, timeout: int) -> _RecordingLease:
        assert timeout > 0
        return self._lease(name)

    def try_acquire_handoff(self, name: str, *, timeout: int, owner_id: str) -> _RecordingLease:
        assert timeout > 0
        assert owner_id
        return self._lease(name)

    def hold(
        self,
        name: str,
        *,
        timeout: int,
        expected_token: str | None = None,
        blocking_timeout: float = 0,
    ) -> AbstractContextManager[_RecordingLease]:
        assert timeout > 0
        assert expected_token is None
        assert blocking_timeout >= 0
        return nullcontext(self._lease(name))

    def hold_handoff(
        self,
        name: str,
        *,
        timeout: int,
        owner_id: str,
        blocking_timeout: float = 0,
    ) -> AbstractContextManager[_RecordingLease]:
        assert timeout > 0
        assert owner_id
        assert blocking_timeout >= 0
        return nullcontext(self._lease(name))


class _RecordingRedis:
    def __init__(self, values: dict[str, str]) -> None:
        self._values = values

    def get(self, name: str) -> bytes | None:
        value = self._values.get(name)
        return value.encode() if value is not None else None


@pytest.fixture(autouse=True)
def _document_indexing_lease(monkeypatch: pytest.MonkeyPatch) -> None:
    values = {"document-index": "worker-token"}
    lease = _RecordingLease(values, "document-index", "worker-token")
    monkeypatch.setattr(
        MODULE,
        "_hold_document_indexing_lease",
        lambda _document_id: nullcontext(lease),
    )


class _WebsiteResumeBackend:
    def __init__(self, segments: SQLAlchemySegmentRepository) -> None:
        self._segments = segments
        self.loaded_attachment_ids: list[tuple[str, ...]] = []
        self.loaded_dataset_ids: list[tuple[str, ...]] = []

    @staticmethod
    def describe_error(error: Exception) -> str:
        return str(error)

    @staticmethod
    def check_paused(ref: DocumentRef) -> None:
        del ref

    @staticmethod
    def extract(document: IndexingDocument) -> ExtractionResult[IndexDocument]:
        del document
        raise AssertionError("INDEXING recovery must not extract the website again")

    @staticmethod
    def cleanup_created_upload_files(document: IndexingDocument, file_ids: Sequence[str]) -> None:
        del document, file_ids

    @staticmethod
    def reclaim_upload_files(document: IndexingDocument, file_ids: Sequence[str]) -> None:
        del document, file_ids
        raise AssertionError("test setup has no pending cleanup")

    @staticmethod
    def transform(document: IndexingDocument, texts: list[IndexDocument]) -> IndexingTransformResult:
        del document, texts
        raise AssertionError("INDEXING recovery must not transform the website again")

    @staticmethod
    def ensure_admission(document: IndexingDocument, chunks: list[IndexDocument]) -> None:
        del document, chunks
        raise AssertionError("INDEXING recovery must not repeat admission")

    @staticmethod
    def count_tokens(document: IndexingDocument, chunks: list[IndexDocument]) -> list[int]:
        del document, chunks
        raise AssertionError("INDEXING recovery must reuse persisted token counts")

    def load(self, document: IndexingDocument, chunks: list[IndexDocument]) -> None:
        attachments = [attachment for chunk in chunks for attachment in chunk.attachments or ()]
        self.loaded_attachment_ids.append(tuple(str(attachment.metadata["doc_id"]) for attachment in attachments))
        self.loaded_dataset_ids.append(tuple(str(attachment.metadata["dataset_id"]) for attachment in attachments))
        self._segments.complete_indexing_segments(
            document.ref,
            [str(chunk.metadata["doc_id"]) for chunk in chunks],
        )

    @staticmethod
    def discard(document: IndexingDocument, chunks: list[IndexDocument]) -> None:
        del document, chunks


def _dataset(tenant_id: str) -> Dataset:
    return make_dataset(
        dataset_id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        name="Website dataset",
        data_source_type=DataSourceType.WEBSITE_CRAWL,
        created_by=str(uuid.uuid4()),
    )


def _document(dataset: Dataset) -> Document:
    document = make_document(
        document_id=str(uuid.uuid4()),
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        data_source_type=DataSourceType.WEBSITE_CRAWL,
        name="Website document",
        created_by=str(uuid.uuid4()),
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    return document


def _segment(*, tenant_id: str, dataset_id: str, document_id: str) -> DocumentSegment:
    return DocumentSegment(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        position=1,
        content="content",
        word_count=1,
        tokens=1,
        created_by=str(uuid.uuid4()),
    )


def test_rejects_document_outside_dataset_before_side_effects(
    sqlite_session: Session,
) -> None:
    tenant_id = str(uuid.uuid4())
    requested_dataset = _dataset(tenant_id)
    foreign_dataset = _dataset(tenant_id)
    foreign_document = _document(foreign_dataset)
    sqlite_session.add_all([requested_dataset, foreign_dataset, foreign_document])
    sqlite_session.commit()

    with (
        patch("tasks.sync_website_document_indexing_task.FeatureService") as feature_service,
        patch("tasks.sync_website_document_indexing_task.IndexProcessorFactory") as processor_factory,
    ):
        sync_website_document_indexing_task(
            requested_dataset.id,
            foreign_document.id,
        )

    feature_service.get_features.assert_not_called()
    processor_factory.assert_not_called()


@config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
def test_cleanup_is_owner_scoped_and_skips_empty_vector_ids(
    sqlite_session: Session,
) -> None:
    tenant_id = str(uuid.uuid4())
    dataset = _dataset(tenant_id)
    document = _document(dataset)
    owned_segment = _segment(tenant_id=tenant_id, dataset_id=dataset.id, document_id=document.id)
    other_dataset = _dataset(tenant_id)
    decoy_segments = [
        _segment(tenant_id=tenant_id, dataset_id=dataset.id, document_id=str(uuid.uuid4())),
        _segment(tenant_id=tenant_id, dataset_id=other_dataset.id, document_id=document.id),
        _segment(tenant_id=str(uuid.uuid4()), dataset_id=dataset.id, document_id=document.id),
    ]
    for index, segment in enumerate(decoy_segments):
        segment.index_node_id = f"decoy-node-{index}"
    sqlite_session.add_all([dataset, document, owned_segment, other_dataset, *decoy_segments])
    sqlite_session.commit()

    features = MagicMock()
    lease_values = {"website-sync": "worker-token"}
    lease = _RecordingLease(lease_values, "website-sync", "worker-token")
    with (
        patch("tasks.sync_website_document_indexing_task.FeatureService.get_features", return_value=features),
        patch("tasks.sync_website_document_indexing_task.IndexProcessorFactory") as processor_factory,
        patch("tasks.sync_website_document_indexing_task.build_document_indexing_service") as indexing_runner,
        patch("tasks.sync_website_document_indexing_task._validate_website_source_identity"),
        patch(
            "tasks.sync_website_document_indexing_task._hold_website_sync_lease",
            return_value=nullcontext(lease),
        ) as hold_lease,
        patch("tasks.sync_website_document_indexing_task.redis_client") as redis,
    ):
        sync_website_document_indexing_task(dataset.id, document.id)

    hold_lease.assert_called_once_with(document.id)
    processor_factory.return_value.init_index_processor.return_value.clean.assert_not_called()
    indexing_runner.return_value.run.assert_called_once()
    refs = indexing_runner.return_value.run.call_args.args[0]
    assert refs[0].document_id == document.id
    assert set(indexing_runner.return_value.run.call_args.kwargs["owned_leases"]) == {document.id}
    redis.delete.assert_not_called()
    sqlite_session.expire_all()
    assert set(sqlite_session.scalars(select(DocumentSegment.id))) == {segment.id for segment in decoy_segments}


@config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
def test_source_identity_failure_preserves_published_index_and_completed_state(sqlite_session: Session) -> None:
    tenant_id = str(uuid.uuid4())
    dataset = _dataset(tenant_id)
    document = _document(dataset)
    document.indexing_status = IndexingStatus.WAITING
    document.completed_at = naive_utc_now()
    segment = _segment(tenant_id=tenant_id, dataset_id=dataset.id, document_id=document.id)
    segment.index_node_id = "published-node"
    sqlite_session.add_all([dataset, document, segment])
    sqlite_session.commit()

    lease_values = {"website-sync": "worker-token"}
    lease = _RecordingLease(lease_values, "website-sync", "worker-token")
    with (
        patch(
            "tasks.sync_website_document_indexing_task._validate_website_source_identity",
            side_effect=ValueError("provider instance is not recorded"),
        ),
        patch("tasks.sync_website_document_indexing_task.IndexProcessorFactory") as processor_factory,
        patch("tasks.sync_website_document_indexing_task.build_document_indexing_service") as indexing_runner,
        patch(
            "tasks.sync_website_document_indexing_task._hold_website_sync_lease",
            return_value=nullcontext(lease),
        ),
        patch("tasks.sync_website_document_indexing_task.redis_client") as redis,
    ):
        sync_website_document_indexing_task(dataset.id, document.id)

    processor_factory.assert_not_called()
    indexing_runner.assert_not_called()
    sqlite_session.expire_all()
    persisted_document = sqlite_session.get(Document, document.id)
    assert persisted_document is not None
    assert persisted_document.indexing_status == "completed"
    assert persisted_document.error is None
    assert sqlite_session.get(DocumentSegment, segment.id) is not None
    redis.delete.assert_not_called()


@config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
def test_source_identity_failure_does_not_mark_never_completed_document_successful(
    sqlite_session: Session,
) -> None:
    tenant_id = str(uuid.uuid4())
    dataset = _dataset(tenant_id)
    document = _document(dataset)
    document.indexing_status = IndexingStatus.WAITING
    document.completed_at = None
    segment = _segment(tenant_id=tenant_id, dataset_id=dataset.id, document_id=document.id)
    sqlite_session.add_all([dataset, document, segment])
    sqlite_session.commit()

    lease_values = {"website-sync": "worker-token"}
    lease = _RecordingLease(lease_values, "website-sync", "worker-token")
    with (
        patch(
            "tasks.sync_website_document_indexing_task._validate_website_source_identity",
            side_effect=ValueError("provider instance is not recorded"),
        ),
        patch("tasks.sync_website_document_indexing_task.IndexProcessorFactory") as processor_factory,
        patch("tasks.sync_website_document_indexing_task.build_document_indexing_service") as indexing_runner,
        patch(
            "tasks.sync_website_document_indexing_task._hold_website_sync_lease",
            return_value=nullcontext(lease),
        ),
        patch("tasks.sync_website_document_indexing_task.redis_client") as redis,
    ):
        sync_website_document_indexing_task(dataset.id, document.id)

    processor_factory.assert_not_called()
    indexing_runner.assert_not_called()
    sqlite_session.expire_all()
    persisted_document = sqlite_session.get(Document, document.id)
    assert persisted_document is not None
    assert persisted_document.indexing_status == "error"
    assert persisted_document.error == "Website source is not executable: provider instance is not recorded"
    assert persisted_document.completed_at is None
    assert persisted_document.stopped_at is not None
    assert sqlite_session.get(DocumentSegment, segment.id) is not None
    redis.delete.assert_not_called()


@config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
def test_lost_lease_after_parsing_commit_retries_the_same_message(sqlite_session: Session) -> None:
    tenant_id = str(uuid.uuid4())
    dataset = _dataset(tenant_id)
    document = _document(dataset)
    sqlite_session.add_all([dataset, document])
    sqlite_session.commit()

    first_values = {"website-sync": "first-worker"}
    first_lease = _LoseOwnershipOnCheckLease(
        first_values,
        "website-sync",
        "first-worker",
        lose_on_check=5,
    )
    second_values = {"website-sync": "second-worker"}
    second_lease = _RecordingLease(second_values, "website-sync", "second-worker")
    with (
        patch("tasks.sync_website_document_indexing_task._validate_website_source_identity"),
        patch("tasks.sync_website_document_indexing_task.IndexProcessorFactory"),
        patch("tasks.sync_website_document_indexing_task.build_document_indexing_service") as indexing_runner,
        patch(
            "tasks.sync_website_document_indexing_task._hold_website_sync_lease",
            side_effect=[nullcontext(first_lease), nullcontext(second_lease)],
        ),
        patch.object(sync_website_document_indexing_task, "retry", side_effect=Retry()) as retry,
    ):
        indexing_runner.return_value.run.side_effect = [None, None]
        with pytest.raises(Retry):
            sync_website_document_indexing_task.run(dataset.id, document.id)

        sqlite_session.expire_all()
        interrupted = sqlite_session.get_one(Document, document.id)
        assert interrupted.indexing_status == "parsing"

        sync_website_document_indexing_task.run(dataset.id, document.id)
        assert indexing_runner.return_value.run.call_count == 2

    assert indexing_runner.return_value.run.call_count == 2
    retry.assert_called_once()
    assert isinstance(retry.call_args.kwargs["exc"], KnowledgeIndexingLeaseLostError)
    assert sync_website_document_indexing_task.acks_late is True
    assert sync_website_document_indexing_task.reject_on_worker_lost is True
    assert sync_website_document_indexing_task.max_retries == 12


@config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
@pytest.mark.parametrize(
    ("status", "resume_method"),
    [
        (IndexingStatus.SPLITTING, "run_in_splitting_status"),
        (IndexingStatus.INDEXING, "run_in_indexing_status"),
    ],
)
def test_redelivery_resumes_the_persisted_indexing_phase(
    sqlite_session: Session,
    status: IndexingStatus,
    resume_method: str,
) -> None:
    tenant_id = str(uuid.uuid4())
    dataset = _dataset(tenant_id)
    document = _document(dataset)
    document.indexing_status = status
    sqlite_session.add_all([dataset, document])
    sqlite_session.commit()
    lease_values = {"website-sync": "worker-token"}
    lease = _RecordingLease(lease_values, "website-sync", "worker-token")

    with (
        patch("tasks.sync_website_document_indexing_task._validate_website_source_identity") as validate_source,
        patch("tasks.sync_website_document_indexing_task.IndexProcessorFactory") as processor_factory,
        patch("tasks.sync_website_document_indexing_task.build_document_indexing_service") as indexing_runner,
        patch(
            "tasks.sync_website_document_indexing_task._hold_website_sync_lease",
            return_value=nullcontext(lease),
        ),
    ):
        sync_website_document_indexing_task.run(dataset.id, document.id)

    resume = (
        indexing_runner.return_value.run_in_indexing_status
        if resume_method == "run_in_indexing_status"
        else indexing_runner.return_value.run_in_splitting_status
    )
    resume.assert_called_once()
    assert resume.call_args.kwargs["owned_lease"] is not None
    indexing_runner.return_value.run.assert_not_called()
    processor_factory.assert_not_called()
    if status == "indexing":
        validate_source.assert_not_called()
    else:
        validate_source.assert_called_once()


@config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
def test_indexing_redelivery_restores_scoped_attachment_vectors_and_completes_document(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant_id = str(uuid.uuid4())
    dataset = _dataset(tenant_id)
    dataset.indexing_technique = "high_quality"
    dataset.is_multimodal = True
    document = _document(dataset)
    document.indexing_status = IndexingStatus.INDEXING
    segment = _segment(tenant_id=tenant_id, dataset_id=dataset.id, document_id=document.id)
    segment.index_node_id = "website-node"
    segment.index_node_hash = "website-hash"
    segment.status = SegmentStatus.INDEXING

    other_dataset = _dataset(tenant_id)
    other_document = _document(other_dataset)
    other_segment = _segment(
        tenant_id=tenant_id,
        dataset_id=other_dataset.id,
        document_id=other_document.id,
    )
    attachment = make_upload_file(
        tenant_id=tenant_id,
        name="shared-image.png",
        extension="png",
        mime_type="image/png",
    )
    sqlite_session.add_all(
        [
            dataset,
            document,
            segment,
            other_dataset,
            other_document,
            other_segment,
            attachment,
        ]
    )
    sqlite_session.flush()
    current_binding = SegmentAttachmentBinding(
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        segment_id=segment.id,
        attachment_id=attachment.id,
    )
    other_binding = SegmentAttachmentBinding(
        tenant_id=tenant_id,
        dataset_id=other_dataset.id,
        document_id=other_document.id,
        segment_id=other_segment.id,
        attachment_id=attachment.id,
    )
    sqlite_session.add_all([current_binding, other_binding])
    sqlite_session.commit()

    documents = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    segments = SQLAlchemySegmentRepository(session_factory=sqlite_session_factory)
    backend = _WebsiteResumeBackend(segments)
    indexing = DocumentIndexingService(
        documents=documents,
        segments=segments,
        backend=backend,
        indexing_locks=_InMemoryIndexingLock(),
    )
    lease_values = {"website-sync": "worker-token"}
    lease = _RecordingLease(lease_values, "website-sync", "worker-token")
    monkeypatch.setattr(MODULE, "build_document_indexing_service", lambda **_kwargs: indexing)
    monkeypatch.setattr(
        MODULE,
        "_hold_website_sync_lease",
        lambda *_args, **_kwargs: nullcontext(lease),
    )

    sync_website_document_indexing_task.run(dataset.id, document.id)

    assert backend.loaded_attachment_ids == [(attachment.id,)]
    assert backend.loaded_dataset_ids == [(dataset.id,)]
    sqlite_session.expire_all()
    assert sqlite_session.get_one(Document, document.id).indexing_status == IndexingStatus.COMPLETED
    assert sqlite_session.get_one(DocumentSegment, segment.id).status == SegmentStatus.COMPLETED
    persisted_bindings = sqlite_session.scalars(select(SegmentAttachmentBinding)).all()
    assert {
        (binding.dataset_id, binding.document_id, binding.segment_id, binding.attachment_id)
        for binding in persisted_bindings
    } == {
        (dataset.id, document.id, segment.id, attachment.id),
        (other_dataset.id, other_document.id, other_segment.id, attachment.id),
    }


def test_worker_lease_serializes_token_observation_and_preserves_replacement(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    marker_name = MODULE._sync_marker_name("document-1")
    worker_name = f"{marker_name}:worker"
    values = {marker_name: "producer-token"}
    locks = _RecordingLocks(values)
    monkeypatch.setattr(MODULE, "RedisKnowledgeIndexingLock", lambda **_kwargs: locks)
    monkeypatch.setattr(MODULE, "redis_client", _RecordingRedis(values))

    def claim_duplicate() -> None:
        with MODULE._hold_website_sync_lease("document-1"):
            raise AssertionError("duplicate worker entered the sync lease")

    def lose_lease_to_replacement() -> None:
        with MODULE._hold_website_sync_lease("document-1") as lease:
            assert values[marker_name] == lease.token
            with pytest.raises(KnowledgeIndexingLockBusyError):
                claim_duplicate()

            # Simulate expiry followed by a new producer. The old lease must
            # report loss and its compare-token release must preserve this value.
            values[marker_name] = "replacement-producer-token"

    with pytest.raises(KnowledgeIndexingLeaseLostError):
        lose_lease_to_replacement()

    assert values[marker_name] == "replacement-producer-token"
    assert worker_name not in values


def test_worker_cannot_adopt_a_marker_replaced_after_observation(monkeypatch: pytest.MonkeyPatch) -> None:
    marker_name = MODULE._sync_marker_name("document-1")
    values = {marker_name: "producer-token"}
    locks = _RecordingLocks(values)

    class ReplacedMarkerRedis(_RecordingRedis):
        @override
        def get(self, name: str) -> bytes | None:
            observed = super().get(name)
            values[name] = "new-producer-token"
            return observed

    monkeypatch.setattr(MODULE, "RedisKnowledgeIndexingLock", lambda **_kwargs: locks)
    monkeypatch.setattr(MODULE, "redis_client", ReplacedMarkerRedis(values))

    with pytest.raises(KnowledgeIndexingLockBusyError):
        with MODULE._hold_website_sync_lease("document-1"):
            raise AssertionError("worker adopted a marker replaced after observation")

    assert values[marker_name] == "new-producer-token"


def test_worker_lease_recovers_after_the_producer_marker_expires(monkeypatch: pytest.MonkeyPatch) -> None:
    marker_name = MODULE._sync_marker_name("document-1")
    worker_name = f"{marker_name}:worker"
    values: dict[str, str] = {}
    locks = _RecordingLocks(values)
    monkeypatch.setattr(MODULE, "RedisKnowledgeIndexingLock", lambda **_kwargs: locks)
    monkeypatch.setattr(MODULE, "redis_client", _RecordingRedis(values))

    with MODULE._hold_website_sync_lease("document-1") as lease:
        assert values[marker_name] == lease.token
        assert worker_name in values

    assert marker_name not in values
    assert worker_name not in values


def test_worker_does_not_adopt_an_active_worker_token_when_mutex_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    marker_name = MODULE._sync_marker_name("document-1")
    active_worker = f"{MODULE._SYNC_WORKER_TOKEN_PREFIX}active"
    values = {marker_name: active_worker}
    locks = _RecordingLocks(values)
    monkeypatch.setattr(MODULE, "RedisKnowledgeIndexingLock", lambda **_kwargs: locks)
    monkeypatch.setattr(MODULE, "redis_client", _RecordingRedis(values))

    def claim_active_worker() -> None:
        with MODULE._hold_website_sync_lease("document-1"):
            raise AssertionError("duplicate worker adopted an active worker token")

    with pytest.raises(KnowledgeIndexingLockBusyError):
        claim_active_worker()

    assert values[marker_name] == active_worker
    assert f"{marker_name}:worker" not in values


def test_completed_document_drops_stale_message_before_redis_claim(sqlite_session: Session) -> None:
    tenant_id = str(uuid.uuid4())
    dataset = _dataset(tenant_id)
    document = _document(dataset)
    document.indexing_status = IndexingStatus.COMPLETED
    sqlite_session.add_all([dataset, document])
    sqlite_session.commit()

    with patch("tasks.sync_website_document_indexing_task._hold_website_sync_lease") as hold_lease:
        sync_website_document_indexing_task(dataset.id, document.id)

    hold_lease.assert_not_called()
