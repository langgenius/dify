from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import (
    DatabaseFileAccessController,
    FileAccessScope,
    bind_file_access_scope,
    get_current_file_access_scope,
    grant_retriever_segment_access,
    grant_upload_file_access,
    is_retriever_segment_access_granted,
)
from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.embedding.retrieval import RetrievalSegments
from core.rag.models.document import Document as RagDocument
from core.rag.retrieval import dataset_retrieval as dataset_retrieval_module
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.workflow.nodes.knowledge_retrieval.retrieval import KnowledgeRetrievalRequest
from extensions.storage.storage_type import StorageType
from models import UploadFile
from models.dataset import Dataset, DocumentSegment, SegmentAttachmentBinding
from models.dataset import Document as DatasetDocument
from models.enums import CreatorUserRole, DataSourceType, DocumentCreatedFrom, SegmentStatus


def test_file_access_grants_ignore_empty_inputs_and_missing_scope() -> None:
    grant_upload_file_access(["upload-file-id"])
    grant_retriever_segment_access(["segment-id"])
    assert is_retriever_segment_access_granted("segment-id") is True

    scope = FileAccessScope(
        tenant_id=str(uuid4()),
        user_id=str(uuid4()),
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )

    with bind_file_access_scope(scope):
        grant_upload_file_access([""])
        grant_retriever_segment_access([""])
        current_scope = get_current_file_access_scope()

    assert current_scope is not None
    assert current_scope.granted_upload_file_ids == frozenset()
    assert current_scope.granted_retriever_segment_ids == frozenset()


@pytest.mark.parametrize("sqlite_session", [(UploadFile, SegmentAttachmentBinding)], indirect=True)
def test_segment_attachment_lookup_grants_returned_upload_files_to_current_scope(sqlite_session: Session) -> None:
    tenant_id = str(uuid4())
    upload_file_id = str(uuid4())
    segment_id = str(uuid4())
    user_id = str(uuid4())
    upload_file = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key="uploads/chart.png",
        name="chart.png",
        size=1024,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.END_USER,
        created_by=user_id,
        created_at=datetime.now(UTC),
        used=False,
    )
    upload_file.id = upload_file_id
    binding = SegmentAttachmentBinding(
        tenant_id=tenant_id,
        dataset_id=str(uuid4()),
        document_id=str(uuid4()),
        segment_id=segment_id,
        attachment_id=upload_file_id,
    )
    sqlite_session.add_all([upload_file, binding])
    sqlite_session.commit()
    scope = FileAccessScope(
        tenant_id=tenant_id,
        user_id=user_id,
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )

    with bind_file_access_scope(scope):
        result = RetrievalService.get_segment_attachment_infos([upload_file_id], sqlite_session)
        scoped_stmt = DatabaseFileAccessController().apply_upload_file_filters(
            select(UploadFile).where(UploadFile.id == upload_file_id)
        )

    assert result[0]["attachment_id"] == upload_file_id
    whereclause = str(scoped_stmt.whereclause)
    assert "upload_files.created_by_role" in whereclause
    assert "upload_files.id IN" in whereclause


@pytest.mark.parametrize("sqlite_session", [(Dataset, DatasetDocument, DocumentSegment)], indirect=True)
def test_knowledge_retrieval_grants_returned_segments_to_current_scope(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    sqlite_session: Session,
) -> None:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    document_id = str(uuid4())
    segment_id = str(uuid4())
    created_by = str(uuid4())
    dataset = Dataset(tenant_id=tenant_id, name="Dataset", created_by=created_by)
    dataset.id = dataset_id
    document = DatasetDocument(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="Document",
        created_from=DocumentCreatedFrom.API,
        created_by=created_by,
        doc_metadata={},
    )
    document.id = document_id
    segment = DocumentSegment(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        position=1,
        content="segment content",
        word_count=10,
        tokens=2,
        created_by=created_by,
        index_node_hash="hash",
        hit_count=1,
    )
    segment.id = segment_id
    segment.status = SegmentStatus.COMPLETED
    sqlite_session.add_all([dataset, document, segment])
    sqlite_session.commit()

    record = RetrievalSegments(segment=segment, score=0.8)
    retrieval = DatasetRetrieval()
    monkeypatch.setattr(retrieval, "_check_knowledge_rate_limit", lambda tenant_id: None)
    monkeypatch.setattr(retrieval, "_get_available_datasets", lambda tenant_id, dataset_ids: [dataset])
    monkeypatch.setattr(
        retrieval,
        "multiple_retrieve",
        lambda **kwargs: [RagDocument(page_content="segment content", provider="dify")],
    )
    monkeypatch.setattr(RetrievalService, "format_retrieval_documents", lambda _session, documents: [record])
    factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    monkeypatch.setattr(dataset_retrieval_module.session_factory, "create_session", factory)
    scope = FileAccessScope(
        tenant_id=tenant_id,
        user_id=str(uuid4()),
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )

    with bind_file_access_scope(scope):
        results = retrieval.knowledge_retrieval(
            sqlite_session,
            KnowledgeRetrievalRequest(
                tenant_id=tenant_id,
                user_id=str(uuid4()),
                app_id=str(uuid4()),
                user_from=UserFrom.END_USER.value,
                dataset_ids=[dataset_id],
                query="desktop picture",
                retrieval_mode="multiple",
            ),
        )
        current_scope = get_current_file_access_scope()

    assert results[0].metadata.segment_id == segment_id
    assert current_scope is not None
    assert segment_id in current_scope.granted_retriever_segment_ids
