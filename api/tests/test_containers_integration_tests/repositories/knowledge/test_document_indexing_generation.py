"""PostgreSQL guarantees for document indexing generation and execution fences."""

from concurrent.futures import ThreadPoolExecutor, TimeoutError
from datetime import timedelta
from threading import Event
from uuid import uuid4

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, DatasetAutoDisableLog, Document, DocumentSegment
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus
from models.knowledge_task import KnowledgeTaskOutbox
from repositories.knowledge.document_repository import (
    SQLAlchemyDocumentRepository,
    complete_document_index_add,
    complete_document_index_remove,
)
from services.knowledge.indexing.contracts import DocumentIndexingExecution
from services.knowledge.indexing.errors import DocumentIndexingGenerationChangedError
from services.knowledge.resource_scope import DatasetRef, DocumentRef
from services.knowledge.task_outbox.contracts import KnowledgeTaskExecutionLeaseLostError, KnowledgeTaskKind


def _create_indexing_document(session: Session) -> tuple[DocumentRef, str]:
    tenant_id = str(uuid4())
    actor_id = str(uuid4())
    generation = str(uuid4())
    dataset = Dataset(
        tenant_id=tenant_id,
        name=f"dataset-{uuid4()}",
        description="",
        provider="vendor",
        permission="only_me",
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.ECONOMY,
        created_by=actor_id,
        maintainer=actor_id,
    )
    session.add(dataset)
    session.flush()
    document = Document(
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch=f"batch-{uuid4()}",
        name="document.txt",
        created_from=DocumentCreatedFrom.API,
        created_by=actor_id,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
        word_count=8,
        tokens=11,
        indexing_latency=0.25,
        indexing_status=IndexingStatus.INDEXING,
        indexing_generation=generation,
        enabled=True,
        archived=False,
        is_paused=False,
    )
    session.add(document)
    session.flush()
    ref = DatasetRef(tenant_id, dataset.id).document(document.id)
    session.commit()
    return ref, generation


def _repository(session: Session) -> SQLAlchemyDocumentRepository:
    return SQLAlchemyDocumentRepository(
        session_factory=sessionmaker(bind=session.get_bind(), expire_on_commit=False),
    )


def _create_executing_document_intent(
    session: Session,
    ref: DocumentRef,
    generation: str,
    *,
    execution_id: str,
) -> KnowledgeTaskOutbox:
    intent = KnowledgeTaskOutbox(
        tenant_id=ref.dataset.tenant_id,
        dataset_id=ref.dataset.dataset_id,
        document_id=ref.document_id,
        resource_id=ref.document_id,
        task_kind=KnowledgeTaskKind.DOCUMENT_INDEX_CREATE.value,
        payload={
            "tenant_id": ref.dataset.tenant_id,
            "dataset_id": ref.dataset.dataset_id,
            "document_ids": [ref.document_id],
            "generations": {ref.document_id: generation},
        },
        status="executing",
        claim_id=execution_id,
        claimed_at=naive_utc_now(),
        available_at=naive_utc_now() + timedelta(minutes=5),
    )
    session.add(intent)
    session.flush()
    return intent


def test_stale_generation_cannot_complete_or_fail_successor_state(
    db_session_with_containers: Session,
) -> None:
    ref, current_generation = _create_indexing_document(db_session_with_containers)
    repository = _repository(db_session_with_containers)
    stale_execution = DocumentIndexingExecution(
        expected_generation=str(uuid4()),
        assert_owned=lambda: None,
    )

    with pytest.raises(DocumentIndexingGenerationChangedError):
        repository.complete_indexing(ref, tokens=99, latency=9.5, execution=stale_execution)
    repository.fail_indexing(ref, "late failure", execution=stale_execution)

    db_session_with_containers.rollback()
    persisted = db_session_with_containers.get(Document, ref.document_id)
    assert persisted is not None
    assert persisted.indexing_generation == current_generation
    assert persisted.indexing_status == IndexingStatus.INDEXING
    assert persisted.tokens == 11
    assert persisted.indexing_latency == 0.25
    assert persisted.completed_at is None
    assert persisted.stopped_at is None
    assert persisted.error is None


def test_lost_execution_lease_rolls_back_completion_transaction(
    db_session_with_containers: Session,
) -> None:
    ref, generation = _create_indexing_document(db_session_with_containers)
    repository = _repository(db_session_with_containers)
    ownership_checks = 0

    def assert_owned() -> None:
        nonlocal ownership_checks
        ownership_checks += 1
        if ownership_checks == 2:
            raise KnowledgeTaskExecutionLeaseLostError("execution lease was reclaimed")

    execution = DocumentIndexingExecution(expected_generation=generation, assert_owned=assert_owned)

    with pytest.raises(KnowledgeTaskExecutionLeaseLostError, match="reclaimed"):
        repository.complete_indexing(ref, tokens=99, latency=9.5, execution=execution)

    assert ownership_checks == 2
    db_session_with_containers.rollback()
    persisted = db_session_with_containers.get(Document, ref.document_id)
    assert persisted is not None
    assert persisted.indexing_generation == generation
    assert persisted.indexing_status == IndexingStatus.INDEXING
    assert persisted.tokens == 11
    assert persisted.indexing_latency == 0.25
    assert persisted.completed_at is None
    assert persisted.error is None


def test_ordinary_completion_commits_with_exact_task_execution_claim(
    db_session_with_containers: Session,
) -> None:
    ref, generation = _create_indexing_document(db_session_with_containers)
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    execution_id = str(uuid4())
    with sessions.begin() as session:
        intent = _create_executing_document_intent(session, ref, generation, execution_id=execution_id)
        intent_id = intent.id

    repository = SQLAlchemyDocumentRepository(session_factory=sessions)
    execution = DocumentIndexingExecution(
        expected_generation=generation,
        assert_owned=lambda: None,
        task_intent_id=intent_id,
        task_execution_id=execution_id,
    )

    repository.complete_indexing(ref, tokens=99, latency=9.5, execution=execution)

    with sessions() as session:
        persisted = session.get(Document, ref.document_id)
        assert persisted is not None
        assert persisted.indexing_status == IndexingStatus.COMPLETED
        assert persisted.tokens == 99
        assert persisted.indexing_latency == 9.5


def test_ordinary_completion_claim_takeover_at_final_guard_rolls_back_domain_state(
    db_session_with_containers: Session,
) -> None:
    ref, generation = _create_indexing_document(db_session_with_containers)
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    previous_execution_id = str(uuid4())
    successor_execution_id = str(uuid4())
    with sessions.begin() as session:
        intent = _create_executing_document_intent(
            session,
            ref,
            generation,
            execution_id=previous_execution_id,
        )
        intent_id = intent.id

    ownership_checks = 0

    def replace_claim_before_final_guard() -> None:
        nonlocal ownership_checks
        ownership_checks += 1
        if ownership_checks != 2:
            return
        with sessions.begin() as session:
            intent = session.get(KnowledgeTaskOutbox, intent_id, with_for_update=True)
            assert intent is not None
            intent.claim_id = successor_execution_id

    repository = SQLAlchemyDocumentRepository(session_factory=sessions)
    execution = DocumentIndexingExecution(
        expected_generation=generation,
        assert_owned=replace_claim_before_final_guard,
        task_intent_id=intent_id,
        task_execution_id=previous_execution_id,
    )

    with pytest.raises(KnowledgeTaskExecutionLeaseLostError, match="lost its execution claim"):
        repository.complete_indexing(ref, tokens=99, latency=9.5, execution=execution)

    assert ownership_checks == 2
    with sessions() as session:
        persisted = session.get(Document, ref.document_id)
        intent = session.get(KnowledgeTaskOutbox, intent_id)
        assert persisted is not None
        assert intent is not None
        assert persisted.indexing_generation == generation
        assert persisted.indexing_status == IndexingStatus.INDEXING
        assert persisted.tokens == 11
        assert persisted.indexing_latency == 0.25
        assert persisted.completed_at is None
        assert persisted.error is None
        assert intent.status == "executing"
        assert intent.claim_id == successor_execution_id


def test_pipeline_completion_commits_required_summary_intent_atomically(
    db_session_with_containers: Session,
) -> None:
    ref, generation = _create_indexing_document(db_session_with_containers)
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    with sessions.begin() as session:
        dataset = session.get(Dataset, ref.dataset.dataset_id)
        document = session.get(Document, ref.document_id)
        assert dataset is not None
        assert document is not None
        dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
        dataset.summary_index_setting = {"enable": True}
        session.add(
            DocumentSegment(
                tenant_id=ref.dataset.tenant_id,
                dataset_id=ref.dataset.dataset_id,
                document_id=ref.document_id,
                position=1,
                content="pipeline segment",
                word_count=3,
                tokens=2,
                created_by=document.created_by,
                status=SegmentStatus.INDEXING,
            )
        )

    repository = SQLAlchemyDocumentRepository(session_factory=sessions)
    execution_id = str(uuid4())
    assert repository.claim_pipeline_indexing_execution(
        ref,
        execution_id=execution_id,
        expected_generation=generation,
    )
    execution = DocumentIndexingExecution(
        expected_generation=generation,
        assert_owned=lambda: None,
        execution_id=execution_id,
    )
    with sessions.begin() as session:
        assert (
            repository.complete_pipeline_indexing(
                session,
                ref,
                latency=1.5,
                need_summary=True,
                execution=execution,
            )
            == 3
        )

    with sessions() as session:
        document = session.get(Document, ref.document_id)
        intent = session.scalar(
            select(KnowledgeTaskOutbox).where(
                KnowledgeTaskOutbox.task_kind == "document_summary_index",
                KnowledgeTaskOutbox.document_id == ref.document_id,
            )
        )
        assert document is not None
        assert document.indexing_status == IndexingStatus.COMPLETED
        assert document.need_summary is True
        assert intent is not None
        assert intent.payload["expected_generation"] == generation


def test_pipeline_completion_row_lock_keeps_ownership_until_atomic_commit(
    db_session_with_containers: Session,
) -> None:
    ref, generation = _create_indexing_document(db_session_with_containers)
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    repository = SQLAlchemyDocumentRepository(session_factory=sessions)
    previous_execution_id = str(uuid4())
    successor_execution_id = str(uuid4())
    assert repository.claim_pipeline_indexing_execution(
        ref,
        execution_id=previous_execution_id,
        expected_generation=generation,
    )
    execution = DocumentIndexingExecution(
        expected_generation=generation,
        assert_owned=lambda: None,
        execution_id=previous_execution_id,
    )
    entered_commit = Event()
    allow_commit = Event()
    completion_session = sessions()

    def pause_before_commit(_session: Session) -> None:
        entered_commit.set()
        assert allow_commit.wait(timeout=10)

    event.listen(completion_session, "before_commit", pause_before_commit)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            completion = executor.submit(
                repository.complete_pipeline_indexing,
                completion_session,
                ref,
                latency=1,
                need_summary=False,
                execution=execution,
            )
            assert entered_commit.wait(timeout=10)
            takeover = executor.submit(
                repository.claim_pipeline_indexing_execution,
                ref,
                execution_id=successor_execution_id,
                expected_generation=generation,
            )
            with pytest.raises(TimeoutError):
                takeover.result(timeout=0.2)
            allow_commit.set()
            assert completion.result(timeout=10) == 0
            assert takeover.result(timeout=10) is False
    finally:
        allow_commit.set()
        event.remove(completion_session, "before_commit", pause_before_commit)
        completion_session.close()

    with sessions() as session:
        document = session.get(Document, ref.document_id)
        assert document is not None
        assert document.indexing_status == IndexingStatus.COMPLETED
        assert document.indexing_execution_id is None


def test_current_generation_add_completion_enables_segments_and_clears_disable_log(
    db_session_with_containers: Session,
) -> None:
    ref, generation = _create_indexing_document(db_session_with_containers)
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    disabled_by = str(uuid4())
    with sessions.begin() as session:
        document = session.get(Document, ref.document_id)
        assert document is not None
        document.indexing_status = IndexingStatus.COMPLETED
        segment = DocumentSegment(
            tenant_id=ref.dataset.tenant_id,
            dataset_id=ref.dataset.dataset_id,
            document_id=ref.document_id,
            position=1,
            content="segment",
            word_count=1,
            tokens=1,
            created_by=document.created_by,
            enabled=False,
            disabled_by=disabled_by,
            status=SegmentStatus.COMPLETED,
        )
        session.add_all(
            [
                segment,
                DatasetAutoDisableLog(
                    tenant_id=ref.dataset.tenant_id,
                    dataset_id=ref.dataset.dataset_id,
                    document_id=ref.document_id,
                ),
            ]
        )
        session.flush()
        segment_id = segment.id

    execution = DocumentIndexingExecution(expected_generation=generation, assert_owned=lambda: None)
    with sessions.begin() as session:
        complete_document_index_add(session, ref, execution=execution)

    with sessions() as session:
        persisted_segment = session.get(DocumentSegment, segment_id)
        assert persisted_segment is not None
        assert persisted_segment.enabled is True
        assert persisted_segment.disabled_at is None
        assert persisted_segment.disabled_by is None
        assert (
            session.scalar(select(DatasetAutoDisableLog.id).where(DatasetAutoDisableLog.document_id == ref.document_id))
            is None
        )


def test_remove_completion_rejects_old_generation_before_applying_current_state(
    db_session_with_containers: Session,
) -> None:
    ref, generation = _create_indexing_document(db_session_with_containers)
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    disabled_by = str(uuid4())
    with sessions.begin() as session:
        document = session.get(Document, ref.document_id)
        assert document is not None
        document.enabled = False
        document.disabled_by = disabled_by
        segment = DocumentSegment(
            tenant_id=ref.dataset.tenant_id,
            dataset_id=ref.dataset.dataset_id,
            document_id=ref.document_id,
            position=1,
            content="segment",
            word_count=1,
            tokens=1,
            created_by=document.created_by,
            enabled=True,
            status=SegmentStatus.COMPLETED,
        )
        session.add(segment)
        session.flush()
        segment_id = segment.id

    stale_execution = DocumentIndexingExecution(expected_generation=str(uuid4()), assert_owned=lambda: None)
    with pytest.raises(DocumentIndexingGenerationChangedError):
        with sessions.begin() as session:
            complete_document_index_remove(session, ref, execution=stale_execution)
    with sessions() as session:
        unchanged = session.get(DocumentSegment, segment_id)
        assert unchanged is not None
        assert unchanged.enabled is True
        assert unchanged.disabled_at is None

    current_execution = DocumentIndexingExecution(expected_generation=generation, assert_owned=lambda: None)
    with sessions.begin() as session:
        complete_document_index_remove(session, ref, execution=current_execution)
    with sessions() as session:
        completed = session.get(DocumentSegment, segment_id)
        assert completed is not None
        assert completed.enabled is False
        assert completed.disabled_at is not None
        assert completed.disabled_by == disabled_by
