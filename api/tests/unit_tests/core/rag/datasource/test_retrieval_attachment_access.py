from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import select
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
from core.rag.models.document import Document as RagDocument
from enums.creator import CreatorUserRole
from extensions.storage.storage_type import StorageType
from models import UploadFile
from models.dataset import Dataset, DocumentSegment, SegmentAttachmentBinding
from models.dataset import Document as DatasetDocument
from models.enums import DataSourceType, DocumentCreatedFrom, SegmentStatus
from services.knowledge.retrieval.finalization import KnowledgeRetrievalFinalizer
from services.knowledge.retrieval.records import RetrievalSegments


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
def test_segment_attachment_lookup_is_pure(sqlite_session: Session) -> None:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
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
        dataset_id=dataset_id,
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
        result = RetrievalService.get_segment_attachment_infos(
            [upload_file_id],
            dataset_refs=((tenant_id, dataset_id),),
            session=sqlite_session,
        )
        current_scope = get_current_file_access_scope()
        scoped_stmt = DatabaseFileAccessController().apply_upload_file_filters(
            select(UploadFile).where(UploadFile.id == upload_file_id)
        )

    assert result[0]["attachment_id"] == upload_file_id
    assert result[0]["attachment_info"]["source_url"] == ""
    assert current_scope is not None
    assert upload_file_id not in current_scope.granted_upload_file_ids
    whereclause = str(scoped_stmt.whereclause)
    assert "upload_files.created_by_role" in whereclause
    assert "upload_files.id IN" not in whereclause


@pytest.mark.parametrize("sqlite_session", [(UploadFile, SegmentAttachmentBinding)], indirect=True)
def test_segment_attachment_lookup_rejects_another_tenants_upload(sqlite_session: Session) -> None:
    tenant_id = str(uuid4())
    foreign_tenant_id = str(uuid4())
    upload_file_id = str(uuid4())
    foreign_dataset_id = str(uuid4())
    upload_file = UploadFile(
        tenant_id=foreign_tenant_id,
        storage_type=StorageType.LOCAL,
        key="uploads/foreign.png",
        name="foreign.png",
        size=1024,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.END_USER,
        created_by=str(uuid4()),
        created_at=datetime.now(UTC),
        used=False,
    )
    upload_file.id = upload_file_id
    sqlite_session.add_all(
        [
            upload_file,
            SegmentAttachmentBinding(
                tenant_id=foreign_tenant_id,
                dataset_id=foreign_dataset_id,
                document_id=str(uuid4()),
                segment_id=str(uuid4()),
                attachment_id=upload_file_id,
            ),
        ]
    )
    sqlite_session.commit()
    scope = FileAccessScope(
        tenant_id=tenant_id,
        user_id=str(uuid4()),
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )

    with bind_file_access_scope(scope):
        result = RetrievalService.get_segment_attachment_infos(
            [upload_file_id],
            dataset_refs=((tenant_id, str(uuid4())),),
            session=sqlite_session,
        )
        current_scope = get_current_file_access_scope()

    assert result == []
    assert current_scope is not None
    assert current_scope.granted_upload_file_ids == frozenset()


@pytest.mark.parametrize("sqlite_session", [(Dataset, DatasetDocument, DocumentSegment)], indirect=True)
def test_knowledge_retrieval_grants_returned_segments_to_current_scope(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
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
    document.indexing_status = "completed"
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
    finalizer = KnowledgeRetrievalFinalizer(session_factory=sqlite_session_factory)
    monkeypatch.setattr(
        RetrievalService,
        "format_retrieval_documents",
        lambda _session, documents, **_kwargs: [record],
    )
    scope = FileAccessScope(
        tenant_id=tenant_id,
        user_id=str(uuid4()),
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )

    with bind_file_access_scope(scope):
        result = finalizer.finalize_response(
            candidates=[RagDocument(page_content="segment content", provider="dify")],
            tenant_id=tenant_id,
            dataset_ids=[dataset_id],
            top_k=4,
            retriever_from="workflow",
        )
        current_scope = get_current_file_access_scope()

    assert result.sources[0].metadata.segment_id == segment_id
    assert current_scope is not None
    assert segment_id in current_scope.granted_retriever_segment_ids
