from dataclasses import replace
from datetime import timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.models.document import AttachmentDocument, ChildDocument
from core.rag.models.document import Document as IndexDocument
from libs.datetime_utils import naive_utc_now
from models.dataset import ChildChunk, DatasetProcessRule, Document, DocumentSegment, SegmentAttachmentBinding
from models.enums import IndexingStatus, ProcessRuleMode, SegmentStatus
from models.knowledge_task import KnowledgeTaskOutbox
from models.model import KnowledgeUploadFileReference
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.segment_repository import SQLAlchemySegmentAttachmentWriter, SQLAlchemySegmentRepository
from services.knowledge.indexing.contracts import DocumentIndexingExecution, IndexingDocument
from services.knowledge.indexing.errors import DocumentIndexingGenerationChangedError, DocumentIsDeletedPausedError
from services.knowledge.resource_scope import DatasetRef
from services.knowledge.segments.contracts import SegmentChildIndexCompletion
from services.knowledge.task_outbox.contracts import KnowledgeTaskExecutionLeaseLostError
from tests.unit_tests.model_factories import make_upload_file
from tests.unit_tests.repositories.knowledge.test_document_repository import _dataset, _document


def _noop_wake_after_commit(_session: Session) -> None:
    pass


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
    segments = SQLAlchemySegmentRepository(
        session_factory=sqlite_session_factory, wake_after_commit=_noop_wake_after_commit
    )
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
        assert len(session.scalars(select(DocumentSegment)).all()) == 2
        assert len(session.scalars(select(ChildChunk)).all()) == 2


def test_repeated_save_does_not_duplicate_segments_or_children(
    sqlite_session_factory: sessionmaker[Session], indexing_rows: IndexingRows
) -> None:
    segments, job, chunks = indexing_rows
    segments.save_for_indexing(job, chunks, [13, 17])
    segments.save_for_indexing(job, chunks, [19, 23])
    with sqlite_session_factory() as session:
        assert len(session.scalars(select(ChildChunk)).all()) == 2
    assert segments.resume_indexing(job)[1] == 42


def test_replacement_detaches_all_file_edges_and_enqueues_cleanup(
    sqlite_session_factory: sessionmaker[Session], indexing_rows: IndexingRows
) -> None:
    segments, job, _ = indexing_rows
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                make_upload_file(file_id="inline-file", tenant_id="workspace-1", key="files/inline"),
                make_upload_file(file_id="attachment-file", tenant_id="workspace-1", key="files/attachment"),
            ]
        )
    old_chunk = IndexDocument(
        page_content="![image](https://example.test/files/inline-file/image-preview)",
        metadata={"doc_id": "old-node", "doc_hash": "old-hash"},
        attachments=[AttachmentDocument(page_content="image", metadata={"doc_id": "attachment-file"})],
    )
    replacement = IndexDocument(
        page_content="replacement",
        metadata={"doc_id": "new-node", "doc_hash": "new-hash"},
    )

    segments.save_for_indexing(job, [old_chunk], [5])
    segments.save_for_indexing(job, [replacement], [7])

    with sqlite_session_factory() as session:
        assert session.scalars(select(KnowledgeUploadFileReference)).all() == []
        assert session.scalars(select(SegmentAttachmentBinding)).all() == []
        intents = session.scalars(
            select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "file_cleanup")
        ).all()
        assert len(intents) == 1
        assert intents[0].payload["file_ids"] == ["inline-file", "attachment-file"]


def test_attachment_writer_replacement_persists_detached_image_cleanup(
    sqlite_session_factory: sessionmaker[Session], indexing_rows: IndexingRows
) -> None:
    segments, job, _ = indexing_rows
    with sqlite_session_factory.begin() as session:
        session.add(make_upload_file(file_id="inline-file", tenant_id="workspace-1", key="files/inline"))
    segments.save_for_indexing(
        job,
        [
            IndexDocument(
                page_content="![image](https://example.test/files/inline-file/image-preview)",
                metadata={"doc_id": "segment-1", "doc_hash": "hash-1"},
            )
        ],
        [5],
    )
    with sqlite_session_factory() as session:
        segment_id = session.scalar(select(DocumentSegment.id).where(DocumentSegment.index_node_id == "segment-1"))
    assert segment_id is not None

    with sqlite_session_factory.begin() as session:
        SQLAlchemySegmentAttachmentWriter().replace_content_references(
            session,
            tenant_id="workspace-1",
            dataset_id="dataset-1",
            document_id="document-1",
            segment_id=segment_id,
            content="replacement",
        )

    with sqlite_session_factory() as session:
        intent = session.scalar(select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "file_cleanup"))
        assert intent is not None
        assert intent.payload["file_ids"] == ["inline-file"]


def test_token_count_mismatch_rolls_back_segments_and_state(
    sqlite_session_factory: sessionmaker[Session], indexing_rows: IndexingRows
) -> None:
    segments, job, chunks = indexing_rows
    with pytest.raises(ValueError, match="zip\\(\\) argument 2 is shorter than argument 1"):
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


@pytest.mark.parametrize("operation", ["clear", "save", "resume", "complete"])
def test_indexing_segment_writes_reject_stale_document_generation(
    sqlite_session_factory: sessionmaker[Session],
    indexing_rows: IndexingRows,
    operation: str,
) -> None:
    segments, job, chunks = indexing_rows
    assertions: list[str] = []
    tracked = replace(
        job,
        execution=DocumentIndexingExecution(
            expected_generation=None,
            assert_owned=lambda: assertions.append("owned"),
        ),
    )
    with sqlite_session_factory.begin() as session:
        document = session.get(Document, job.ref.document_id)
        assert document is not None
        document.indexing_generation = "11111111-1111-1111-1111-111111111111"

    def invoke() -> None:
        if operation == "clear":
            segments.clear_for_indexing(tracked)
        elif operation == "save":
            segments.save_for_indexing(tracked, chunks, [13, 17])
        elif operation == "resume":
            segments.resume_indexing(tracked)
        else:
            segments.complete_indexing_segments(
                tracked.ref,
                ["node-0"],
                execution=tracked.execution,
            )

    with pytest.raises(DocumentIndexingGenerationChangedError):
        invoke()
    assert assertions == ["owned"]
    with sqlite_session_factory() as session:
        assert session.scalars(select(DocumentSegment)).all() == []


def test_indexing_segment_save_rolls_back_when_execution_lease_is_lost_before_commit(
    sqlite_session_factory: sessionmaker[Session],
    indexing_rows: IndexingRows,
) -> None:
    segments, job, chunks = indexing_rows
    assertions = 0

    def assert_owned() -> None:
        nonlocal assertions
        assertions += 1
        if assertions == 2:
            raise RuntimeError("execution lease lost")

    tracked = replace(
        job,
        execution=DocumentIndexingExecution(expected_generation=None, assert_owned=assert_owned),
    )

    with pytest.raises(RuntimeError, match="execution lease lost"):
        segments.save_for_indexing(tracked, chunks, [13, 17])

    with sqlite_session_factory() as session:
        document = session.get(Document, job.ref.document_id)
        assert document is not None
        assert document.indexing_status == IndexingStatus.SPLITTING
        assert session.scalars(select(DocumentSegment)).all() == []


def test_indexing_segment_save_rolls_back_when_durable_execution_claim_is_lost(
    sqlite_session_factory: sessionmaker[Session],
    indexing_rows: IndexingRows,
) -> None:
    segments, job, chunks = indexing_rows
    with sqlite_session_factory.begin() as session:
        delivery = KnowledgeTaskOutbox(
            tenant_id=job.ref.dataset.tenant_id,
            dataset_id=job.ref.dataset.dataset_id,
            document_id=job.ref.document_id,
            resource_id=job.ref.dataset.dataset_id,
            task_kind="document_index_create",
            payload={},
            status="executing",
            claim_id="33333333-3333-3333-3333-333333333333",
            claimed_at=naive_utc_now(),
            available_at=naive_utc_now() + timedelta(minutes=5),
        )
        session.add(delivery)
    tracked = replace(
        job,
        execution=DocumentIndexingExecution(
            expected_generation=None,
            assert_owned=lambda: None,
            task_intent_id=delivery.id,
            task_execution_id="22222222-2222-2222-2222-222222222222",
        ),
    )

    with pytest.raises(KnowledgeTaskExecutionLeaseLostError):
        segments.save_for_indexing(tracked, chunks, [13, 17])

    with sqlite_session_factory() as session:
        document = session.get(Document, job.ref.document_id)
        assert document is not None
        assert document.indexing_status == IndexingStatus.SPLITTING
        assert session.scalars(select(DocumentSegment)).all() == []


def test_recovered_segment_workers_persist_successors_from_current_generation(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    generation = "11111111-1111-1111-1111-111111111111"
    document = _document("document-1", status=IndexingStatus.COMPLETED)
    document.doc_form = IndexStructureType.PARENT_CHILD_INDEX
    segment = DocumentSegment(
        tenant_id="workspace-1",
        dataset_id="dataset-1",
        document_id=document.id,
        position=1,
        content="parent",
        index_node_id="parent-node",
        index_node_hash="parent-hash",
        word_count=1,
        tokens=1,
        created_by="account-1",
        enabled=True,
        status=SegmentStatus.INDEXING,
        indexing_generation=generation,
    )
    segment.id = "segment-1"
    child = ChildChunk(
        tenant_id="workspace-1",
        dataset_id="dataset-1",
        document_id=document.id,
        segment_id=segment.id,
        position=1,
        content="child",
        index_node_id="current-child-node",
        index_node_hash="child-hash",
        word_count=1,
        created_by="account-1",
    )
    child.id = "child-1"
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-1", "workspace-1"), document, segment, child])

    wake_calls: list[str] = []
    repository = SQLAlchemySegmentRepository(
        session_factory=sqlite_session_factory,
        wake_after_commit=lambda _session: wake_calls.append("wake"),
    )
    document_ref = DatasetRef("workspace-1", "dataset-1").document(document.id)
    assert repository.enqueue_created_segments_repair(
        document_ref,
        (segment.id,),
        batch_job_id="job-1",
    )
    assert repository.enqueue_child_reconcile_repair(
        document_ref.segment(segment.id),
        delete_node_ids=("stale-child-node",),
        completion=SegmentChildIndexCompletion("stale-generation", (segment.id,), "job-1"),
    )

    with sqlite_session_factory() as session:
        intents = session.scalars(select(KnowledgeTaskOutbox).order_by(KnowledgeTaskOutbox.created_at)).all()
    assert [intent.task_kind for intent in intents] == ["segment_index_create", "segment_index_reconcile"]
    assert intents[0].payload["generation"] == generation
    assert intents[0].payload["job_id"] == "job-1"
    assert intents[1].payload["parent_generation"] == generation
    assert intents[1].payload["delete_node_ids"] == ["stale-child-node", "current-child-node"]
    assert intents[1].payload["batch_segment_ids"] == [segment.id]
    assert intents[1].payload["job_id"] == "job-1"
    assert wake_calls == ["wake", "wake"]

    successor_generation = "22222222-2222-2222-2222-222222222222"
    with sqlite_session_factory.begin() as session:
        current = session.get(DocumentSegment, segment.id)
        assert current is not None
        current.enabled = False
        current.status = SegmentStatus.COMPLETED
        current.indexing_generation = successor_generation

    assert repository.enqueue_created_segments_repair(
        document_ref,
        (segment.id,),
        batch_job_id="job-2",
    )
    with sqlite_session_factory() as session:
        repaired = [
            intent
            for intent in session.scalars(select(KnowledgeTaskOutbox)).all()
            if intent.payload.get("generation") == successor_generation or intent.payload.get("job_id") == "job-2"
        ]
    assert {intent.task_kind for intent in repaired} == {"segment_index_disable", "segment_index_create"}
    status_repair = next(intent for intent in repaired if intent.task_kind == "segment_index_disable")
    batch_cancellation = next(intent for intent in repaired if intent.task_kind == "segment_index_create")
    assert status_repair.payload["generation"] == successor_generation
    assert status_repair.payload["expected_enabled"] is False
    assert batch_cancellation.payload["generation"] != successor_generation
    assert batch_cancellation.payload["job_id"] == "job-2"
    assert wake_calls == ["wake", "wake", "wake"]
