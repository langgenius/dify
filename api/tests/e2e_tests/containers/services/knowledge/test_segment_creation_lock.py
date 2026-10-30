"""Document-index lock coordination for manual segment creation."""

from collections.abc import Generator, Sequence
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from threading import Event
from typing import cast
from uuid import uuid4

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.models.document import Document as IndexDocument
from extensions.ext_redis import redis_client
from libs.helper import generate_text_hash
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.segment_repository import SQLAlchemySegmentRepository
from services.extraction.contracts import ExtractionResult
from services.knowledge.entities.resource_scope import DatasetRef, DocumentRef
from services.knowledge.entities.segments import SegmentUpdateArgs
from services.knowledge.indexing.adapters.redis_lock import RedisKnowledgeIndexingLock
from services.knowledge.indexing.contracts import IndexingDocument
from services.knowledge.indexing.execution import (
    DocumentIndexingService,
    IndexingBackend,
    IndexingTransformResult,
)
from services.knowledge.indexing.locks import document_index_lock_name
from services.knowledge.segments.adapters import RedisSegmentIndexingState
from services.knowledge.segments.application import (
    SegmentIndex,
    SegmentIndexingState,
    SegmentMutationService,
    SegmentUploadCatalog,
)
from services.knowledge.segments.contracts import SegmentDatasetRecord, SegmentDocumentRecord, SegmentMutationScope


class _ObservedIndexingState:
    def __init__(self, state: RedisSegmentIndexingState, attempted: Event, entered: Event) -> None:
        self._state = state
        self._attempted = attempted
        self._entered = entered

    @contextmanager
    def lock(self, name: str, *, timeout: int) -> Generator[object]:
        self._attempted.set()
        with self._state.lock(name, timeout=timeout) as lease:
            self._entered.set()
            yield lease


class _RecordingIndex:
    def __init__(self, published: Event) -> None:
        self._published = published

    def count_tokens_many(self, dataset: SegmentDatasetRecord, texts: Sequence[str]) -> list[int]:
        del dataset
        return [0] * len(texts)

    def count_tokens(self, dataset: SegmentDatasetRecord, text: str) -> int:
        del dataset, text
        return 0

    def create_many(
        self,
        document_ref: DocumentRef,
        *,
        segment_ids: Sequence[str],
        keywords_list: Sequence[Sequence[str] | None] | None,
    ) -> None:
        del document_ref, segment_ids, keywords_list
        self._published.set()


class _NoUploads:
    def get_existing_file_ids(self, *, workspace_id: str, file_ids: Sequence[str]) -> frozenset[str]:
        del workspace_id
        return frozenset(file_ids)


class _ControlledIndexingBackend:
    def __init__(
        self,
        *,
        segments: SQLAlchemySegmentRepository,
        extraction_started: Event,
        continue_extraction: Event,
    ) -> None:
        self._segments = segments
        self._extraction_started = extraction_started
        self._continue_extraction = continue_extraction

    def describe_error(self, error: Exception) -> str:
        return str(error)

    def check_paused(self, ref: DocumentRef) -> None:
        del ref

    def extract(self, document: IndexingDocument) -> ExtractionResult[IndexDocument]:
        del document
        self._extraction_started.set()
        assert self._continue_extraction.wait(timeout=10)
        return ExtractionResult(
            documents=[
                IndexDocument(
                    page_content="full indexing segment",
                    metadata={"doc_id": "full-index-node", "doc_hash": "full-index-hash"},
                )
            ]
        )

    def cleanup_created_upload_files(self, document: IndexingDocument, file_ids: Sequence[str]) -> None:
        del document, file_ids

    def reclaim_upload_files(self, document: IndexingDocument, file_ids: Sequence[str]) -> None:
        del document, file_ids

    def transform(
        self,
        document: IndexingDocument,
        texts: list[IndexDocument],
    ) -> IndexingTransformResult:
        del document
        return IndexingTransformResult(chunks=texts)

    def ensure_admission(self, document: IndexingDocument, chunks: list[IndexDocument]) -> None:
        del document, chunks

    def count_tokens(self, document: IndexingDocument, chunks: list[IndexDocument]) -> list[int]:
        del document
        return [len(chunk.page_content) for chunk in chunks]

    def load(self, document: IndexingDocument, chunks: list[IndexDocument]) -> None:
        self._segments.complete_indexing_segments(
            document.ref,
            [str(chunk.metadata["doc_id"]) for chunk in chunks],
        )


def test_full_indexing_lock_blocks_manual_segment_persistence_and_publication(
    db_session_with_containers: Session,
) -> None:
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    document_id = str(uuid4())
    actor_id = str(uuid4())
    with sessions.begin() as session:
        session.add(
            Dataset(
                id=dataset_id,
                tenant_id=tenant_id,
                name="Segment lock coordination",
                data_source_type=DataSourceType.UPLOAD_FILE,
                indexing_technique="economy",
                created_by=actor_id,
            )
        )
        session.add(
            Document(
                id=document_id,
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                position=1,
                data_source_type=DataSourceType.UPLOAD_FILE,
                batch=str(uuid4()),
                name="segments.txt",
                created_from=DocumentCreatedFrom.WEB,
                created_by=actor_id,
                indexing_status=IndexingStatus.COMPLETED,
                doc_form=IndexStructureType.PARAGRAPH_INDEX,
                word_count=0,
            )
        )

    manual_lock_attempted = Event()
    manual_lock_entered = Event()
    published = Event()
    extraction_started = Event()
    continue_extraction = Event()
    locks = RedisKnowledgeIndexingLock(redis=redis_client, heartbeat_interval=60, poll_interval=0.01)
    state = _ObservedIndexingState(
        RedisSegmentIndexingState(redis_client, locks=locks),
        manual_lock_attempted,
        manual_lock_entered,
    )
    segments = SQLAlchemySegmentRepository(session_factory=sessions)
    mutation = SegmentMutationService(
        store=segments,
        index=cast(SegmentIndex, _RecordingIndex(published)),
        text_hash=generate_text_hash,
        uploads=cast(SegmentUploadCatalog, _NoUploads()),
        indexing_state=cast(SegmentIndexingState, state),
    )
    indexing = DocumentIndexingService(
        documents=SQLAlchemyDocumentRepository(session_factory=sessions),
        segments=segments,
        backend=cast(
            IndexingBackend,
            _ControlledIndexingBackend(
                segments=segments,
                extraction_started=extraction_started,
                continue_extraction=continue_extraction,
            ),
        ),
        indexing_locks=locks,
    )
    scope = SegmentMutationScope(
        dataset=SegmentDatasetRecord(dataset_id, tenant_id, "economy", None, None),
        document=SegmentDocumentRecord(document_id, dataset_id, tenant_id, "text_model"),
    )
    lock_name = document_index_lock_name(document_id)
    executor = ThreadPoolExecutor(max_workers=2)
    try:
        indexing_future = executor.submit(indexing.run, [scope.document.ref])
        assert extraction_started.wait(timeout=5)
        manual_future = executor.submit(
            mutation.create_segment,
            scope,
            actor_id=actor_id,
            args=SegmentUpdateArgs(content="manual segment"),
        )
        assert manual_lock_attempted.wait(timeout=5)
        assert not manual_lock_entered.wait(timeout=0.2)
        with sessions() as session:
            segment_ids = session.scalars(
                select(DocumentSegment.id).where(DocumentSegment.document_id == document_id)
            ).all()
            assert segment_ids == []
        assert not manual_future.done()
        assert not published.is_set()

        continue_extraction.set()
        indexing_future.result(timeout=10)
        assert manual_lock_entered.wait(timeout=5)
        assert manual_future.result(timeout=10).document.document_id == document_id
        assert published.wait(timeout=5)
        with sessions() as session:
            segments_by_content = dict(
                session.execute(
                    select(DocumentSegment.content, DocumentSegment.index_node_id).where(
                        DocumentSegment.document_id == document_id
                    )
                ).tuples()
            )
            assert segments_by_content["full indexing segment"] == "full-index-node"
            assert segments_by_content["manual segment"] is not None
    finally:
        continue_extraction.set()
        executor.shutdown(wait=True, cancel_futures=True)
        redis_client.delete(lock_name)
        with sessions.begin() as session:
            session.execute(delete(DocumentSegment).where(DocumentSegment.document_id == document_id))
            session.execute(delete(Document).where(Document.id == document_id))
            session.execute(delete(Dataset).where(Dataset.id == dataset_id))


def test_document_cleanup_waits_until_index_writer_has_finished(
    db_session_with_containers: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from services.knowledge.indexing.adapters import cleanup
    from services.knowledge.indexing.adapters.cleanup import clean_document_indexes

    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    tenant_id, dataset_id, document_id, actor_id = (str(uuid4()) for _ in range(4))
    with sessions.begin() as session:
        session.add(
            Dataset(
                id=dataset_id,
                tenant_id=tenant_id,
                name="cleanup lock",
                created_by=actor_id,
                data_source_type=DataSourceType.UPLOAD_FILE,
                indexing_technique="economy",
            )
        )
        session.add(
            Document(
                id=document_id,
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                name="document",
                position=1,
                batch=str(uuid4()),
                data_source_type=DataSourceType.UPLOAD_FILE,
                created_from=DocumentCreatedFrom.WEB,
                created_by=actor_id,
                indexing_status=IndexingStatus.COMPLETED,
                doc_form=IndexStructureType.PARAGRAPH_INDEX,
            )
        )
    entered = Event()
    release = Event()
    cleanup_attempted = Event()
    cleaned = Event()
    remote_nodes: set[str] = set()
    segments = SQLAlchemySegmentRepository(session_factory=sessions)
    ready = Event()
    ready.set()
    backend = _ControlledIndexingBackend(segments=segments, extraction_started=Event(), continue_extraction=ready)

    def slow_load(document: IndexingDocument, chunks: list[IndexDocument]) -> None:
        entered.set()
        assert release.wait(timeout=10)
        remote_nodes.update(str(chunk.metadata["doc_id"]) for chunk in chunks)
        segments.complete_indexing_segments(document.ref, [str(chunk.metadata["doc_id"]) for chunk in chunks])

    def delete_keywords(
        _self: object, _chunks: list[IndexDocument], *, deleted_ids: Sequence[str], **_kwargs: object
    ) -> None:
        remote_nodes.difference_update(deleted_ids)
        cleaned.set()

    monkeypatch.setattr(backend, "load", slow_load)
    monkeypatch.setattr(cleanup.Jieba, "update_texts", delete_keywords)
    indexing = DocumentIndexingService(
        documents=SQLAlchemyDocumentRepository(session_factory=sessions),
        segments=segments,
        backend=cast(IndexingBackend, backend),
        indexing_locks=RedisKnowledgeIndexingLock(redis=redis_client),
    )

    def clean() -> None:
        cleanup_attempted.set()
        clean_document_indexes(
            dataset_id=dataset_id,
            document_ids=[document_id],
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
            new_session=sessions,
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        writer = executor.submit(indexing.run, [DatasetRef(tenant_id, dataset_id).document(document_id)])
        try:
            assert entered.wait(timeout=5)
            cleaner = executor.submit(clean)
            assert cleanup_attempted.wait(timeout=5)
            assert not cleaned.wait(timeout=0.2)
            assert not cleaner.done()
        finally:
            release.set()
        writer.result(timeout=10)
        cleaner.result(timeout=10)
    assert cleaned.is_set()
    assert remote_nodes == set()
    with sessions.begin() as session:
        session.execute(delete(DocumentSegment).where(DocumentSegment.document_id == document_id))
        session.execute(delete(Document).where(Document.id == document_id))
        session.execute(delete(Dataset).where(Dataset.id == dataset_id))
