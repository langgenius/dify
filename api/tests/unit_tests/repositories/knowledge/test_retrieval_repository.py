import json
from collections.abc import Iterator
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.models.document import Document
from models.dataset import ChildChunk, Dataset, DatasetQuery, DocumentSegment
from models.dataset import Document as DatasetDocument
from models.enums import CreatorUserRole, DatasetQuerySource, DataSourceType, DocumentCreatedFrom
from repositories.knowledge.retrieval_repository import KnowledgeRetrievalRepository


@pytest.fixture
def repository(sqlite_session_factory: sessionmaker[Session]) -> KnowledgeRetrievalRepository:
    return KnowledgeRetrievalRepository(sqlite_session_factory)


@pytest.fixture(autouse=True)
def caller_session_boundary(sqlite_engine: Engine) -> Iterator[None]:
    """Prove every repository operation leaves the caller's transaction intact."""

    with Session(sqlite_engine, expire_on_commit=False) as session:
        pending_query = DatasetQuery(
            dataset_id=str(uuid4()),
            content="caller-owned pending query",
            source=DatasetQuerySource.APP,
            source_app_id=str(uuid4()),
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=str(uuid4()),
        )
        session.add(pending_query)
        transaction = session.get_transaction()
        assert transaction is not None

        yield

        assert session.get_transaction() is transaction
        assert list(session.new) == [pending_query]
        assert not session.dirty
        assert not session.deleted

    with Session(sqlite_engine) as observer_session:
        assert observer_session.get(DatasetQuery, pending_query.id) is None


def _dataset(*, tenant_id: str) -> Dataset:
    return Dataset(tenant_id=tenant_id, name="Dataset", created_by=str(uuid4()))


def _dataset_document(*, tenant_id: str, dataset_id: str, doc_form: IndexStructureType) -> DatasetDocument:
    return DatasetDocument(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch",
        name="Document",
        created_from=DocumentCreatedFrom.API,
        created_by=str(uuid4()),
        doc_form=doc_form,
    )


def _segment(document: DatasetDocument, *, index_node_id: str) -> DocumentSegment:
    return DocumentSegment(
        tenant_id=document.tenant_id,
        dataset_id=document.dataset_id,
        document_id=document.id,
        position=1,
        content="content",
        word_count=1,
        tokens=1,
        created_by=document.created_by,
        index_node_id=index_node_id,
        hit_count=0,
    )


@pytest.mark.parametrize(
    ("role", "query", "attachment_ids", "expected_content"),
    [
        (CreatorUserRole.ACCOUNT, "test query", None, {"content_type": "text_query", "content": "test query"}),
        (CreatorUserRole.END_USER, "test query", None, {"content_type": "text_query", "content": "test query"}),
        (CreatorUserRole.ACCOUNT, None, ["attachment-1"], {"content_type": "image_query", "content": "attachment-1"}),
    ],
    ids=["account-text", "end-user-text", "account-image"],
)
def test_record_queries_uses_owned_transaction_and_tenant_scope(
    repository: KnowledgeRetrievalRepository,
    sqlite_session: Session,
    role: CreatorUserRole,
    query: str | None,
    attachment_ids: list[str] | None,
    expected_content: dict[str, str],
) -> None:
    tenant_id = str(uuid4())
    owned = _dataset(tenant_id=tenant_id)
    foreign = _dataset(tenant_id=str(uuid4()))
    sqlite_session.add_all([owned, foreign])
    sqlite_session.commit()

    repository.record_queries(
        tenant_id,
        query=query,
        attachment_ids=attachment_ids,
        dataset_ids=[owned.id, foreign.id],
        app_id=str(uuid4()),
        role=role,
        user_id=str(uuid4()),
    )

    queries = sqlite_session.scalars(select(DatasetQuery)).all()
    assert len(queries) == 1
    assert queries[0].dataset_id == owned.id
    assert queries[0].created_by_role == role
    assert json.loads(queries[0].content) == [expected_content]


def test_record_queries_without_content_keeps_caller_transaction(
    repository: KnowledgeRetrievalRepository,
    sqlite_session: Session,
) -> None:
    repository.record_queries(
        str(uuid4()),
        query=None,
        attachment_ids=None,
        dataset_ids=[str(uuid4())],
        app_id=str(uuid4()),
        role=CreatorUserRole.ACCOUNT,
        user_id=str(uuid4()),
    )

    assert sqlite_session.scalar(select(DatasetQuery)) is None


def test_record_hits_ignores_document_without_metadata(
    repository: KnowledgeRetrievalRepository,
) -> None:
    document = Document.model_construct(page_content="content", metadata=None, provider="dify")

    repository.record_hits(str(uuid4()), [document])


def test_record_hits_ignores_missing_dataset_document(
    repository: KnowledgeRetrievalRepository,
    sqlite_session: Session,
) -> None:
    document = Document(page_content="content", metadata={"document_id": str(uuid4()), "doc_id": "node-1"})

    repository.record_hits(str(uuid4()), [document])

    assert sqlite_session.scalar(select(DatasetDocument)) is None


def test_record_hits_parent_child_keys_include_dataset_and_document(
    repository: KnowledgeRetrievalRepository,
    sqlite_session: Session,
) -> None:
    tenant_id = str(uuid4())
    dataset_documents = [
        _dataset_document(
            tenant_id=tenant_id,
            dataset_id=str(uuid4()),
            doc_form=IndexStructureType.PARENT_CHILD_INDEX,
        )
        for _ in range(2)
    ]
    sqlite_session.add_all(dataset_documents)
    sqlite_session.flush()
    segments = [_segment(document, index_node_id=f"parent-{index}") for index, document in enumerate(dataset_documents)]
    sqlite_session.add_all(segments)
    sqlite_session.flush()
    sqlite_session.add_all(
        ChildChunk(
            tenant_id=document.tenant_id,
            dataset_id=document.dataset_id,
            document_id=document.id,
            segment_id=segment.id,
            position=1,
            content="child",
            word_count=1,
            created_by=document.created_by,
            index_node_id="shared-child-node",
        )
        for document, segment in zip(dataset_documents, segments, strict=True)
    )
    sqlite_session.commit()

    repository.record_hits(
        tenant_id,
        [
            Document(
                page_content="content",
                metadata={"document_id": document.id, "doc_id": "shared-child-node"},
            )
            for document in dataset_documents
        ],
    )

    sqlite_session.expire_all()
    assert [sqlite_session.get(DocumentSegment, segment.id).hit_count for segment in segments] == [1, 1]  # type: ignore[union-attr]


def test_record_hits_segment_keys_include_dataset_and_document(
    repository: KnowledgeRetrievalRepository,
    sqlite_session: Session,
) -> None:
    tenant_id = str(uuid4())
    dataset_documents = [
        _dataset_document(
            tenant_id=tenant_id,
            dataset_id=str(uuid4()),
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
        )
        for _ in range(2)
    ]
    sqlite_session.add_all(dataset_documents)
    sqlite_session.flush()
    segments = [_segment(document, index_node_id="shared-node") for document in dataset_documents]
    sqlite_session.add_all(segments)
    sqlite_session.commit()

    repository.record_hits(
        tenant_id,
        [
            Document(
                page_content="content",
                metadata={
                    "document_id": document.id,
                    "doc_id": "shared-node",
                    "dataset_id": document.dataset_id,
                },
            )
            for document in dataset_documents
        ],
    )

    sqlite_session.expire_all()
    assert [sqlite_session.get(DocumentSegment, segment.id).hit_count for segment in segments] == [1, 1]  # type: ignore[union-attr]


def test_record_hits_accepts_empty_documents(repository: KnowledgeRetrievalRepository) -> None:
    repository.record_hits(str(uuid4()), [])
