#!/usr/bin/env python3
"""
Test suite for async client implementation in the Python SDK.

This test validates the async/await functionality using httpx.AsyncClient
and ensures API parity with sync clients.
"""

import unittest
from unittest.mock import Mock, patch, AsyncMock

from dify_client.async_client import (
    AsyncDifyClient,
    AsyncChatClient,
    AsyncCompletionClient,
    AsyncWorkflowClient,
    AsyncWorkspaceClient,
    AsyncKnowledgeBaseClient,
)


class TestAsyncAPIParity(unittest.TestCase):
    """Test that async clients have API parity with sync clients."""

    def test_dify_client_api_parity(self):
        """Test AsyncDifyClient has same methods as DifyClient."""
        from dify_client import DifyClient

        sync_methods = {name for name in dir(DifyClient) if not name.startswith("_")}
        async_methods = {name for name in dir(AsyncDifyClient) if not name.startswith("_")}

        # aclose is async-specific, close is sync-specific
        sync_methods.discard("close")
        async_methods.discard("aclose")

        # Verify parity
        self.assertEqual(sync_methods, async_methods, "API parity mismatch for DifyClient")

    def test_chat_client_api_parity(self):
        """Test AsyncChatClient has same methods as ChatClient."""
        from dify_client import ChatClient

        sync_methods = {name for name in dir(ChatClient) if not name.startswith("_")}
        async_methods = {name for name in dir(AsyncChatClient) if not name.startswith("_")}

        sync_methods.discard("close")
        async_methods.discard("aclose")

        self.assertEqual(sync_methods, async_methods, "API parity mismatch for ChatClient")

    def test_completion_client_api_parity(self):
        """Test AsyncCompletionClient has same methods as CompletionClient."""
        from dify_client import CompletionClient

        sync_methods = {name for name in dir(CompletionClient) if not name.startswith("_")}
        async_methods = {name for name in dir(AsyncCompletionClient) if not name.startswith("_")}

        sync_methods.discard("close")
        async_methods.discard("aclose")

        self.assertEqual(sync_methods, async_methods, "API parity mismatch for CompletionClient")

    def test_workflow_client_api_parity(self):
        """Test AsyncWorkflowClient has same methods as WorkflowClient."""
        from dify_client import WorkflowClient

        sync_methods = {name for name in dir(WorkflowClient) if not name.startswith("_")}
        async_methods = {name for name in dir(AsyncWorkflowClient) if not name.startswith("_")}

        sync_methods.discard("close")
        async_methods.discard("aclose")

        self.assertEqual(sync_methods, async_methods, "API parity mismatch for WorkflowClient")

    def test_workspace_client_api_parity(self):
        """Test AsyncWorkspaceClient has same methods as WorkspaceClient."""
        from dify_client import WorkspaceClient

        sync_methods = {name for name in dir(WorkspaceClient) if not name.startswith("_")}
        async_methods = {name for name in dir(AsyncWorkspaceClient) if not name.startswith("_")}

        sync_methods.discard("close")
        async_methods.discard("aclose")

        self.assertEqual(sync_methods, async_methods, "API parity mismatch for WorkspaceClient")

    def test_knowledge_base_client_api_parity(self):
        """Test AsyncKnowledgeBaseClient has same methods as KnowledgeBaseClient."""
        from dify_client import KnowledgeBaseClient

        sync_methods = {name for name in dir(KnowledgeBaseClient) if not name.startswith("_")}
        async_methods = {name for name in dir(AsyncKnowledgeBaseClient) if not name.startswith("_")}

        sync_methods.discard("close")
        async_methods.discard("aclose")

        self.assertEqual(sync_methods, async_methods, "API parity mismatch for KnowledgeBaseClient")


class TestAsyncClientMocked(unittest.IsolatedAsyncioTestCase):
    """Test async client with mocked httpx.AsyncClient."""

    @patch("dify_client.async_client.httpx.AsyncClient")
    async def test_async_client_initialization(self, mock_httpx_async_client):
        """Test async client initializes with httpx.AsyncClient."""
        mock_client_instance = AsyncMock()
        mock_httpx_async_client.return_value = mock_client_instance

        client = AsyncDifyClient("test-key", "https://api.dify.ai/v1")

        # Verify httpx.AsyncClient was called
        mock_httpx_async_client.assert_called_once()
        self.assertEqual(client.api_key, "test-key")

        await client.aclose()

    @patch("dify_client.async_client.httpx.AsyncClient")
    async def test_async_context_manager(self, mock_httpx_async_client):
        """Test async context manager works."""
        mock_client_instance = AsyncMock()
        mock_httpx_async_client.return_value = mock_client_instance

        async with AsyncDifyClient("test-key") as client:
            self.assertEqual(client.api_key, "test-key")

        # Verify aclose was called
        mock_client_instance.aclose.assert_called_once()

    @patch("dify_client.async_client.httpx.AsyncClient")
    async def test_async_send_request(self, mock_httpx_async_client):
        """Test async _send_request method."""
        mock_response = AsyncMock()
        mock_response.json = AsyncMock(return_value={"result": "success"})
        mock_response.status_code = 200

        mock_client_instance = AsyncMock()
        mock_client_instance.request = AsyncMock(return_value=mock_response)
        mock_httpx_async_client.return_value = mock_client_instance

        async with AsyncDifyClient("test-key") as client:
            response = await client._send_request("GET", "/test")

            # Verify request was called
            mock_client_instance.request.assert_called_once()
            call_args = mock_client_instance.request.call_args

            # Verify parameters
            self.assertEqual(call_args[0][0], "GET")
            self.assertEqual(call_args[0][1], "/test")

    @patch("dify_client.async_client.httpx.AsyncClient")
    async def test_async_chat_client(self, mock_httpx_async_client):
        """Test AsyncChatClient functionality."""
        mock_response = AsyncMock()
        mock_response.text = '{"answer": "Hello!"}'
        mock_response.json = AsyncMock(return_value={"answer": "Hello!"})

        mock_client_instance = AsyncMock()
        mock_client_instance.request = AsyncMock(return_value=mock_response)
        mock_httpx_async_client.return_value = mock_client_instance

        async with AsyncChatClient("test-key") as client:
            response = await client.create_chat_message({}, "Hi", "user123")
            self.assertIn("answer", response.text)

    @patch("dify_client.async_client.httpx.AsyncClient")
    async def test_async_completion_client(self, mock_httpx_async_client):
        """Test AsyncCompletionClient functionality."""
        mock_response = AsyncMock()
        mock_response.text = '{"answer": "Response"}'
        mock_response.json = AsyncMock(return_value={"answer": "Response"})

        mock_client_instance = AsyncMock()
        mock_client_instance.request = AsyncMock(return_value=mock_response)
        mock_httpx_async_client.return_value = mock_client_instance

        async with AsyncCompletionClient("test-key") as client:
            response = await client.create_completion_message({"query": "test"}, "blocking", "user123")
            self.assertIn("answer", response.text)

    @patch("dify_client.async_client.httpx.AsyncClient")
    async def test_async_workflow_client(self, mock_httpx_async_client):
        """Test AsyncWorkflowClient functionality."""
        mock_response = AsyncMock()
        mock_response.json = AsyncMock(return_value={"result": "success"})

        mock_client_instance = AsyncMock()
        mock_client_instance.request = AsyncMock(return_value=mock_response)
        mock_httpx_async_client.return_value = mock_client_instance

        async with AsyncWorkflowClient("test-key") as client:
            response = await client.run({"input": "test"}, "blocking", "user123")
            data = await response.json()
            self.assertEqual(data["result"], "success")

    @patch("dify_client.async_client.httpx.AsyncClient")
    async def test_async_workspace_client(self, mock_httpx_async_client):
        """Test AsyncWorkspaceClient functionality."""
        mock_response = AsyncMock()
        mock_response.json = AsyncMock(return_value={"data": []})

        mock_client_instance = AsyncMock()
        mock_client_instance.request = AsyncMock(return_value=mock_response)
        mock_httpx_async_client.return_value = mock_client_instance

        async with AsyncWorkspaceClient("test-key") as client:
            response = await client.get_available_models("llm")
            data = await response.json()
            self.assertIn("data", data)

    @patch("dify_client.async_client.httpx.AsyncClient")
    async def test_async_knowledge_base_client(self, mock_httpx_async_client):
        """Test AsyncKnowledgeBaseClient functionality."""
        mock_response = AsyncMock()
        mock_response.json = AsyncMock(return_value={"data": [], "total": 0})

        mock_client_instance = AsyncMock()
        mock_client_instance.request = AsyncMock(return_value=mock_response)
        mock_httpx_async_client.return_value = mock_client_instance

        async with AsyncKnowledgeBaseClient("test-key") as client:
            response = await client.list_datasets()
            data = await response.json()
            self.assertIn("data", data)

    @patch("dify_client.async_client.httpx.AsyncClient")
    async def test_all_async_client_classes(self, mock_httpx_async_client):
        """Test all async client classes work with httpx.AsyncClient."""
        mock_client_instance = AsyncMock()
        mock_httpx_async_client.return_value = mock_client_instance

        clients = [
            AsyncDifyClient("key"),
            AsyncChatClient("key"),
            AsyncCompletionClient("key"),
            AsyncWorkflowClient("key"),
            AsyncWorkspaceClient("key"),
            AsyncKnowledgeBaseClient("key"),
        ]

        # Verify httpx.AsyncClient was called for each
        self.assertEqual(mock_httpx_async_client.call_count, 6)

        # Clean up
        for client in clients:
            await client.aclose()


if __name__ == "__main__":
    unittest.main()
