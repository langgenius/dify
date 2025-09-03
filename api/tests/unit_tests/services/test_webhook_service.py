from io import BytesIO
from unittest.mock import MagicMock, patch

from flask import Flask
from werkzeug.datastructures import FileStorage

from services.webhook_service import WebhookService


class TestWebhookServiceUnit:
    """Unit tests for WebhookService focusing on business logic without database dependencies."""

    def test_extract_webhook_data_json(self):
        """Test webhook data extraction from JSON request."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "application/json", "Authorization": "Bearer token"},
            query_string="version=1&format=json",
            json={"message": "hello", "count": 42},
        ):
            webhook_trigger = MagicMock()
            webhook_data = WebhookService.extract_webhook_data(webhook_trigger)

            assert webhook_data["method"] == "POST"
            assert webhook_data["headers"]["Authorization"] == "Bearer token"
            assert webhook_data["query_params"]["version"] == "1"
            assert webhook_data["query_params"]["format"] == "json"
            assert webhook_data["body"]["message"] == "hello"
            assert webhook_data["body"]["count"] == 42
            assert webhook_data["files"] == {}

    def test_extract_webhook_data_form_urlencoded(self):
        """Test webhook data extraction from form URL encoded request."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data={"username": "test", "password": "secret"},
        ):
            webhook_trigger = MagicMock()
            webhook_data = WebhookService.extract_webhook_data(webhook_trigger)

            assert webhook_data["method"] == "POST"
            assert webhook_data["body"]["username"] == "test"
            assert webhook_data["body"]["password"] == "secret"

    def test_extract_webhook_data_multipart_with_files(self):
        """Test webhook data extraction from multipart form with files."""
        app = Flask(__name__)

        # Create a mock file
        file_content = b"test file content"
        file_storage = FileStorage(stream=BytesIO(file_content), filename="test.txt", content_type="text/plain")

        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "multipart/form-data"},
            data={"message": "test", "upload": file_storage},
        ):
            webhook_trigger = MagicMock()
            webhook_trigger.tenant_id = "test_tenant"

            with patch.object(WebhookService, "_process_file_uploads") as mock_process_files:
                mock_process_files.return_value = {"upload": "mocked_file_obj"}

                webhook_data = WebhookService.extract_webhook_data(webhook_trigger)

                assert webhook_data["method"] == "POST"
                assert webhook_data["body"]["message"] == "test"
                assert webhook_data["files"]["upload"] == "mocked_file_obj"
                mock_process_files.assert_called_once()

    def test_extract_webhook_data_raw_text(self):
        """Test webhook data extraction from raw text request."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook", method="POST", headers={"Content-Type": "text/plain"}, data="raw text content"
        ):
            webhook_trigger = MagicMock()
            webhook_data = WebhookService.extract_webhook_data(webhook_trigger)

            assert webhook_data["method"] == "POST"
            assert webhook_data["body"]["raw"] == "raw text content"

    def test_extract_webhook_data_invalid_json(self):
        """Test webhook data extraction with invalid JSON."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook", method="POST", headers={"Content-Type": "application/json"}, data="invalid json"
        ):
            webhook_trigger = MagicMock()
            webhook_data = WebhookService.extract_webhook_data(webhook_trigger)

            assert webhook_data["method"] == "POST"
            assert webhook_data["body"] == {}  # Should default to empty dict

    def test_validate_webhook_request_success(self):
        """Test successful webhook request validation."""
        webhook_data = {
            "method": "POST",
            "headers": {"Authorization": "Bearer token", "Content-Type": "application/json"},
            "query_params": {"version": "1"},
            "body": {"message": "hello"},
            "files": {},
        }

        node_config = {
            "data": {
                "method": "post",
                "headers": [{"name": "Authorization", "required": True}, {"name": "Content-Type", "required": False}],
                "params": [{"name": "version", "required": True}],
                "body": [{"name": "message", "type": "string", "required": True}],
            }
        }

        result = WebhookService.validate_webhook_request(webhook_data, node_config)

        assert result["valid"] is True

    def test_validate_webhook_request_method_mismatch(self):
        """Test webhook validation with HTTP method mismatch."""
        webhook_data = {"method": "GET", "headers": {}, "query_params": {}, "body": {}, "files": {}}

        node_config = {"data": {"method": "post"}}

        result = WebhookService.validate_webhook_request(webhook_data, node_config)

        assert result["valid"] is False
        assert "HTTP method mismatch" in result["error"]
        assert "Expected POST, got GET" in result["error"]

    def test_validate_webhook_request_missing_required_header(self):
        """Test webhook validation with missing required header."""
        webhook_data = {"method": "POST", "headers": {}, "query_params": {}, "body": {}, "files": {}}

        node_config = {"data": {"method": "post", "headers": [{"name": "Authorization", "required": True}]}}

        result = WebhookService.validate_webhook_request(webhook_data, node_config)

        assert result["valid"] is False
        assert "Required header missing: Authorization" in result["error"]

    def test_validate_webhook_request_case_insensitive_headers(self):
        """Test webhook validation with case-insensitive header matching."""
        webhook_data = {
            "method": "POST",
            "headers": {"authorization": "Bearer token"},  # lowercase
            "query_params": {},
            "body": {},
            "files": {},
        }

        node_config = {
            "data": {
                "method": "post",
                "headers": [
                    {"name": "Authorization", "required": True}  # Pascal case
                ],
            }
        }

        result = WebhookService.validate_webhook_request(webhook_data, node_config)

        assert result["valid"] is True

    def test_validate_webhook_request_missing_required_param(self):
        """Test webhook validation with missing required query parameter."""
        webhook_data = {"method": "POST", "headers": {}, "query_params": {}, "body": {}, "files": {}}

        node_config = {"data": {"method": "post", "params": [{"name": "version", "required": True}]}}

        result = WebhookService.validate_webhook_request(webhook_data, node_config)

        assert result["valid"] is False
        assert "Required query parameter missing: version" in result["error"]

    def test_validate_webhook_request_missing_required_body_param(self):
        """Test webhook validation with missing required body parameter."""
        webhook_data = {"method": "POST", "headers": {}, "query_params": {}, "body": {}, "files": {}}

        node_config = {"data": {"method": "post", "body": [{"name": "message", "type": "string", "required": True}]}}

        result = WebhookService.validate_webhook_request(webhook_data, node_config)

        assert result["valid"] is False
        assert "Required body parameter missing: message" in result["error"]

    def test_validate_webhook_request_missing_required_file(self):
        """Test webhook validation with missing required file parameter."""
        webhook_data = {"method": "POST", "headers": {}, "query_params": {}, "body": {}, "files": {}}

        node_config = {"data": {"method": "post", "body": [{"name": "upload", "type": "file", "required": True}]}}

        result = WebhookService.validate_webhook_request(webhook_data, node_config)

        assert result["valid"] is False
        assert "Required file parameter missing: upload" in result["error"]

    def test_validate_webhook_request_text_plain_with_required_body(self):
        """Test webhook validation for text/plain content type with required body content."""
        # Test case 1: text/plain with raw content - should pass
        webhook_data = {
            "method": "POST", 
            "headers": {"content-type": "text/plain"}, 
            "query_params": {}, 
            "body": {"raw": "Hello World"}, 
            "files": {}
        }

        node_config = {
            "data": {
                "method": "post", 
                "content_type": "text/plain",
                "body": [{"name": "message", "type": "string", "required": True}]
            }
        }

        result = WebhookService.validate_webhook_request(webhook_data, node_config)
        assert result["valid"] is True

        # Test case 2: text/plain without raw content but required - should fail
        webhook_data_no_body = {
            "method": "POST", 
            "headers": {"content-type": "text/plain"}, 
            "query_params": {}, 
            "body": {}, 
            "files": {}
        }

        result = WebhookService.validate_webhook_request(webhook_data_no_body, node_config)
        assert result["valid"] is False
        assert "Required body content missing for text/plain request" in result["error"]

        # Test case 3: text/plain with empty raw content but required - should fail
        webhook_data_empty_body = {
            "method": "POST", 
            "headers": {"content-type": "text/plain"}, 
            "query_params": {}, 
            "body": {"raw": ""}, 
            "files": {}
        }

        result = WebhookService.validate_webhook_request(webhook_data_empty_body, node_config)
        assert result["valid"] is False
        assert "Required body content missing for text/plain request" in result["error"]

    def test_validate_webhook_request_text_plain_no_body_params(self):
        """Test webhook validation for text/plain content type with no body params configured."""
        webhook_data = {
            "method": "POST", 
            "headers": {"content-type": "text/plain"}, 
            "query_params": {}, 
            "body": {"raw": "Hello World"}, 
            "files": {}
        }

        node_config = {
            "data": {
                "method": "post", 
                "content_type": "text/plain",
                "body": []  # No body params configured
            }
        }

        result = WebhookService.validate_webhook_request(webhook_data, node_config)
        assert result["valid"] is True

    def test_validate_webhook_request_validation_exception(self):
        """Test webhook validation with exception handling."""
        webhook_data = {"method": "POST", "headers": {}, "query_params": {}, "body": {}, "files": {}}

        # Invalid node config that will cause an exception
        node_config = None

        result = WebhookService.validate_webhook_request(webhook_data, node_config)

        assert result["valid"] is False
        assert "Validation failed" in result["error"]

    def test_generate_webhook_response_default(self):
        """Test webhook response generation with default values."""
        node_config = {"data": {}}

        response_data, status_code = WebhookService.generate_webhook_response(node_config)

        assert status_code == 200
        assert response_data["status"] == "success"
        assert "Webhook processed successfully" in response_data["message"]

    def test_generate_webhook_response_custom_json(self):
        """Test webhook response generation with custom JSON response."""
        node_config = {"data": {"status_code": 201, "response_body": '{"result": "created", "id": 123}'}}

        response_data, status_code = WebhookService.generate_webhook_response(node_config)

        assert status_code == 201
        assert response_data["result"] == "created"
        assert response_data["id"] == 123

    def test_generate_webhook_response_custom_text(self):
        """Test webhook response generation with custom text response."""
        node_config = {"data": {"status_code": 202, "response_body": "Request accepted for processing"}}

        response_data, status_code = WebhookService.generate_webhook_response(node_config)

        assert status_code == 202
        assert response_data["message"] == "Request accepted for processing"

    def test_generate_webhook_response_invalid_json(self):
        """Test webhook response generation with invalid JSON response."""
        node_config = {"data": {"status_code": 400, "response_body": '{"invalid": json}'}}

        response_data, status_code = WebhookService.generate_webhook_response(node_config)

        assert status_code == 400
        assert response_data["message"] == '{"invalid": json}'

    def test_generate_webhook_response_empty_response_body(self):
        """Test webhook response generation with empty response body."""
        node_config = {"data": {"status_code": 204, "response_body": ""}}

        response_data, status_code = WebhookService.generate_webhook_response(node_config)

        assert status_code == 204
        assert response_data["status"] == "success"
        assert "Webhook processed successfully" in response_data["message"]

    def test_generate_webhook_response_array_json(self):
        """Test webhook response generation with JSON array response."""
        node_config = {"data": {"status_code": 200, "response_body": '[{"id": 1}, {"id": 2}]'}}

        response_data, status_code = WebhookService.generate_webhook_response(node_config)

        assert status_code == 200
        assert isinstance(response_data, list)
        assert len(response_data) == 2
        assert response_data[0]["id"] == 1
        assert response_data[1]["id"] == 2

    @patch("services.webhook_service.ToolFileManager")
    @patch("services.webhook_service.file_factory")
    def test_process_file_uploads_success(self, mock_file_factory, mock_tool_file_manager):
        """Test successful file upload processing."""
        # Mock ToolFileManager
        mock_tool_file_instance = MagicMock()
        mock_tool_file_manager.return_value = mock_tool_file_instance

        # Mock file creation
        mock_tool_file = MagicMock()
        mock_tool_file.id = "test_file_id"
        mock_tool_file_instance.create_file_by_raw.return_value = mock_tool_file

        # Mock file factory
        mock_file_obj = MagicMock()
        mock_file_factory.build_from_mapping.return_value = mock_file_obj

        # Create mock files
        files = {
            "file1": MagicMock(filename="test1.txt", content_type="text/plain"),
            "file2": MagicMock(filename="test2.jpg", content_type="image/jpeg"),
        }

        # Mock file reads
        files["file1"].read.return_value = b"content1"
        files["file2"].read.return_value = b"content2"

        webhook_trigger = MagicMock()
        webhook_trigger.tenant_id = "test_tenant"

        result = WebhookService._process_file_uploads(files, webhook_trigger)

        assert len(result) == 2
        assert "file1" in result
        assert "file2" in result

        # Verify file processing was called for each file
        assert mock_tool_file_manager.call_count == 2
        assert mock_file_factory.build_from_mapping.call_count == 2

    @patch("services.webhook_service.ToolFileManager")
    @patch("services.webhook_service.file_factory")
    def test_process_file_uploads_with_errors(self, mock_file_factory, mock_tool_file_manager):
        """Test file upload processing with errors."""
        # Mock ToolFileManager
        mock_tool_file_instance = MagicMock()
        mock_tool_file_manager.return_value = mock_tool_file_instance

        # Mock file creation
        mock_tool_file = MagicMock()
        mock_tool_file.id = "test_file_id"
        mock_tool_file_instance.create_file_by_raw.return_value = mock_tool_file

        # Mock file factory
        mock_file_obj = MagicMock()
        mock_file_factory.build_from_mapping.return_value = mock_file_obj

        # Create mock files, one will fail
        files = {
            "good_file": MagicMock(filename="test.txt", content_type="text/plain"),
            "bad_file": MagicMock(filename="test.bad", content_type="text/plain"),
        }

        files["good_file"].read.return_value = b"content"
        files["bad_file"].read.side_effect = Exception("Read error")

        webhook_trigger = MagicMock()
        webhook_trigger.tenant_id = "test_tenant"

        result = WebhookService._process_file_uploads(files, webhook_trigger)

        # Should process the good file and skip the bad one
        assert len(result) == 1
        assert "good_file" in result
        assert "bad_file" not in result

    def test_process_file_uploads_empty_filename(self):
        """Test file upload processing with empty filename."""
        files = {
            "no_filename": MagicMock(filename="", content_type="text/plain"),
            "none_filename": MagicMock(filename=None, content_type="text/plain"),
        }

        webhook_trigger = MagicMock()
        webhook_trigger.tenant_id = "test_tenant"

        result = WebhookService._process_file_uploads(files, webhook_trigger)

        # Should skip files without filenames
        assert len(result) == 0
