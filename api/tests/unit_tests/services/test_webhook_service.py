import logging
from io import BytesIO
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.datastructures import FileStorage

from services.errors.app import QuotaExceededError
from services.trigger.webhook_service import WebhookService


class TestWebhookServiceUnit:
    """Unit tests for WebhookService focusing on business logic without database dependencies."""

    def test_trigger_workflow_execution_propagates_quota_error_without_error_log(
        self, caplog: pytest.LogCaptureFixture
    ):
        webhook_trigger = MagicMock(
            webhook_id="webhook-123",
            tenant_id="tenant-123",
            app_id="app-123",
            node_id="node-123",
        )
        workflow = MagicMock(id="workflow-123")
        quota_charge = MagicMock()
        quota_error = QuotaExceededError(feature="workflow", tenant_id="tenant-123", required=1)

        caplog.set_level(logging.INFO)
        with (
            patch(
                "services.trigger.webhook_service.EndUserService.get_or_create_end_user_by_type",
                return_value=MagicMock(id="end-user-123"),
            ),
            patch("services.trigger.webhook_service.QuotaService.reserve", return_value=quota_charge),
            patch("services.trigger.webhook_service.db"),
            patch("services.trigger.webhook_service.Session"),
            patch(
                "services.trigger.webhook_service.AsyncWorkflowService.trigger_workflow_async",
                side_effect=quota_error,
            ),
        ):
            with pytest.raises(QuotaExceededError) as exc_info:
                WebhookService.trigger_workflow_execution(
                    webhook_trigger,
                    {"body": {}, "headers": {}, "query_params": {}, "files": {}, "method": "POST"},
                    workflow,
                )

        assert exc_info.value is quota_error
        quota_charge.refund.assert_called_once_with()

        # Verify logs using caplog instead of mock_log
        assert len(caplog.records) == 1
        assert caplog.records[0].levelno == logging.INFO
        assert caplog.records[0].message == (
            "Tenant tenant-123 quota exceeded for feature workflow, "
            "skipping webhook trigger webhook-123"
        )

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

            with patch("services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger):
                result = WebhookService._get_webhook_trigger("webhook-123")
                assert result == webhook_trigger

    def test_extract_webhook_data_multipart(self):
        """Test webhook data extraction from multipart form-data request."""
        app = Flask(__name__)
        data = {"field1": "value1", "field2": "value2"}
        file_storage = FileStorage(stream=BytesIO(b"test content"), filename="test.txt", content_type="text/plain")

        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "multipart/form-data"},
            data={"field1": "value1", "field2": "value2", "file": file_storage},
        ):
            webhook_trigger = MagicMock()
            webhook_trigger.supported_http_methods = ["POST"]

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                result = WebhookService._get_webhook_trigger("webhook-123")
                assert result == webhook_trigger

    def test_extract_webhook_data_form_urlencoded(self):
        """Test webhook data extraction from URL-encoded form request."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data="field1=value1&field2=value2",
        ):
            webhook_trigger = MagicMock()
            webhook_trigger.supported_http_methods = ["POST"]

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                result = WebhookService._get_webhook_trigger("webhook-123")
                assert result == webhook_trigger

    def test_extract_webhook_data_unsupported_content_type(self):
        """Test webhook data extraction with unsupported Content-Type."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "application/xml"},
            data="<root><item>value</item></root>",
        ):
            webhook_trigger = MagicMock()
            webhook_trigger.supported_http_methods = ["POST"]

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                result = WebhookService._get_webhook_trigger("webhook-123")
                assert result == webhook_trigger

    def test_get_webhook_trigger_returns_none_when_not_found(self):
        """Test _get_webhook_trigger returns None when trigger not found."""
        with patch("services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=None):
            result = WebhookService._get_webhook_trigger("nonexistent")
            assert result is None

    def test_get_webhook_trigger_raises_when_method_not_allowed(self):
        """Test _get_webhook_trigger raises when HTTP method not allowed."""
        app = Flask(__name__)

        with app.test_request_context("/webhook", method="GET"):
            webhook_trigger = MagicMock()
            webhook_trigger.supported_http_methods = ["POST"]

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                with pytest.raises(Exception):
                    WebhookService._get_webhook_trigger("webhook-123")

    def test_validate_webhook_request_with_invalid_signature(self):
        """Test webhook request validation with invalid signature."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={
                "Content-Type": "application/json",
                "X-Hub-Signature-256": "sha256=invalidsignature",
            },
            json={"message": "hello"},
        ):
            webhook_trigger = MagicMock()
            webhook_trigger.secret = "my_secret"

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                with pytest.raises(Exception):
                    WebhookService._get_webhook_trigger("webhook-123")

    def test_validate_webhook_request_with_valid_signature(self):
        """Test webhook request validation with valid signature."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={
                "Content-Type": "application/json",
                "X-Hub-Signature-256": "sha256=valid_signature",
            },
            json={"message": "hello"},
        ):
            webhook_trigger = MagicMock()
            webhook_trigger.secret = "my_secret"

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                result = WebhookService._get_webhook_trigger("webhook-123")
                assert result == webhook_trigger

    def test_validate_webhook_request_without_signature(self):
        """Test webhook request validation without signature header."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "application/json"},
            json={"message": "hello"},
        ):
            webhook_trigger = MagicMock()
            webhook_trigger.secret = None

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                result = WebhookService._get_webhook_trigger("webhook-123")
                assert result == webhook_trigger

    def test_validate_webhook_request_with_empty_body(self):
        """Test webhook request validation with empty body."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={
                "Content-Type": "application/json",
                "X-Hub-Signature-256": "sha256=signature_for_empty_body",
            },
            data=b"",
        ):
            webhook_trigger = MagicMock()
            webhook_trigger.secret = "my_secret"

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                with pytest.raises(Exception):
                    WebhookService._get_webhook_trigger("webhook-123")

    def test_webhook_data_extraction_with_files(self):
        """Test webhook data extraction when files are uploaded."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "multipart/form-data"},
            data={"file": (BytesIO(b"test content"), "test.txt")},
        ):
            webhook_trigger = MagicMock()
            webhook_trigger.supported_http_methods = ["POST"]

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                result = WebhookService._get_webhook_trigger("webhook-123")
                assert result == webhook_trigger

    def test_http_method_not_allowed(self):
        """Test webhook trigger raises when HTTP method is not supported."""
        app = Flask(__name__)

        with app.test_request_context("/webhook", method="DELETE"):
            webhook_trigger = MagicMock()
            webhook_trigger.supported_http_methods = ["POST", "GET"]

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                with pytest.raises(Exception):
                    WebhookService._get_webhook_trigger("webhook-123")

    def test_http_method_allowed(self):
        """Test webhook trigger works when HTTP method is supported."""
        app = Flask(__name__)

        with app.test_request_context("/webhook", method="GET"):
            webhook_trigger = MagicMock()
            webhook_trigger.supported_http_methods = ["GET", "POST"]

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                result = WebhookService._get_webhook_trigger("webhook-123")
                assert result == webhook_trigger

    def test_missing_content_type(self):
        """Test webhook data extraction without Content-Type header."""
        app = Flask(__name__)

        with app.test_request_context("/webhook", method="POST", data="raw data"):
            webhook_trigger = MagicMock()
            webhook_trigger.supported_http_methods = ["POST"]

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                result = WebhookService._get_webhook_trigger("webhook-123")
                assert result == webhook_trigger

    def test_webhook_request_with_query_params(self):
        """Test webhook data extraction with query parameters."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="GET",
            query_string="param1=value1&param2=value2",
        ):
            webhook_trigger = MagicMock()
            webhook_trigger.supported_http_methods = ["GET"]

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                result = WebhookService._get_webhook_trigger("webhook-123")
                assert result == webhook_trigger

    def test_webhook_request_with_headers(self):
        """Test webhook data extraction with custom headers."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="GET",
            headers={"X-Custom-Header": "custom_value"},
        ):
            webhook_trigger = MagicMock()
            webhook_trigger.supported_http_methods = ["GET"]

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                result = WebhookService._get_webhook_trigger("webhook-123")
                assert result == webhook_trigger

    def test_webhook_request_with_none_trigger(self):
        """Test webhook request when trigger is None."""
        with patch("services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=None):
            result = WebhookService._get_webhook_trigger("webhook-123")
            assert result is None

    def test_webhook_request_with_empty_method_list(self):
        """Test webhook request when supported methods list is empty."""
        app = Flask(__name__)

        with app.test_request_context("/webhook", method="POST"):
            webhook_trigger = MagicMock()
            webhook_trigger.supported_http_methods = []

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                with pytest.raises(Exception):
                    WebhookService._get_webhook_trigger("webhook-123")

    def test_webhook_request_with_multiple_query_params(self):
        """Test webhook data extraction with multiple query parameters."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="GET",
            query_string="a=1&b=2&c=3",
        ):
            webhook_trigger = MagicMock()
            webhook_trigger.supported_http_methods = ["GET"]

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                result = WebhookService._get_webhook_trigger("webhook-123")
                assert result == webhook_trigger

    def test_webhook_request_with_no_query_params(self):
        """Test webhook data extraction without query parameters."""
        app = Flask(__name__)

        with app.test_request_context("/webhook", method="GET"):
            webhook_trigger = MagicMock()
            webhook_trigger.supported_http_methods = ["GET"]

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                result = WebhookService._get_webhook_trigger("webhook-123")
                assert result == webhook_trigger

    def test_webhook_request_with_invalid_content_type(self):
        """Test webhook data extraction with invalid Content-Type."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "invalid/content-type"},
            data="raw data",
        ):
            webhook_trigger = MagicMock()
            webhook_trigger.supported_http_methods = ["POST"]

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                result = WebhookService._get_webhook_trigger("webhook-123")
                assert result == webhook_trigger

    def test_webhook_request_with_no_content_type(self):
        """Test webhook data extraction with no Content-Type header."""
        app = Flask(__name__)

        with app.test_request_context("/webhook", method="POST", data="raw"):
            webhook_trigger = MagicMock()
            webhook_trigger.supported_http_methods = ["POST"]

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                result = WebhookService._get_webhook_trigger("webhook-123")
                assert result == webhook_trigger

    def test_webhook_request_with_empty_body_in_post(self):
        """Test webhook request with empty body in POST request."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "application/json"},
            data=b"",
        ):
            webhook_trigger = MagicMock()
            webhook_trigger.supported_http_methods = ["POST"]

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                result = WebhookService._get_webhook_trigger("webhook-123")
                assert result == webhook_trigger

    def test_webhook_request_with_large_body(self):
        """Test webhook request with large body."""
        app = Flask(__name__)
        large_body = "x" * 100000

        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "text/plain"},
            data=large_body,
        ):
            webhook_trigger = MagicMock()
            webhook_trigger.supported_http_methods = ["POST"]

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                result = WebhookService._get_webhook_trigger("webhook-123")
                assert result == webhook_trigger

    def test_webhook_request_with_special_chars_in_body(self):
        """Test webhook request with special characters in body."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "text/plain"},
            data="Hello\nWorld\r\nTest\tTab",
        ):
            webhook_trigger = MagicMock()
            webhook_trigger.supported_http_methods = ["POST"]

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                result = WebhookService._get_webhook_trigger("webhook-123")
                assert result == webhook_trigger

    def test_webhook_request_with_unicode_body(self):
        """Test webhook request with Unicode body."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "text/plain; charset=utf-8"},
            data="Hello 世界 🌍",
        ):
            webhook_trigger = MagicMock()
            webhook_trigger.supported_http_methods = ["POST"]

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                result = WebhookService._get_webhook_trigger("webhook-123")
                assert result == webhook_trigger

    def test_webhook_request_with_none_content_type(self):
        """Test webhook request with None as Content-Type."""
        app = Flask(__name__)

        with app.test_request_context("/webhook", method="POST"):
            webhook_trigger = MagicMock()
            webhook_trigger.supported_http_methods = ["POST"]

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                result = WebhookService._get_webhook_trigger("webhook-123")
                assert result == webhook_trigger

    def test_webhook_request_with_array_body(self):
        """Test webhook request with array in request body."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "application/json"},
            json=["item1", "item2", "item3"],
        ):
            webhook_trigger = MagicMock()
            webhook_trigger.supported_http_methods = ["POST"]

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                result = WebhookService._get_webhook_trigger("webhook-123")
                assert result == webhook_trigger

    def test_webhook_request_with_nested_json(self):
        """Test webhook request with nested JSON in body."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "application/json"},
            json={"outer": {"inner": "value"}},
        ):
            webhook_trigger = MagicMock()
            webhook_trigger.supported_http_methods = ["POST"]

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                result = WebhookService._get_webhook_trigger("webhook-123")
                assert result == webhook_trigger

class TestWebhookServiceIntegration:
    """Integration tests for WebhookService with minimal mocking."""

    def test_full_webhook_workflow_with_mocked_db(self):
        """Test the complete webhook workflow with mocked database."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "application/json"},
            json={"message": "hello"},
        ):
            webhook_trigger = MagicMock()
            webhook_trigger.webhook_id = "webhook-123"
            webhook_trigger.tenant_id = "tenant-123"
            webhook_trigger.app_id = "app-123"
            webhook_trigger.node_id = "node-123"
            webhook_trigger.supported_http_methods = ["POST"]

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                with patch("services.trigger.webhook_service.WebhookService.trigger_workflow_execution") as mock_trigger:
                    result = WebhookService._get_webhook_trigger("webhook-123")
                    assert result == webhook_trigger

    def test_webhook_workflow_without_db(self):
        """Test webhook workflow without database access."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "application/json"},
            json={"message": "hello"},
        ):
            webhook_trigger = MagicMock()
            webhook_trigger.webhook_id = "webhook-123"
            webhook_trigger.tenant_id = "tenant-123"
            webhook_trigger.app_id = "app-123"
            webhook_trigger.node_id = "node-123"
            webhook_trigger.supported_http_methods = ["POST"]

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                result = WebhookService._get_webhook_trigger("webhook-123")
                assert result == webhook_trigger

    def test_webhook_trigger_with_invalid_data(self):
        """Test webhook trigger with invalid input data."""
        with pytest.raises(Exception):
            WebhookService._get_webhook_trigger("")

    def test_webhook_trigger_without_context(self):
        """Test webhook trigger outside of request context."""
        with pytest.raises(Exception):
            WebhookService._get_webhook_trigger("webhook-123")

    def test_webhook_trigger_with_multiple_files(self):
        """Test webhook trigger with multiple file uploads."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "multipart/form-data"},
            data={
                "file1": (BytesIO(b"content1"), "file1.txt"),
                "file2": (BytesIO(b"content2"), "file2.txt"),
            },
        ):
            webhook_trigger = MagicMock()
            webhook_trigger.supported_http_methods = ["POST"]

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                result = WebhookService._get_webhook_trigger("webhook-123")
                assert result == webhook_trigger

    def test_webhook_trigger_with_file_and_fields(self):
        """Test webhook trigger with file and form fields."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "multipart/form-data"},
            data={
                "field1": "value1",
                "file": (BytesIO(b"content"), "file.txt"),
            },
        ):
            webhook_trigger = MagicMock()
            webhook_trigger.supported_http_methods = ["POST"]

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                result = WebhookService._get_webhook_trigger("webhook-123")
                assert result == webhook_trigger

    def test_webhook_trigger_with_none_file(self):
        """Test webhook trigger with None file storage."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "multipart/form-data"},
            data={"file": None},
        ):
            webhook_trigger = MagicMock()
            webhook_trigger.supported_http_methods = ["POST"]

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                result = WebhookService._get_webhook_trigger("webhook-123")
                assert result == webhook_trigger

    def test_webhook_trigger_with_empty_file_list(self):
        """Test webhook trigger with empty file list."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "multipart/form-data"},
            data={},
        ):
            webhook_trigger = MagicMock()
            webhook_trigger.supported_http_methods = ["POST"]

            with patch(
                "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=webhook_trigger
            ):
                result = WebhookService._get_webhook_trigger("webhook-123")
                assert result == webhook_trigger

    def test_get_webhook_trigger_with_empty_id(self):
        """Test get_webhook_trigger with empty ID."""
        with pytest.raises(Exception):
            WebhookService._get_webhook_trigger("")

    def test_get_webhook_trigger_with_special_chars_id(self):
        """Test get_webhook_trigger with special characters in ID."""
        with patch("services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=None):
            result = WebhookService._get_webhook_trigger("test@#$%")
            assert result is None

    def test_get_webhook_trigger_with_long_id(self):
        """Test get_webhook_trigger with very long ID."""
        long_id = "a" * 1000
        with patch("services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=None):
            result = WebhookService._get_webhook_trigger(long_id)
            assert result is None

    def test_get_webhook_trigger_with_whitespace_id(self):
        """Test get_webhook_trigger with whitespace-only ID."""
        with patch("services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=None):
            result = WebhookService._get_webhook_trigger("   ")
            assert result is None

    def test_get_webhook_trigger_with_different_case(self):
        """Test get_webhook_trigger with different case in ID."""
        with patch("services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=None):
            result = WebhookService._get_webhook_trigger("WEBHOOK-123")
            assert result is None

    def test_get_webhook_trigger_with_number_id(self):
        """Test get_webhook_trigger with numeric ID."""
        with patch("services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=None):
            result = WebhookService._get_webhook_trigger("12345")
            assert result is None

    def test_get_webhook_trigger_with_uuid(self):
        """Test get_webhook_trigger with UUID-like ID."""
        with patch("services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=None):
            result = WebhookService._get_webhook_trigger("550e8400-e29b-41d4-a716-446655440000")
            assert result is None

    def test_prepare_webhook_execution_with_debug_mode(self):
        """Test prepare_webhook_execution in debug mode without DB access."""
        from services.trigger.webhook_service import _prepare_webhook_execution

        mock_trigger = MagicMock()
        mock_workflow = MagicMock()
        mock_config = MagicMock()
        mock_data = MagicMock()

        with patch(
            "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=mock_trigger
        ):
            with patch(
                "services.trigger.webhook_service.Workflow.get_by_id", return_value=mock_workflow
            ):
                with patch(
                    "services.trigger.webhook_service.WebhookConfig.get_by_webhook_id",
                    return_value=mock_config,
                ):
                    with patch(
                        "services.trigger.webhook_service.WebhookData.get_by_webhook_id",
                        return_value=mock_data,
                    ):
                        result = _prepare_webhook_execution("test_webhook", is_debug=True)
                        assert result == (mock_trigger, mock_workflow, mock_config, mock_data, None)

    def test_prepare_webhook_execution_without_debug_mode(self):
        """Test prepare_webhook_execution without debug mode with DB access."""
        from services.trigger.webhook_service import _prepare_webhook_execution

        mock_trigger = MagicMock()
        mock_workflow = MagicMock()
        mock_config = MagicMock()
        mock_data = MagicMock()

        with patch(
            "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=mock_trigger
        ):
            with patch(
                "services.trigger.webhook_service.Workflow.get_by_id", return_value=mock_workflow
            ):
                with patch(
                    "services.trigger.webhook_service.WebhookConfig.get_by_webhook_id",
                    return_value=mock_config,
                ):
                    with patch(
                        "services.trigger.webhook_service.WebhookData.get_by_webhook_id",
                        return_value=mock_data,
                    ):
                        result = _prepare_webhook_execution("test_webhook", is_debug=False)
                        assert result == (mock_trigger, mock_workflow, mock_config, mock_data, None)

    def test_prepare_webhook_execution_with_none_results(self):
        """Test prepare_webhook_execution when some results are None."""
        from services.trigger.webhook_service import _prepare_webhook_execution

        with patch(
            "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=None
        ):
            result = _prepare_webhook_execution("nonexistent_webhook", is_debug=True)
            assert result is None

    def test_prepare_webhook_execution_with_all_mock_data(self):
        """Test prepare_webhook_execution with all mocked data."""
        from services.trigger.webhook_service import _prepare_webhook_execution

        mock_trigger = MagicMock()
        mock_workflow = MagicMock()
        mock_config = MagicMock()
        mock_data = MagicMock()

        with patch(
            "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=mock_trigger
        ):
            with patch(
                "services.trigger.webhook_service.Workflow.get_by_id", return_value=mock_workflow
            ):
                with patch(
                    "services.trigger.webhook_service.WebhookConfig.get_by_webhook_id",
                    return_value=mock_config,
                ):
                    with patch(
                        "services.trigger.webhook_service.WebhookData.get_by_webhook_id",
                        return_value=mock_data,
                    ):
                        result = _prepare_webhook_execution("test_webhook", is_debug=True)
                        assert result == (mock_trigger, mock_workflow, mock_config, mock_data, None)

    def test_prepare_webhook_execution_with_exception(self):
        """Test prepare_webhook_execution when exception occurs."""
        from services.trigger.webhook_service import _prepare_webhook_execution

        with patch(
            "services.trigger.webhook_service.WebhookTrigger.get_by_id",
            side_effect=Exception("DB error"),
        ):
            with pytest.raises(Exception):
                _prepare_webhook_execution("test_webhook", is_debug=True)

    def test_prepare_webhook_execution_with_missing_trigger(self):
        """Test prepare_webhook_execution with missing trigger."""
        from services.trigger.webhook_service import _prepare_webhook_execution

        with patch(
            "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=None
        ):
            result = _prepare_webhook_execution("test_webhook", is_debug=True)
            assert result is None

    def test_prepare_webhook_execution_with_missing_workflow(self):
        """Test prepare_webhook_execution with missing workflow."""
        from services.trigger.webhook_service import _prepare_webhook_execution

        mock_trigger = MagicMock()

        with patch(
            "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=mock_trigger
        ):
            with patch(
                "services.trigger.webhook_service.Workflow.get_by_id", return_value=None
            ):
                result = _prepare_webhook_execution("test_webhook", is_debug=True)
                assert result is None

    def test_prepare_webhook_execution_with_missing_config(self):
        """Test prepare_webhook_execution with missing config."""
        from services.trigger.webhook_service import _prepare_webhook_execution

        mock_trigger = MagicMock()
        mock_workflow = MagicMock()

        with patch(
            "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=mock_trigger
        ):
            with patch(
                "services.trigger.webhook_service.Workflow.get_by_id", return_value=mock_workflow
            ):
                with patch(
                    "services.trigger.webhook_service.WebhookConfig.get_by_webhook_id",
                    return_value=None,
                ):
                    result = _prepare_webhook_execution("test_webhook", is_debug=True)
                    assert result is None

    def test_prepare_webhook_execution_with_missing_data(self):
        """Test prepare_webhook_execution with missing data."""
        from services.trigger.webhook_service import _prepare_webhook_execution

        mock_trigger = MagicMock()
        mock_workflow = MagicMock()
        mock_config = MagicMock()

        with patch(
            "services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=mock_trigger
        ):
            with patch(
                "services.trigger.webhook_service.Workflow.get_by_id", return_value=mock_workflow
            ):
                with patch(
                    "services.trigger.webhook_service.WebhookConfig.get_by_webhook_id",
                    return_value=mock_config,
                ):
                    with patch(
                        "services.trigger.webhook_service.WebhookData.get_by_webhook_id",
                        return_value=None,
                    ):
                        with patch(
                            "services.trigger.webhook_service.WebhookData.create",
                            return_value=MagicMock(),
                        ):
                            result = _prepare_webhook_execution("test_webhook", is_debug=True)
                            assert result is not None

    def test_prepare_webhook_execution_multiple_calls(self):
        """Test prepare_webhook_execution with multiple sequential calls."""
        from services.trigger.webhook_service import _prepare_webhook_execution

        mock_trigger = MagicMock()
        mock_workflow = MagicMock()
        mock_config = MagicMock()
        mock_data = MagicMock()

        patches = [
            patch("services.trigger.webhook_service.WebhookTrigger.get_by_id", return_value=mock_trigger),
            patch("services.trigger.webhook_service.Workflow.get_by_id", return_value=mock_workflow),
            patch("services.trigger.webhook_service.WebhookConfig.get_by_webhook_id", return_value=mock_config),
            patch("services.trigger.webhook_service.WebhookData.get_by_webhook_id", return_value=mock_data),
        ]

        for _ in range(3):
            with (
                patches[0],
                patches[1],
                patches[2],
                patches[3],
            ):
                result = _prepare_webhook_execution("test_webhook", is_debug=True)
                assert result == (mock_trigger, mock_workflow, mock_config, mock_data, None)