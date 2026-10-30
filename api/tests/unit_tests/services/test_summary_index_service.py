"""SQLite-backed tests for the surviving summary read contracts."""

from datetime import datetime
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from models.dataset import Dataset, Document, DocumentSegment, DocumentSegmentSummary
from models.enums import DataSourceType, DocumentCreatedFrom, SegmentStatus, SummaryStatus
from services.knowledge.documents.adapters import SQLAlchemyDocumentOperations
from services.knowledge.documents.application import DocumentNotFoundError
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.summaries.adapters import SummaryIndexAdapter

TENANT_ID = "tenant-1"
OTHER_TENANT_ID = "tenant-2"


def _persist_dataset(
    session: Session,
    *,
    dataset_id: str = "dataset-1",
    tenant_id: str = TENANT_ID,
) -> Dataset:
    dataset = Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name=f"Dataset {dataset_id}",
        description="",
        provider="vendor",
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        created_by="account-1",
        chunk_structure=IndexStructureType.PARAGRAPH_INDEX,
    )
    session.add(dataset)
    session.commit()
    return dataset


def _persist_document(
    session: Session,
    dataset: Dataset,
    *,
    document_id: str,
) -> Document:
    document = Document(
        id=document_id,
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info="{}",
        batch="batch-1",
        name=f"Document {document_id}",
        created_from=DocumentCreatedFrom.WEB,
        created_by="account-1",
        indexing_status="completed",
        enabled=True,
        archived=False,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
        doc_language="en",
    )
    session.add(document)
    session.commit()
    return document


def _persist_segment(
    session: Session,
    dataset: Dataset,
    document: Document,
    *,
    segment_id: str,
    position: int,
    enabled: bool = True,
    status: SegmentStatus = SegmentStatus.COMPLETED,
    tenant_id: str | None = None,
    dataset_id: str | None = None,
) -> DocumentSegment:
    segment = DocumentSegment(
        tenant_id=tenant_id or dataset.tenant_id,
        dataset_id=dataset_id or dataset.id,
        document_id=document.id,
        position=position,
        content=f"segment-{position}",
        word_count=1,
        tokens=1,
        created_by="account-1",
        enabled=enabled,
        status=status,
    )
    segment.id = segment_id
    session.add(segment)
    session.commit()
    return segment


def _persist_summary(
    session: Session,
    dataset: Dataset,
    document: Document,
    segment: DocumentSegment,
    *,
    summary_id: str,
    status: SummaryStatus,
    enabled: bool = True,
    content: str | None = "summary",
    created_at: datetime | None = None,
) -> DocumentSegmentSummary:
    summary = DocumentSegmentSummary(
        dataset_id=dataset.id,
        document_id=document.id,
        chunk_id=segment.id,
        summary_content=content,
        status=status,
        enabled=enabled,
    )
    summary.id = summary_id
    if created_at is not None:
        summary.created_at = created_at
        summary.updated_at = created_at
    session.add(summary)
    session.commit()
    return summary


def test_document_summary_index_status_is_scoped_and_reports_only_pending_enabled_rows(
    sqlite_session: Session,
) -> None:
    dataset = _persist_dataset(sqlite_session)
    pending_document = _persist_document(sqlite_session, dataset, document_id="doc-pending")
    finished_document = _persist_document(sqlite_session, dataset, document_id="doc-finished")
    pending_segment = _persist_segment(sqlite_session, dataset, pending_document, segment_id="seg-pending", position=1)
    finished_segment = _persist_segment(
        sqlite_session, dataset, finished_document, segment_id="seg-finished", position=1
    )
    disabled_segment = _persist_segment(
        sqlite_session, dataset, finished_document, segment_id="seg-disabled", position=2
    )
    resegment = _persist_segment(
        sqlite_session,
        dataset,
        finished_document,
        segment_id="seg-resegment",
        position=3,
        status=SegmentStatus.RE_SEGMENT,
    )
    _persist_summary(
        sqlite_session,
        dataset,
        pending_document,
        pending_segment,
        summary_id="sum-pending",
        status=SummaryStatus.GENERATING,
    )
    _persist_summary(
        sqlite_session,
        dataset,
        finished_document,
        finished_segment,
        summary_id="sum-finished",
        status=SummaryStatus.COMPLETED,
    )
    _persist_summary(
        sqlite_session,
        dataset,
        finished_document,
        disabled_segment,
        summary_id="sum-disabled",
        status=SummaryStatus.NOT_STARTED,
        enabled=False,
    )
    _persist_summary(
        sqlite_session,
        dataset,
        finished_document,
        resegment,
        summary_id="sum-resegment",
        status=SummaryStatus.NOT_STARTED,
    )

    result = SummaryIndexAdapter.get_documents_summary_index_status(
        [pending_document.id, finished_document.id, "missing"],
        dataset.id,
        dataset.tenant_id,
        session=sqlite_session,
    )

    assert result == {
        pending_document.id: "SUMMARIZING",
        finished_document.id: None,
        "missing": None,
    }
    assert (
        SummaryIndexAdapter.get_document_summary_index_status(
            pending_document.id,
            dataset.id,
            OTHER_TENANT_ID,
            session=sqlite_session,
        )
        is None
    )
    assert (
        SummaryIndexAdapter.get_documents_summary_index_status(
            [], dataset.id, dataset.tenant_id, session=sqlite_session
        )
        == {}
    )


def test_document_summary_status_detail_uses_completed_enabled_owned_segments(
    sqlite_session: Session,
) -> None:
    dataset = _persist_dataset(sqlite_session)
    document = _persist_document(sqlite_session, dataset, document_id="doc-1")
    completed = _persist_segment(sqlite_session, dataset, document, segment_id="seg-1", position=1)
    not_started = _persist_segment(sqlite_session, dataset, document, segment_id="seg-2", position=2)
    timed_out = _persist_segment(sqlite_session, dataset, document, segment_id="seg-3", position=3)
    disabled = _persist_segment(sqlite_session, dataset, document, segment_id="seg-disabled", position=4, enabled=False)
    waiting = _persist_segment(
        sqlite_session,
        dataset,
        document,
        segment_id="seg-waiting",
        position=5,
        status=SegmentStatus.WAITING,
    )
    foreign = _persist_segment(
        sqlite_session,
        dataset,
        document,
        segment_id="seg-foreign",
        position=6,
        tenant_id=OTHER_TENANT_ID,
    )
    created_at = datetime(2026, 1, 1)
    _persist_summary(
        sqlite_session,
        dataset,
        document,
        completed,
        summary_id="sum-completed",
        status=SummaryStatus.COMPLETED,
        content="x" * 150,
        created_at=created_at,
    )
    _persist_summary(
        sqlite_session,
        dataset,
        document,
        timed_out,
        summary_id="sum-timeout",
        status=SummaryStatus.TIMEOUT,
    )
    for index, segment in enumerate((disabled, waiting, foreign), start=1):
        _persist_summary(
            sqlite_session,
            dataset,
            document,
            segment,
            summary_id=f"sum-ignored-{index}",
            status=SummaryStatus.GENERATING,
        )

    detail = SummaryIndexAdapter.get_document_summary_status_detail(
        document.id,
        dataset.id,
        sqlite_session,
        tenant_id=dataset.tenant_id,
    )

    assert detail["total_segments"] == 3
    assert detail["summary_status"] == {
        "completed": 1,
        "generating": 0,
        "error": 0,
        "not_started": 1,
        "timeout": 1,
    }
    assert [entry["segment_id"] for entry in detail["summaries"]] == [
        completed.id,
        not_started.id,
        timed_out.id,
    ]
    assert detail["summaries"][0]["summary_preview"] == "x" * 100 + "..."
    assert detail["summaries"][0]["created_at"] == int(created_at.timestamp())
    assert detail["summaries"][1]["status"] == SummaryStatus.NOT_STARTED


def test_document_operations_summary_status_runs_the_reachable_database_path(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset = _persist_dataset(sqlite_session)
    document = _persist_document(sqlite_session, dataset, document_id="doc-1")
    segment = _persist_segment(sqlite_session, dataset, document, segment_id="seg-1", position=1)
    _persist_summary(
        sqlite_session,
        dataset,
        document,
        segment,
        summary_id="sum-1",
        status=SummaryStatus.GENERATING,
    )
    operations = SQLAlchemyDocumentOperations(
        session_factory=sqlite_session_factory,
        documents=MagicMock(),
        files=MagicMock(),
    )

    result = operations.get_summary_status(DatasetRef(dataset.tenant_id, dataset.id).document(document.id))

    assert result["total_segments"] == 1
    assert result["summary_status"]["generating"] == 1
    assert result["summaries"][0]["segment_id"] == segment.id
    with pytest.raises(DocumentNotFoundError):
        operations.get_summary_status(DatasetRef(OTHER_TENANT_ID, dataset.id).document(document.id))


def test_summary_getters_scope_dataset_document_segment_and_enabled(sqlite_session: Session) -> None:
    dataset = _persist_dataset(sqlite_session)
    document = _persist_document(sqlite_session, dataset, document_id="doc-1")
    first = _persist_segment(sqlite_session, dataset, document, segment_id="seg-1", position=1)
    second = _persist_segment(sqlite_session, dataset, document, segment_id="seg-2", position=2)
    first_summary = _persist_summary(
        sqlite_session,
        dataset,
        document,
        first,
        summary_id="sum-1",
        status=SummaryStatus.COMPLETED,
    )
    _persist_summary(
        sqlite_session,
        dataset,
        document,
        second,
        summary_id="sum-2",
        status=SummaryStatus.GENERATING,
        enabled=False,
    )

    assert SummaryIndexAdapter.get_segment_summary(first.id, dataset.id, session=sqlite_session) is first_summary
    assert SummaryIndexAdapter.get_segment_summary(second.id, dataset.id, session=sqlite_session) is None
    assert SummaryIndexAdapter.get_segments_summaries([first.id, second.id], dataset.id, session=sqlite_session) == {
        first.id: first_summary
    }
    assert SummaryIndexAdapter.get_segments_summaries([], dataset.id, session=sqlite_session) == {}
    assert SummaryIndexAdapter.get_document_summaries(
        document.id,
        dataset.id,
        [first.id, second.id],
        session=sqlite_session,
    ) == [first_summary]
