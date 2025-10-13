#!/usr/bin/env python3
"""
Test suite for httpx migration in the Python SDK.

This test validates that the migration from requests to httpx maintains
backward compatibility and proper resource management.
"""

import unittest
from unittest.mock import Mock, patch

from dify_client import (
    DifyClient,
    ChatClient,
    CompletionClient,
    WorkflowClient,
    WorkspaceClient,
    KnowledgeBaseClient,
)


class TestHttpxMigrationMocked(unittest.TestCase):
    """Test cases for httpx migration with mocked requests."""

    def setUp(self):
        """Set up test fixtures."""
        self.api_key = "test-api-key"
        self.base_url = "https://api.dify.ai/v1"

    @patch("dify_client.client.httpx.Client")
    def test_client_initialization(self, mock_httpx_client):
        """Test that client initializes with httpx.Client."""
        mock_client_instance = Mock()
        mock_httpx_client.return_value = mock_client_instance

        client = DifyClient(self.api_key, self.base_url)

        # Verify httpx.Client was called with correct parameters
        mock_httpx_client.assert_called_once()
        call_kwargs = mock_httpx_client.call_args[1]
        self.assertEqual(call_kwargs["base_url"], self.base_url)

        # Verify client properties
        self.assertEqual(client.api_key, self.api_key)
        self.assertEqual(client.base_url, self.base_url)

        client.close()

    @patch("dify_client.client.httpx.Client")
    def test_context_manager_support(self, mock_httpx_client):
        """Test that client works as context manager."""
        mock_client_instance = Mock()
        mock_httpx_client.return_value = mock_client_instance

        with DifyClient(self.api_key, self.base_url) as client:
            self.assertEqual(client.api_key, self.api_key)

        # Verify close was called
        mock_client_instance.close.assert_called_once()

    @patch("dify_client.client.httpx.Client")
    def test_manual_close(self, mock_httpx_client):
        """Test manual close() method."""
        mock_client_instance = Mock()
        mock_httpx_client.return_value = mock_client_instance

        client = DifyClient(self.api_key, self.base_url)
        client.close()

        # Verify close was called
        mock_client_instance.close.assert_called_once()

    @patch("dify_client.client.httpx.Client")
    def test_send_request_httpx_compatibility(self, mock_httpx_client):
        """Test _send_request uses httpx.Client.request properly."""
        mock_response = Mock()
        mock_response.json.return_value = {"result": "success"}
        mock_response.status_code = 200

        mock_client_instance = Mock()
        mock_client_instance.request.return_value = mock_response
        mock_httpx_client.return_value = mock_client_instance

        client = DifyClient(self.api_key, self.base_url)
        response = client._send_request("GET", "/test-endpoint")

        # Verify httpx.Client.request was called correctly
        mock_client_instance.request.assert_called_once()
        call_args = mock_client_instance.request.call_args

        # Verify method and endpoint
        self.assertEqual(call_args[0][0], "GET")
        self.assertEqual(call_args[0][1], "/test-endpoint")

        # Verify headers contain authorization
        headers = call_args[1]["headers"]
        self.assertEqual(headers["Authorization"], f"Bearer {self.api_key}")
        self.assertEqual(headers["Content-Type"], "application/json")

        client.close()

    @patch("dify_client.client.httpx.Client")
    def test_response_compatibility(self, mock_httpx_client):
        """Test httpx.Response is compatible with requests.Response API."""
        mock_response = Mock()
        mock_response.json.return_value = {"key": "value"}
        mock_response.text = '{"key": "value"}'
        mock_response.content = b'{"key": "value"}'
        mock_response.status_code = 200
        mock_response.headers = {"Content-Type": "application/json"}

        mock_client_instance = Mock()
        mock_client_instance.request.return_value = mock_response
        mock_httpx_client.return_value = mock_client_instance

        client = DifyClient(self.api_key, self.base_url)
        response = client._send_request("GET", "/test")

        # Verify all common response methods work
        self.assertEqual(response.json(), {"key": "value"})
        self.assertEqual(response.text, '{"key": "value"}')
        self.assertEqual(response.content, b'{"key": "value"}')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Content-Type"], "application/json")

        client.close()

    @patch("dify_client.client.httpx.Client")
    def test_all_client_classes_use_httpx(self, mock_httpx_client):
        """Test that all client classes properly use httpx."""
        mock_client_instance = Mock()
        mock_httpx_client.return_value = mock_client_instance

        clients = [
            DifyClient(self.api_key, self.base_url),
            ChatClient(self.api_key, self.base_url),
            CompletionClient(self.api_key, self.base_url),
            WorkflowClient(self.api_key, self.base_url),
            WorkspaceClient(self.api_key, self.base_url),
            KnowledgeBaseClient(self.api_key, self.base_url),
        ]

        # Verify httpx.Client was called for each client
        self.assertEqual(mock_httpx_client.call_count, 6)

        # Clean up
        for client in clients:
            client.close()

    @patch("dify_client.client.httpx.Client")
    def test_json_parameter_handling(self, mock_httpx_client):
        """Test that json parameter is passed correctly."""
        mock_response = Mock()
        mock_response.json.return_value = {"result": "success"}

        mock_client_instance = Mock()
        mock_client_instance.request.return_value = mock_response
        mock_httpx_client.return_value = mock_client_instance

        client = DifyClient(self.api_key, self.base_url)
        test_data = {"key": "value", "number": 123}

        client._send_request("POST", "/test", json=test_data)

        # Verify json parameter was passed
        call_args = mock_client_instance.request.call_args
        self.assertEqual(call_args[1]["json"], test_data)

        client.close()

    @patch("dify_client.client.httpx.Client")
    def test_params_parameter_handling(self, mock_httpx_client):
        """Test that params parameter is passed correctly."""
        mock_response = Mock()
        mock_response.json.return_value = {"result": "success"}

        mock_client_instance = Mock()
        mock_client_instance.request.return_value = mock_response
        mock_httpx_client.return_value = mock_client_instance

        client = DifyClient(self.api_key, self.base_url)
        test_params = {"page": 1, "limit": 20}

        client._send_request("GET", "/test", params=test_params)

        # Verify params parameter was passed
        call_args = mock_client_instance.request.call_args
        self.assertEqual(call_args[1]["params"], test_params)

        client.close()

    @patch("dify_client.client.httpx.Client")
    def test_inheritance_chain(self, mock_httpx_client):
        """Test that inheritance chain is maintained."""
        mock_client_instance = Mock()
        mock_httpx_client.return_value = mock_client_instance

        # ChatClient inherits from DifyClient
        chat_client = ChatClient(self.api_key, self.base_url)
        self.assertIsInstance(chat_client, DifyClient)

        # CompletionClient inherits from DifyClient
        completion_client = CompletionClient(self.api_key, self.base_url)
        self.assertIsInstance(completion_client, DifyClient)

        # WorkflowClient inherits from DifyClient
        workflow_client = WorkflowClient(self.api_key, self.base_url)
        self.assertIsInstance(workflow_client, DifyClient)

        # Clean up
        chat_client.close()
        completion_client.close()
        workflow_client.close()

    @patch("dify_client.client.httpx.Client")
    def test_nested_context_managers(self, mock_httpx_client):
        """Test nested context managers work correctly."""
        mock_client_instance = Mock()
        mock_httpx_client.return_value = mock_client_instance

        with DifyClient(self.api_key, self.base_url) as client1:
            with ChatClient(self.api_key, self.base_url) as client2:
                self.assertEqual(client1.api_key, self.api_key)
                self.assertEqual(client2.api_key, self.api_key)

        # Both close methods should have been called
        self.assertEqual(mock_client_instance.close.call_count, 2)


class TestChatClientHttpx(unittest.TestCase):
    """Test ChatClient specific httpx integration."""

    @patch("dify_client.client.httpx.Client")
    def test_create_chat_message_httpx(self, mock_httpx_client):
        """Test create_chat_message works with httpx."""
        mock_response = Mock()
        mock_response.text = '{"answer": "Hello!"}'
        mock_response.json.return_value = {"answer": "Hello!"}
        mock_response.status_code = 200

        mock_client_instance = Mock()
        mock_client_instance.request.return_value = mock_response
        mock_httpx_client.return_value = mock_client_instance

        with ChatClient("test-key") as client:
            response = client.create_chat_message({}, "Hi", "user123")
            self.assertIn("answer", response.text)
            self.assertEqual(response.json()["answer"], "Hello!")


class TestCompletionClientHttpx(unittest.TestCase):
    """Test CompletionClient specific httpx integration."""

    @patch("dify_client.client.httpx.Client")
    def test_create_completion_message_httpx(self, mock_httpx_client):
        """Test create_completion_message works with httpx."""
        mock_response = Mock()
        mock_response.text = '{"answer": "Response"}'
        mock_response.json.return_value = {"answer": "Response"}
        mock_response.status_code = 200

        mock_client_instance = Mock()
        mock_client_instance.request.return_value = mock_response
        mock_httpx_client.return_value = mock_client_instance

        with CompletionClient("test-key") as client:
            response = client.create_completion_message({"query": "test"}, "blocking", "user123")
            self.assertIn("answer", response.text)


class TestKnowledgeBaseClientHttpx(unittest.TestCase):
    """Test KnowledgeBaseClient specific httpx integration."""

    @patch("dify_client.client.httpx.Client")
    def test_list_datasets_httpx(self, mock_httpx_client):
        """Test list_datasets works with httpx."""
        mock_response = Mock()
        mock_response.json.return_value = {"data": [], "total": 0}
        mock_response.status_code = 200

        mock_client_instance = Mock()
        mock_client_instance.request.return_value = mock_response
        mock_httpx_client.return_value = mock_client_instance

        with KnowledgeBaseClient("test-key") as client:
            response = client.list_datasets()
            data = response.json()
            self.assertIn("data", data)
            self.assertIn("total", data)


class TestWorkflowClientHttpx(unittest.TestCase):
    """Test WorkflowClient specific httpx integration."""

    @patch("dify_client.client.httpx.Client")
    def test_run_workflow_httpx(self, mock_httpx_client):
        """Test run workflow works with httpx."""
        mock_response = Mock()
        mock_response.json.return_value = {"result": "success"}
        mock_response.status_code = 200

        mock_client_instance = Mock()
        mock_client_instance.request.return_value = mock_response
        mock_httpx_client.return_value = mock_client_instance

        with WorkflowClient("test-key") as client:
            response = client.run({"input": "test"}, "blocking", "user123")
            self.assertEqual(response.json()["result"], "success")


class TestWorkspaceClientHttpx(unittest.TestCase):
    """Test WorkspaceClient specific httpx integration."""

    @patch("dify_client.client.httpx.Client")
    def test_get_available_models_httpx(self, mock_httpx_client):
        """Test get_available_models works with httpx."""
        mock_response = Mock()
        mock_response.json.return_value = {"data": []}
        mock_response.status_code = 200

        mock_client_instance = Mock()
        mock_client_instance.request.return_value = mock_response
        mock_httpx_client.return_value = mock_client_instance

        with WorkspaceClient("test-key") as client:
            response = client.get_available_models("llm")
            self.assertIn("data", response.json())


if __name__ == "__main__":
    unittest.main()
