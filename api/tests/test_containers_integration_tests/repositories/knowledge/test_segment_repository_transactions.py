"""PostgreSQL transaction coverage for segment persistence and child reconciliation."""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from models.dataset import ChildChunk, Dataset, Document, DocumentSegment
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus, SegmentType
from models.knowledge_task import KnowledgeTaskOutbox
from repositories.knowledge.segment_repository import SQLAlchemySegmentRepository
from services.knowledge.entities.segments import ChildChunkRecord
from services.knowledge.resource_scope import DatasetRef, DocumentRef
from services.knowledge.segments.contracts import (
    ChildChunkState,
    SegmentChildIndexCompletion,
    SegmentIndexReconcileOutcome,
)
from services.knowledge.task_outbox.contracts import KnowledgeTaskKind


def _repository(session: Session) -> SQLAlchemySegmentRepository:
    return SQLAlchemySegmentRepository(
        session_factory=sessionmaker(bind=session.get_bind(), expire_on_commit=False),
        wake_after_commit=lambda _session: None,
    )


def _create_document_scope(
    session: Session,
    *,
    indexing_status: IndexingStatus = IndexingStatus.COMPLETED,
    enabled: bool = True,
    archived: bool = False,
) -> tuple[DocumentRef, str]:
    tenant_id = str(uuid4())
    actor_id = str(uuid4())
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
        doc_form=IndexStructureType.PARENT_CHILD_INDEX,
        word_count=3,
        indexing_status=indexing_status,
        enabled=enabled,
        archived=archived,
    )
    session.add(document)
    session.flush()
    ref = DatasetRef(tenant_id, dataset.id).document(document.id)
    session.commit()
    return ref, actor_id


def _segment_values(
    segment_id: str,
    *,
    content: str,
    word_count: int,
    actor_id: str,
    generation: str,
) -> dict[str, object]:
    return {
        "id": segment_id,
        "content": content,
        "word_count": word_count,
        "tokens": 1,
        "created_by": actor_id,
        "status": SegmentStatus.INDEXING,
        "indexing_generation": generation,
    }


def _child_state(*, segment_id: str, actor_id: str, position: int) -> ChildChunkState:
    created_at = datetime(2026, 1, 1, 0, position)
    return ChildChunkState(
        data=ChildChunkRecord(
            id=str(uuid4()),
            segment_id=segment_id,
            content=f"child-{position}",
            position=position,
            word_count=position + 1,
            type=SegmentType.AUTOMATIC,
            created_at=created_at,
            updated_at=created_at,
        ),
        index_node_id=str(uuid4()),
        index_node_hash=f"hash-{position}",
        created_by=actor_id,
    )


def test_create_segments_commits_batch_state_and_index_intent_together(
    db_session_with_containers: Session,
) -> None:
    document_ref, actor_id = _create_document_scope(db_session_with_containers)
    generation = str(uuid4())
    segment_ids = (str(uuid4()), str(uuid4()))
    batch_job_id = str(uuid4())

    state = _repository(db_session_with_containers).create_segments(
        document_ref,
        (
            _segment_values(segment_ids[0], content="first", word_count=5, actor_id=actor_id, generation=generation),
            _segment_values(segment_ids[1], content="second", word_count=7, actor_id=actor_id, generation=generation),
        ),
        attachment_ids_list=((), ()),
        generation=generation,
        batch_job_id=batch_job_id,
    )

    assert state is not None
    assert (state.indexing_status, state.enabled, state.archived) == ("completed", True, False)
    db_session_with_containers.rollback()
    rows = db_session_with_containers.scalars(
        select(DocumentSegment)
        .where(DocumentSegment.document_id == document_ref.document_id)
        .order_by(DocumentSegment.position)
    ).all()
    document = db_session_with_containers.get(Document, document_ref.document_id)
    intent = db_session_with_containers.scalar(
        select(KnowledgeTaskOutbox).where(
            KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.SEGMENT_INDEX_CREATE,
            KnowledgeTaskOutbox.document_id == document_ref.document_id,
        )
    )

    assert [(row.id, row.position, row.status, row.indexing_generation) for row in rows] == [
        (segment_ids[0], 1, SegmentStatus.INDEXING, generation),
        (segment_ids[1], 2, SegmentStatus.INDEXING, generation),
    ]
    assert document is not None
    assert document.word_count == 15
    assert intent is not None
    assert intent.status == "pending"
    assert intent.resource_id == document_ref.document_id
    assert intent.payload == {
        "dataset_id": document_ref.dataset.dataset_id,
        "document_id": document_ref.document_id,
        "segment_ids": list(segment_ids),
        "generation": generation,
        "job_id": batch_job_id,
    }


def test_create_segments_rechecks_parent_lifecycle_without_partial_writes(
    db_session_with_containers: Session,
) -> None:
    document_ref, actor_id = _create_document_scope(db_session_with_containers, archived=True)
    generation = str(uuid4())

    state = _repository(db_session_with_containers).create_segments(
        document_ref,
        (
            _segment_values(
                str(uuid4()), content="must not persist", word_count=11, actor_id=actor_id, generation=generation
            ),
        ),
        attachment_ids_list=((),),
        generation=generation,
        batch_job_id=str(uuid4()),
    )

    assert state is not None
    assert state.archived is True
    db_session_with_containers.rollback()
    document = db_session_with_containers.get(Document, document_ref.document_id)
    assert document is not None
    assert document.word_count == 3
    assert (
        db_session_with_containers.scalar(
            select(DocumentSegment.id).where(DocumentSegment.document_id == document_ref.document_id)
        )
        is None
    )
    assert (
        db_session_with_containers.scalar(
            select(KnowledgeTaskOutbox.id).where(KnowledgeTaskOutbox.document_id == document_ref.document_id)
        )
        is None
    )


def test_child_reconcile_intents_keep_batch_parents_indexing_until_each_completion(
    db_session_with_containers: Session,
) -> None:
    document_ref, actor_id = _create_document_scope(db_session_with_containers)
    repository = _repository(db_session_with_containers)
    generation = str(uuid4())
    segment_ids = (str(uuid4()), str(uuid4()))
    repository.create_segments(
        document_ref,
        tuple(
            _segment_values(
                segment_id,
                content=f"parent-{position}",
                word_count=position,
                actor_id=actor_id,
                generation=generation,
            )
            for position, segment_id in enumerate(segment_ids, start=1)
        ),
        attachment_ids_list=((), ()),
        generation=generation,
        batch_job_id=None,
    )
    completion = SegmentChildIndexCompletion(
        generation=generation,
        batch_segment_ids=segment_ids,
        batch_job_id=str(uuid4()),
    )

    intent_ids = tuple(
        repository.save_children(
            document_ref.segment(segment_id),
            added=(_child_state(segment_id=segment_id, actor_id=actor_id, position=position),),
            completion=completion,
        )
        for position, segment_id in enumerate(segment_ids, start=1)
    )

    assert all(intent_ids)
    db_session_with_containers.rollback()
    before_completion = db_session_with_containers.scalars(
        select(DocumentSegment).where(DocumentSegment.id.in_(segment_ids)).order_by(DocumentSegment.position)
    ).all()
    children = db_session_with_containers.scalars(
        select(ChildChunk).where(ChildChunk.segment_id.in_(segment_ids)).order_by(ChildChunk.position)
    ).all()
    intents = db_session_with_containers.scalars(
        select(KnowledgeTaskOutbox)
        .where(KnowledgeTaskOutbox.id.in_(intent_ids))
        .order_by(KnowledgeTaskOutbox.created_at, KnowledgeTaskOutbox.id)
    ).all()
    assert [row.status for row in before_completion] == [SegmentStatus.INDEXING, SegmentStatus.INDEXING]
    assert {child.segment_id for child in children} == set(segment_ids)
    assert len(intents) == 2
    assert all(intent.task_kind == KnowledgeTaskKind.SEGMENT_INDEX_RECONCILE for intent in intents)
    assert all(intent.payload["parent_generation"] == generation for intent in intents)
    assert all(intent.payload["batch_segment_ids"] == list(segment_ids) for intent in intents)

    assert (
        repository.complete_child_reconcile(document_ref.segment(segment_ids[0]), completion)
        == SegmentIndexReconcileOutcome.WAITING
    )
    db_session_with_containers.rollback()
    partially_completed = db_session_with_containers.scalars(
        select(DocumentSegment).where(DocumentSegment.id.in_(segment_ids)).order_by(DocumentSegment.position)
    ).all()
    assert [row.status for row in partially_completed] == [SegmentStatus.COMPLETED, SegmentStatus.INDEXING]

    assert (
        repository.complete_child_reconcile(document_ref.segment(segment_ids[1]), completion)
        == SegmentIndexReconcileOutcome.COMPLETED
    )
    db_session_with_containers.rollback()
    completed = db_session_with_containers.scalars(
        select(DocumentSegment).where(DocumentSegment.id.in_(segment_ids)).order_by(DocumentSegment.position)
    ).all()
    assert [row.status for row in completed] == [SegmentStatus.COMPLETED, SegmentStatus.COMPLETED]
