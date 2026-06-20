from __future__ import annotations

import json
from datetime import datetime
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from pydantic import BaseModel, ConfigDict, TypeAdapter
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.rag.embedding.retrieval import RetrievalSegments
from core.rag.models.document import Document
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from models.dataset import Dataset, DatasetQuery, DocumentSegment
from models.dataset import Document as DatasetDocument
from models.enums import DataSourceType, DocumentCreatedFrom, SegmentStatus
from services.hit_testing_service import HitTestingService


class _QueryResponse(BaseModel):
    content: str


class _RetrieveRecordResponse(BaseModel):
    content: str | None = None
    title: str | None = None

    model_config = ConfigDict(extra="allow")


class _RetrieveResponse(BaseModel):
    query: _QueryResponse
    records: list[_RetrieveRecordResponse]


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


def _create_dataset(
    db_session: Session,
    *,
    provider: str = "vendor",
    tenant_id: str | None = None,
    created_by: str | None = None,
    name: str = "test-dataset",
) -> Dataset:
    ds = Dataset(
        tenant_id=tenant_id or str(uuid4()),
        name=name,
        created_by=created_by or str(uuid4()),
        provider=provider,
    )
    db_session.add(ds)
    db_session.commit()
    db_session.refresh(ds)
    return ds


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


class TestHitTestingService:
    # ── Utility methods (pure logic, no DB) ────────────────────────────

    def test_escape_query_for_search_should_escape_double_quotes(self) -> None:
        query = 'test "query" with quotes'
        result = HitTestingService.escape_query_for_search(query)
        assert result == 'test \\"query\\" with quotes'

    def test_hit_testing_args_check_should_pass_with_valid_query(self) -> None:
        HitTestingService.hit_testing_args_check({"query": "valid query"})

    def test_hit_testing_args_check_should_pass_with_valid_attachments(self) -> None:
        HitTestingService.hit_testing_args_check({"attachment_ids": ["id1", "id2"]})

    def test_hit_testing_args_check_should_raise_error_when_no_query_or_attachments(self) -> None:
        with pytest.raises(ValueError, match="Query or attachment_ids is required"):
            HitTestingService.hit_testing_args_check({})

    def test_hit_testing_args_check_should_raise_error_when_query_too_long(self) -> None:
        with pytest.raises(ValueError, match="Query cannot exceed 250 characters"):
            HitTestingService.hit_testing_args_check({"query": "a" * 251})

    def test_hit_testing_args_check_should_raise_error_when_attachments_not_list(self) -> None:
        with pytest.raises(ValueError, match="Attachment_ids must be a list"):
            HitTestingService.hit_testing_args_check({"attachment_ids": "not a list"})

    # ── Response formatting ────────────────────────────────────────────

    @patch("core.rag.datasource.retrieval_service.RetrievalService.format_retrieval_documents")
    def test_compact_retrieve_response_should_format_correctly(self, mock_format: MagicMock) -> None:
        query = "test query"
        mock_doc = MagicMock(spec=Document)

        mock_record = MagicMock()
        mock_record.model_dump.return_value = {"content": "formatted content"}
        mock_format.return_value = [mock_record]

        response = _RetrieveResponse.model_validate(HitTestingService.compact_retrieve_response(query, [mock_doc]))

        assert response.query.content == query
        assert len(response.records) == 1
        assert response.records[0].content == "formatted content"
        mock_format.assert_called_once_with([mock_doc])

    def test_compact_external_retrieve_response_should_return_records_for_external_provider(
        self, db_session_with_containers: Session
    ) -> None:
        dataset = _create_dataset(db_session_with_containers, provider="external")
        documents = [
            {"content": "c1", "title": "t1", "score": 0.9, "metadata": {"m1": "v1"}},
            {"content": "c2", "title": "t2", "score": 0.8, "metadata": {"m2": "v2"}},
        ]

        response = _RetrieveResponse.model_validate(
            HitTestingService.compact_external_retrieve_response(dataset, "test query", documents)
        )

        assert response.query.content == "test query"
        assert len(response.records) == 2
        assert response.records[0].content == "c1"
        assert response.records[1].title == "t2"

    def test_compact_external_retrieve_response_should_return_empty_for_non_external_provider(
        self, db_session_with_containers: Session
    ) -> None:
        dataset = _create_dataset(db_session_with_containers, provider="vendor")

        response = _RetrieveResponse.model_validate(
            HitTestingService.compact_external_retrieve_response(dataset, "test query", [{"content": "c1"}])
        )

        assert response.query.content == "test query"
        assert response.records == []

    # ── External retrieve (real DB) ────────────────────────────────────

    @patch("core.rag.datasource.retrieval_service.RetrievalService.external_retrieve")
    def test_external_retrieve_should_succeed_for_external_provider(
        self, mock_ext_retrieve: MagicMock, db_session_with_containers: Session
    ) -> None:
        dataset = _create_dataset(db_session_with_containers, provider="external")
        account_id = str(uuid4())
        account = MagicMock()
        account.id = account_id
        mock_ext_retrieve.return_value = [{"content": "ext content", "score": 1.0}]

        before_count = db_session_with_containers.scalar(select(func.count()).select_from(DatasetQuery)) or 0

        response = _RetrieveResponse.model_validate(
            HitTestingService.external_retrieve(
                dataset=dataset,
                query='test "query"',
                account=account,
                external_retrieval_model={"model": "test"},
                metadata_filtering_conditions={"key": "val"},
            )
        )

        assert response.query.content == 'test "query"'
        assert response.records[0].content == "ext content"
        mock_ext_retrieve.assert_called_once_with(
            dataset_id=dataset.id,
            query='test \\"query\\"',
            external_retrieval_model={"model": "test"},
            metadata_filtering_conditions={"key": "val"},
        )

        db_session_with_containers.expire_all()
        after_count = db_session_with_containers.scalar(select(func.count()).select_from(DatasetQuery)) or 0
        assert after_count == before_count + 1

    def test_external_retrieve_should_return_empty_for_non_external_provider(
        self, db_session_with_containers: Session
    ) -> None:
        dataset = _create_dataset(db_session_with_containers, provider="vendor")
        account = MagicMock()

        response = _RetrieveResponse.model_validate(HitTestingService.external_retrieve(dataset, "test query", account))

        assert response.query.content == "test query"
        assert response.records == []

    # ── Retrieve (real DB) ─────────────────────────────────────────────

    @patch("core.rag.datasource.retrieval_service.RetrievalService.retrieve")
    def test_retrieve_should_use_default_model_when_none_provided(
        self, mock_retrieve: MagicMock, db_session_with_containers: Session
    ) -> None:
        dataset = _create_dataset(db_session_with_containers)
        dataset.retrieval_model = None
        account = MagicMock()
        account.id = str(uuid4())
        retrieved_documents: list[Document] = []
        mock_retrieve.return_value = retrieved_documents
        external_retrieval_model: dict[str, object] = {}

        before_count = db_session_with_containers.scalar(select(func.count()).select_from(DatasetQuery)) or 0

        response = _RetrieveResponse.model_validate(
            HitTestingService.retrieve(
                dataset=dataset,
                query="test query",
                account=account,
                retrieval_model=None,
                external_retrieval_model=external_retrieval_model,
            )
        )

        assert response.query.content == "test query"
        mock_retrieve.assert_called_once()
        assert mock_retrieve.call_args.kwargs["top_k"] == 4

        db_session_with_containers.expire_all()
        after_count = db_session_with_containers.scalar(select(func.count()).select_from(DatasetQuery)) or 0
        assert after_count == before_count + 1

    @patch("core.rag.datasource.retrieval_service.RetrievalService.retrieve")
    @patch("core.rag.retrieval.dataset_retrieval.DatasetRetrieval.get_metadata_filter_condition")
    def test_retrieve_should_handle_metadata_filtering(
        self, mock_get_meta: MagicMock, mock_retrieve: MagicMock, db_session_with_containers: Session
    ) -> None:
        dataset = _create_dataset(db_session_with_containers)
        account = MagicMock()
        account.id = str(uuid4())
        external_retrieval_model: dict[str, object] = {}

        retrieval_model = {
            "search_method": "semantic_search",
            "metadata_filtering_conditions": {"some": "condition"},
            "top_k": 5,
            "reranking_enable": False,
            "score_threshold_enabled": False,
        }
        mock_get_meta.return_value = ({dataset.id: ["doc_id1"]}, "condition_string")
        retrieved_documents: list[Document] = []
        mock_retrieve.return_value = retrieved_documents

        HitTestingService.retrieve(
            dataset=dataset,
            query="test query",
            account=account,
            retrieval_model=retrieval_model,
            external_retrieval_model=external_retrieval_model,
        )

        mock_get_meta.assert_called_once()
        mock_retrieve.assert_called_once()
        assert mock_retrieve.call_args.kwargs["document_ids_filter"] == ["doc_id1"]

    @patch("core.rag.datasource.retrieval_service.RetrievalService.retrieve")
    @patch("core.rag.retrieval.dataset_retrieval.DatasetRetrieval.get_metadata_filter_condition")
    def test_retrieve_should_return_empty_if_metadata_filtering_fails(
        self, mock_get_meta: MagicMock, mock_retrieve: MagicMock, db_session_with_containers: Session
    ) -> None:
        dataset = _create_dataset(db_session_with_containers)
        account = MagicMock()
        external_retrieval_model: dict[str, object] = {}

        retrieval_model = {
            "search_method": "semantic_search",
            "metadata_filtering_conditions": {"some": "condition"},
            "top_k": 5,
            "reranking_enable": False,
            "score_threshold_enabled": False,
        }
        empty_document_ids: dict[str, list[str]] = {}
        mock_get_meta.return_value = (empty_document_ids, "condition_string")

        response = _RetrieveResponse.model_validate(
            HitTestingService.retrieve(
                dataset=dataset,
                query="test query",
                account=account,
                retrieval_model=retrieval_model,
                external_retrieval_model=external_retrieval_model,
            )
        )

        assert response.records == []
        mock_retrieve.assert_not_called()

    @patch("core.rag.datasource.retrieval_service.RetrievalService.retrieve")
    def test_retrieve_should_handle_attachments(
        self, mock_retrieve: MagicMock, db_session_with_containers: Session
    ) -> None:
        dataset = _create_dataset(db_session_with_containers)
        account = MagicMock()
        account.id = str(uuid4())
        attachment_ids = ["att1", "att2"]
        external_retrieval_model: dict[str, object] = {}

        retrieval_model = {
            "search_method": "semantic_search",
            "top_k": 4,
            "reranking_enable": False,
            "score_threshold_enabled": False,
        }
        retrieved_documents: list[Document] = []
        mock_retrieve.return_value = retrieved_documents

        HitTestingService.retrieve(
            dataset=dataset,
            query="test query",
            account=account,
            retrieval_model=retrieval_model,
            external_retrieval_model=external_retrieval_model,
            attachment_ids=attachment_ids,
        )

        mock_retrieve.assert_called_once_with(
            retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
            dataset_id=dataset.id,
            query="test query",
            attachment_ids=attachment_ids,
            top_k=4,
            score_threshold=0.0,
            reranking_model=None,
            reranking_mode="reranking_model",
            weights=None,
            document_ids_filter=None,
        )

        # Verify DatasetQuery was persisted with correct content structure
        db_session_with_containers.expire_all()
        latest = db_session_with_containers.scalar(
            select(DatasetQuery)
            .where(DatasetQuery.dataset_id == dataset.id)
            .order_by(DatasetQuery.created_at.desc())
            .limit(1)
        )
        assert latest is not None
        query_content = json.loads(latest.content)
        assert len(query_content) == 3  # 1 text + 2 images
        assert query_content[0]["content_type"] == "text_query"
        assert query_content[1]["content_type"] == "image_query"
        assert query_content[1]["content"] == "att1"

    @patch("core.rag.datasource.retrieval_service.RetrievalService.retrieve")
    def test_retrieve_should_handle_reranking_and_threshold(
        self, mock_retrieve: MagicMock, db_session_with_containers: Session
    ) -> None:
        dataset = _create_dataset(db_session_with_containers)
        account = MagicMock()
        account.id = str(uuid4())
        external_retrieval_model: dict[str, object] = {}

        retrieval_model = {
            "search_method": "hybrid_search",
            "top_k": 10,
            "reranking_enable": True,
            "reranking_model": {"provider": "test"},
            "reranking_mode": "weighted_sum",
            "score_threshold_enabled": True,
            "score_threshold": 0.5,
            "weights": {"vector": 0.5, "keyword": 0.5},
        }
        retrieved_documents: list[Document] = []
        mock_retrieve.return_value = retrieved_documents

        HitTestingService.retrieve(
            dataset=dataset,
            query="test query",
            account=account,
            retrieval_model=retrieval_model,
            external_retrieval_model=external_retrieval_model,
        )

        mock_retrieve.assert_called_once()
        kwargs = mock_retrieve.call_args.kwargs
        assert kwargs["score_threshold"] == 0.5
        assert kwargs["reranking_model"] == {"provider": "test"}
        assert kwargs["reranking_mode"] == "weighted_sum"
        assert kwargs["weights"] == {"vector": 0.5, "keyword": 0.5}

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
