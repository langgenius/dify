import json
from datetime import datetime
from typing import cast
from unittest.mock import patch

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker

from controllers.console.datasets.datasets_document import DocumentDetailResponse, DocumentWithSegmentsListResponse
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from models.dataset import Dataset, DatasetProcessRule, Document, DocumentPipelineExecutionLog, DocumentSegment
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, ProcessRuleMode, SegmentStatus
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from services.file_service import FileService
from services.knowledge.documents.adapters import SQLAlchemyDocumentOperations
from services.knowledge.documents.application import DocumentListFilter, DocumentNotFoundError
from services.knowledge.entities.resource_scope import DatasetRef

_DOCUMENT_ADAPTERS_REF = DatasetRef("tenant-1", "dataset-1")


def _dataset(**values: object) -> Dataset:
    row = Dataset(
        id="dataset-1",
        tenant_id="tenant-1",
        name="Dataset",
        created_by="actor-1",
        maintainer="actor-1",
        indexing_technique="economy",
        chunk_structure="text_model",
    )
    for key, value in values.items():
        setattr(row, key, value)
    return row


def _document(**values: object) -> Document:
    row = Document(
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        position=1,
        data_source_type=DataSourceType("local_file"),
        batch="batch-1",
        name="Document",
        created_from=DocumentCreatedFrom("web"),
        created_by="actor-1",
    )
    row.id = "document-1"
    row.data_source_info = json.dumps({"file_path": "/path/to/file"})
    row.indexing_status = IndexingStatus.COMPLETED
    row.doc_form = IndexStructureType.PARAGRAPH_INDEX
    row.enabled = True
    row.archived = False
    row.word_count = 10
    row.created_at = datetime(2024, 1, 1)
    for key, value in values.items():
        setattr(row, key, value)
    return row


def _segment(
    segment_id: str,
    *,
    tenant_id: str = "tenant-1",
    dataset_id: str = "dataset-1",
    document_id: str = "document-1",
    status: SegmentStatus = SegmentStatus.COMPLETED,
    completed_at: datetime | None = datetime(2024, 1, 1),
    hit_count: int = 0,
) -> DocumentSegment:
    segment = DocumentSegment(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        position=1,
        content="content",
        word_count=7,
        tokens=2,
        created_by="actor-1",
        status=status,
        completed_at=completed_at,
        hit_count=hit_count,
    )
    segment.id = segment_id
    return segment


class TestDocumentAdaptersCases:
    @staticmethod
    @pytest.fixture
    def operations(sqlite_session_factory: sessionmaker[Session]) -> SQLAlchemyDocumentOperations:
        with sqlite_session_factory.begin() as session:
            session.add_all([_dataset(), _document()])
        return SQLAlchemyDocumentOperations(
            session_factory=sqlite_session_factory,
            documents=SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory),
            files=cast(FileService, object()),
        )

    @staticmethod
    def test_listing_filters_scope_and_materializes_values(
        operations: SQLAlchemyDocumentOperations, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        with sqlite_session_factory.begin() as session:
            session.add_all(
                [
                    _document(id="matching", name="Needle", position=2),
                    _document(id="disabled", name="Needle", enabled=False),
                    _document(id="foreign", name="Needle", tenant_id="other"),
                    _document(id="other-dataset", name="Needle", dataset_id="other"),
                ]
            )
        result = operations.list_documents(
            _DOCUMENT_ADAPTERS_REF, DocumentListFilter(search="Needle", status="available", fetch=True)
        )
        response = DocumentWithSegmentsListResponse.model_validate(result).model_dump(mode="json")
        assert response["total"] == 1
        assert response["data"][0]["id"] == "matching"
        assert response["data"][0]["data_source_info"] == {"file_path": "/path/to/file"}
        assert response["data"][0]["completed_segments"] == 0
        assert response["data"][0]["total_segments"] == 0

    @staticmethod
    def test_listing_hit_count_sort_and_exact_last_page(
        operations: SQLAlchemyDocumentOperations, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        with sqlite_session_factory.begin() as session:
            session.add_all(
                [
                    _document(id="popular", position=2),
                    _segment("segment-1", hit_count=1),
                    _segment("segment-2", document_id="popular", hit_count=10),
                    _segment("foreign", tenant_id="other", hit_count=1000),
                ]
            )
        first = operations.list_documents(_DOCUMENT_ADAPTERS_REF, DocumentListFilter(sort="-hit_count", limit=1))
        last = operations.list_documents(_DOCUMENT_ADAPTERS_REF, DocumentListFilter(sort="-hit_count", limit=1, page=2))
        assert [row["id"] for row in first["data"]] == ["popular"]
        assert first["has_more"] is True
        assert last["has_more"] is False
        assert last["total"] == 2

    @staticmethod
    def test_status_counts_use_one_aggregate_and_complete_owner_chain(
        operations: SQLAlchemyDocumentOperations, sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine
    ) -> None:
        with sqlite_session_factory.begin() as session:
            session.add_all(
                [
                    _segment("complete"),
                    _segment("waiting", completed_at=None),
                    _segment("excluded", status=SegmentStatus.RE_SEGMENT),
                    _segment("foreign", tenant_id="other"),
                    _segment("wrong-dataset", dataset_id="other"),
                    _document(id="second", is_paused=True, indexing_status=IndexingStatus.INDEXING),
                ]
            )
        statements: list[str] = []

        def record(
            _conn: object, _cursor: object, statement: str, _parameters: object, _context: object, _many: bool
        ) -> None:
            statements.append(statement)

        event.listen(sqlite_engine, "before_cursor_execute", record)
        try:
            result = operations.get_batch_indexing_status(_DOCUMENT_ADAPTERS_REF, "batch-1")
        finally:
            event.remove(sqlite_engine, "before_cursor_execute", record)
        rows = {row["id"]: row for row in result["data"]}
        assert rows["document-1"]["completed_segments"] == 1
        assert rows["document-1"]["total_segments"] == 2
        assert rows["second"]["indexing_status"] == "paused"
        assert sum("FROM document_segments" in statement for statement in statements) == 1

    @staticmethod
    def test_unknown_batch_is_not_found(operations: SQLAlchemyDocumentOperations) -> None:
        with pytest.raises(DocumentNotFoundError):
            operations.get_batch_indexing_status(_DOCUMENT_ADAPTERS_REF, "missing")

    @staticmethod
    @pytest.mark.parametrize("rules", [None, {"segmentation": {"delimiter": "\\n", "max_tokens": 500}}])
    def test_process_rule_preserves_null_and_legacy_delimiter(
        operations: SQLAlchemyDocumentOperations,
        sqlite_session_factory: sessionmaker[Session],
        rules: dict[str, object] | None,
    ) -> None:
        with sqlite_session_factory.begin() as session:
            session.add(
                DatasetProcessRule(
                    dataset_id="dataset-1",
                    mode=ProcessRuleMode.CUSTOM,
                    rules=json.dumps(rules) if rules else None,
                    created_by="actor-1",
                )
            )
        result = operations.get_process_rule(_DOCUMENT_ADAPTERS_REF)
        assert result["mode"] == "custom"
        assert result["rules"] == rules

    @staticmethod
    def test_detail_is_serializable_after_session_closes(operations: SQLAlchemyDocumentOperations) -> None:
        result = operations.get_detail(_DOCUMENT_ADAPTERS_REF.document("document-1"), metadata_only=False)
        response = DocumentDetailResponse.model_validate(result).model_dump(mode="json")
        assert response["id"] == "document-1"
        assert response["data_source_info"] == {"file_path": "/path/to/file"}
        assert response["data_source_detail_dict"] == {}
        assert response["created_at"] == int(datetime(2024, 1, 1).timestamp())

    @staticmethod
    def test_metadata_only_avoids_loading_full_details(operations: SQLAlchemyDocumentOperations) -> None:
        with patch("services.knowledge.documents.adapters.get_document_source_detail") as source:
            result = operations.get_detail(_DOCUMENT_ADAPTERS_REF.document("document-1"), metadata_only=True)
        assert set(result) == {"id", "doc_type", "doc_metadata"}
        source.assert_not_called()

    @staticmethod
    def test_latest_pipeline_log_and_empty_result(
        operations: SQLAlchemyDocumentOperations, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        assert operations.get_execution_log(_DOCUMENT_ADAPTERS_REF.document("document-1")) == {}
        with sqlite_session_factory.begin() as session:
            for year in [2024, 2025]:
                row = DocumentPipelineExecutionLog(
                    pipeline_id="pipeline-1",
                    document_id="document-1",
                    datasource_type="local_file",
                    datasource_info=json.dumps({"year": year}),
                    datasource_node_id="node-1",
                    input_data={"year": year},
                    created_by="actor-1",
                )
                row.created_at = datetime(year, 1, 1)
                session.add(row)
        result = operations.get_execution_log(_DOCUMENT_ADAPTERS_REF.document("document-1"))
        assert result["datasource_info"] == {"year": 2025}
        assert result["input_data"] == {"year": 2025}

