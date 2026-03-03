import json
from typing import Any, cast
from unittest.mock import ANY, MagicMock, patch

import pytest

from core.rag.models.document import Document
from models.dataset import Dataset
from services.hit_testing_service import HitTestingService


class TestHitTestingService:
    """Test suite for HitTestingService"""

    # ===== Utility Method Tests =====

    def test_escape_query_for_search_should_escape_double_quotes(self):
        """Test that escape_query_for_search escapes double quotes correctly"""
        # Arrange
        query = 'test "query" with quotes'
        expected = 'test \\"query\\" with quotes'

        # Act
        result = HitTestingService.escape_query_for_search(query)

        # Assert
        assert result == expected

    def test_hit_testing_args_check_should_pass_with_valid_query(self):
        """Test that hit_testing_args_check passes with a valid query"""
        # Arrange
        args = {"query": "valid query"}

        # Act & Assert (should not raise)
        HitTestingService.hit_testing_args_check(args)

    def test_hit_testing_args_check_should_pass_with_valid_attachments(self):
        """Test that hit_testing_args_check passes with valid attachment_ids"""
        # Arrange
        args = {"attachment_ids": ["id1", "id2"]}

        # Act & Assert (should not raise)
        HitTestingService.hit_testing_args_check(args)

    def test_hit_testing_args_check_should_raise_error_when_no_query_or_attachments(self):
        """Test that hit_testing_args_check raises ValueError if both query and attachment_ids are missing"""
        # Arrange
        args = {}

        # Act & Assert
        with pytest.raises(ValueError) as exc_info:
            HitTestingService.hit_testing_args_check(args)
        assert "Query or attachment_ids is required" in str(exc_info.value)

    def test_hit_testing_args_check_should_raise_error_when_query_too_long(self):
        """Test that hit_testing_args_check raises ValueError if query exceeds 250 characters"""
        # Arrange
        args = {"query": "a" * 251}

        # Act & Assert
        with pytest.raises(ValueError) as exc_info:
            HitTestingService.hit_testing_args_check(args)
        assert "Query cannot exceed 250 characters" in str(exc_info.value)

    def test_hit_testing_args_check_should_raise_error_when_attachments_not_list(self):
        """Test that hit_testing_args_check raises ValueError if attachment_ids is not a list"""
        # Arrange
        args = {"attachment_ids": "not a list"}

        # Act & Assert
        with pytest.raises(ValueError) as exc_info:
            HitTestingService.hit_testing_args_check(args)
        assert "Attachment_ids must be a list" in str(exc_info.value)

    # ===== Response Formatting Tests =====

    @patch("core.rag.datasource.retrieval_service.RetrievalService.format_retrieval_documents")
    def test_compact_retrieve_response_should_format_correctly(self, mock_format):
        """Test that compact_retrieve_response formats the response correctly"""
        # Arrange
        query = "test query"
        mock_doc = MagicMock(spec=Document)
        documents = [mock_doc]

        mock_record = MagicMock()
        mock_record.model_dump.return_value = {"content": "formatted content"}
        mock_format.return_value = [mock_record]

        # Act
        result = cast(dict[str, Any], HitTestingService.compact_retrieve_response(query, documents))

        # Assert
        assert cast(dict[str, Any], result["query"])["content"] == query
        assert len(result["records"]) == 1
        assert cast(dict[str, Any], result["records"][0])["content"] == "formatted content"
        mock_format.assert_called_once_with(documents)

    def test_compact_external_retrieve_response_should_return_records_for_external_provider(self):
        """Test that compact_external_retrieve_response returns records when dataset provider is external"""
        # Arrange
        dataset = MagicMock(spec=Dataset)
        dataset.provider = "external"
        query = "test query"
        documents = [
            {"content": "c1", "title": "t1", "score": 0.9, "metadata": {"m1": "v1"}},
            {"content": "c2", "title": "t2", "score": 0.8, "metadata": {"m2": "v2"}},
        ]

        # Act
        result = cast(dict[str, Any], HitTestingService.compact_external_retrieve_response(dataset, query, documents))

        # Assert
        assert cast(dict[str, Any], result["query"])["content"] == query
        assert len(result["records"]) == 2
        assert cast(dict[str, Any], result["records"][0])["content"] == "c1"
        assert cast(dict[str, Any], result["records"][1])["title"] == "t2"

    def test_compact_external_retrieve_response_should_return_empty_for_non_external_provider(self):
        """Test that compact_external_retrieve_response returns empty records for non-external provider"""
        # Arrange
        dataset = MagicMock(spec=Dataset)
        dataset.provider = "not_external"
        query = "test query"
        documents = [{"content": "c1"}]

        # Act
        result = cast(dict[str, Any], HitTestingService.compact_external_retrieve_response(dataset, query, documents))

        # Assert
        assert cast(dict[str, Any], result["query"])["content"] == query
        assert result["records"] == []

    # ===== External Retrieve Tests =====

    @patch("core.rag.datasource.retrieval_service.RetrievalService.external_retrieve")
    @patch("extensions.ext_database.db.session.add")
    @patch("extensions.ext_database.db.session.commit")
    def test_external_retrieve_should_succeed_for_external_provider(self, mock_commit, mock_add, mock_ext_retrieve):
        """Test that external_retrieve successfully retrieves from external provider and commits query"""
        # Arrange
        dataset = MagicMock(spec=Dataset)
        dataset.id = "dataset_id"
        dataset.provider = "external"
        query = 'test "query"'
        account = MagicMock()
        account.id = "account_id"

        mock_ext_retrieve.return_value = [{"content": "ext content", "score": 1.0}]

        # Act
        result = cast(
            dict[str, Any],
            HitTestingService.external_retrieve(
                dataset=dataset,
                query=query,
                account=account,
                external_retrieval_model={"model": "test"},
                metadata_filtering_conditions={"key": "val"},
            ),
        )

        # Assert
        assert cast(dict[str, Any], result["query"])["content"] == query
        assert cast(dict[str, Any], result["records"][0])["content"] == "ext content"

        # Verify call to RetrievalService.external_retrieve with escaped query
        mock_ext_retrieve.assert_called_once_with(
            dataset_id="dataset_id",
            query='test \\"query\\"',
            external_retrieval_model={"model": "test"},
            metadata_filtering_conditions={"key": "val"},
        )

        # Verify DatasetQuery record was added and committed
        mock_add.assert_called_once()
        mock_commit.assert_called_once()

    def test_external_retrieve_should_return_empty_for_non_external_provider(self):
        """Test that external_retrieve returns empty results immediately if provider is not external"""
        # Arrange
        dataset = MagicMock(spec=Dataset)
        dataset.provider = "not_external"
        query = "test query"
        account = MagicMock()

        # Act
        result = cast(dict[str, Any], HitTestingService.external_retrieve(dataset, query, account))

        # Assert
        assert cast(dict[str, Any], result["query"])["content"] == query
        assert result["records"] == []

    # ===== Retrieve Tests =====

    @patch("core.rag.datasource.retrieval_service.RetrievalService.retrieve")
    @patch("extensions.ext_database.db.session.add")
    @patch("extensions.ext_database.db.session.commit")
    def test_retrieve_should_use_default_model_when_none_provided(self, mock_commit, mock_add, mock_retrieve):
        """Test that retrieve uses default model when retrieval_model is not provided"""
        # Arrange
        dataset = MagicMock(spec=Dataset)
        dataset.id = "dataset_id"
        dataset.retrieval_model = None
        query = "test query"
        account = MagicMock()
        account.id = "account_id"

        mock_retrieve.return_value = []

        # Act
        result = cast(
            dict[str, Any],
            HitTestingService.retrieve(
                dataset=dataset, query=query, account=account, retrieval_model=None, external_retrieval_model={}
            ),
        )

        # Assert
        assert cast(dict[str, Any], result["query"])["content"] == query
        mock_retrieve.assert_called_once()
        # Verify top_k from default_retrieval_model (4)
        assert mock_retrieve.call_args.kwargs["top_k"] == 4
        mock_commit.assert_called_once()

    @patch("core.rag.datasource.retrieval_service.RetrievalService.retrieve")
    @patch("core.rag.retrieval.dataset_retrieval.DatasetRetrieval.get_metadata_filter_condition")
    @patch("extensions.ext_database.db.session.add")
    @patch("extensions.ext_database.db.session.commit")
    def test_retrieve_should_handle_metadata_filtering(self, mock_commit, mock_add, mock_get_meta, mock_retrieve):
        """Test that retrieve correctly calls metadata filtering when conditions are present"""
        # Arrange
        dataset = MagicMock(spec=Dataset)
        dataset.id = "dataset_id"
        query = "test query"
        account = MagicMock()
        account.id = "account_id"

        retrieval_model = {
            "search_method": "semantic_search",
            "metadata_filtering_conditions": {"some": "condition"},
            "top_k": 5,
            "reranking_enable": False,
            "score_threshold_enabled": False,
        }

        # Mock metadata filtering response
        mock_get_meta.return_value = ({"dataset_id": ["doc_id1"]}, "condition_string")
        mock_retrieve.return_value = []

        # Act
        HitTestingService.retrieve(
            dataset=dataset, query=query, account=account, retrieval_model=retrieval_model, external_retrieval_model={}
        )

        # Assert
        mock_get_meta.assert_called_once()
        mock_retrieve.assert_called_once()
        assert mock_retrieve.call_args.kwargs["document_ids_filter"] == ["doc_id1"]

    @patch("core.rag.datasource.retrieval_service.RetrievalService.retrieve")
    @patch("core.rag.retrieval.dataset_retrieval.DatasetRetrieval.get_metadata_filter_condition")
    def test_retrieve_should_return_empty_if_metadata_filtering_fails(self, mock_get_meta, mock_retrieve):
        """Test that retrieve returns empty response if metadata filtering returns condition but no document IDs"""
        # Arrange
        dataset = MagicMock(spec=Dataset)
        dataset.id = "dataset_id"
        query = "test query"
        account = MagicMock()

        retrieval_model = {
            "search_method": "semantic_search",
            "metadata_filtering_conditions": {"some": "condition"},
            "top_k": 5,
            "reranking_enable": False,
            "score_threshold_enabled": False,
        }

        # Mock metadata filtering response: condition returned but no IDs
        mock_get_meta.return_value = ({}, "condition_string")

        # Act
        result = cast(
            dict[str, Any],
            HitTestingService.retrieve(
                dataset=dataset,
                query=query,
                account=account,
                retrieval_model=retrieval_model,
                external_retrieval_model={},
            ),
        )

        # Assert
        assert result["records"] == []
        mock_retrieve.assert_not_called()

    @patch("core.rag.datasource.retrieval_service.RetrievalService.retrieve")
    @patch("extensions.ext_database.db.session.add")
    @patch("extensions.ext_database.db.session.commit")
    def test_retrieve_should_handle_attachments(self, mock_commit, mock_add, mock_retrieve):
        """Test that retrieve handles attachment_ids and adds them to DatasetQuery"""
        # Arrange
        dataset = MagicMock(spec=Dataset)
        dataset.id = "dataset_id"
        query = "test query"
        account = MagicMock()
        account.id = "account_id"
        attachment_ids = ["att1", "att2"]

        retrieval_model = {
            "search_method": "semantic_search",
            "top_k": 4,
            "reranking_enable": False,
            "score_threshold_enabled": False,
        }
        mock_retrieve.return_value = []

        # Act
        HitTestingService.retrieve(
            dataset=dataset,
            query=query,
            account=account,
            retrieval_model=retrieval_model,
            external_retrieval_model={},
            attachment_ids=attachment_ids,
        )

        # Assert
        mock_retrieve.assert_called_once_with(
            retrieval_method=ANY,
            dataset_id="dataset_id",
            query=query,
            attachment_ids=attachment_ids,
            top_k=4,
            score_threshold=0.0,
            reranking_model=None,
            reranking_mode="reranking_model",
            weights=None,
            document_ids_filter=None,
        )
        # Verify DatasetQuery record (there should be 2 queries: 1 text, 2 images)
        # The content is json.dumps([{"content_type": "text_query", ...}, {"content_type": "image_query", ...}])
        called_query = mock_add.call_args[0][0]
        query_content = json.loads(called_query.content)
        assert len(query_content) == 3  # 1 text + 2 images
        assert query_content[0]["content_type"] == "text_query"
        assert query_content[1]["content_type"] == "image_query"
        assert query_content[1]["content"] == "att1"

    @patch("core.rag.datasource.retrieval_service.RetrievalService.retrieve")
    @patch("extensions.ext_database.db.session.add")
    @patch("extensions.ext_database.db.session.commit")
    def test_retrieve_should_handle_reranking_and_threshold(self, mock_commit, mock_add, mock_retrieve):
        """Test that retrieve passes reranking and threshold parameters correctly"""
        # Arrange
        dataset = MagicMock(spec=Dataset)
        dataset.id = "dataset_id"
        query = "test query"
        account = MagicMock()
        account.id = "account_id"

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

        # Act
        HitTestingService.retrieve(
            dataset=dataset, query=query, account=account, retrieval_model=retrieval_model, external_retrieval_model={}
        )

        # Assert
        mock_retrieve.assert_called_once()
        kwargs = mock_retrieve.call_args.kwargs
        assert kwargs["score_threshold"] == 0.5
        assert kwargs["reranking_model"] == {"provider": "test"}
        assert kwargs["reranking_mode"] == "weighted_sum"
        assert kwargs["weights"] == {"vector": 0.5, "keyword": 0.5}
