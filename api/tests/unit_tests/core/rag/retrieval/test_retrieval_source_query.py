"""Exercise the SQL emitted when workflow retrieval assembles source citations."""

from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy import event, inspect
from sqlalchemy.exc import InvalidRequestError
from sqlalchemy.orm import Session

from core.rag.models.document import Document as RetrievedDocument
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.workflow.nodes.knowledge_retrieval.retrieval import KnowledgeRetrievalRequest
from models.dataset import Dataset, Document, DocumentSegment
from repositories.knowledge.retrieval_source_repository import get_retrieval_source_documents


def test_source_citations_do_not_fetch_unused_document_fields(sqlite_session: Session) -> None:
    tenant_id, creator_id, dataset_id, document_id = (str(uuid4()) for _ in range(4))
    dataset = Dataset(id=dataset_id, tenant_id=tenant_id, name="Knowledge", created_by=creator_id)
    document = Document(
        id=document_id,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        position=1,
        data_source_type="upload_file",
        batch="batch-1",
        name="source.txt",
        created_from="web",
        created_by=creator_id,
        enabled=True,
        archived=False,
        doc_metadata={"category": "transport"},
        data_source_info="x" * 1_000_000,
        error="y" * 1_000_000,
    )
    segments = [
        DocumentSegment(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=document_id,
            position=position,
            content=f"content-{position}",
            word_count=10,
            tokens=3,
            created_by=creator_id,
            enabled=True,
            index_node_id=f"node-{position}",
            index_node_hash=f"hash-{position}",
        )
        for position in (1, 2)
    ]
    sqlite_session.add_all([dataset, document, *segments])
    sqlite_session.commit()
    records = [
        SimpleNamespace(segment=segment, score=score, summary=None, child_chunks=None, files=None)
        for segment, score in zip(segments, (0.8, 0.9), strict=True)
    ]
    retrieved = [RetrievedDocument(provider="dify", page_content="content", metadata={})]
    request = KnowledgeRetrievalRequest(
        tenant_id=tenant_id,
        user_id=creator_id,
        app_id=str(uuid4()),
        user_from="web",
        dataset_ids=[dataset_id],
        query="小动物如何运输",
        retrieval_mode="multiple",
        metadata_filtering_mode="disabled",
    )
    queries: list[str] = []

    def capture_query(_conn, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        if "FROM documents" in statement:
            queries.append(statement)

    engine = sqlite_session.get_bind()
    retrieval = DatasetRetrieval()
    event.listen(engine, "before_cursor_execute", capture_query)
    try:
        with (
            patch.object(retrieval, "_check_knowledge_rate_limit"),
            patch.object(retrieval, "_get_available_datasets", return_value=[dataset]),
            patch.object(retrieval, "multiple_retrieve", return_value=retrieved),
            patch(
                "core.rag.retrieval.dataset_retrieval.RetrievalService.format_retrieval_documents",
                return_value=records,
            ),
        ):
            sources = retrieval.knowledge_retrieval(sqlite_session, request)
    finally:
        event.remove(engine, "before_cursor_execute", capture_query)

    assert len(sources) == 2
    assert [source.content for source in sources] == ["content-2", "content-1"]
    for source in sources:
        assert source.title == "source.txt"
        assert source.metadata.document_id == document_id
        assert source.metadata.dataset_name == "Knowledge"
        assert source.metadata.data_source_type == "upload_file"
        assert source.metadata.doc_metadata == {"category": "transport"}
    assert len(queries) == 1, "Citation fields must not cause additional lazy SQL queries"
    assert "documents.data_source_info" not in queries[0]
    assert "documents.error" not in queries[0]
    assert "documents.indexing_latency" not in queries[0]


def test_source_document_read_is_scoped_and_has_no_lazy_queries(sqlite_session: Session) -> None:
    tenant_id, foreign_tenant_id, dataset_id, foreign_dataset_id = (str(uuid4()) for _ in range(4))
    documents = [
        Document(
            id=str(uuid4()),
            tenant_id=owner,
            dataset_id=dataset,
            position=1,
            data_source_type="upload_file",
            batch="batch-1",
            name="source.txt",
            created_from="web",
            created_by=str(uuid4()),
            doc_metadata=None,
        )
        for owner, dataset in (
            (tenant_id, dataset_id),
            (foreign_tenant_id, dataset_id),
            (tenant_id, foreign_dataset_id),
        )
    ]
    sqlite_session.add_all(documents)
    sqlite_session.flush()
    document_ids = [document.id for document in documents]
    sqlite_session.expunge_all()
    queries: list[str] = []

    def capture_query(_conn, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        queries.append(statement)

    engine = sqlite_session.get_bind()
    event.listen(engine, "before_cursor_execute", capture_query)
    try:
        result = get_retrieval_source_documents(
            tenant_id=tenant_id,
            dataset_ids=[dataset_id],
            document_ids=[*document_ids, document_ids[0]],
            session=sqlite_session,
        )
        assert [document.id for document in result] == [document_ids[0]]
        assert result[0].name == "source.txt"
        assert result[0].data_source_type == "upload_file"
        assert result[0].doc_metadata is None
        assert set(inspect(result[0]).dict) - {"_sa_instance_state"} == {
            "id",
            "tenant_id",
            "dataset_id",
            "name",
            "data_source_type",
            "doc_metadata",
        }
        with pytest.raises(InvalidRequestError, match="raiseload"):
            _ = result[0].data_source_info
        assert (
            get_retrieval_source_documents(
                tenant_id=tenant_id, dataset_ids=[], document_ids=document_ids, session=sqlite_session
            )
            == []
        )
        assert (
            get_retrieval_source_documents(
                tenant_id=tenant_id, dataset_ids=[dataset_id], document_ids=[], session=sqlite_session
            )
            == []
        )
    finally:
        event.remove(engine, "before_cursor_execute", capture_query)
    assert len(queries) == 1
