"""SQLite-backed tests for dataset availability, rate limiting, and retrieval orchestration."""

from dataclasses import dataclass
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.models.document import Document
from core.rag.retrieval import dataset_retrieval as retrieval_module
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.workflow.nodes.knowledge_retrieval import exc
from core.workflow.nodes.knowledge_retrieval.retrieval import KnowledgeRetrievalRequest
from models.dataset import Dataset, DocumentSegment, RateLimitLog
from models.dataset import Document as DatasetDocument
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus


@dataclass(frozen=True)
class RetrievalDatabase:
    session_maker: sessionmaker[Session]


@pytest.fixture
def retrieval_database(sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> RetrievalDatabase:
    """Bind every retrieval-owned session to a disposable SQLite database."""
    Dataset.metadata.create_all(
        sqlite_engine,
        tables=[Dataset.__table__, DatasetDocument.__table__, DocumentSegment.__table__, RateLimitLog.__table__],
    )
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    monkeypatch.setattr(retrieval_module.session_factory, "create_session", session_maker)
    return RetrievalDatabase(session_maker=session_maker)


def _persist_dataset(
    database: RetrievalDatabase,
    *,
    dataset_id: str,
    tenant_id: str = "tenant-1",
    provider: str = "vendor",
) -> Dataset:
    dataset = Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name=f"Dataset {dataset_id}",
        created_by="user-1",
        provider=provider,
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        embedding_model="text-embedding-ada-002",
        embedding_model_provider="openai",
        retrieval_model={
            "search_method": "semantic_search",
            "reranking_enable": False,
            "top_k": 4,
            "score_threshold_enabled": False,
        },
    )
    with database.session_maker.begin() as session:
        session.add(dataset)
    return dataset


def _persist_document(
    database: RetrievalDatabase,
    *,
    dataset_id: str,
    document_id: str,
    tenant_id: str = "tenant-1",
    indexing_status: IndexingStatus = IndexingStatus.COMPLETED,
    enabled: bool = True,
    archived: bool = False,
) -> DatasetDocument:
    document = DatasetDocument(
        id=document_id,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name=f"Document {document_id}",
        created_from=DocumentCreatedFrom.API,
        created_by="user-1",
        indexing_status=indexing_status,
        enabled=enabled,
        archived=archived,
    )
    with database.session_maker.begin() as session:
        session.add(document)
    return document


def _persist_segment(
    database: RetrievalDatabase,
    *,
    dataset_id: str,
    document_id: str,
) -> DocumentSegment:
    segment = DocumentSegment(
        tenant_id="tenant-1",
        dataset_id=dataset_id,
        document_id=document_id,
        position=1,
        content="Python is great",
        word_count=3,
        tokens=3,
        created_by="user-1",
        index_node_id="node-1",
        index_node_hash="hash-1",
        hit_count=5,
    )
    with database.session_maker.begin() as session:
        session.add(segment)
    return segment


def _persist_available_dataset(
    database: RetrievalDatabase,
    *,
    dataset_id: str = "dataset-1",
    document_id: str = "document-1",
) -> tuple[Dataset, DatasetDocument]:
    return (
        _persist_dataset(database, dataset_id=dataset_id),
        _persist_document(database, dataset_id=dataset_id, document_id=document_id),
    )


def _request(
    *,
    dataset_ids: list[str],
    retrieval_mode: str = "multiple",
    metadata_filtering_mode: str = "disabled",
) -> KnowledgeRetrievalRequest:
    return KnowledgeRetrievalRequest(
        tenant_id="tenant-1",
        user_id="user-1",
        app_id="app-1",
        user_from="web",
        dataset_ids=dataset_ids,
        query="What is Python?",
        retrieval_mode=retrieval_mode,
        metadata_filtering_mode=metadata_filtering_mode,
        top_k=5,
        score_threshold=0.7,
        reranking_enable=True,
        reranking_mode="reranking_model",
        reranking_model={"reranking_provider_name": "cohere", "reranking_model_name": "rerank-v2"},
    )


def _rag_document(
    content: str,
    doc_id: str,
    *,
    score: float = 0.8,
    provider: str = "dify",
    additional_metadata: dict[str, object] | None = None,
) -> Document:
    metadata: dict[str, object] = {
        "doc_id": doc_id,
        "document_id": "document-1",
        "dataset_id": "dataset-1",
        "score": score,
    }
    if additional_metadata:
        metadata.update(additional_metadata)
    return Document(page_content=content, metadata=metadata, provider=provider)


def _patch_rate_limit(
    monkeypatch: pytest.MonkeyPatch,
    *,
    enabled: bool,
    request_count: int = 0,
) -> MagicMock:
    limit = SimpleNamespace(enabled=enabled, limit=100, subscription_plan="professional")
    monkeypatch.setattr(
        retrieval_module.FeatureService,
        "get_knowledge_rate_limit",
        MagicMock(return_value=limit),
    )
    redis = MagicMock()
    redis.zcard.return_value = request_count
    monkeypatch.setattr(retrieval_module, "redis_client", redis)
    monkeypatch.setattr(retrieval_module.time, "time", lambda: 1234567890)
    return redis


class TestCheckKnowledgeRateLimit:
    def test_rate_limit_disabled_performs_no_redis_or_database_work(
        self,
        monkeypatch: pytest.MonkeyPatch,
        retrieval_database: RetrievalDatabase,
    ) -> None:
        redis = _patch_rate_limit(monkeypatch, enabled=False)

        DatasetRetrieval()._check_knowledge_rate_limit("tenant-1")

        redis.zadd.assert_not_called()
        with retrieval_database.session_maker() as session:
            assert session.scalar(select(RateLimitLog)) is None

    def test_rate_limit_enabled_not_exceeded_tracks_request_without_log(
        self,
        monkeypatch: pytest.MonkeyPatch,
        retrieval_database: RetrievalDatabase,
    ) -> None:
        redis = _patch_rate_limit(monkeypatch, enabled=True, request_count=50)

        DatasetRetrieval()._check_knowledge_rate_limit("tenant-1")

        current_time = 1234567890000
        redis.zadd.assert_called_once_with("rate_limit_tenant-1", {current_time: current_time})
        redis.zremrangebyscore.assert_called_once_with("rate_limit_tenant-1", 0, current_time - 60000)
        with retrieval_database.session_maker() as session:
            assert session.scalar(select(RateLimitLog)) is None

    def test_rate_limit_exceeded_commits_audit_log_before_raising(
        self,
        monkeypatch: pytest.MonkeyPatch,
        retrieval_database: RetrievalDatabase,
    ) -> None:
        _patch_rate_limit(monkeypatch, enabled=True, request_count=150)

        with pytest.raises(exc.RateLimitExceededError, match="knowledge base request rate limit"):
            DatasetRetrieval()._check_knowledge_rate_limit("tenant-1")

        with retrieval_database.session_maker() as session:
            logs = session.scalars(select(RateLimitLog)).all()
            assert len(logs) == 1
            assert logs[0].tenant_id == "tenant-1"
            assert logs[0].subscription_plan == "professional"
            assert logs[0].operation == "knowledge"


class TestGetAvailableDatasets:
    def test_returns_completed_or_external_datasets_with_tenant_scope(
        self,
        retrieval_database: RetrievalDatabase,
    ) -> None:
        _persist_available_dataset(retrieval_database, dataset_id="available", document_id="available-doc")
        _persist_dataset(retrieval_database, dataset_id="disabled")
        _persist_document(
            retrieval_database,
            dataset_id="disabled",
            document_id="disabled-doc",
            enabled=False,
        )
        _persist_dataset(retrieval_database, dataset_id="archived")
        _persist_document(
            retrieval_database,
            dataset_id="archived",
            document_id="archived-doc",
            archived=True,
        )
        _persist_dataset(retrieval_database, dataset_id="waiting")
        _persist_document(
            retrieval_database,
            dataset_id="waiting",
            document_id="waiting-doc",
            indexing_status=IndexingStatus.WAITING,
        )
        _persist_dataset(retrieval_database, dataset_id="external", provider="external")
        _persist_dataset(retrieval_database, dataset_id="other-tenant", tenant_id="tenant-2")
        _persist_document(
            retrieval_database,
            dataset_id="other-tenant",
            document_id="other-doc",
            tenant_id="tenant-2",
        )

        datasets = DatasetRetrieval()._get_available_datasets(
            "tenant-1",
            ["available", "disabled", "archived", "waiting", "external", "other-tenant"],
        )

        assert {dataset.id for dataset in datasets} == {"available", "external"}

    def test_returns_empty_for_vendor_dataset_without_documents(
        self,
        retrieval_database: RetrievalDatabase,
    ) -> None:
        _persist_dataset(retrieval_database, dataset_id="empty")

        assert DatasetRetrieval()._get_available_datasets("tenant-1", ["empty"]) == []


class TestDatasetRetrievalKnowledgeRetrieval:
    def test_single_mode_request_shape(self) -> None:
        request = KnowledgeRetrievalRequest(
            tenant_id="tenant-1",
            user_id="user-1",
            app_id="app-1",
            user_from="web",
            dataset_ids=["dataset-1"],
            query="What is Python?",
            retrieval_mode="single",
            model_provider="openai",
            model_name="gpt-4",
            model_mode="chat",
            completion_params={"temperature": 0.7},
        )

        assert request.retrieval_mode == "single"
        assert request.model_provider == "openai"
        assert request.model_name == "gpt-4"

    def test_multiple_mode_formats_persisted_dataset_and_document(
        self,
        monkeypatch: pytest.MonkeyPatch,
        retrieval_database: RetrievalDatabase,
    ) -> None:
        dataset, document = _persist_available_dataset(retrieval_database)
        segment = _persist_segment(retrieval_database, dataset_id=dataset.id, document_id=document.id)
        retrieval = DatasetRetrieval()
        monkeypatch.setattr(retrieval, "_check_knowledge_rate_limit", MagicMock())
        monkeypatch.setattr(retrieval, "multiple_retrieve", MagicMock(return_value=[_rag_document("Python", "node-1")]))
        record = SimpleNamespace(segment=segment, score=0.9, child_chunks=[], summary=None, files=None)
        monkeypatch.setattr(
            retrieval_module.RetrievalService,
            "format_retrieval_documents",
            MagicMock(return_value=[record]),
        )
        grant_access = MagicMock()
        monkeypatch.setattr(retrieval_module, "grant_retriever_segment_access", grant_access)

        with retrieval_database.session_maker() as caller_session:
            result = retrieval.knowledge_retrieval(caller_session, _request(dataset_ids=[dataset.id]))

        assert len(result) == 1
        assert result[0].metadata.dataset_id == dataset.id
        assert result[0].metadata.document_id == document.id
        assert result[0].title == document.name
        grant_access.assert_called_once_with([segment.id])

    def test_metadata_filtering_disabled_skips_filter_builder(
        self,
        monkeypatch: pytest.MonkeyPatch,
        retrieval_database: RetrievalDatabase,
    ) -> None:
        _persist_available_dataset(retrieval_database)
        retrieval = DatasetRetrieval()
        monkeypatch.setattr(retrieval, "_check_knowledge_rate_limit", MagicMock())
        metadata_filter = MagicMock(return_value=(None, None))
        monkeypatch.setattr(retrieval, "get_metadata_filter_condition", metadata_filter)
        monkeypatch.setattr(retrieval, "multiple_retrieve", MagicMock(return_value=[]))

        with retrieval_database.session_maker() as caller_session:
            result = retrieval.knowledge_retrieval(caller_session, _request(dataset_ids=["dataset-1"]))

        assert result == []
        metadata_filter.assert_not_called()

    def test_external_documents_are_formatted_without_database_document(
        self,
        monkeypatch: pytest.MonkeyPatch,
        retrieval_database: RetrievalDatabase,
    ) -> None:
        _persist_dataset(retrieval_database, dataset_id="external", provider="external")
        retrieval = DatasetRetrieval()
        monkeypatch.setattr(retrieval, "_check_knowledge_rate_limit", MagicMock())
        external_document = _rag_document(
            "External knowledge",
            "external-node",
            score=0.9,
            provider="external",
            additional_metadata={
                "dataset_id": "external",
                "dataset_name": "External Dataset",
                "document_id": "external-document",
                "title": "External Document",
            },
        )
        monkeypatch.setattr(retrieval, "multiple_retrieve", MagicMock(return_value=[external_document]))

        with retrieval_database.session_maker() as caller_session:
            result = retrieval.knowledge_retrieval(caller_session, _request(dataset_ids=["external"]))

        assert len(result) == 1
        assert result[0].metadata.data_source_type == "external"
        assert result[0].metadata.dataset_id == "external"

    def test_empty_retrieval_results_return_empty_list(
        self,
        monkeypatch: pytest.MonkeyPatch,
        retrieval_database: RetrievalDatabase,
    ) -> None:
        _persist_available_dataset(retrieval_database)
        retrieval = DatasetRetrieval()
        monkeypatch.setattr(retrieval, "_check_knowledge_rate_limit", MagicMock())
        monkeypatch.setattr(retrieval, "multiple_retrieve", MagicMock(return_value=[]))

        with retrieval_database.session_maker() as caller_session:
            result = retrieval.knowledge_retrieval(caller_session, _request(dataset_ids=["dataset-1"]))

        assert result == []

    def test_rate_limit_exception_stops_retrieval(
        self,
        monkeypatch: pytest.MonkeyPatch,
        retrieval_database: RetrievalDatabase,
    ) -> None:
        retrieval = DatasetRetrieval()
        monkeypatch.setattr(
            retrieval,
            "_check_knowledge_rate_limit",
            MagicMock(side_effect=exc.RateLimitExceededError("Rate limit exceeded")),
        )

        with retrieval_database.session_maker() as caller_session:
            with pytest.raises(exc.RateLimitExceededError):
                retrieval.knowledge_retrieval(caller_session, _request(dataset_ids=["dataset-1"]))

    def test_no_available_datasets_skips_retrieval(
        self,
        monkeypatch: pytest.MonkeyPatch,
        retrieval_database: RetrievalDatabase,
    ) -> None:
        _persist_dataset(retrieval_database, dataset_id="empty")
        retrieval = DatasetRetrieval()
        monkeypatch.setattr(retrieval, "_check_knowledge_rate_limit", MagicMock())
        multiple_retrieve = MagicMock()
        monkeypatch.setattr(retrieval, "multiple_retrieve", multiple_retrieve)

        with retrieval_database.session_maker() as caller_session:
            result = retrieval.knowledge_retrieval(caller_session, _request(dataset_ids=["empty"]))

        assert result == []
        multiple_retrieve.assert_not_called()

    def test_document_scores_sort_descending(self) -> None:
        documents = [
            _rag_document("Low", "doc1", score=0.6),
            _rag_document("High", "doc2", score=0.95),
            _rag_document("Medium", "doc3", score=0.8),
        ]

        sorted_documents = sorted(documents, key=lambda document: document.metadata["score"], reverse=True)

        assert [document.metadata["score"] for document in sorted_documents] == [0.95, 0.8, 0.6]
