from __future__ import annotations

import json
from typing import Any, cast
from unittest.mock import ANY, MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.rag.models.document import Document
from models.dataset import Dataset, DatasetQuery
from services.hit_testing_service import HitTestingService


def _create_dataset(db_session: Session, *, provider: str = "vendor", **kwargs: Any) -> Dataset:
    tenant_id = str(uuid4())
    created_by = str(uuid4())
    ds = Dataset(
        tenant_id=kwargs.get("tenant_id", tenant_id),
        name=kwargs.get("name", "test-dataset"),
        created_by=kwargs.get("created_by", created_by),
        provider=provider,
    )
    db_session.add(ds)
    db_session.commit()
    db_session.refresh(ds)
    return ds


class TestHitTestingService:
    # ── Utility methods (pure logic, no DB) ────────────────────────────

    def test_escape_query_for_search_should_escape_double_quotes(self):
        query = 'test "query" with quotes'
        result = HitTestingService.escape_query_for_search(query)
        assert result == 'test \\"query\\" with quotes'

    def test_hit_testing_args_check_should_pass_with_valid_query(self):
        HitTestingService.hit_testing_args_check({"query": "valid query"})

    def test_hit_testing_args_check_should_pass_with_valid_attachments(self):
        HitTestingService.hit_testing_args_check({"attachment_ids": ["id1", "id2"]})

    def test_hit_testing_args_check_should_raise_error_when_no_query_or_attachments(self):
        with pytest.raises(ValueError, match="Query or attachment_ids is required"):
            HitTestingService.hit_testing_args_check({})

    def test_hit_testing_args_check_should_raise_error_when_query_too_long(self):
        with pytest.raises(ValueError, match="Query cannot exceed 250 characters"):
            HitTestingService.hit_testing_args_check({"query": "a" * 251})

    def test_hit_testing_args_check_should_raise_error_when_attachments_not_list(self):
        with pytest.raises(ValueError, match="Attachment_ids must be a list"):
            HitTestingService.hit_testing_args_check({"attachment_ids": "not a list"})

    # ── Response formatting ────────────────────────────────────────────

    @patch("core.rag.datasource.retrieval_service.RetrievalService.format_retrieval_documents")
    def test_compact_retrieve_response_should_format_correctly(self, mock_format):
        query = "test query"
        mock_doc = MagicMock(spec=Document)

        mock_record = MagicMock()
        mock_record.model_dump.return_value = {"content": "formatted content"}
        mock_format.return_value = [mock_record]

        result = cast(dict[str, Any], HitTestingService.compact_retrieve_response(query, [mock_doc]))

        assert cast(dict[str, Any], result["query"])["content"] == query
        assert len(result["records"]) == 1
        assert cast(dict[str, Any], result["records"][0])["content"] == "formatted content"
        mock_format.assert_called_once_with([mock_doc])

    def test_compact_external_retrieve_response_should_return_records_for_external_provider(
        self, db_session_with_containers: Session
    ):
        dataset = _create_dataset(db_session_with_containers, provider="external")
        documents = [
            {"content": "c1", "title": "t1", "score": 0.9, "metadata": {"m1": "v1"}},
            {"content": "c2", "title": "t2", "score": 0.8, "metadata": {"m2": "v2"}},
        ]

        result = cast(
            dict[str, Any], HitTestingService.compact_external_retrieve_response(dataset, "test query", documents)
        )

        assert cast(dict[str, Any], result["query"])["content"] == "test query"
        assert len(result["records"]) == 2
        assert cast(dict[str, Any], result["records"][0])["content"] == "c1"
        assert cast(dict[str, Any], result["records"][1])["title"] == "t2"

    def test_compact_external_retrieve_response_should_return_empty_for_non_external_provider(
        self, db_session_with_containers: Session
    ):
        dataset = _create_dataset(db_session_with_containers, provider="vendor")

        result = cast(
            dict[str, Any],
            HitTestingService.compact_external_retrieve_response(dataset, "test query", [{"content": "c1"}]),
        )

        assert cast(dict[str, Any], result["query"])["content"] == "test query"
        assert result["records"] == []

    # ── External retrieve (real DB) ────────────────────────────────────

    @patch("core.rag.datasource.retrieval_service.RetrievalService.external_retrieve")
    def test_external_retrieve_should_succeed_for_external_provider(
        self, mock_ext_retrieve, db_session_with_containers: Session
    ):
        dataset = _create_dataset(db_session_with_containers, provider="external")
        account_id = str(uuid4())
        account = MagicMock()
        account.id = account_id
        mock_ext_retrieve.return_value = [{"content": "ext content", "score": 1.0}]

        before_count = db_session_with_containers.scalar(select(func.count()).select_from(DatasetQuery)) or 0

        result = cast(
            dict[str, Any],
            HitTestingService.external_retrieve(
                dataset=dataset,
                query='test "query"',
                account=account,
                external_retrieval_model={"model": "test"},
                metadata_filtering_conditions={"key": "val"},
            ),
        )

        assert cast(dict[str, Any], result["query"])["content"] == 'test "query"'
        assert cast(dict[str, Any], result["records"][0])["content"] == "ext content"
        mock_ext_retrieve.assert_called_once_with(
            dataset_id=dataset.id,
            query='test \\"query\\"',
            external_retrieval_model={"model": "test"},
            metadata_filtering_conditions={"key": "val"},
        )

        db_session_with_containers.expire_all()
        after_count = db_session_with_containers.scalar(select(func.count()).select_from(DatasetQuery)) or 0
        assert after_count == before_count + 1

    def test_external_retrieve_should_return_empty_for_non_external_provider(self, db_session_with_containers: Session):
        dataset = _create_dataset(db_session_with_containers, provider="vendor")
        account = MagicMock()

        result = cast(dict[str, Any], HitTestingService.external_retrieve(dataset, "test query", account))

        assert cast(dict[str, Any], result["query"])["content"] == "test query"
        assert result["records"] == []

    # ── Retrieve (real DB) ─────────────────────────────────────────────

    @patch("core.rag.datasource.retrieval_service.RetrievalService.retrieve")
    def test_retrieve_should_use_default_model_when_none_provided(
        self, mock_retrieve, db_session_with_containers: Session
    ):
        dataset = _create_dataset(db_session_with_containers)
        dataset.retrieval_model = None
        account = MagicMock()
        account.id = str(uuid4())
        mock_retrieve.return_value = []

        before_count = db_session_with_containers.scalar(select(func.count()).select_from(DatasetQuery)) or 0

        result = cast(
            dict[str, Any],
            HitTestingService.retrieve(
                dataset=dataset, query="test query", account=account, retrieval_model=None, external_retrieval_model={}
            ),
        )

        assert cast(dict[str, Any], result["query"])["content"] == "test query"
        mock_retrieve.assert_called_once()
        assert mock_retrieve.call_args.kwargs["top_k"] == 4

        db_session_with_containers.expire_all()
        after_count = db_session_with_containers.scalar(select(func.count()).select_from(DatasetQuery)) or 0
        assert after_count == before_count + 1

    @patch("core.rag.datasource.retrieval_service.RetrievalService.retrieve")
    @patch("core.rag.retrieval.dataset_retrieval.DatasetRetrieval.get_metadata_filter_condition")
    def test_retrieve_should_handle_metadata_filtering(
        self, mock_get_meta, mock_retrieve, db_session_with_containers: Session
    ):
        dataset = _create_dataset(db_session_with_containers)
        account = MagicMock()
        account.id = str(uuid4())

        retrieval_model = {
            "search_method": "semantic_search",
            "metadata_filtering_conditions": {"some": "condition"},
            "top_k": 5,
            "reranking_enable": False,
            "score_threshold_enabled": False,
        }
        mock_get_meta.return_value = ({dataset.id: ["doc_id1"]}, "condition_string")
        mock_retrieve.return_value = []

        HitTestingService.retrieve(
            dataset=dataset,
            query="test query",
            account=account,
            retrieval_model=retrieval_model,
            external_retrieval_model={},
        )

        mock_get_meta.assert_called_once()
        mock_retrieve.assert_called_once()
        assert mock_retrieve.call_args.kwargs["document_ids_filter"] == ["doc_id1"]

    @patch("core.rag.datasource.retrieval_service.RetrievalService.retrieve")
    @patch("core.rag.retrieval.dataset_retrieval.DatasetRetrieval.get_metadata_filter_condition")
    def test_retrieve_should_return_empty_if_metadata_filtering_fails(
        self, mock_get_meta, mock_retrieve, db_session_with_containers: Session
    ):
        dataset = _create_dataset(db_session_with_containers)
        account = MagicMock()

        retrieval_model = {
            "search_method": "semantic_search",
            "metadata_filtering_conditions": {"some": "condition"},
            "top_k": 5,
            "reranking_enable": False,
            "score_threshold_enabled": False,
        }
        mock_get_meta.return_value = ({}, "condition_string")

        result = cast(
            dict[str, Any],
            HitTestingService.retrieve(
                dataset=dataset,
                query="test query",
                account=account,
                retrieval_model=retrieval_model,
                external_retrieval_model={},
            ),
        )

        assert result["records"] == []
        mock_retrieve.assert_not_called()

    @patch("core.rag.datasource.retrieval_service.RetrievalService.retrieve")
    def test_retrieve_should_handle_attachments(self, mock_retrieve, db_session_with_containers: Session):
        dataset = _create_dataset(db_session_with_containers)
        account = MagicMock()
        account.id = str(uuid4())
        attachment_ids = ["att1", "att2"]

        retrieval_model = {
            "search_method": "semantic_search",
            "top_k": 4,
            "reranking_enable": False,
            "score_threshold_enabled": False,
        }
        mock_retrieve.return_value = []

        HitTestingService.retrieve(
            dataset=dataset,
            query="test query",
            account=account,
            retrieval_model=retrieval_model,
            external_retrieval_model={},
            attachment_ids=attachment_ids,
        )

        mock_retrieve.assert_called_once_with(
            retrieval_method=ANY,
            dataset_id=dataset.id,
            query="test query",
            attachment_ids=attachment_ids,
            top_k=4,
            score_threshold=0.0,
            reranking_model=None,
            reranking_mode="reranking_model",
            weights=None,
            document_ids_filter=None,
        )

        # Verify DatasetQuery was persisted with correct content structure
        db_session_with_containers.expire_all()
        latest = db_session_with_containers.scalar(
            select(DatasetQuery)
            .where(DatasetQuery.dataset_id == dataset.id)
            .order_by(DatasetQuery.created_at.desc())
            .limit(1)
        )
        assert latest is not None
        query_content = json.loads(latest.content)
        assert len(query_content) == 3  # 1 text + 2 images
        assert query_content[0]["content_type"] == "text_query"
        assert query_content[1]["content_type"] == "image_query"
        assert query_content[1]["content"] == "att1"

    @patch("core.rag.datasource.retrieval_service.RetrievalService.retrieve")
    def test_retrieve_should_handle_reranking_and_threshold(self, mock_retrieve, db_session_with_containers: Session):
        dataset = _create_dataset(db_session_with_containers)
        account = MagicMock()
        account.id = str(uuid4())

        retrieval_model = {
            "search_method": "hybrid_search",
            "top_k": 10,
            "reranking_enable": True,
            "reranking_model": {"provider": "test"},
            "reranking_mode": "weighted_sum",
            "score_threshold_enabled": True,
            "score_threshold": 0.5,
            "weights": {"vector": 0.5, "keyword": 0.5},
        }
        mock_retrieve.return_value = []

        HitTestingService.retrieve(
            dataset=dataset,
            query="test query",
            account=account,
            retrieval_model=retrieval_model,
            external_retrieval_model={},
        )

        mock_retrieve.assert_called_once()
        kwargs = mock_retrieve.call_args.kwargs
        assert kwargs["score_threshold"] == 0.5
        assert kwargs["reranking_model"] == {"provider": "test"}
        assert kwargs["reranking_mode"] == "weighted_sum"
        assert kwargs["weights"] == {"vector": 0.5, "keyword": 0.5}
