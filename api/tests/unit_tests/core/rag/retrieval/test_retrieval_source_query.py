"""Exercise the SQL emitted when workflow retrieval assembles source citations."""

from uuid import uuid4

import pytest
from sqlalchemy import event, inspect
from sqlalchemy.exc import InvalidRequestError
from sqlalchemy.orm import Session, sessionmaker

from core.rag.models.document import Document as RetrievedDocument
from core.workflow.nodes.knowledge_retrieval.retrieval import KnowledgeRetrievalRequest
from models.dataset import Dataset, Document, DocumentSegment
from repositories.knowledge.retrieval_repository import KnowledgeRetrievalRepository
from repositories.knowledge.retrieval_source_repository import get_retrieval_source_documents


def test_source_citations_do_not_fetch_unused_document_fields(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
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
    segment = DocumentSegment(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        position=1,
        content="content-1",
        word_count=10,
        tokens=3,
        created_by=creator_id,
        enabled=True,
        status="completed",
        index_node_id="node-1",
        index_node_hash="hash-1",
    )
    sqlite_session.add_all([dataset, document, segment])
    sqlite_session.commit()
    retrieved = [
        RetrievedDocument(
            provider="dify",
            page_content="content-1",
            metadata={"document_id": document_id, "doc_id": "node-1", "score": 0.8},
        )
    ]
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
    repository = KnowledgeRetrievalRepository(sqlite_session_factory)
    event.listen(engine, "before_cursor_execute", capture_query)
    try:
        sources = repository.workflow_sources(request, retrieved, [dataset_id])
    finally:
        event.remove(engine, "before_cursor_execute", capture_query)

    assert len(sources) == 1
    source = sources[0]
    assert source.content == "content-1"
    assert source.title == "source.txt"
    assert source.metadata.document_id == document_id
    assert source.metadata.dataset_name == "Knowledge"
    assert source.metadata.data_source_type == "upload_file"
    assert source.metadata.doc_metadata == {"category": "transport"}
    citation_queries = [query for query in queries if "documents.name" in query]
    assert len(citation_queries) == 1, "Citation fields must come from one minimal, owner-scoped query"
    citation_query = citation_queries[0]
    assert "documents.tenant_id = ?" in citation_query
    assert "documents.dataset_id IN" in citation_query
    assert "documents.data_source_info" not in citation_query
    assert "documents.error" not in citation_query
    assert "documents.indexing_latency" not in citation_query


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
