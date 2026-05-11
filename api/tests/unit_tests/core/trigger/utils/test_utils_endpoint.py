"""Tests for core.trigger.utils.endpoint — URL generation."""

from __future__ import annotations

from unittest.mock import patch

from yarl import URL

from core.trigger.utils import endpoint


class TestGeneratePluginTriggerEndpointUrl:
    def test_builds_correct_url(self):
        with patch.object(endpoint, "base_url", URL("https://api.example.com")):
            url = endpoint.generate_plugin_trigger_endpoint_url("endpoint-123")

        assert url == "https://api.example.com/triggers/plugin/endpoint-123"


class TestGenerateWebhookTriggerEndpoint:
    def test_non_debug_url(self):
        with patch.object(endpoint, "base_url", URL("https://api.example.com")):
            url = endpoint.generate_webhook_trigger_endpoint("sub-456", debug=False)

        assert url == "https://api.example.com/triggers/webhook/sub-456"

    def test_debug_url(self):
        with patch.object(endpoint, "base_url", URL("https://api.example.com")):
            url = endpoint.generate_webhook_trigger_endpoint("sub-456", debug=True)

        assert url == "https://api.example.com/triggers/webhook-debug/sub-456"
