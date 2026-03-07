import types
from unittest.mock import patch

import pytest
from werkzeug.exceptions import NotFound, RequestEntityTooLarge

import controllers.trigger.webhook as module


@pytest.fixture(autouse=True)
def mock_request():
    module.request = types.SimpleNamespace(
        method="POST",
        headers={"x-test": "1"},
        args={"a": "b"},
    )


@pytest.fixture(autouse=True)
def mock_jsonify():
    module.jsonify = lambda payload: payload


class DummyWebhookTrigger:
    webhook_id = "wh-1"
    tenant_id = "tenant-1"
    app_id = "app-1"
    node_id = "node-1"


class TestPrepareWebhookExecution:
    @patch.object(module.WebhookService, "get_webhook_trigger_and_workflow")
    @patch.object(module.WebhookService, "extract_and_validate_webhook_data")
    def test_prepare_success(self, mock_extract, mock_get):
        mock_get.return_value = ("trigger", "workflow", "node_config")
        mock_extract.return_value = {"data": "ok"}

        result = module._prepare_webhook_execution("wh-1")

        assert result == ("trigger", "workflow", "node_config", {"data": "ok"}, None)

    @patch.object(module.WebhookService, "get_webhook_trigger_and_workflow")
    @patch.object(module.WebhookService, "extract_and_validate_webhook_data", side_effect=ValueError("bad"))
    def test_prepare_validation_error(self, mock_extract, mock_get):
        mock_get.return_value = ("trigger", "workflow", "node_config")

        trigger, workflow, node_config, webhook_data, error = module._prepare_webhook_execution("wh-1")

        assert error == "bad"
        assert webhook_data["method"] == "POST"


class TestHandleWebhook:
    @patch.object(module.WebhookService, "get_webhook_trigger_and_workflow")
    @patch.object(module.WebhookService, "extract_and_validate_webhook_data")
    @patch.object(module.WebhookService, "trigger_workflow_execution")
    @patch.object(module.WebhookService, "generate_webhook_response")
    def test_success(
        self,
        mock_generate,
        mock_trigger,
        mock_extract,
        mock_get,
    ):
        mock_get.return_value = (DummyWebhookTrigger(), "workflow", "node_config")
        mock_extract.return_value = {"input": "x"}
        mock_generate.return_value = ({"ok": True}, 200)

        response, status = module.handle_webhook("wh-1")

        assert status == 200
        assert response["ok"] is True
        mock_trigger.assert_called_once()

    @patch.object(module.WebhookService, "get_webhook_trigger_and_workflow")
    @patch.object(module.WebhookService, "extract_and_validate_webhook_data", side_effect=ValueError("bad"))
    def test_bad_request(self, mock_extract, mock_get):
        mock_get.return_value = (DummyWebhookTrigger(), "workflow", "node_config")

        response, status = module.handle_webhook("wh-1")

        assert status == 400
        assert response["error"] == "Bad Request"

    @patch.object(module.WebhookService, "get_webhook_trigger_and_workflow", side_effect=ValueError("missing"))
    def test_value_error_not_found(self, mock_get):
        with pytest.raises(NotFound):
            module.handle_webhook("wh-1")

    @patch.object(module.WebhookService, "get_webhook_trigger_and_workflow", side_effect=RequestEntityTooLarge())
    def test_request_entity_too_large(self, mock_get):
        with pytest.raises(RequestEntityTooLarge):
            module.handle_webhook("wh-1")

    @patch.object(module.WebhookService, "get_webhook_trigger_and_workflow", side_effect=Exception("boom"))
    def test_internal_error(self, mock_get):
        response, status = module.handle_webhook("wh-1")

        assert status == 500
        assert response["error"] == "Internal server error"


class TestHandleWebhookDebug:
    @patch.object(module.WebhookService, "get_webhook_trigger_and_workflow")
    @patch.object(module.WebhookService, "extract_and_validate_webhook_data")
    @patch.object(module.WebhookService, "build_workflow_inputs", return_value={"x": 1})
    @patch.object(module.TriggerDebugEventBus, "dispatch")
    @patch.object(module.WebhookService, "generate_webhook_response")
    def test_debug_success(
        self,
        mock_generate,
        mock_dispatch,
        mock_build_inputs,
        mock_extract,
        mock_get,
    ):
        mock_get.return_value = (DummyWebhookTrigger(), None, "node_config")
        mock_extract.return_value = {"method": "POST"}
        mock_generate.return_value = ({"ok": True}, 200)

        response, status = module.handle_webhook_debug("wh-1")

        assert status == 200
        assert response["ok"] is True
        mock_dispatch.assert_called_once()

    @patch.object(module.WebhookService, "get_webhook_trigger_and_workflow")
    @patch.object(module.WebhookService, "extract_and_validate_webhook_data", side_effect=ValueError("bad"))
    def test_debug_bad_request(self, mock_extract, mock_get):
        mock_get.return_value = (DummyWebhookTrigger(), None, "node_config")

        response, status = module.handle_webhook_debug("wh-1")

        assert status == 400
        assert response["error"] == "Bad Request"

    @patch.object(module.WebhookService, "get_webhook_trigger_and_workflow", side_effect=ValueError("missing"))
    def test_debug_not_found(self, mock_get):
        with pytest.raises(NotFound):
            module.handle_webhook_debug("wh-1")

    @patch.object(module.WebhookService, "get_webhook_trigger_and_workflow", side_effect=RequestEntityTooLarge())
    def test_debug_request_entity_too_large(self, mock_get):
        with pytest.raises(RequestEntityTooLarge):
            module.handle_webhook_debug("wh-1")

    @patch.object(module.WebhookService, "get_webhook_trigger_and_workflow", side_effect=Exception("boom"))
    def test_debug_internal_error(self, mock_get):
        response, status = module.handle_webhook_debug("wh-1")

        assert status == 500
        assert response["error"] == "Internal server error"
