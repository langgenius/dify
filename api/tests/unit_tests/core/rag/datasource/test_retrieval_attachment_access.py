from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

from sqlalchemy import select

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
from core.rag.retrieval import dataset_retrieval as dataset_retrieval_module
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.workflow.nodes.knowledge_retrieval.retrieval import KnowledgeRetrievalRequest
from models import UploadFile


class _ScalarResult:
    def __init__(self, values):
        self._values = values

    def all(self):
        return self._values


class _AttachmentSession:
    def __init__(self, upload_file, binding):
        self._results = [
            _ScalarResult([upload_file]),
            _ScalarResult([binding]),
        ]

    def scalars(self, _stmt):
        return self._results.pop(0)


class _DatasetRetrievalSession:
    def __init__(self, datasets, documents):
        self._results = [
            _ScalarResult(datasets),
            _ScalarResult(documents),
        ]

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def scalars(self, _stmt):
        return self._results.pop(0)


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


def test_segment_attachment_lookup_grants_returned_upload_files_to_current_scope() -> None:
    tenant_id = str(uuid4())
    upload_file_id = str(uuid4())
    segment_id = str(uuid4())
    upload_file = SimpleNamespace(
        id=upload_file_id,
        name="chart.png",
        extension="png",
        mime_type="image/png",
        size=1024,
    )
    binding = SimpleNamespace(attachment_id=upload_file_id, segment_id=segment_id)
    session = _AttachmentSession(upload_file, binding)
    scope = FileAccessScope(
        tenant_id=tenant_id,
        user_id=str(uuid4()),
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )

    with bind_file_access_scope(scope):
        result = RetrievalService.get_segment_attachment_infos([upload_file_id], session)  # type: ignore[arg-type]
        scoped_stmt = DatabaseFileAccessController().apply_upload_file_filters(
            select(UploadFile).where(UploadFile.id == upload_file_id)
        )

    assert result[0]["attachment_id"] == upload_file_id
    whereclause = str(scoped_stmt.whereclause)
    assert "upload_files.created_by_role" in whereclause
    assert "upload_files.id IN" in whereclause


def test_knowledge_retrieval_grants_returned_segments_to_current_scope(monkeypatch) -> None:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    document_id = str(uuid4())
    segment_id = str(uuid4())
    segment = SimpleNamespace(
        id=segment_id,
        dataset_id=dataset_id,
        document_id=document_id,
        hit_count=1,
        word_count=10,
        position=1,
        index_node_hash="hash",
        answer=None,
        get_sign_content=lambda: "segment content",
    )
    record = SimpleNamespace(segment=segment, score=0.8, child_chunks=None, files=None, summary=None)
    dataset = SimpleNamespace(id=dataset_id, name="Dataset")
    document = SimpleNamespace(id=document_id, name="Document", data_source_type="upload_file", doc_metadata={})
    retrieval = DatasetRetrieval()
    monkeypatch.setattr(retrieval, "_check_knowledge_rate_limit", lambda tenant_id: None)
    monkeypatch.setattr(retrieval, "_get_available_datasets", lambda tenant_id, dataset_ids: [dataset])
    monkeypatch.setattr(retrieval, "multiple_retrieve", lambda **kwargs: [SimpleNamespace(provider="dify")])
    monkeypatch.setattr(RetrievalService, "format_retrieval_documents", lambda documents: [record])
    session = _DatasetRetrievalSession([dataset], [document])
    monkeypatch.setattr(dataset_retrieval_module.session_factory, "create_session", lambda: session)
    scope = FileAccessScope(
        tenant_id=tenant_id,
        user_id=str(uuid4()),
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )

    with bind_file_access_scope(scope):
        results = retrieval.knowledge_retrieval(
            KnowledgeRetrievalRequest(
                tenant_id=tenant_id,
                user_id=str(uuid4()),
                app_id=str(uuid4()),
                user_from=UserFrom.END_USER.value,
                dataset_ids=[dataset_id],
                query="desktop picture",
                retrieval_mode="multiple",
            )
        )
        current_scope = get_current_file_access_scope()

    assert results[0].metadata.segment_id == segment_id
    assert current_scope is not None
    assert segment_id in current_scope.granted_retriever_segment_ids
