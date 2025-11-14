import os
import time
import unittest
from unittest.mock import Mock, patch, mock_open

from dify_client.client import (
    ChatClient,
    CompletionClient,
    DifyClient,
    KnowledgeBaseClient,
)

API_KEY = os.environ.get("API_KEY")
APP_ID = os.environ.get("APP_ID")
API_BASE_URL = os.environ.get("API_BASE_URL", "https://api.dify.ai/v1")
FILE_PATH_BASE = os.path.dirname(__file__)


class TestKnowledgeBaseClient(unittest.TestCase):
    def setUp(self):
        self.api_key = "test-api-key"
        self.base_url = "https://api.dify.ai/v1"
        self.knowledge_base_client = KnowledgeBaseClient(self.api_key, base_url=self.base_url)
        self.README_FILE_PATH = os.path.abspath(os.path.join(FILE_PATH_BASE, "../README.md"))
        self.dataset_id = "test-dataset-id"
        self.document_id = "test-document-id"
        self.segment_id = "test-segment-id"
        self.batch_id = "test-batch-id"

    def _get_dataset_kb_client(self):
        return KnowledgeBaseClient(self.api_key, base_url=self.base_url, dataset_id=self.dataset_id)

    @patch("dify_client.client.httpx.Client")
    def test_001_create_dataset(self, mock_httpx_client):
        # Mock the HTTP response
        mock_response = Mock()
        mock_response.json.return_value = {"id": self.dataset_id, "name": "test_dataset"}
        mock_response.status_code = 200

        mock_client_instance = Mock()
        mock_client_instance.request.return_value = mock_response
        mock_httpx_client.return_value = mock_client_instance

        # Re-create client with mocked httpx
        self.knowledge_base_client = KnowledgeBaseClient(self.api_key, base_url=self.base_url)

        response = self.knowledge_base_client.create_dataset(name="test_dataset")
        data = response.json()
        self.assertIn("id", data)
        self.assertEqual("test_dataset", data["name"])

        # the following tests require to be executed in order because they use
        # the dataset/document/segment ids from the previous test
        self._test_002_list_datasets()
        self._test_003_create_document_by_text()
        self._test_004_update_document_by_text()
        self._test_006_update_document_by_file()
        self._test_007_list_documents()
        self._test_008_delete_document()
        self._test_009_create_document_by_file()
        self._test_010_add_segments()
        self._test_011_query_segments()
        self._test_012_update_document_segment()
        self._test_013_delete_document_segment()
        self._test_014_delete_dataset()

    def _test_002_list_datasets(self):
        # Mock the response - using the already mocked client from test_001_create_dataset
        mock_response = Mock()
        mock_response.json.return_value = {"data": [], "total": 0}
        mock_response.status_code = 200
        self.knowledge_base_client._client.request.return_value = mock_response

        response = self.knowledge_base_client.list_datasets()
        data = response.json()
        self.assertIn("data", data)
        self.assertIn("total", data)

    def _test_003_create_document_by_text(self):
        client = self._get_dataset_kb_client()
        # Mock the response
        mock_response = Mock()
        mock_response.json.return_value = {"document": {"id": self.document_id}, "batch": self.batch_id}
        mock_response.status_code = 200
        client._client.request.return_value = mock_response

        response = client.create_document_by_text("test_document", "test_text")
        data = response.json()
        self.assertIn("document", data)

    def _test_004_update_document_by_text(self):
        client = self._get_dataset_kb_client()
        # Mock the response
        mock_response = Mock()
        mock_response.json.return_value = {"document": {"id": self.document_id}, "batch": self.batch_id}
        mock_response.status_code = 200
        client._client.request.return_value = mock_response

        response = client.update_document_by_text(self.document_id, "test_document_updated", "test_text_updated")
        data = response.json()
        self.assertIn("document", data)
        self.assertIn("batch", data)

    def _test_006_update_document_by_file(self):
        client = self._get_dataset_kb_client()
        # Mock the response
        mock_response = Mock()
        mock_response.json.return_value = {"document": {"id": self.document_id}, "batch": self.batch_id}
        mock_response.status_code = 200
        client._client.request.return_value = mock_response

        response = client.update_document_by_file(self.document_id, self.README_FILE_PATH)
        data = response.json()
        self.assertIn("document", data)
        self.assertIn("batch", data)

    def _test_007_list_documents(self):
        client = self._get_dataset_kb_client()
        # Mock the response
        mock_response = Mock()
        mock_response.json.return_value = {"data": []}
        mock_response.status_code = 200
        client._client.request.return_value = mock_response

        response = client.list_documents()
        data = response.json()
        self.assertIn("data", data)

    def _test_008_delete_document(self):
        client = self._get_dataset_kb_client()
        # Mock the response
        mock_response = Mock()
        mock_response.json.return_value = {"result": "success"}
        mock_response.status_code = 200
        client._client.request.return_value = mock_response

        response = client.delete_document(self.document_id)
        data = response.json()
        self.assertIn("result", data)
        self.assertEqual("success", data["result"])

    def _test_009_create_document_by_file(self):
        client = self._get_dataset_kb_client()
        # Mock the response
        mock_response = Mock()
        mock_response.json.return_value = {"document": {"id": self.document_id}, "batch": self.batch_id}
        mock_response.status_code = 200
        client._client.request.return_value = mock_response

        response = client.create_document_by_file(self.README_FILE_PATH)
        data = response.json()
        self.assertIn("document", data)

    def _test_010_add_segments(self):
        client = self._get_dataset_kb_client()
        # Mock the response
        mock_response = Mock()
        mock_response.json.return_value = {"data": [{"id": self.segment_id, "content": "test text segment 1"}]}
        mock_response.status_code = 200
        client._client.request.return_value = mock_response

        response = client.add_segments(self.document_id, [{"content": "test text segment 1"}])
        data = response.json()
        self.assertIn("data", data)
        self.assertGreater(len(data["data"]), 0)

    def _test_011_query_segments(self):
        client = self._get_dataset_kb_client()
        # Mock the response
        mock_response = Mock()
        mock_response.json.return_value = {"data": [{"id": self.segment_id, "content": "test text segment 1"}]}
        mock_response.status_code = 200
        client._client.request.return_value = mock_response

        response = client.query_segments(self.document_id)
        data = response.json()
        self.assertIn("data", data)
        self.assertGreater(len(data["data"]), 0)

    def _test_012_update_document_segment(self):
        client = self._get_dataset_kb_client()
        # Mock the response
        mock_response = Mock()
        mock_response.json.return_value = {"data": {"id": self.segment_id, "content": "test text segment 1 updated"}}
        mock_response.status_code = 200
        client._client.request.return_value = mock_response

        response = client.update_document_segment(
            self.document_id,
            self.segment_id,
            {"content": "test text segment 1 updated"},
        )
        data = response.json()
        self.assertIn("data", data)
        self.assertEqual("test text segment 1 updated", data["data"]["content"])

    def _test_013_delete_document_segment(self):
        client = self._get_dataset_kb_client()
        # Mock the response
        mock_response = Mock()
        mock_response.json.return_value = {"result": "success"}
        mock_response.status_code = 200
        client._client.request.return_value = mock_response

        response = client.delete_document_segment(self.document_id, self.segment_id)
        data = response.json()
        self.assertIn("result", data)
        self.assertEqual("success", data["result"])

    def _test_014_delete_dataset(self):
        client = self._get_dataset_kb_client()
        # Mock the response
        mock_response = Mock()
        mock_response.status_code = 204
        client._client.request.return_value = mock_response

        response = client.delete_dataset()
        self.assertEqual(204, response.status_code)


class TestChatClient(unittest.TestCase):
    @patch("dify_client.client.httpx.Client")
    def setUp(self, mock_httpx_client):
        self.api_key = "test-api-key"
        self.chat_client = ChatClient(self.api_key)

        # Set up default mock response for the client
        mock_response = Mock()
        mock_response.text = '{"answer": "Hello! This is a test response."}'
        mock_response.json.return_value = {"answer": "Hello! This is a test response."}
        mock_response.status_code = 200

        mock_client_instance = Mock()
        mock_client_instance.request.return_value = mock_response
        mock_httpx_client.return_value = mock_client_instance

    @patch("dify_client.client.httpx.Client")
    def test_create_chat_message(self, mock_httpx_client):
        # Mock the HTTP response
        mock_response = Mock()
        mock_response.text = '{"answer": "Hello! This is a test response."}'
        mock_response.json.return_value = {"answer": "Hello! This is a test response."}
        mock_response.status_code = 200

        mock_client_instance = Mock()
        mock_client_instance.request.return_value = mock_response
        mock_httpx_client.return_value = mock_client_instance

        # Create client with mocked httpx
        chat_client = ChatClient(self.api_key)
        response = chat_client.create_chat_message({}, "Hello, World!", "test_user")
        self.assertIn("answer", response.text)

    @patch("dify_client.client.httpx.Client")
    def test_create_chat_message_with_vision_model_by_remote_url(self, mock_httpx_client):
        # Mock the HTTP response
        mock_response = Mock()
        mock_response.text = '{"answer": "I can see this is a test image description."}'
        mock_response.json.return_value = {"answer": "I can see this is a test image description."}
        mock_response.status_code = 200

        mock_client_instance = Mock()
        mock_client_instance.request.return_value = mock_response
        mock_httpx_client.return_value = mock_client_instance

        # Create client with mocked httpx
        chat_client = ChatClient(self.api_key)
        files = [{"type": "image", "transfer_method": "remote_url", "url": "https://example.com/test-image.jpg"}]
        response = chat_client.create_chat_message({}, "Describe the picture.", "test_user", files=files)
        self.assertIn("answer", response.text)

    @patch("dify_client.client.httpx.Client")
    def test_create_chat_message_with_vision_model_by_local_file(self, mock_httpx_client):
        # Mock the HTTP response
        mock_response = Mock()
        mock_response.text = '{"answer": "I can see this is a test uploaded image."}'
        mock_response.json.return_value = {"answer": "I can see this is a test uploaded image."}
        mock_response.status_code = 200

        mock_client_instance = Mock()
        mock_client_instance.request.return_value = mock_response
        mock_httpx_client.return_value = mock_client_instance

        # Create client with mocked httpx
        chat_client = ChatClient(self.api_key)
        files = [
            {
                "type": "image",
                "transfer_method": "local_file",
                "upload_file_id": "test-file-id",
            }
        ]
        response = chat_client.create_chat_message({}, "Describe the picture.", "test_user", files=files)
        self.assertIn("answer", response.text)

    @patch("dify_client.client.httpx.Client")
    def test_get_conversation_messages(self, mock_httpx_client):
        # Mock the HTTP response
        mock_response = Mock()
        mock_response.text = '{"answer": "Here are the conversation messages."}'
        mock_response.json.return_value = {"answer": "Here are the conversation messages."}
        mock_response.status_code = 200

        mock_client_instance = Mock()
        mock_client_instance.request.return_value = mock_response
        mock_httpx_client.return_value = mock_client_instance

        # Create client with mocked httpx
        chat_client = ChatClient(self.api_key)
        response = chat_client.get_conversation_messages("test_user", "test-conversation-id")
        self.assertIn("answer", response.text)

    @patch("dify_client.client.httpx.Client")
    def test_get_conversations(self, mock_httpx_client):
        # Mock the HTTP response
        mock_response = Mock()
        mock_response.text = '{"data": [{"id": "conv1", "name": "Test Conversation"}]}'
        mock_response.json.return_value = {"data": [{"id": "conv1", "name": "Test Conversation"}]}
        mock_response.status_code = 200

        mock_client_instance = Mock()
        mock_client_instance.request.return_value = mock_response
        mock_httpx_client.return_value = mock_client_instance

        # Create client with mocked httpx
        chat_client = ChatClient(self.api_key)
        response = chat_client.get_conversations("test_user")
        self.assertIn("data", response.text)


class TestCompletionClient(unittest.TestCase):
    @patch("dify_client.client.httpx.Client")
    def setUp(self, mock_httpx_client):
        self.api_key = "test-api-key"
        self.completion_client = CompletionClient(self.api_key)

        # Set up default mock response for the client
        mock_response = Mock()
        mock_response.text = '{"answer": "This is a test completion response."}'
        mock_response.json.return_value = {"answer": "This is a test completion response."}
        mock_response.status_code = 200

        mock_client_instance = Mock()
        mock_client_instance.request.return_value = mock_response
        mock_httpx_client.return_value = mock_client_instance

    @patch("dify_client.client.httpx.Client")
    def test_create_completion_message(self, mock_httpx_client):
        # Mock the HTTP response
        mock_response = Mock()
        mock_response.text = '{"answer": "The weather today is sunny with a temperature of 75°F."}'
        mock_response.json.return_value = {"answer": "The weather today is sunny with a temperature of 75°F."}
        mock_response.status_code = 200

        mock_client_instance = Mock()
        mock_client_instance.request.return_value = mock_response
        mock_httpx_client.return_value = mock_client_instance

        # Create client with mocked httpx
        completion_client = CompletionClient(self.api_key)
        response = completion_client.create_completion_message(
            {"query": "What's the weather like today?"}, "blocking", "test_user"
        )
        self.assertIn("answer", response.text)

    @patch("dify_client.client.httpx.Client")
    def test_create_completion_message_with_vision_model_by_remote_url(self, mock_httpx_client):
        # Mock the HTTP response
        mock_response = Mock()
        mock_response.text = '{"answer": "This is a test image description from completion API."}'
        mock_response.json.return_value = {"answer": "This is a test image description from completion API."}
        mock_response.status_code = 200

        mock_client_instance = Mock()
        mock_client_instance.request.return_value = mock_response
        mock_httpx_client.return_value = mock_client_instance

        # Create client with mocked httpx
        completion_client = CompletionClient(self.api_key)
        files = [{"type": "image", "transfer_method": "remote_url", "url": "https://example.com/test-image.jpg"}]
        response = completion_client.create_completion_message(
            {"query": "Describe the picture."}, "blocking", "test_user", files
        )
        self.assertIn("answer", response.text)

    @patch("dify_client.client.httpx.Client")
    def test_create_completion_message_with_vision_model_by_local_file(self, mock_httpx_client):
        # Mock the HTTP response
        mock_response = Mock()
        mock_response.text = '{"answer": "This is a test uploaded image description from completion API."}'
        mock_response.json.return_value = {"answer": "This is a test uploaded image description from completion API."}
        mock_response.status_code = 200

        mock_client_instance = Mock()
        mock_client_instance.request.return_value = mock_response
        mock_httpx_client.return_value = mock_client_instance

        # Create client with mocked httpx
        completion_client = CompletionClient(self.api_key)
        files = [
            {
                "type": "image",
                "transfer_method": "local_file",
                "upload_file_id": "test-file-id",
            }
        ]
        response = completion_client.create_completion_message(
            {"query": "Describe the picture."}, "blocking", "test_user", files
        )
        self.assertIn("answer", response.text)


class TestDifyClient(unittest.TestCase):
    @patch("dify_client.client.httpx.Client")
    def setUp(self, mock_httpx_client):
        self.api_key = "test-api-key"
        self.dify_client = DifyClient(self.api_key)

        # Set up default mock response for the client
        mock_response = Mock()
        mock_response.text = '{"result": "success"}'
        mock_response.json.return_value = {"result": "success"}
        mock_response.status_code = 200

        mock_client_instance = Mock()
        mock_client_instance.request.return_value = mock_response
        mock_httpx_client.return_value = mock_client_instance

    @patch("dify_client.client.httpx.Client")
    def test_message_feedback(self, mock_httpx_client):
        # Mock the HTTP response
        mock_response = Mock()
        mock_response.text = '{"success": true}'
        mock_response.json.return_value = {"success": True}
        mock_response.status_code = 200

        mock_client_instance = Mock()
        mock_client_instance.request.return_value = mock_response
        mock_httpx_client.return_value = mock_client_instance

        # Create client with mocked httpx
        dify_client = DifyClient(self.api_key)
        response = dify_client.message_feedback("test-message-id", "like", "test_user")
        self.assertIn("success", response.text)

    @patch("dify_client.client.httpx.Client")
    def test_get_application_parameters(self, mock_httpx_client):
        # Mock the HTTP response
        mock_response = Mock()
        mock_response.text = '{"user_input_form": [{"field": "text", "label": "Input"}]}'
        mock_response.json.return_value = {"user_input_form": [{"field": "text", "label": "Input"}]}
        mock_response.status_code = 200

        mock_client_instance = Mock()
        mock_client_instance.request.return_value = mock_response
        mock_httpx_client.return_value = mock_client_instance

        # Create client with mocked httpx
        dify_client = DifyClient(self.api_key)
        response = dify_client.get_application_parameters("test_user")
        self.assertIn("user_input_form", response.text)

    @patch("dify_client.client.httpx.Client")
    @patch("builtins.open", new_callable=mock_open, read_data=b"fake image data")
    def test_file_upload(self, mock_file_open, mock_httpx_client):
        # Mock the HTTP response
        mock_response = Mock()
        mock_response.text = '{"name": "panda.jpeg", "id": "test-file-id"}'
        mock_response.json.return_value = {"name": "panda.jpeg", "id": "test-file-id"}
        mock_response.status_code = 200

        mock_client_instance = Mock()
        mock_client_instance.request.return_value = mock_response
        mock_httpx_client.return_value = mock_client_instance

        # Create client with mocked httpx
        dify_client = DifyClient(self.api_key)
        file_path = "/path/to/test/panda.jpeg"
        file_name = "panda.jpeg"
        mime_type = "image/jpeg"

        with open(file_path, "rb") as file:
            files = {"file": (file_name, file, mime_type)}
            response = dify_client.file_upload("test_user", files)
            self.assertIn("name", response.text)


if __name__ == "__main__":
    unittest.main()
