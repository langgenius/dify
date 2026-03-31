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
            data={"message": "test", "file": file_storage},
        ):
            webhook_trigger = MagicMock()
            webhook_trigger.tenant_id = "test_tenant"

            with patch.object(WebhookService, "_process_file_uploads", autospec=True) as mock_process_files:
                mock_process_files.return_value = {"file": "mocked_file_obj"}

                webhook_data = WebhookService.extract_webhook_data(webhook_trigger)

                assert webhook_data["method"] == "POST"
                assert webhook_data["body"]["message"] == "test"
                assert webhook_data["files"]["file"] == "mocked_file_obj"
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

    def test_extract_octet_stream_body_uses_detected_mime(self):
        """Octet-stream uploads should rely on detected MIME type."""
        app = Flask(__name__)
        binary_content = b"plain text data"

        with app.test_request_context(
            "/webhook", method="POST", headers={"Content-Type": "application/octet-stream"}, data=binary_content
        ):
            webhook_trigger = MagicMock()
            mock_file = MagicMock()
            mock_file.to_dict.return_value = {"file": "data"}

            with (
                patch.object(
                    WebhookService, "_detect_binary_mimetype", return_value="text/plain", autospec=True
                ) as mock_detect,
                patch.object(WebhookService, "_create_file_from_binary", autospec=True) as mock_create,
            ):
                mock_create.return_value = mock_file
                body, files = WebhookService._extract_octet_stream_body(webhook_trigger)

            assert body["raw"] == {"file": "data"}
            assert files == {}
            mock_detect.assert_called_once_with(binary_content)
            mock_create.assert_called_once()
            args = mock_create.call_args[0]
            assert args[0] == binary_content
            assert args[1] == "text/plain"
            assert args[2] is webhook_trigger

    def test_detect_binary_mimetype_uses_magic(self, monkeypatch):
        """python-magic output should be used when available."""
        fake_magic = MagicMock()
        fake_magic.from_buffer.return_value = "image/png"
        monkeypatch.setattr("services.trigger.webhook_service.magic", fake_magic)

        result = WebhookService._detect_binary_mimetype(b"binary data")

        assert result == "image/png"
        fake_magic.from_buffer.assert_called_once()

    def test_detect_binary_mimetype_fallback_without_magic(self, monkeypatch):
        """Fallback MIME type should be used when python-magic is unavailable."""
        monkeypatch.setattr("services.trigger.webhook_service.magic", None)

        result = WebhookService._detect_binary_mimetype(b"binary data")

        assert result == "application/octet-stream"

    def test_detect_binary_mimetype_handles_magic_exception(self, monkeypatch):
        """Fallback MIME type should be used when python-magic raises an exception."""
        try:
            import magic as real_magic
        except ImportError:
            pytest.skip("python-magic is not installed")

        fake_magic = MagicMock()
        fake_magic.from_buffer.side_effect = real_magic.MagicException("magic error")
        monkeypatch.setattr("services.trigger.webhook_service.magic", fake_magic)

        with patch("services.trigger.webhook_service.logger", autospec=True) as mock_logger:
            result = WebhookService._detect_binary_mimetype(b"binary data")

            assert result == "application/octet-stream"
            mock_logger.debug.assert_called_once()

    def test_extract_webhook_data_invalid_json(self):
        """Test webhook data extraction with invalid JSON."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook", method="POST", headers={"Content-Type": "application/json"}, data="invalid json"
        ):
            webhook_trigger = MagicMock()
            with pytest.raises(ValueError, match="Invalid JSON body"):
                WebhookService.extract_webhook_data(webhook_trigger)

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

    @patch("services.trigger.webhook_service.ToolFileManager", autospec=True)
    @patch("services.trigger.webhook_service.file_factory", autospec=True)
    def test_process_file_uploads_success(self, mock_file_factory, mock_tool_file_manager):
        """Test successful file upload processing."""
        # Mock ToolFileManager
        mock_tool_file_instance = mock_tool_file_manager.return_value  # Mock file creation
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

    @patch("services.trigger.webhook_service.ToolFileManager", autospec=True)
    @patch("services.trigger.webhook_service.file_factory", autospec=True)
    def test_process_file_uploads_with_errors(self, mock_file_factory, mock_tool_file_manager):
        """Test file upload processing with errors."""
        # Mock ToolFileManager
        mock_tool_file_instance = mock_tool_file_manager.return_value  # Mock file creation
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

    def test_extract_and_validate_webhook_data_invalid_json_error(self):
        """Invalid JSON should bubble up as a ValueError with details."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "application/json"},
            data='{"invalid": }',
        ):
            webhook_trigger = MagicMock()
            node_config = {
                "data": {
                    "method": "post",
                    "content_type": "application/json",
                }
            }

            with pytest.raises(ValueError, match="Invalid JSON body"):
                WebhookService.extract_and_validate_webhook_data(webhook_trigger, node_config)

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
            patch.object(WebhookService, "get_webhook_trigger_and_workflow", autospec=True) as mock_get_trigger,
            patch.object(WebhookService, "extract_and_validate_webhook_data", autospec=True) as mock_extract,
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


# === Merged from test_webhook_service_additional.py ===


from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock

import pytest
from flask import Flask
from graphon.variables.types import SegmentType
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import RequestEntityTooLarge

from core.workflow.nodes.trigger_webhook.entities import (
    ContentType,
    WebhookBodyParameter,
    WebhookData,
    WebhookParameter,
)
from models.enums import AppTriggerStatus
from models.model import App
from models.trigger import WorkflowWebhookTrigger
from models.workflow import Workflow
from services.errors.app import QuotaExceededError
from services.trigger import webhook_service as service_module
from services.trigger.webhook_service import WebhookService


class _FakeQuery:
    def __init__(self, result: Any) -> None:
        self._result = result

    def where(self, *args: Any, **kwargs: Any) -> "_FakeQuery":
        return self

    def filter(self, *args: Any, **kwargs: Any) -> "_FakeQuery":
        return self

    def order_by(self, *args: Any, **kwargs: Any) -> "_FakeQuery":
        return self

    def first(self) -> Any:
        return self._result


class _SessionContext:
    def __init__(self, session: Any) -> None:
        self._session = session

    def __enter__(self) -> Any:
        return self._session

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
        return False


@pytest.fixture
def flask_app() -> Flask:
    return Flask(__name__)


def _patch_session(monkeypatch: pytest.MonkeyPatch, session: Any) -> None:
    monkeypatch.setattr(service_module, "db", SimpleNamespace(engine=MagicMock(), session=MagicMock()))
    monkeypatch.setattr(service_module, "Session", lambda *args, **kwargs: _SessionContext(session))


def _workflow_trigger(**kwargs: Any) -> WorkflowWebhookTrigger:
    return cast(WorkflowWebhookTrigger, SimpleNamespace(**kwargs))


def _workflow(**kwargs: Any) -> Workflow:
    return cast(Workflow, SimpleNamespace(**kwargs))


def _app(**kwargs: Any) -> App:
    return cast(App, SimpleNamespace(**kwargs))


def test_get_webhook_trigger_and_workflow_should_raise_when_webhook_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    fake_session = MagicMock()
    fake_session.query.return_value = _FakeQuery(None)
    _patch_session(monkeypatch, fake_session)

    # Act / Assert
    with pytest.raises(ValueError, match="Webhook not found"):
        WebhookService.get_webhook_trigger_and_workflow("webhook-1")


def test_get_webhook_trigger_and_workflow_should_raise_when_app_trigger_not_found(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    webhook_trigger = SimpleNamespace(app_id="app-1", node_id="node-1")
    fake_session = MagicMock()
    fake_session.query.side_effect = [_FakeQuery(webhook_trigger), _FakeQuery(None)]
    _patch_session(monkeypatch, fake_session)

    # Act / Assert
    with pytest.raises(ValueError, match="App trigger not found"):
        WebhookService.get_webhook_trigger_and_workflow("webhook-1")


def test_get_webhook_trigger_and_workflow_should_raise_when_app_trigger_rate_limited(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    webhook_trigger = SimpleNamespace(app_id="app-1", node_id="node-1")
    app_trigger = SimpleNamespace(status=AppTriggerStatus.RATE_LIMITED)
    fake_session = MagicMock()
    fake_session.query.side_effect = [_FakeQuery(webhook_trigger), _FakeQuery(app_trigger)]
    _patch_session(monkeypatch, fake_session)

    # Act / Assert
    with pytest.raises(ValueError, match="rate limited"):
        WebhookService.get_webhook_trigger_and_workflow("webhook-1")


def test_get_webhook_trigger_and_workflow_should_raise_when_app_trigger_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    webhook_trigger = SimpleNamespace(app_id="app-1", node_id="node-1")
    app_trigger = SimpleNamespace(status=AppTriggerStatus.DISABLED)
    fake_session = MagicMock()
    fake_session.query.side_effect = [_FakeQuery(webhook_trigger), _FakeQuery(app_trigger)]
    _patch_session(monkeypatch, fake_session)

    # Act / Assert
    with pytest.raises(ValueError, match="disabled"):
        WebhookService.get_webhook_trigger_and_workflow("webhook-1")


def test_get_webhook_trigger_and_workflow_should_raise_when_workflow_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    webhook_trigger = SimpleNamespace(app_id="app-1", node_id="node-1")
    app_trigger = SimpleNamespace(status=AppTriggerStatus.ENABLED)
    fake_session = MagicMock()
    fake_session.query.side_effect = [_FakeQuery(webhook_trigger), _FakeQuery(app_trigger), _FakeQuery(None)]
    _patch_session(monkeypatch, fake_session)

    # Act / Assert
    with pytest.raises(ValueError, match="Workflow not found"):
        WebhookService.get_webhook_trigger_and_workflow("webhook-1")


def test_get_webhook_trigger_and_workflow_should_return_values_for_non_debug_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    webhook_trigger = SimpleNamespace(app_id="app-1", node_id="node-1")
    app_trigger = SimpleNamespace(status=AppTriggerStatus.ENABLED)
    workflow = MagicMock()
    workflow.get_node_config_by_id.return_value = {"data": {"key": "value"}}

    fake_session = MagicMock()
    fake_session.query.side_effect = [_FakeQuery(webhook_trigger), _FakeQuery(app_trigger), _FakeQuery(workflow)]
    _patch_session(monkeypatch, fake_session)

    # Act
    got_trigger, got_workflow, got_node_config = WebhookService.get_webhook_trigger_and_workflow("webhook-1")

    # Assert
    assert got_trigger is webhook_trigger
    assert got_workflow is workflow
    assert got_node_config == {"data": {"key": "value"}}


def test_get_webhook_trigger_and_workflow_should_return_values_for_debug_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    webhook_trigger = SimpleNamespace(app_id="app-1", node_id="node-1")
    workflow = MagicMock()
    workflow.get_node_config_by_id.return_value = {"data": {"mode": "debug"}}

    fake_session = MagicMock()
    fake_session.query.side_effect = [_FakeQuery(webhook_trigger), _FakeQuery(workflow)]
    _patch_session(monkeypatch, fake_session)

    # Act
    got_trigger, got_workflow, got_node_config = WebhookService.get_webhook_trigger_and_workflow(
        "webhook-1", is_debug=True
    )

    # Assert
    assert got_trigger is webhook_trigger
    assert got_workflow is workflow
    assert got_node_config == {"data": {"mode": "debug"}}


def test_extract_webhook_data_should_use_text_fallback_for_unknown_content_type(
    flask_app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    warning_mock = MagicMock()
    monkeypatch.setattr(service_module.logger, "warning", warning_mock)
    webhook_trigger = MagicMock()

    # Act
    with flask_app.test_request_context(
        "/webhook",
        method="POST",
        headers={"Content-Type": "application/vnd.custom"},
        data="plain content",
    ):
        result = WebhookService.extract_webhook_data(webhook_trigger)

    # Assert
    assert result["body"] == {"raw": "plain content"}
    warning_mock.assert_called_once()


def test_extract_webhook_data_should_raise_for_request_too_large(
    flask_app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    monkeypatch.setattr(service_module.dify_config, "WEBHOOK_REQUEST_BODY_MAX_SIZE", 1)

    # Act / Assert
    with flask_app.test_request_context("/webhook", method="POST", data="ab"):
        with pytest.raises(RequestEntityTooLarge):
            WebhookService.extract_webhook_data(MagicMock())


def test_extract_octet_stream_body_should_return_none_when_empty_payload(flask_app: Flask) -> None:
    # Arrange
    webhook_trigger = MagicMock()

    # Act
    with flask_app.test_request_context("/webhook", method="POST", data=b""):
        body, files = WebhookService._extract_octet_stream_body(webhook_trigger)

    # Assert
    assert body == {"raw": None}
    assert files == {}


def test_extract_octet_stream_body_should_return_none_when_processing_raises(
    flask_app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    webhook_trigger = MagicMock()
    monkeypatch.setattr(WebhookService, "_detect_binary_mimetype", MagicMock(return_value="application/octet-stream"))
    monkeypatch.setattr(WebhookService, "_create_file_from_binary", MagicMock(side_effect=RuntimeError("boom")))

    # Act
    with flask_app.test_request_context("/webhook", method="POST", data=b"abc"):
        body, files = WebhookService._extract_octet_stream_body(webhook_trigger)

    # Assert
    assert body == {"raw": None}
    assert files == {}


def test_extract_text_body_should_return_empty_string_when_request_read_fails(
    flask_app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    monkeypatch.setattr("flask.wrappers.Request.get_data", MagicMock(side_effect=RuntimeError("read error")))

    # Act
    with flask_app.test_request_context("/webhook", method="POST", data="abc"):
        body, files = WebhookService._extract_text_body()

    # Assert
    assert body == {"raw": ""}
    assert files == {}


def test_detect_binary_mimetype_should_fallback_when_magic_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    fake_magic = MagicMock()
    fake_magic.from_buffer.side_effect = RuntimeError("magic failed")
    monkeypatch.setattr(service_module, "magic", fake_magic)

    # Act
    result = WebhookService._detect_binary_mimetype(b"binary")

    # Assert
    assert result == "application/octet-stream"


def test_process_file_uploads_should_use_octet_stream_fallback_when_mimetype_unknown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    webhook_trigger = _workflow_trigger(created_by="user-1", tenant_id="tenant-1")
    file_obj = MagicMock()
    file_obj.to_dict.return_value = {"id": "f-1"}
    monkeypatch.setattr(WebhookService, "_create_file_from_binary", MagicMock(return_value=file_obj))
    monkeypatch.setattr(service_module.mimetypes, "guess_type", MagicMock(return_value=(None, None)))

    uploaded = MagicMock()
    uploaded.filename = "file.unknown"
    uploaded.content_type = None
    uploaded.read.return_value = b"content"

    # Act
    result = WebhookService._process_file_uploads({"f": uploaded}, webhook_trigger)

    # Assert
    assert result == {"f": {"id": "f-1"}}


def test_create_file_from_binary_should_call_tool_file_manager_and_file_factory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    webhook_trigger = _workflow_trigger(created_by="user-1", tenant_id="tenant-1")
    manager = MagicMock()
    manager.create_file_by_raw.return_value = SimpleNamespace(id="tool-file-1")
    monkeypatch.setattr(service_module, "ToolFileManager", MagicMock(return_value=manager))
    expected_file = MagicMock()
    monkeypatch.setattr(service_module.file_factory, "build_from_mapping", MagicMock(return_value=expected_file))

    # Act
    result = WebhookService._create_file_from_binary(b"abc", "text/plain", webhook_trigger)

    # Assert
    assert result is expected_file
    manager.create_file_by_raw.assert_called_once()


@pytest.mark.parametrize(
    ("raw_value", "param_type", "expected"),
    [
        ("42", SegmentType.NUMBER, 42),
        ("3.14", SegmentType.NUMBER, 3.14),
        ("yes", SegmentType.BOOLEAN, True),
        ("no", SegmentType.BOOLEAN, False),
    ],
)
def test_convert_form_value_should_convert_supported_types(
    raw_value: str,
    param_type: str,
    expected: Any,
) -> None:
    # Arrange

    # Act
    result = WebhookService._convert_form_value("param", raw_value, param_type)

    # Assert
    assert result == expected


def test_convert_form_value_should_raise_for_unsupported_type() -> None:
    # Arrange

    # Act / Assert
    with pytest.raises(ValueError, match="Unsupported type"):
        WebhookService._convert_form_value("p", "x", SegmentType.FILE)


def test_validate_json_value_should_return_original_for_unmapped_supported_segment_type(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    warning_mock = MagicMock()
    monkeypatch.setattr(service_module.logger, "warning", warning_mock)

    # Act
    result = WebhookService._validate_json_value("param", {"x": 1}, "unsupported-type")

    # Assert
    assert result == {"x": 1}
    warning_mock.assert_called_once()


def test_validate_and_convert_value_should_wrap_conversion_errors() -> None:
    # Arrange

    # Act / Assert
    with pytest.raises(ValueError, match="validation failed"):
        WebhookService._validate_and_convert_value("param", "bad", SegmentType.NUMBER, is_form_data=True)


def test_process_parameters_should_raise_when_required_parameter_missing() -> None:
    # Arrange
    raw_params = {"optional": "x"}
    config = [WebhookParameter(name="required_param", type=SegmentType.STRING, required=True)]

    # Act / Assert
    with pytest.raises(ValueError, match="Required parameter missing"):
        WebhookService._process_parameters(raw_params, config, is_form_data=True)


def test_process_parameters_should_include_unconfigured_parameters() -> None:
    # Arrange
    raw_params = {"known": "1", "unknown": "x"}
    config = [WebhookParameter(name="known", type=SegmentType.NUMBER, required=False)]

    # Act
    result = WebhookService._process_parameters(raw_params, config, is_form_data=True)

    # Assert
    assert result == {"known": 1, "unknown": "x"}


def test_process_body_parameters_should_raise_when_required_text_raw_is_missing() -> None:
    # Arrange

    # Act / Assert
    with pytest.raises(ValueError, match="Required body content missing"):
        WebhookService._process_body_parameters(
            raw_body={"raw": ""},
            body_configs=[WebhookBodyParameter(name="raw", required=True)],
            content_type=ContentType.TEXT,
        )


def test_process_body_parameters_should_skip_file_config_for_multipart_form_data() -> None:
    # Arrange
    raw_body = {"message": "hello", "extra": "x"}
    body_configs = [
        WebhookBodyParameter(name="upload", type=SegmentType.FILE, required=True),
        WebhookBodyParameter(name="message", type=SegmentType.STRING, required=True),
    ]

    # Act
    result = WebhookService._process_body_parameters(raw_body, body_configs, ContentType.FORM_DATA)

    # Assert
    assert result == {"message": "hello", "extra": "x"}


def test_validate_required_headers_should_accept_sanitized_header_names() -> None:
    # Arrange
    headers = {"x_api_key": "123"}
    configs = [WebhookParameter(name="x-api-key", required=True)]

    # Act
    WebhookService._validate_required_headers(headers, configs)

    # Assert
    assert True


def test_validate_required_headers_should_raise_when_required_header_missing() -> None:
    # Arrange
    headers = {"x-other": "123"}
    configs = [WebhookParameter(name="x-api-key", required=True)]

    # Act / Assert
    with pytest.raises(ValueError, match="Required header missing"):
        WebhookService._validate_required_headers(headers, configs)


def test_validate_http_metadata_should_return_content_type_mismatch_error() -> None:
    # Arrange
    webhook_data = {"method": "POST", "headers": {"Content-Type": "application/json"}}
    node_data = WebhookData(method="post", content_type=ContentType.TEXT)

    # Act
    result = WebhookService._validate_http_metadata(webhook_data, node_data)

    # Assert
    assert result["valid"] is False
    assert "Content-type mismatch" in result["error"]


def test_extract_content_type_should_fallback_to_lowercase_header_key() -> None:
    # Arrange
    headers = {"content-type": "application/json; charset=utf-8"}

    # Act
    result = WebhookService._extract_content_type(headers)

    # Assert
    assert result == "application/json"


def test_build_workflow_inputs_should_include_expected_keys() -> None:
    # Arrange
    webhook_data = {"headers": {"h": "v"}, "query_params": {"q": 1}, "body": {"b": 2}}

    # Act
    result = WebhookService.build_workflow_inputs(webhook_data)

    # Assert
    assert result["webhook_data"] == webhook_data
    assert result["webhook_headers"] == {"h": "v"}
    assert result["webhook_query_params"] == {"q": 1}
    assert result["webhook_body"] == {"b": 2}


def test_trigger_workflow_execution_should_trigger_async_workflow_successfully(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    webhook_trigger = _workflow_trigger(
        app_id="app-1",
        node_id="node-1",
        tenant_id="tenant-1",
        webhook_id="webhook-1",
    )
    workflow = _workflow(id="wf-1")
    webhook_data = {"body": {"x": 1}}

    session = MagicMock()
    _patch_session(monkeypatch, session)

    end_user = SimpleNamespace(id="end-user-1")
    monkeypatch.setattr(
        service_module.EndUserService, "get_or_create_end_user_by_type", MagicMock(return_value=end_user)
    )
    quota_type = SimpleNamespace(TRIGGER=SimpleNamespace(consume=MagicMock()))
    monkeypatch.setattr(service_module, "QuotaType", quota_type)
    trigger_async_mock = MagicMock()
    monkeypatch.setattr(service_module.AsyncWorkflowService, "trigger_workflow_async", trigger_async_mock)

    # Act
    WebhookService.trigger_workflow_execution(webhook_trigger, webhook_data, workflow)

    # Assert
    trigger_async_mock.assert_called_once()


def test_trigger_workflow_execution_should_mark_tenant_rate_limited_when_quota_exceeded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    webhook_trigger = _workflow_trigger(
        app_id="app-1",
        node_id="node-1",
        tenant_id="tenant-1",
        webhook_id="webhook-1",
    )
    workflow = _workflow(id="wf-1")

    session = MagicMock()
    _patch_session(monkeypatch, session)

    monkeypatch.setattr(
        service_module.EndUserService,
        "get_or_create_end_user_by_type",
        MagicMock(return_value=SimpleNamespace(id="end-user-1")),
    )
    quota_type = SimpleNamespace(
        TRIGGER=SimpleNamespace(
            consume=MagicMock(side_effect=QuotaExceededError(feature="trigger", tenant_id="tenant-1", required=1))
        )
    )
    monkeypatch.setattr(service_module, "QuotaType", quota_type)
    mark_rate_limited_mock = MagicMock()
    monkeypatch.setattr(service_module.AppTriggerService, "mark_tenant_triggers_rate_limited", mark_rate_limited_mock)

    # Act / Assert
    with pytest.raises(QuotaExceededError):
        WebhookService.trigger_workflow_execution(webhook_trigger, {"body": {}}, workflow)
    mark_rate_limited_mock.assert_called_once_with("tenant-1")


def test_trigger_workflow_execution_should_log_and_reraise_unexpected_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    webhook_trigger = _workflow_trigger(
        app_id="app-1",
        node_id="node-1",
        tenant_id="tenant-1",
        webhook_id="webhook-1",
    )
    workflow = _workflow(id="wf-1")

    session = MagicMock()
    _patch_session(monkeypatch, session)

    monkeypatch.setattr(
        service_module.EndUserService, "get_or_create_end_user_by_type", MagicMock(side_effect=RuntimeError("boom"))
    )
    logger_exception_mock = MagicMock()
    monkeypatch.setattr(service_module.logger, "exception", logger_exception_mock)

    # Act / Assert
    with pytest.raises(RuntimeError, match="boom"):
        WebhookService.trigger_workflow_execution(webhook_trigger, {"body": {}}, workflow)
    logger_exception_mock.assert_called_once()


def test_sync_webhook_relationships_should_raise_when_workflow_exceeds_node_limit() -> None:
    # Arrange
    app = _app(id="app-1", tenant_id="tenant-1", created_by="user-1")
    workflow = _workflow(
        walk_nodes=lambda _node_type: [
            (f"node-{i}", {}) for i in range(WebhookService.MAX_WEBHOOK_NODES_PER_WORKFLOW + 1)
        ]
    )

    # Act / Assert
    with pytest.raises(ValueError, match="maximum webhook node limit"):
        WebhookService.sync_webhook_relationships(app, workflow)


def test_sync_webhook_relationships_should_raise_when_lock_not_acquired(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    app = _app(id="app-1", tenant_id="tenant-1", created_by="user-1")
    workflow = _workflow(walk_nodes=lambda _node_type: [("node-1", {})])

    lock = MagicMock()
    lock.acquire.return_value = False
    monkeypatch.setattr(service_module.redis_client, "get", MagicMock(return_value=None))
    monkeypatch.setattr(service_module.redis_client, "lock", MagicMock(return_value=lock))

    # Act / Assert
    with pytest.raises(RuntimeError, match="Failed to acquire lock"):
        WebhookService.sync_webhook_relationships(app, workflow)


def test_sync_webhook_relationships_should_create_missing_records_and_delete_stale_records(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    app = _app(id="app-1", tenant_id="tenant-1", created_by="user-1")
    workflow = _workflow(walk_nodes=lambda _node_type: [("node-new", {})])

    class _WorkflowWebhookTrigger:
        app_id = "app_id"
        tenant_id = "tenant_id"
        webhook_id = "webhook_id"
        node_id = "node_id"

        def __init__(self, app_id: str, tenant_id: str, node_id: str, webhook_id: str, created_by: str) -> None:
            self.id = None
            self.app_id = app_id
            self.tenant_id = tenant_id
            self.node_id = node_id
            self.webhook_id = webhook_id
            self.created_by = created_by

    class _Select:
        def where(self, *args: Any, **kwargs: Any) -> "_Select":
            return self

    class _Session:
        def __init__(self) -> None:
            self.added: list[Any] = []
            self.deleted: list[Any] = []
            self.commit_count = 0
            self.existing_records = [SimpleNamespace(node_id="node-stale")]

        def scalars(self, _stmt: Any) -> Any:
            return SimpleNamespace(all=lambda: self.existing_records)

        def add(self, obj: Any) -> None:
            self.added.append(obj)

        def flush(self) -> None:
            for idx, obj in enumerate(self.added, start=1):
                if obj.id is None:
                    obj.id = f"rec-{idx}"

        def commit(self) -> None:
            self.commit_count += 1

        def delete(self, obj: Any) -> None:
            self.deleted.append(obj)

    lock = MagicMock()
    lock.acquire.return_value = True
    lock.release.return_value = None

    fake_session = _Session()

    monkeypatch.setattr(service_module, "WorkflowWebhookTrigger", _WorkflowWebhookTrigger)
    monkeypatch.setattr(service_module, "select", MagicMock(return_value=_Select()))
    monkeypatch.setattr(service_module.redis_client, "get", MagicMock(return_value=None))
    monkeypatch.setattr(service_module.redis_client, "lock", MagicMock(return_value=lock))
    redis_set_mock = MagicMock()
    redis_delete_mock = MagicMock()
    monkeypatch.setattr(service_module.redis_client, "set", redis_set_mock)
    monkeypatch.setattr(service_module.redis_client, "delete", redis_delete_mock)
    monkeypatch.setattr(WebhookService, "generate_webhook_id", MagicMock(return_value="generated-webhook-id"))
    _patch_session(monkeypatch, fake_session)

    # Act
    WebhookService.sync_webhook_relationships(app, workflow)

    # Assert
    assert len(fake_session.added) == 1
    assert len(fake_session.deleted) == 1
    assert fake_session.commit_count == 2
    redis_set_mock.assert_called_once()
    redis_delete_mock.assert_called_once()
    lock.release.assert_called_once()


def test_sync_webhook_relationships_should_log_when_lock_release_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    app = _app(id="app-1", tenant_id="tenant-1", created_by="user-1")
    workflow = _workflow(walk_nodes=lambda _node_type: [])

    class _Select:
        def where(self, *args: Any, **kwargs: Any) -> "_Select":
            return self

    class _Session:
        def scalars(self, _stmt: Any) -> Any:
            return SimpleNamespace(all=lambda: [])

        def commit(self) -> None:
            return None

    lock = MagicMock()
    lock.acquire.return_value = True
    lock.release.side_effect = RuntimeError("release failed")

    logger_exception_mock = MagicMock()

    monkeypatch.setattr(service_module, "select", MagicMock(return_value=_Select()))
    monkeypatch.setattr(service_module.redis_client, "get", MagicMock(return_value=None))
    monkeypatch.setattr(service_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(service_module.logger, "exception", logger_exception_mock)
    _patch_session(monkeypatch, _Session())

    # Act
    WebhookService.sync_webhook_relationships(app, workflow)

    # Assert
    assert logger_exception_mock.call_count == 1


def test_generate_webhook_response_should_fallback_when_response_body_is_not_json() -> None:
    # Arrange
    node_config = {"data": {"status_code": 200, "response_body": "{bad-json"}}

    # Act
    body, status = WebhookService.generate_webhook_response(node_config)

    # Assert
    assert status == 200
    assert "message" in body


def test_generate_webhook_id_should_return_24_character_identifier() -> None:
    # Arrange

    # Act
    webhook_id = WebhookService.generate_webhook_id()

    # Assert
    assert isinstance(webhook_id, str)
    assert len(webhook_id) == 24


def test_sanitize_key_should_return_original_value_for_non_string_input() -> None:
    # Arrange

    # Act
    result = WebhookService._sanitize_key(123)  # type: ignore[arg-type]

    # Assert
    assert result == 123
