from io import BytesIO
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.datastructures import FileStorage

from services.trigger.webhook_service import WebhookService


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
            # Query params are now extracted as raw strings
            assert webhook_data["query_params"]["version"] == "1"
            assert webhook_data["query_params"]["format"] == "json"
            assert webhook_data["body"]["message"] == "hello"
            assert webhook_data["body"]["count"] == 42
            assert webhook_data["files"] == {}

    def test_extract_webhook_data_query_params_remain_strings(self):
        """Query parameters should be extracted as raw strings without automatic conversion."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="GET",
            headers={"Content-Type": "application/json"},
            query_string="count=42&threshold=3.14&enabled=true&note=text",
        ):
            webhook_trigger = MagicMock()
            webhook_data = WebhookService.extract_webhook_data(webhook_trigger)

            # After refactoring, raw extraction keeps query params as strings
            assert webhook_data["query_params"]["count"] == "42"
            assert webhook_data["query_params"]["threshold"] == "3.14"
            assert webhook_data["query_params"]["enabled"] == "true"
            assert webhook_data["query_params"]["note"] == "text"

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

    @patch("services.trigger.webhook_service.ToolFileManager")
    @patch("services.trigger.webhook_service.file_factory")
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

    @patch("services.trigger.webhook_service.ToolFileManager")
    @patch("services.trigger.webhook_service.file_factory")
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

    def test_validate_json_value_string(self):
        """Test JSON value validation for string type."""
        # Valid string
        result = WebhookService._validate_json_value("name", "hello", "string")
        assert result == "hello"

        # Invalid string (number) - should raise ValueError
        with pytest.raises(ValueError, match="Expected string, got int"):
            WebhookService._validate_json_value("name", 123, "string")

    def test_validate_json_value_number(self):
        """Test JSON value validation for number type."""
        # Valid integer
        result = WebhookService._validate_json_value("count", 42, "number")
        assert result == 42

        # Valid float
        result = WebhookService._validate_json_value("price", 19.99, "number")
        assert result == 19.99

        # Invalid number (string) - should raise ValueError
        with pytest.raises(ValueError, match="Expected number, got str"):
            WebhookService._validate_json_value("count", "42", "number")

    def test_validate_json_value_bool(self):
        """Test JSON value validation for boolean type."""
        # Valid boolean
        result = WebhookService._validate_json_value("enabled", True, "boolean")
        assert result is True

        result = WebhookService._validate_json_value("enabled", False, "boolean")
        assert result is False

        # Invalid boolean (string) - should raise ValueError
        with pytest.raises(ValueError, match="Expected boolean, got str"):
            WebhookService._validate_json_value("enabled", "true", "boolean")

    def test_validate_json_value_object(self):
        """Test JSON value validation for object type."""
        # Valid object
        result = WebhookService._validate_json_value("user", {"name": "John", "age": 30}, "object")
        assert result == {"name": "John", "age": 30}

        # Invalid object (string) - should raise ValueError
        with pytest.raises(ValueError, match="Expected object, got str"):
            WebhookService._validate_json_value("user", "not_an_object", "object")

    def test_validate_json_value_array_string(self):
        """Test JSON value validation for array[string] type."""
        # Valid array of strings
        result = WebhookService._validate_json_value("tags", ["tag1", "tag2", "tag3"], "array[string]")
        assert result == ["tag1", "tag2", "tag3"]

        # Invalid - not an array
        with pytest.raises(ValueError, match="Expected array of strings, got str"):
            WebhookService._validate_json_value("tags", "not_an_array", "array[string]")

        # Invalid - array with non-strings
        with pytest.raises(ValueError, match="Expected array of strings, got list"):
            WebhookService._validate_json_value("tags", ["tag1", 123, "tag3"], "array[string]")

    def test_validate_json_value_array_number(self):
        """Test JSON value validation for array[number] type."""
        # Valid array of numbers
        result = WebhookService._validate_json_value("scores", [1, 2.5, 3, 4.7], "array[number]")
        assert result == [1, 2.5, 3, 4.7]

        # Invalid - array with non-numbers
        with pytest.raises(ValueError, match="Expected array of numbers, got list"):
            WebhookService._validate_json_value("scores", [1, "2", 3], "array[number]")

    def test_validate_json_value_array_bool(self):
        """Test JSON value validation for array[boolean] type."""
        # Valid array of booleans
        result = WebhookService._validate_json_value("flags", [True, False, True], "array[boolean]")
        assert result == [True, False, True]

        # Invalid - array with non-booleans
        with pytest.raises(ValueError, match="Expected array of booleans, got list"):
            WebhookService._validate_json_value("flags", [True, "false", True], "array[boolean]")

    def test_validate_json_value_array_object(self):
        """Test JSON value validation for array[object] type."""
        # Valid array of objects
        result = WebhookService._validate_json_value("users", [{"name": "John"}, {"name": "Jane"}], "array[object]")
        assert result == [{"name": "John"}, {"name": "Jane"}]

        # Invalid - array with non-objects
        with pytest.raises(ValueError, match="Expected array of objects, got list"):
            WebhookService._validate_json_value("users", [{"name": "John"}, "not_object"], "array[object]")

    def test_convert_form_value_string(self):
        """Test form value conversion for string type."""
        result = WebhookService._convert_form_value("test", "hello", "string")
        assert result == "hello"

    def test_convert_form_value_number(self):
        """Test form value conversion for number type."""
        # Integer
        result = WebhookService._convert_form_value("count", "42", "number")
        assert result == 42

        # Float
        result = WebhookService._convert_form_value("price", "19.99", "number")
        assert result == 19.99

        # Invalid number
        with pytest.raises(ValueError, match="Cannot convert 'not_a_number' to number"):
            WebhookService._convert_form_value("count", "not_a_number", "number")

    def test_convert_form_value_boolean(self):
        """Test form value conversion for boolean type."""
        # True values
        assert WebhookService._convert_form_value("flag", "true", "boolean") is True
        assert WebhookService._convert_form_value("flag", "1", "boolean") is True
        assert WebhookService._convert_form_value("flag", "yes", "boolean") is True

        # False values
        assert WebhookService._convert_form_value("flag", "false", "boolean") is False
        assert WebhookService._convert_form_value("flag", "0", "boolean") is False
        assert WebhookService._convert_form_value("flag", "no", "boolean") is False

        # Invalid boolean
        with pytest.raises(ValueError, match="Cannot convert 'maybe' to boolean"):
            WebhookService._convert_form_value("flag", "maybe", "boolean")

    def test_extract_and_validate_webhook_data_success(self):
        """Test successful unified data extraction and validation."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "application/json"},
            query_string="count=42&enabled=true",
            json={"message": "hello", "age": 25},
        ):
            webhook_trigger = MagicMock()
            node_config = {
                "data": {
                    "method": "post",
                    "content_type": "application/json",
                    "params": [
                        {"name": "count", "type": "number", "required": True},
                        {"name": "enabled", "type": "boolean", "required": True},
                    ],
                    "body": [
                        {"name": "message", "type": "string", "required": True},
                        {"name": "age", "type": "number", "required": True},
                    ],
                }
            }

            result = WebhookService.extract_and_validate_webhook_data(webhook_trigger, node_config)

            # Check that types are correctly converted
            assert result["query_params"]["count"] == 42  # Converted to int
            assert result["query_params"]["enabled"] is True  # Converted to bool
            assert result["body"]["message"] == "hello"  # Already string
            assert result["body"]["age"] == 25  # Already number

    def test_extract_and_validate_webhook_data_validation_error(self):
        """Test unified data extraction with validation error."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="GET",  # Wrong method
            headers={"Content-Type": "application/json"},
        ):
            webhook_trigger = MagicMock()
            node_config = {
                "data": {
                    "method": "post",  # Expects POST
                    "content_type": "application/json",
                }
            }

            with pytest.raises(ValueError, match="HTTP method mismatch"):
                WebhookService.extract_and_validate_webhook_data(webhook_trigger, node_config)

    def test_debug_mode_parameter_handling(self):
        """Test that the debug mode parameter is properly handled in _prepare_webhook_execution."""
        from controllers.trigger.webhook import _prepare_webhook_execution

        # Mock the WebhookService methods
        with (
            patch.object(WebhookService, "get_webhook_trigger_and_workflow") as mock_get_trigger,
            patch.object(WebhookService, "extract_and_validate_webhook_data") as mock_extract,
        ):
            mock_trigger = MagicMock()
            mock_workflow = MagicMock()
            mock_config = {"data": {"test": "config"}}
            mock_data = {"test": "data"}

            mock_get_trigger.return_value = (mock_trigger, mock_workflow, mock_config)
            mock_extract.return_value = mock_data

            result = _prepare_webhook_execution("test_webhook", is_debug=False)
            assert result == (mock_trigger, mock_workflow, mock_config, mock_data, None)

            # Reset mock
            mock_get_trigger.reset_mock()

            result = _prepare_webhook_execution("test_webhook", is_debug=True)
            assert result == (mock_trigger, mock_workflow, mock_config, mock_data, None)
