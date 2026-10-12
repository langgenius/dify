from dataclasses import replace

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.models.document import ChildDocument
from core.rag.models.document import Document as IndexDocument
from models.dataset import ChildChunk, DatasetProcessRule, Document, DocumentSegment
from models.enums import IndexingStatus, ProcessRuleMode, SegmentStatus
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.segment_repository import SQLAlchemySegmentRepository
from services.knowledge.indexing.errors import DocumentIsDeletedPausedError
from services.knowledge.indexing.execution import IndexingDocument
from services.knowledge.resource_scope import DatasetRef
from tests.unit_tests.repositories.knowledge.test_document_repository import _dataset, _document

IndexingRows = tuple[SQLAlchemySegmentRepository, IndexingDocument, list[IndexDocument]]


@pytest.fixture
def indexing_rows(sqlite_session_factory: sessionmaker[Session]) -> IndexingRows:
    with sqlite_session_factory.begin() as session:
        document = _document("document-1", status=IndexingStatus.SPLITTING)
        document.doc_form = IndexStructureType.PARENT_CHILD_INDEX
        rule = DatasetProcessRule(
            dataset_id="dataset-1",
            mode=ProcessRuleMode.HIERARCHICAL,
            rules='{"parent_mode": "paragraph"}',
            created_by="account-1",
        )
        rule.id = "rule-1"
        document.dataset_process_rule_id = rule.id
        session.add_all([_dataset("dataset-1", "workspace-1"), document, _document("document-2"), rule])
    documents = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    segments = SQLAlchemySegmentRepository(session_factory=sqlite_session_factory)
    job = documents.get_indexing_document(DatasetRef("workspace-1", "dataset-1").document("document-1"))
    chunks = [
        IndexDocument(
            page_content=f"parent-{i}",
            metadata={"doc_id": f"node-{i}", "doc_hash": f"hash-{i}"},
            children=[ChildDocument(page_content="child", metadata={"doc_id": f"child-{i}", "doc_hash": "child-hash"})],
        )
        for i in range(2)
    ]
    return segments, job, chunks


def test_saved_segments_are_visible_before_workers_and_resume_preserves_total(
    sqlite_session_factory: sessionmaker[Session], indexing_rows: IndexingRows
) -> None:
    segments, job, chunks = indexing_rows
    segments.save_for_indexing(job, chunks, [13, 17])
    segments.complete_indexing_segments(job.ref, ["node-0"])
    resumed, tokens = segments.resume_indexing(job)
    assert tokens == 30
    assert [chunk.page_content for chunk in resumed] == ["parent-1"]
    assert resumed[0].children is not None
    assert resumed[0].children[0].page_content == "child"
    with sqlite_session_factory() as session:
        persisted_document = session.get(Document, "document-1")
        assert persisted_document is not None
        assert persisted_document.indexing_status == IndexingStatus.INDEXING
        rows = session.scalars(select(DocumentSegment).order_by(DocumentSegment.position)).all()
        assert [row.status for row in rows] == [SegmentStatus.COMPLETED, SegmentStatus.INDEXING]
    segments.clear_for_indexing(job)
    with sqlite_session_factory() as session:
        assert session.scalars(select(DocumentSegment)).all() == []
        assert session.scalars(select(ChildChunk)).all() == []


def test_repeated_save_does_not_duplicate_segments_or_children(
    sqlite_session_factory: sessionmaker[Session], indexing_rows: IndexingRows
) -> None:
    segments, job, chunks = indexing_rows
    segments.save_for_indexing(job, chunks, [13, 17])
    segments.save_for_indexing(job, chunks, [19, 23])
    with sqlite_session_factory() as session:
        assert len(session.scalars(select(ChildChunk)).all()) == 2
    assert segments.resume_indexing(job)[1] == 42


def test_token_count_mismatch_rolls_back_segments_and_state(
    sqlite_session_factory: sessionmaker[Session], indexing_rows: IndexingRows
) -> None:
    segments, job, chunks = indexing_rows
    with pytest.raises(ValueError):
        segments.save_for_indexing(job, chunks, [13])
    with sqlite_session_factory() as session:
        assert session.scalars(select(DocumentSegment)).all() == []
        persisted_document = session.get(Document, "document-1")
        assert persisted_document is not None
        assert persisted_document.indexing_status == IndexingStatus.SPLITTING


def test_node_id_collision_cannot_overwrite_another_document(indexing_rows: IndexingRows) -> None:
    segments, job, chunks = indexing_rows
    other = replace(job, source=job.source._replace(document_ref=job.ref.dataset.document("document-2")))
    segments.save_for_indexing(other, chunks, [3, 5])
    segments.save_for_indexing(job, chunks, [13, 17])
    segments.complete_indexing_segments(job.ref, ["node-0", "node-1"])
    segments.clear_for_indexing(job)
    assert segments.resume_indexing(other)[1] == 8
    assert len(segments.resume_indexing(other)[0]) == 2


def test_segment_mutations_reject_foreign_tenant(indexing_rows: IndexingRows) -> None:
    segments, job, chunks = indexing_rows
    foreign = replace(
        job, source=job.source._replace(document_ref=DatasetRef("foreign", "dataset-1").document("document-1"))
    )
    for operation in [
        lambda: segments.save_for_indexing(foreign, chunks, [13, 17]),
        lambda: segments.clear_for_indexing(foreign),
        lambda: segments.complete_indexing_segments(foreign.ref, ["node-0"]),
    ]:
        with pytest.raises(DocumentIsDeletedPausedError):
            operation()
