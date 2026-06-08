from typing import Any, cast
from unittest.mock import MagicMock, patch

import pytest

from services.knowledge_service import BedrockRetrievalSetting, ExternalDatasetTestService


class TestKnowledgeService:
    """Test suite for ExternalDatasetTestService"""

    # ===== Happy Path Tests =====

    @patch("services.knowledge_service.boto3.client")
    @patch("services.knowledge_service.dify_config")
    def test_knowledge_retrieval_should_succeed_with_valid_results(
        self, mock_dify_config: MagicMock, mock_boto_client: MagicMock
    ):
        """Test that knowledge_retrieval successfully parses results from Bedrock"""
        # Arrange
        mock_dify_config.AWS_SECRET_ACCESS_KEY = "dummy_secret"
        mock_dify_config.AWS_ACCESS_KEY_ID = "dummy_id"

        mock_client = MagicMock()
        mock_boto_client.return_value = mock_client

        retrieval_setting = BedrockRetrievalSetting(top_k=4, score_threshold=0.5)
        query = "test query"
        knowledge_id = "kb-123"

        # Mock successful response
        mock_client.retrieve.return_value = {
            "ResponseMetadata": {"HTTPStatusCode": 200},
            "retrievalResults": [
                {
                    "score": 0.9,
                    "metadata": {"x-amz-bedrock-kb-source-uri": "s3://bucket/doc1.pdf"},
                    "content": {"text": "content from doc1"},
                },
                {
                    "score": 0.4,  # Below threshold
                    "metadata": {"x-amz-bedrock-kb-source-uri": "s3://bucket/doc2.pdf"},
                    "content": {"text": "content from doc2"},
                },
            ],
        }

        # Act
        result = cast(
            dict[str, Any], ExternalDatasetTestService.knowledge_retrieval(retrieval_setting, query, knowledge_id)
        )

        # Assert
        assert len(result["records"]) == 1
        record = result["records"][0]
        assert record["score"] == 0.9
        assert record["title"] == "s3://bucket/doc1.pdf"
        assert record["content"] == "content from doc1"

        # verify retrieve called correctly
        mock_client.retrieve.assert_called_once_with(
            knowledgeBaseId=knowledge_id,
            retrievalConfiguration={
                "vectorSearchConfiguration": {
                    "numberOfResults": 4,
                    "overrideSearchType": "HYBRID",
                }
            },
            retrievalQuery={"text": query},
        )

        # NEW: verify boto3.client created with proper service name and config values
        mock_boto_client.assert_called_once_with(
            "bedrock-agent-runtime",
            aws_secret_access_key="dummy_secret",
            aws_access_key_id="dummy_id",
            region_name="us-east-1",
        )

    @patch("services.knowledge_service.boto3.client")
    def test_knowledge_retrieval_should_return_empty_when_no_results(self, mock_boto: MagicMock):
        """Test that knowledge_retrieval returns empty records when Bedrock returns nothing"""
        # Arrange
        mock_client = MagicMock()
        mock_boto.return_value = mock_client

        mock_client.retrieve.return_value = {"ResponseMetadata": {"HTTPStatusCode": 200}, "retrievalResults": []}

        # Act
        result = cast(
            dict[str, Any],
            ExternalDatasetTestService.knowledge_retrieval(BedrockRetrievalSetting(top_k=1), "query", "kb"),
        )

        # Assert
        assert result["records"] == []

    # ===== Error Handling Tests =====

    @patch("services.knowledge_service.boto3.client")
    def test_knowledge_retrieval_should_return_empty_on_http_error(self, mock_boto: MagicMock):
        """Test that knowledge_retrieval returns empty records if Bedrock returns non-200 status"""
        # Arrange
        mock_client = MagicMock()
        mock_boto.return_value = mock_client

        mock_client.retrieve.return_value = {"ResponseMetadata": {"HTTPStatusCode": 500}}

        # Act
        result = cast(
            dict[str, Any],
            ExternalDatasetTestService.knowledge_retrieval(BedrockRetrievalSetting(top_k=1), "query", "kb"),
        )

        # Assert
        assert result["records"] == []

    def test_knowledge_retrieval_should_raise_when_boto_client_creation_fails(self):
        """Test that exceptions from boto3.client propagate (e.g., network/credentials issues)"""
        with patch("services.knowledge_service.boto3.client") as mock_boto:
            mock_boto.side_effect = Exception("client init failed")
            with pytest.raises(Exception) as exc_info:
                ExternalDatasetTestService.knowledge_retrieval(BedrockRetrievalSetting(top_k=1), "query", "kb")
            assert "client init failed" in str(exc_info.value)

    # ===== Edge Cases =====

    @patch("services.knowledge_service.boto3.client")
    def test_knowledge_retrieval_should_handle_missing_threshold_in_settings(self, mock_boto: MagicMock):
        """Test that knowledge_retrieval uses 0.0 as default threshold if not provided"""
        # Arrange
        mock_client = MagicMock()
        mock_boto.return_value = mock_client

        mock_client.retrieve.return_value = {
            "ResponseMetadata": {"HTTPStatusCode": 200},
            "retrievalResults": [
                {
                    "score": 0.1,
                    "metadata": {"x-amz-bedrock-kb-source-uri": "uri"},
                    "content": {"text": "text"},
                }
            ],
        }

        # Act
        # retrieval_setting missing "score_threshold"
        result = cast(
            dict[str, Any],
            ExternalDatasetTestService.knowledge_retrieval(BedrockRetrievalSetting(top_k=1), "query", "kb"),
        )

        # Assert
        assert len(result["records"]) == 1
        assert result["records"][0]["score"] == 0.1
