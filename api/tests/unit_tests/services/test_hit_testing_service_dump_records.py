from __future__ import annotations

from datetime import datetime
from uuid import uuid4

import pytest
from pydantic import BaseModel, ConfigDict, TypeAdapter
from sqlalchemy.orm import Session

from core.rag.embedding.retrieval import RetrievalSegments
from models.dataset import Dataset, DocumentSegment
from models.dataset import Document as DatasetDocument
from models.enums import DataSourceType, DocumentCreatedFrom, SegmentStatus
from services.hit_testing_service import HitTestingService


class _DumpedDocumentResponse(BaseModel):
    id: str
    data_source_type: str
    name: str
    doc_type: str | None
    doc_metadata: dict[str, object] | None


class _DumpedSegmentResponse(BaseModel):
    id: str
    document_id: str
    created_at: datetime | None = None
    document: _DumpedDocumentResponse | None = None

    model_config = ConfigDict(extra="allow")


class _DumpedRetrievalRecordResponse(BaseModel):
    segment: _DumpedSegmentResponse
    score: float

    model_config = ConfigDict(extra="allow")


_DUMPED_RETRIEVAL_RECORDS = TypeAdapter(list[_DumpedRetrievalRecordResponse])


def _build_segment(
    *,
    document_id: str,
    tenant_id: str | None = None,
    dataset_id: str | None = None,
    created_by: str | None = None,
) -> DocumentSegment:
    return DocumentSegment(
        tenant_id=tenant_id or str(uuid4()),
        dataset_id=dataset_id or str(uuid4()),
        document_id=document_id,
        created_by=created_by or str(uuid4()),
        position=1,
        content="segment content",
        word_count=2,
        tokens=2,
        status=SegmentStatus.COMPLETED,
    )


def _create_dataset_document(
    db_session: Session,
    *,
    name: str = "guide.md",
    data_source_type: str = DataSourceType.UPLOAD_FILE,
    doc_type: str | None = None,
    doc_metadata: dict[str, object] | None = None,
) -> DatasetDocument:
    tenant_id = str(uuid4())
    created_by = str(uuid4())
    dataset = Dataset(
        tenant_id=tenant_id,
        name=f"dataset-{uuid4()}",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=created_by,
    )
    db_session.add(dataset)
    db_session.flush()

    document = DatasetDocument(
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=data_source_type,
        batch=f"batch-{uuid4()}",
        name=name,
        created_from=DocumentCreatedFrom.WEB,
        created_by=created_by,
        doc_type=doc_type,
        doc_metadata=doc_metadata,
    )
    db_session.add(document)
    db_session.commit()
    db_session.refresh(document)
    return document


def _create_segment(db_session: Session, *, document: DatasetDocument | None = None) -> DocumentSegment:
    segment = _build_segment(
        tenant_id=document.tenant_id if document else None,
        dataset_id=document.dataset_id if document else None,
        document_id=document.id if document else str(uuid4()),
        created_by=document.created_by if document else None,
    )
    db_session.add(segment)
    db_session.commit()
    db_session.refresh(segment)
    return segment


class TestHitTestingServiceDumpRecords:
    def test_dump_dataset_document_returns_frontend_required_fields(self, db_session_with_containers: Session) -> None:
        document = _create_dataset_document(db_session_with_containers, doc_metadata={"source": "manual"})

        assert HitTestingService._dump_dataset_document(document) == {
            "id": document.id,
            "data_source_type": "upload_file",
            "name": "guide.md",
            "doc_type": None,
            "doc_metadata": {"source": "manual"},
        }

    def test_dump_retrieval_records_returns_dumped_records_without_document_ids(self) -> None:
        segment = _build_segment(document_id="")
        record = RetrievalSegments.model_validate({"segment": segment, "score": 0.95})

        records = _DUMPED_RETRIEVAL_RECORDS.validate_python(HitTestingService._dump_retrieval_records([record]))

        assert len(records) == 1
        assert records[0].segment.id == segment.id
        assert records[0].segment.document_id == ""
        assert records[0].score == 0.95

    def test_dump_retrieval_records_injects_documents(self, db_session_with_containers: Session) -> None:
        document = _create_dataset_document(db_session_with_containers)
        segment = _create_segment(db_session_with_containers, document=document)
        record = RetrievalSegments.model_validate({"segment": segment, "score": 0.9})

        records = _DUMPED_RETRIEVAL_RECORDS.validate_python(HitTestingService._dump_retrieval_records([record]))

        assert len(records) == 1
        dumped_segment = records[0].segment
        assert dumped_segment.id == segment.id
        assert dumped_segment.document_id == document.id
        assert dumped_segment.created_at == segment.created_at
        assert dumped_segment.document == _DumpedDocumentResponse(
            id=document.id,
            data_source_type="upload_file",
            name="guide.md",
            doc_type=None,
            doc_metadata=None,
        )
        assert records[0].score == 0.9

    def test_dump_retrieval_records_skips_records_with_missing_documents(
        self, db_session_with_containers: Session, caplog: pytest.LogCaptureFixture
    ) -> None:
        segment = _create_segment(db_session_with_containers)
        record = RetrievalSegments.model_validate({"segment": segment, "score": 0.95})

        result = HitTestingService._dump_retrieval_records([record])

        assert result == []
        assert "Skipping hit-testing records with missing documents" in caplog.text
