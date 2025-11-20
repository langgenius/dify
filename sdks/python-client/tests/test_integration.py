"""Integration tests with proper mocking."""

import unittest
from unittest.mock import Mock, patch, MagicMock
import json
import httpx
from dify_client import (
    DifyClient,
    ChatClient,
    CompletionClient,
    WorkflowClient,
    KnowledgeBaseClient,
    WorkspaceClient,
)
from dify_client.exceptions import (
    APIError,
    AuthenticationError,
    RateLimitError,
    ValidationError,
)


class TestDifyClientIntegration(unittest.TestCase):
    """Integration tests for DifyClient with mocked HTTP responses."""

    def setUp(self):
        self.api_key = "test_api_key"
        self.base_url = "https://api.dify.ai/v1"
        self.client = DifyClient(api_key=self.api_key, base_url=self.base_url, enable_logging=False)

    @patch("httpx.Client.request")
    def test_get_app_info_integration(self, mock_request):
        """Test get_app_info integration."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "app_123",
            "name": "Test App",
            "description": "A test application",
            "mode": "chat",
        }
        mock_request.return_value = mock_response

        response = self.client.get_app_info()
        data = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(data["id"], "app_123")
        self.assertEqual(data["name"], "Test App")
        mock_request.assert_called_once_with(
            "GET",
            "/info",
            json=None,
            params=None,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
        )

    @patch("httpx.Client.request")
    def test_get_application_parameters_integration(self, mock_request):
        """Test get_application_parameters integration."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "opening_statement": "Hello! How can I help you?",
            "suggested_questions": ["What is AI?", "How does this work?"],
            "speech_to_text": {"enabled": True},
            "text_to_speech": {"enabled": False},
        }
        mock_request.return_value = mock_response

        response = self.client.get_application_parameters("user_123")
        data = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(data["opening_statement"], "Hello! How can I help you?")
        self.assertEqual(len(data["suggested_questions"]), 2)
        mock_request.assert_called_once_with(
            "GET",
            "/parameters",
            json=None,
            params={"user": "user_123"},
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
        )

    @patch("httpx.Client.request")
    def test_file_upload_integration(self, mock_request):
        """Test file_upload integration."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "file_123",
            "name": "test.txt",
            "size": 1024,
            "mime_type": "text/plain",
        }
        mock_request.return_value = mock_response

        files = {"file": ("test.txt", "test content", "text/plain")}
        response = self.client.file_upload("user_123", files)
        data = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(data["id"], "file_123")
        self.assertEqual(data["name"], "test.txt")

    @patch("httpx.Client.request")
    def test_message_feedback_integration(self, mock_request):
        """Test message_feedback integration."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"success": True}
        mock_request.return_value = mock_response

        response = self.client.message_feedback("msg_123", "like", "user_123")
        data = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertTrue(data["success"])
        mock_request.assert_called_once_with(
            "POST",
            "/messages/msg_123/feedbacks",
            json={"rating": "like", "user": "user_123"},
            params=None,
            headers={
                "Authorization": "Bearer test_api_key",
                "Content-Type": "application/json",
            },
        )


class TestChatClientIntegration(unittest.TestCase):
    """Integration tests for ChatClient."""

    def setUp(self):
        self.client = ChatClient("test_api_key", enable_logging=False)

    @patch("httpx.Client.request")
    def test_create_chat_message_blocking(self, mock_request):
        """Test create_chat_message with blocking response."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "msg_123",
            "answer": "Hello! How can I help you today?",
            "conversation_id": "conv_123",
            "created_at": 1234567890,
        }
        mock_request.return_value = mock_response

        response = self.client.create_chat_message(
            inputs={"query": "Hello"},
            query="Hello, AI!",
            user="user_123",
            response_mode="blocking",
        )
        data = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(data["answer"], "Hello! How can I help you today?")
        self.assertEqual(data["conversation_id"], "conv_123")

    @patch("httpx.Client.request")
    def test_create_chat_message_streaming(self, mock_request):
        """Test create_chat_message with streaming response."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.iter_lines.return_value = [
            b'data: {"answer": "Hello"}',
            b'data: {"answer": " world"}',
            b'data: {"answer": "!"}',
        ]
        mock_request.return_value = mock_response

        response = self.client.create_chat_message(inputs={}, query="Hello", user="user_123", response_mode="streaming")

        self.assertEqual(response.status_code, 200)
        lines = list(response.iter_lines())
        self.assertEqual(len(lines), 3)

    @patch("httpx.Client.request")
    def test_get_conversations_integration(self, mock_request):
        """Test get_conversations integration."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": [
                {"id": "conv_1", "name": "Conversation 1"},
                {"id": "conv_2", "name": "Conversation 2"},
            ],
            "has_more": False,
            "limit": 20,
        }
        mock_request.return_value = mock_response

        response = self.client.get_conversations("user_123", limit=20)
        data = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(data["data"]), 2)
        self.assertEqual(data["data"][0]["name"], "Conversation 1")

    @patch("httpx.Client.request")
    def test_get_conversation_messages_integration(self, mock_request):
        """Test get_conversation_messages integration."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": [
                {"id": "msg_1", "role": "user", "content": "Hello"},
                {"id": "msg_2", "role": "assistant", "content": "Hi there!"},
            ]
        }
        mock_request.return_value = mock_response

        response = self.client.get_conversation_messages("user_123", conversation_id="conv_123")
        data = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(data["data"]), 2)
        self.assertEqual(data["data"][0]["role"], "user")


class TestCompletionClientIntegration(unittest.TestCase):
    """Integration tests for CompletionClient."""

    def setUp(self):
        self.client = CompletionClient("test_api_key", enable_logging=False)

    @patch("httpx.Client.request")
    def test_create_completion_message_blocking(self, mock_request):
        """Test create_completion_message with blocking response."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "comp_123",
            "answer": "This is a completion response.",
            "created_at": 1234567890,
        }
        mock_request.return_value = mock_response

        response = self.client.create_completion_message(
            inputs={"prompt": "Complete this sentence"},
            response_mode="blocking",
            user="user_123",
        )
        data = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(data["answer"], "This is a completion response.")

    @patch("httpx.Client.request")
    def test_create_completion_message_with_files(self, mock_request):
        """Test create_completion_message with files."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "comp_124",
            "answer": "I can see the image shows...",
            "files": [{"id": "file_1", "type": "image"}],
        }
        mock_request.return_value = mock_response

        files = {
            "file": {
                "type": "image",
                "transfer_method": "remote_url",
                "url": "https://example.com/image.jpg",
            }
        }
        response = self.client.create_completion_message(
            inputs={"prompt": "Describe this image"},
            response_mode="blocking",
            user="user_123",
            files=files,
        )
        data = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertIn("image", data["answer"])
        self.assertEqual(len(data["files"]), 1)


class TestWorkflowClientIntegration(unittest.TestCase):
    """Integration tests for WorkflowClient."""

    def setUp(self):
        self.client = WorkflowClient("test_api_key", enable_logging=False)

    @patch("httpx.Client.request")
    def test_run_workflow_blocking(self, mock_request):
        """Test run workflow with blocking response."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "run_123",
            "workflow_id": "workflow_123",
            "status": "succeeded",
            "inputs": {"query": "Test input"},
            "outputs": {"result": "Test output"},
            "elapsed_time": 2.5,
        }
        mock_request.return_value = mock_response

        response = self.client.run(inputs={"query": "Test input"}, response_mode="blocking", user="user_123")
        data = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(data["status"], "succeeded")
        self.assertEqual(data["outputs"]["result"], "Test output")

    @patch("httpx.Client.request")
    def test_get_workflow_logs(self, mock_request):
        """Test get_workflow_logs integration."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "logs": [
                {"id": "log_1", "status": "succeeded", "created_at": 1234567890},
                {"id": "log_2", "status": "failed", "created_at": 1234567891},
            ],
            "total": 2,
            "page": 1,
            "limit": 20,
        }
        mock_request.return_value = mock_response

        response = self.client.get_workflow_logs(page=1, limit=20)
        data = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(data["logs"]), 2)
        self.assertEqual(data["logs"][0]["status"], "succeeded")


class TestKnowledgeBaseClientIntegration(unittest.TestCase):
    """Integration tests for KnowledgeBaseClient."""

    def setUp(self):
        self.client = KnowledgeBaseClient("test_api_key")

    @patch("httpx.Client.request")
    def test_create_dataset(self, mock_request):
        """Test create_dataset integration."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "dataset_123",
            "name": "Test Dataset",
            "description": "A test dataset",
            "created_at": 1234567890,
        }
        mock_request.return_value = mock_response

        response = self.client.create_dataset(name="Test Dataset")
        data = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(data["name"], "Test Dataset")
        self.assertEqual(data["id"], "dataset_123")

    @patch("httpx.Client.request")
    def test_list_datasets(self, mock_request):
        """Test list_datasets integration."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": [
                {"id": "dataset_1", "name": "Dataset 1"},
                {"id": "dataset_2", "name": "Dataset 2"},
            ],
            "has_more": False,
            "limit": 20,
        }
        mock_request.return_value = mock_response

        response = self.client.list_datasets(page=1, page_size=20)
        data = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(data["data"]), 2)

    @patch("httpx.Client.request")
    def test_create_document_by_text(self, mock_request):
        """Test create_document_by_text integration."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "document": {
                "id": "doc_123",
                "name": "Test Document",
                "word_count": 100,
                "status": "indexing",
            }
        }
        mock_request.return_value = mock_response

        # Mock dataset_id
        self.client.dataset_id = "dataset_123"

        response = self.client.create_document_by_text(name="Test Document", text="This is test document content.")
        data = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(data["document"]["name"], "Test Document")
        self.assertEqual(data["document"]["word_count"], 100)


class TestWorkspaceClientIntegration(unittest.TestCase):
    """Integration tests for WorkspaceClient."""

    def setUp(self):
        self.client = WorkspaceClient("test_api_key", enable_logging=False)

    @patch("httpx.Client.request")
    def test_get_available_models(self, mock_request):
        """Test get_available_models integration."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "models": [
                {"id": "gpt-4", "name": "GPT-4", "provider": "openai"},
                {"id": "claude-3", "name": "Claude 3", "provider": "anthropic"},
            ]
        }
        mock_request.return_value = mock_response

        response = self.client.get_available_models("llm")
        data = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(data["models"]), 2)
        self.assertEqual(data["models"][0]["id"], "gpt-4")


class TestErrorScenariosIntegration(unittest.TestCase):
    """Integration tests for error scenarios."""

    def setUp(self):
        self.client = DifyClient("test_api_key", enable_logging=False)

    @patch("httpx.Client.request")
    def test_authentication_error_integration(self, mock_request):
        """Test authentication error in integration."""
        mock_response = Mock()
        mock_response.status_code = 401
        mock_response.json.return_value = {"message": "Invalid API key"}
        mock_request.return_value = mock_response

        with self.assertRaises(AuthenticationError) as context:
            self.client.get_app_info()

        self.assertEqual(str(context.exception), "Invalid API key")
        self.assertEqual(context.exception.status_code, 401)

    @patch("httpx.Client.request")
    def test_rate_limit_error_integration(self, mock_request):
        """Test rate limit error in integration."""
        mock_response = Mock()
        mock_response.status_code = 429
        mock_response.json.return_value = {"message": "Rate limit exceeded"}
        mock_response.headers = {"Retry-After": "60"}
        mock_request.return_value = mock_response

        with self.assertRaises(RateLimitError) as context:
            self.client.get_app_info()

        self.assertEqual(str(context.exception), "Rate limit exceeded")
        self.assertEqual(context.exception.retry_after, "60")

    @patch("httpx.Client.request")
    def test_server_error_with_retry_integration(self, mock_request):
        """Test server error with retry in integration."""
        # API errors don't retry by design - only network/timeout errors retry
        mock_response_500 = Mock()
        mock_response_500.status_code = 500
        mock_response_500.json.return_value = {"message": "Internal server error"}

        mock_request.return_value = mock_response_500

        with patch("time.sleep"):  # Skip actual sleep
            with self.assertRaises(APIError) as context:
                self.client.get_app_info()

        self.assertEqual(str(context.exception), "Internal server error")
        self.assertEqual(mock_request.call_count, 1)

    @patch("httpx.Client.request")
    def test_validation_error_integration(self, mock_request):
        """Test validation error in integration."""
        mock_response = Mock()
        mock_response.status_code = 422
        mock_response.json.return_value = {
            "message": "Validation failed",
            "details": {"field": "query", "error": "required"},
        }
        mock_request.return_value = mock_response

        with self.assertRaises(ValidationError) as context:
            self.client.get_app_info()

        self.assertEqual(str(context.exception), "Validation failed")
        self.assertEqual(context.exception.status_code, 422)


class TestContextManagerIntegration(unittest.TestCase):
    """Integration tests for context manager usage."""

    @patch("httpx.Client.close")
    @patch("httpx.Client.request")
    def test_context_manager_usage(self, mock_request, mock_close):
        """Test context manager properly closes connections."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"id": "app_123", "name": "Test App"}
        mock_request.return_value = mock_response

        with DifyClient("test_api_key") as client:
            response = client.get_app_info()
            self.assertEqual(response.status_code, 200)

        # Verify close was called
        mock_close.assert_called_once()

    @patch("httpx.Client.close")
    def test_manual_close(self, mock_close):
        """Test manual close method."""
        client = DifyClient("test_api_key")
        client.close()
        mock_close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
