#!/usr/bin/env python3
"""
Test suite for the new Service API functionality in the Python SDK.

This test validates the implementation of the missing Service API endpoints
that were added to the Python SDK to achieve complete coverage.
"""

import unittest
from unittest.mock import Mock, patch, MagicMock

from dify_client import (
    DifyClient,
    ChatClient,
    WorkflowClient,
    KnowledgeBaseClient,
    WorkspaceClient,
)


class TestNewServiceAPIs(unittest.TestCase):
    """Test cases for new Service API implementations."""

    def setUp(self):
        """Set up test fixtures."""
        self.api_key = "test-api-key"
        self.base_url = "https://api.dify.ai/v1"

    @patch("dify_client.client.requests.request")
    def test_app_info_apis(self, mock_request):
        """Test application info APIs."""
        mock_response = Mock()
        mock_response.json.return_value = {
            "name": "Test App",
            "description": "Test Description",
            "tags": ["test", "api"],
            "mode": "chat",
            "author_name": "Test Author",
        }
        mock_request.return_value = mock_response

        client = DifyClient(self.api_key, self.base_url)

        # Test get_app_info
        result = client.get_app_info()
        mock_request.assert_called_with(
            "GET",
            f"{self.base_url}/info",
            json=None,
            params=None,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            stream=False,
        )

        # Test get_app_site_info
        client.get_app_site_info()
        mock_request.assert_called_with(
            "GET",
            f"{self.base_url}/site",
            json=None,
            params=None,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            stream=False,
        )

        # Test get_file_preview
        file_id = "test-file-id"
        client.get_file_preview(file_id)
        mock_request.assert_called_with(
            "GET",
            f"{self.base_url}/files/{file_id}/preview",
            json=None,
            params=None,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            stream=False,
        )

    @patch("dify_client.client.requests.request")
    def test_annotation_apis(self, mock_request):
        """Test annotation APIs."""
        mock_response = Mock()
        mock_response.json.return_value = {"result": "success"}
        mock_request.return_value = mock_response

        client = ChatClient(self.api_key, self.base_url)

        # Test annotation_reply_action - enable
        client.annotation_reply_action(
            action="enable",
            score_threshold=0.8,
            embedding_provider_name="openai",
            embedding_model_name="text-embedding-ada-002",
        )
        mock_request.assert_called_with(
            "POST",
            f"{self.base_url}/apps/annotation-reply/enable",
            json={
                "score_threshold": 0.8,
                "embedding_provider_name": "openai",
                "embedding_model_name": "text-embedding-ada-002",
            },
            params=None,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            stream=False,
        )

        # Test annotation_reply_action - disable (now requires same fields as enable)
        client.annotation_reply_action(
            action="disable",
            score_threshold=0.5,
            embedding_provider_name="openai",
            embedding_model_name="text-embedding-ada-002",
        )

        # Test annotation_reply_action with score_threshold=0 (edge case)
        client.annotation_reply_action(
            action="enable",
            score_threshold=0.0,  # This should work and not raise ValueError
            embedding_provider_name="openai",
            embedding_model_name="text-embedding-ada-002",
        )

        # Test get_annotation_reply_status
        client.get_annotation_reply_status("enable", "job-123")

        # Test list_annotations
        client.list_annotations(page=1, limit=20, keyword="test")

        # Test create_annotation
        client.create_annotation("Test question?", "Test answer.")

        # Test update_annotation
        client.update_annotation("annotation-123", "Updated question?", "Updated answer.")

        # Test delete_annotation
        client.delete_annotation("annotation-123")

        # Verify all calls were made (8 calls: enable + disable + enable with 0.0 + 5 other operations)
        self.assertEqual(mock_request.call_count, 8)

    @patch("dify_client.client.requests.request")
    def test_knowledge_base_advanced_apis(self, mock_request):
        """Test advanced knowledge base APIs."""
        mock_response = Mock()
        mock_response.json.return_value = {"result": "success"}
        mock_request.return_value = mock_response

        dataset_id = "test-dataset-id"
        client = KnowledgeBaseClient(self.api_key, self.base_url, dataset_id)

        # Test hit_testing
        client.hit_testing("test query", {"type": "vector"})
        mock_request.assert_called_with(
            "POST",
            f"{self.base_url}/datasets/{dataset_id}/hit-testing",
            json={"query": "test query", "retrieval_model": {"type": "vector"}},
            params=None,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            stream=False,
        )

        # Test metadata operations
        client.get_dataset_metadata()
        client.create_dataset_metadata({"key": "value"})
        client.update_dataset_metadata("meta-123", {"key": "new_value"})
        client.get_built_in_metadata()
        client.manage_built_in_metadata("enable", {"type": "built_in"})
        client.update_documents_metadata([{"document_id": "doc1", "metadata": {"key": "value"}}])

        # Test tag operations
        client.list_dataset_tags()
        client.bind_dataset_tags(["tag1", "tag2"])
        client.unbind_dataset_tag("tag1")
        client.get_dataset_tags()

        # Verify multiple calls were made
        self.assertGreater(mock_request.call_count, 5)

    @patch("dify_client.client.requests.request")
    def test_rag_pipeline_apis(self, mock_request):
        """Test RAG pipeline APIs."""
        mock_response = Mock()
        mock_response.json.return_value = {"result": "success"}
        mock_request.return_value = mock_response

        dataset_id = "test-dataset-id"
        client = KnowledgeBaseClient(self.api_key, self.base_url, dataset_id)

        # Test get_datasource_plugins
        client.get_datasource_plugins(is_published=True)
        mock_request.assert_called_with(
            "GET",
            f"{self.base_url}/datasets/{dataset_id}/pipeline/datasource-plugins",
            json=None,
            params={"is_published": True},
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            stream=False,
        )

        # Test run_datasource_node
        client.run_datasource_node(
            node_id="node-123",
            inputs={"param": "value"},
            datasource_type="online_document",
            is_published=True,
            credential_id="cred-123",
        )

        # Test run_rag_pipeline with blocking mode
        client.run_rag_pipeline(
            inputs={"query": "test"},
            datasource_type="online_document",
            datasource_info_list=[{"id": "ds1"}],
            start_node_id="start-node",
            is_published=True,
            response_mode="blocking",
        )

        # Test run_rag_pipeline with streaming mode
        client.run_rag_pipeline(
            inputs={"query": "test"},
            datasource_type="online_document",
            datasource_info_list=[{"id": "ds1"}],
            start_node_id="start-node",
            is_published=True,
            response_mode="streaming",
        )

        self.assertEqual(mock_request.call_count, 4)

    @patch("dify_client.client.requests.request")
    def test_workspace_apis(self, mock_request):
        """Test workspace APIs."""
        mock_response = Mock()
        mock_response.json.return_value = {
            "data": [
                {"name": "gpt-3.5-turbo", "type": "llm"},
                {"name": "gpt-4", "type": "llm"},
            ]
        }
        mock_request.return_value = mock_response

        client = WorkspaceClient(self.api_key, self.base_url)

        # Test get_available_models
        result = client.get_available_models("llm")
        mock_request.assert_called_with(
            "GET",
            f"{self.base_url}/workspaces/current/models/model-types/llm",
            json=None,
            params=None,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            stream=False,
        )

    @patch("dify_client.client.requests.request")
    def test_workflow_advanced_apis(self, mock_request):
        """Test advanced workflow APIs."""
        mock_response = Mock()
        mock_response.json.return_value = {"result": "success"}
        mock_request.return_value = mock_response

        client = WorkflowClient(self.api_key, self.base_url)

        # Test get_workflow_logs
        client.get_workflow_logs(keyword="test", status="succeeded", page=1, limit=20)
        mock_request.assert_called_with(
            "GET",
            f"{self.base_url}/workflows/logs",
            json=None,
            params={"page": 1, "limit": 20, "keyword": "test", "status": "succeeded"},
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            stream=False,
        )

        # Test get_workflow_logs with additional filters
        client.get_workflow_logs(
            keyword="test",
            status="succeeded",
            page=1,
            limit=20,
            created_at__before="2024-01-01",
            created_at__after="2023-01-01",
            created_by_account="user123",
        )

        # Test run_specific_workflow
        client.run_specific_workflow(
            workflow_id="workflow-123",
            inputs={"param": "value"},
            response_mode="streaming",
            user="user-123",
        )

        self.assertEqual(mock_request.call_count, 3)

    def test_error_handling(self):
        """Test error handling for required parameters."""
        client = ChatClient(self.api_key, self.base_url)

        # Test annotation_reply_action with missing required parameters would be a TypeError now
        # since parameters are required in method signature
        with self.assertRaises(TypeError):
            client.annotation_reply_action("enable")

        # Test annotation_reply_action with explicit None values should raise ValueError
        with self.assertRaises(ValueError) as context:
            client.annotation_reply_action("enable", None, "provider", "model")

        self.assertIn("cannot be None", str(context.exception))

        # Test KnowledgeBaseClient without dataset_id
        kb_client = KnowledgeBaseClient(self.api_key, self.base_url)
        with self.assertRaises(ValueError) as context:
            kb_client.hit_testing("test query")

        self.assertIn("dataset_id is not set", str(context.exception))

    @patch("dify_client.client.open")
    @patch("dify_client.client.requests.request")
    def test_file_upload_apis(self, mock_request, mock_open):
        """Test file upload APIs."""
        mock_response = Mock()
        mock_response.json.return_value = {"result": "success"}
        mock_request.return_value = mock_response

        mock_file = MagicMock()
        mock_open.return_value.__enter__.return_value = mock_file

        dataset_id = "test-dataset-id"
        client = KnowledgeBaseClient(self.api_key, self.base_url, dataset_id)

        # Test upload_pipeline_file
        client.upload_pipeline_file("/path/to/test.pdf")

        mock_open.assert_called_with("/path/to/test.pdf", "rb")
        mock_request.assert_called_once()

    def test_comprehensive_coverage(self):
        """Test that all previously missing APIs are now implemented."""

        # Test DifyClient methods
        dify_methods = ["get_app_info", "get_app_site_info", "get_file_preview"]
        client = DifyClient(self.api_key)
        for method in dify_methods:
            self.assertTrue(hasattr(client, method), f"DifyClient missing method: {method}")

        # Test ChatClient annotation methods
        chat_methods = [
            "annotation_reply_action",
            "get_annotation_reply_status",
            "list_annotations",
            "create_annotation",
            "update_annotation",
            "delete_annotation",
        ]
        chat_client = ChatClient(self.api_key)
        for method in chat_methods:
            self.assertTrue(hasattr(chat_client, method), f"ChatClient missing method: {method}")

        # Test WorkflowClient advanced methods
        workflow_methods = ["get_workflow_logs", "run_specific_workflow"]
        workflow_client = WorkflowClient(self.api_key)
        for method in workflow_methods:
            self.assertTrue(
                hasattr(workflow_client, method),
                f"WorkflowClient missing method: {method}",
            )

        # Test KnowledgeBaseClient advanced methods
        kb_methods = [
            "hit_testing",
            "get_dataset_metadata",
            "create_dataset_metadata",
            "update_dataset_metadata",
            "get_built_in_metadata",
            "manage_built_in_metadata",
            "update_documents_metadata",
            "list_dataset_tags",
            "bind_dataset_tags",
            "unbind_dataset_tag",
            "get_dataset_tags",
            "get_datasource_plugins",
            "run_datasource_node",
            "run_rag_pipeline",
            "upload_pipeline_file",
        ]
        kb_client = KnowledgeBaseClient(self.api_key)
        for method in kb_methods:
            self.assertTrue(
                hasattr(kb_client, method),
                f"KnowledgeBaseClient missing method: {method}",
            )

        # Test WorkspaceClient methods
        workspace_methods = ["get_available_models"]
        workspace_client = WorkspaceClient(self.api_key)
        for method in workspace_methods:
            self.assertTrue(
                hasattr(workspace_client, method),
                f"WorkspaceClient missing method: {method}",
            )

    @patch("dify_client.client.requests.request")
    def test_missing_core_apis_dataset(self, mock_request):
        """Test missing core dataset APIs - get_dataset and update_dataset."""
        mock_response = Mock()
        mock_response.json.return_value = {"result": "success"}
        mock_request.return_value = mock_response

        dataset_id = "test-dataset-id"
        client = KnowledgeBaseClient(self.api_key, self.base_url, dataset_id)

        # Test get_dataset
        client.get_dataset()
        mock_request.assert_called_with(
            "GET",
            f"{self.base_url}/datasets/{dataset_id}",
            json=None,
            params=None,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            stream=False,
        )

        # Test get_dataset with explicit dataset_id
        other_dataset_id = "other-dataset-id"
        client.get_dataset(other_dataset_id)
        mock_request.assert_called_with(
            "GET",
            f"{self.base_url}/datasets/{other_dataset_id}",
            json=None,
            params=None,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            stream=False,
        )

        # Test update_dataset with all parameters
        client.update_dataset(
            name="Updated Dataset",
            description="New description",
            indexing_technique="high_quality",
            embedding_model="text-embedding-ada-002",
            embedding_model_provider="openai",
            retrieval_model={
                "search_method": "semantic_search",
                "reranking_enable": True,
            },
        )
        expected_data = {
            "name": "Updated Dataset",
            "description": "New description",
            "indexing_technique": "high_quality",
            "embedding_model": "text-embedding-ada-002",
            "embedding_model_provider": "openai",
            "retrieval_model": {
                "search_method": "semantic_search",
                "reranking_enable": True,
            },
        }
        mock_request.assert_called_with(
            "PATCH",
            f"{self.base_url}/datasets/{dataset_id}",
            json=expected_data,
            params=None,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            stream=False,
        )

        # Test update_dataset with partial parameters
        client.update_dataset(name="Just Name Change")
        mock_request.assert_called_with(
            "PATCH",
            f"{self.base_url}/datasets/{dataset_id}",
            json={"name": "Just Name Change"},
            params=None,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            stream=False,
        )

    @patch("dify_client.client.requests.request")
    def test_missing_core_apis_conversation_variables(self, mock_request):
        """Test missing core conversation variable APIs."""
        mock_response = Mock()
        mock_response.json.return_value = {"result": "success"}
        mock_request.return_value = mock_response

        client = ChatClient(self.api_key, self.base_url)
        conversation_id = "test-conversation-id"
        variable_id = "test-variable-id"
        user = "test-user"

        # Test get_conversation_variables
        client.get_conversation_variables(conversation_id, user)
        mock_request.assert_called_with(
            "GET",
            f"{self.base_url}/conversations/{conversation_id}/variables",
            json=None,
            params={"user": user},
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            stream=False,
        )

        # Test update_conversation_variable with string value
        client.update_conversation_variable(conversation_id, variable_id, "new_value", user)
        mock_request.assert_called_with(
            "PATCH",
            f"{self.base_url}/conversations/{conversation_id}/variables/{variable_id}",
            json={"value": "new_value", "user": user},
            params=None,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            stream=False,
        )

        # Test update_conversation_variable with dict value
        client.update_conversation_variable(conversation_id, variable_id, {"key": "value"}, user)
        mock_request.assert_called_with(
            "PATCH",
            f"{self.base_url}/conversations/{conversation_id}/variables/{variable_id}",
            json={"value": {"key": "value"}, "user": user},
            params=None,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            stream=False,
        )

        # Test update_conversation_variable with list value
        client.update_conversation_variable(conversation_id, variable_id, ["item1", "item2"], user)
        mock_request.assert_called_with(
            "PATCH",
            f"{self.base_url}/conversations/{conversation_id}/variables/{variable_id}",
            json={"value": ["item1", "item2"], "user": user},
            params=None,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            stream=False,
        )

    @patch("dify_client.client.requests.request")
    def test_missing_core_apis_document_batch_status(self, mock_request):
        """Test missing core document batch status update API."""
        mock_response = Mock()
        mock_response.json.return_value = {"result": "success"}
        mock_request.return_value = mock_response

        dataset_id = "test-dataset-id"
        client = KnowledgeBaseClient(self.api_key, self.base_url, dataset_id)
        document_ids = ["doc-1", "doc-2", "doc-3"]

        # Test enable action
        client.batch_update_document_status("enable", document_ids)
        mock_request.assert_called_with(
            "PATCH",
            f"{self.base_url}/datasets/{dataset_id}/documents/status/enable",
            json={"document_ids": document_ids},
            params=None,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            stream=False,
        )

        # Test disable action
        client.batch_update_document_status("disable", document_ids)
        mock_request.assert_called_with(
            "PATCH",
            f"{self.base_url}/datasets/{dataset_id}/documents/status/disable",
            json={"document_ids": document_ids},
            params=None,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            stream=False,
        )

        # Test archive action
        client.batch_update_document_status("archive", document_ids)
        mock_request.assert_called_with(
            "PATCH",
            f"{self.base_url}/datasets/{dataset_id}/documents/status/archive",
            json={"document_ids": document_ids},
            params=None,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            stream=False,
        )

        # Test un_archive action
        client.batch_update_document_status("un_archive", document_ids)
        mock_request.assert_called_with(
            "PATCH",
            f"{self.base_url}/datasets/{dataset_id}/documents/status/un_archive",
            json={"document_ids": document_ids},
            params=None,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            stream=False,
        )

        # Test with explicit dataset_id
        other_dataset_id = "other-dataset-id"
        client.batch_update_document_status("enable", document_ids, dataset_id=other_dataset_id)
        mock_request.assert_called_with(
            "PATCH",
            f"{self.base_url}/datasets/{other_dataset_id}/documents/status/enable",
            json={"document_ids": document_ids},
            params=None,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            stream=False,
        )

    def test_comprehensive_coverage_extended(self):
        """Test that all newly added missing core APIs are implemented."""

        # Test ChatClient conversation variable methods
        chat_methods = ["get_conversation_variables", "update_conversation_variable"]
        chat_client = ChatClient(self.api_key)
        for method in chat_methods:
            self.assertTrue(hasattr(chat_client, method), f"ChatClient missing method: {method}")

        # Test KnowledgeBaseClient dataset management methods
        kb_methods = ["get_dataset", "update_dataset", "batch_update_document_status"]
        kb_client = KnowledgeBaseClient(self.api_key)
        for method in kb_methods:
            self.assertTrue(
                hasattr(kb_client, method),
                f"KnowledgeBaseClient missing method: {method}",
            )


if __name__ == "__main__":
    unittest.main()
