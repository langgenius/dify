"""Unit tests for the database-independent hit-testing helpers."""

from dataclasses import dataclass
from unittest.mock import patch

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.models.document import Document
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from models import Account
from models.dataset import Dataset, DatasetQuery
from services.hit_testing_service import HitTestingService


class TestHitTestingServiceArguments:
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


@dataclass
class _FakeSegment:
    """Minimal stand-in for a retrieval segment carrying a document id."""

    document_id: str


class _FakeRetrievalRecord:
    """Minimal stand-in for a RetrievalSegments record.

    Implements just the two members ``_dump_retrieval_records`` reads:
    ``model_dump()`` and ``segment.document_id``.
    """

    def __init__(self, document_id: str, content: str, score: float) -> None:
        self.segment = _FakeSegment(document_id)
        self._content = content
        self._score = score

    def model_dump(self) -> dict[str, str | float]:
        return {"content": self._content, "score": self._score}


class TestHitTestingServiceRetrieveTransaction:
    """Regression tests for https://github.com/langgenius/dify/issues/38998."""

    def test_retrieve_should_not_close_caller_managed_transaction(self, sqlite_session: Session) -> None:
        """retrieve() must not commit the caller-managed session mid-flow.

        When the caller manages the session inside a ``session.begin()`` block, an
        explicit ``session.commit()`` inside retrieve() closes that transaction and
        the follow-up document lookup then fails with "Can't operate on closed
        transaction inside context manager". The query log must be staged with
        ``flush()`` so the caller commits it.
        """
        dataset = Dataset(id="dataset-123", tenant_id="tenant-123", provider="vendor", retrieval_model=None)
        account = Account(name="Test User", email="test@example.com")
        account.id = "user-789"
        query = "test query"

        record = _FakeRetrievalRecord(document_id="doc-1", content="Doc 1", score=0.95)

        with (
            patch("services.hit_testing_service.RetrievalService.retrieve", autospec=True) as mock_retrieve,
            patch(
                "services.hit_testing_service.RetrievalService.format_retrieval_documents", autospec=True
            ) as mock_format,
        ):
            mock_retrieve.return_value = [Document(page_content="Doc 1", metadata={})]
            mock_format.return_value = [record]

            with sqlite_session.begin():
                result = HitTestingService.retrieve(dataset, query, account, None, {}, session=sqlite_session)

        assert result["query"]["content"] == query
        query_log = sqlite_session.scalar(select(DatasetQuery))
        assert query_log is not None
        assert query_log.dataset_id == dataset.id
        assert query_log.created_by == account.id


class TestHitTestingServiceConnectionUse:
    def test_retrieve_reads_metadata_filters_through_a_session_of_its_own(
        self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The caller's session must not be in a transaction while retrieval waits on a model or a vector store.

        A metadata lookup made through the caller's session would begin one, so the lookup uses a
        session that is closed before retrieval starts.
        """
        dataset = Dataset(
            id="dataset-123",
            tenant_id="tenant-123",
            provider="vendor",
            retrieval_model=None,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        )
        account = Account(name="Test User", email="test@example.com")
        account.id = "user-789"
        retrieval_model = {
            "search_method": RetrievalMethod.SEMANTIC_SEARCH,
            "reranking_enable": False,
            "score_threshold_enabled": False,
            "top_k": 4,
            "metadata_filtering_conditions": {
                "logical_operator": "and",
                "conditions": [{"name": "author", "comparison_operator": "is", "value": "someone"}],
            },
        }
        filter_sessions: list[Session] = []
        caller_in_transaction_during_retrieval: list[bool] = []
        document_filters: list[object] = []
        filtered_dataset_ids: list[object] = []

        def get_metadata_filter_condition(
            _self: DatasetRetrieval, *, session: Session, **kwargs: object
        ) -> tuple[dict[str, list[str]], None]:
            filter_sessions.append(session)
            filtered_dataset_ids.append(kwargs["dataset_ids"])
            return {dataset.id: ["document-1"]}, None

        def retrieve(**kwargs: object) -> list[Document]:
            caller_in_transaction_during_retrieval.append(sqlite_session.in_transaction())
            document_filters.append(kwargs["document_ids_filter"])
            return []

        monkeypatch.setattr(DatasetRetrieval, "get_metadata_filter_condition", get_metadata_filter_condition)
        monkeypatch.setattr(RetrievalService, "retrieve", retrieve)

        HitTestingService.retrieve(dataset, "test query", account, retrieval_model, {}, session=sqlite_session)

        assert len(filter_sessions) == 1
        assert filter_sessions[0] is not sqlite_session
        assert filtered_dataset_ids == [[dataset.id]]
        assert caller_in_transaction_during_retrieval == [False]
        assert document_filters == [["document-1"]]


class TestHitTestingServiceRetrievalMethod:
    @pytest.mark.parametrize(
        ("indexing_technique", "retrieval_model", "expected_method"),
        [
            (IndexTechniqueType.ECONOMY, None, RetrievalMethod.KEYWORD_SEARCH),
            (
                IndexTechniqueType.ECONOMY,
                {
                    "search_method": RetrievalMethod.SEMANTIC_SEARCH,
                    "reranking_enable": False,
                    "score_threshold_enabled": False,
                    "top_k": 4,
                },
                RetrievalMethod.KEYWORD_SEARCH,
            ),
            (IndexTechniqueType.HIGH_QUALITY, None, RetrievalMethod.SEMANTIC_SEARCH),
        ],
        ids=["economy-default", "economy-requested-semantic", "high-quality-default"],
    )
    def test_retrieve_should_use_keyword_search_only_for_economy_datasets(
        self,
        sqlite_session: Session,
        indexing_technique: IndexTechniqueType,
        retrieval_model: dict[str, object] | None,
        expected_method: RetrievalMethod,
    ) -> None:
        dataset = Dataset(
            id="dataset-123",
            tenant_id="tenant-123",
            provider="vendor",
            retrieval_model=None,
            indexing_technique=indexing_technique,
        )
        account = Account(name="Test User", email="test@example.com")
        account.id = "user-789"
        query = "test query"

        with (
            patch("services.hit_testing_service.RetrievalService.retrieve", autospec=True) as mock_retrieve,
        ):
            no_documents: list[Document] = []
            mock_retrieve.return_value = no_documents
            HitTestingService.retrieve(dataset, query, account, retrieval_model, {}, session=sqlite_session)

        assert mock_retrieve.call_args.kwargs["retrieval_method"] == expected_method
