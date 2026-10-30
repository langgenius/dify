"""Exercise the SQL emitted when workflow retrieval assembles source citations."""

import json
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy import event, inspect, select
from sqlalchemy.exc import InvalidRequestError
from sqlalchemy.orm import Session, sessionmaker

from core.rag.models.document import Document as RetrievedDocument
from enums.creator import CreatorUserRole
from models.dataset import Dataset, DatasetQuery, Document, DocumentSegment
from models.enums import SegmentStatus
from repositories.knowledge.retrieval_source_repository import (
    SQLAlchemyRetrievalRepository,
    get_retrieval_source_documents,
)
from services.knowledge.retrieval.finalization import KnowledgeRetrievalFinalizer
from services.knowledge.retrieval.records import RetrievalSegments


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
        indexing_status="completed",
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
            status=SegmentStatus.COMPLETED,
            index_node_id=f"node-{position}",
            index_node_hash=f"hash-{position}",
        )
        for position in (1, 2)
    ]
    sqlite_session.add_all([dataset, document, *segments])
    sqlite_session.commit()
    records = [
        RetrievalSegments(segment=segment, score=score) for segment, score in zip(segments, (0.8, 0.9), strict=True)
    ]
    retrieved = [RetrievedDocument(provider="dify", page_content="content", metadata={})]
    queries: list[str] = []

    def capture_query(_conn, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        if "FROM documents" in statement:
            queries.append(statement)

    engine = sqlite_session.get_bind()
    finalizer = KnowledgeRetrievalFinalizer(session_factory=sqlite_session_factory)
    event.listen(engine, "before_cursor_execute", capture_query)
    try:
        with patch(
            "services.knowledge.retrieval.finalization.RetrievalService.format_retrieval_documents",
            return_value=records,
        ):
            result = finalizer.finalize_response(
                candidates=retrieved,
                tenant_id=tenant_id,
                dataset_ids=[dataset_id],
                top_k=4,
                retriever_from="workflow",
            )
    finally:
        event.remove(engine, "before_cursor_execute", capture_query)

    assert len(result.sources) == 2
    assert [source.content for source in result.sources] == ["content-2", "content-1"]
    for source in result.sources:
        assert source.title == "source.txt"
        assert source.metadata.document_id == document_id
        assert source.metadata.dataset_name == "Knowledge"
        assert source.metadata.data_source_type == "upload_file"
        assert source.metadata.doc_metadata == {"category": "transport"}
    # Finalization also checks current document ownership under row locks.
    # Those id-only reads must not change the single batched citation read or
    # load large, unused fields through an expired ORM object.
    citation_queries = [query for query in queries if "documents.name" in query]
    assert len(citation_queries) == 1, "Citation fields must not cause additional lazy SQL queries"
    for query in queries:
        assert "documents.data_source_info" not in query
        assert "documents.error" not in query
        assert "documents.indexing_latency" not in query


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


@pytest.mark.parametrize(
    ("user_from", "expected_role"),
    [("account", CreatorUserRole.ACCOUNT), ("end_user", CreatorUserRole.END_USER)],
)
def test_retrieval_repository_records_query_in_its_own_transaction(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    user_from: str,
    expected_role: CreatorUserRole,
) -> None:
    dataset = Dataset(tenant_id=str(uuid4()), name="Dataset", created_by=str(uuid4()))
    sqlite_session.add(dataset)
    sqlite_session.commit()
    repository = SQLAlchemyRetrievalRepository(session_factory=sqlite_session_factory)

    repository.record_app_query(
        tenant_id=dataset.tenant_id,
        dataset_ids=[dataset.id],
        query="question",
        attachment_ids=["image-1"],
        app_id=str(uuid4()),
        user_from=user_from,
        user_id=str(uuid4()),
    )

    sqlite_session.expire_all()
    query = sqlite_session.scalars(select(DatasetQuery)).one()
    assert query.created_by_role is expected_role
    assert json.loads(query.content) == [
        {"content_type": "text_query", "content": "question"},
        {"content_type": "image_query", "content": "image-1"},
    ]


def test_retrieval_repository_increments_each_selected_segment_once(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    tenant_id, creator_id, dataset_id, document_id = (str(uuid4()) for _ in range(4))
    dataset = Dataset(id=dataset_id, tenant_id=tenant_id, name="Dataset", created_by=creator_id)
    document = Document(
        id=document_id,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        position=1,
        data_source_type="upload_file",
        batch="batch",
        name="source.txt",
        created_from="web",
        created_by=creator_id,
    )
    segment = DocumentSegment(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        position=1,
        content="content",
        word_count=1,
        tokens=1,
        created_by=creator_id,
        hit_count=2,
    )
    sqlite_session.add_all([dataset, document, segment])
    sqlite_session.commit()

    SQLAlchemyRetrievalRepository(session_factory=sqlite_session_factory).increment_segment_hit_counts(
        [segment.id, segment.id]
    )

    sqlite_session.expire_all()
    assert sqlite_session.get_one(DocumentSegment, segment.id).hit_count == 3
