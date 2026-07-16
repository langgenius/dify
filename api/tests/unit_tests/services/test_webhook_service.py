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
                WebhookService.trigger_webwork_execution(
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
