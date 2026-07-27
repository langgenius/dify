import inspect
from unittest.mock import call, patch

import pytest
from flask import Flask
from pydantic import ValidationError

from controllers.inner_api.workspace.plugin_model_providers import (
    EnterprisePluginModelProvidersCacheInvalidate,
    InvalidatePluginModelProvidersCachePayload,
)


class TestInvalidatePluginModelProvidersCachePayload:
    def test_valid_payload(self):
        payload = InvalidatePluginModelProvidersCachePayload.model_validate(
            {"tenant_ids": ["tenant-alpha", "tenant-beta"]}
        )
        assert payload.tenant_ids == ["tenant-alpha", "tenant-beta"]

    def test_missing_tenant_ids_defaults_to_empty(self):
        payload = InvalidatePluginModelProvidersCachePayload.model_validate({})
        assert payload.tenant_ids == []

    def test_unknown_field_rejected(self):
        with pytest.raises(ValidationError):
            InvalidatePluginModelProvidersCachePayload.model_validate({"tenant_ids": ["tenant-alpha"], "generation": 7})


class TestEnterprisePluginModelProvidersCacheInvalidate:
    @pytest.fixture
    def api_instance(self):
        return EnterprisePluginModelProvidersCacheInvalidate()

    def _post(self, api_instance, app: Flask, payload):
        unwrapped_post = inspect.unwrap(api_instance.post)
        with app.test_request_context():
            with patch("controllers.inner_api.workspace.plugin_model_providers.inner_api_ns") as mock_ns:
                mock_ns.payload = payload
                return unwrapped_post(api_instance)

    @patch("controllers.inner_api.workspace.plugin_model_providers.PluginService")
    def test_post_invalidates_once_per_tenant(self, mock_plugin_service, api_instance, app: Flask):
        result = self._post(api_instance, app, {"tenant_ids": ["tenant-alpha", "tenant-beta"]})

        assert result == ({"result": "success"}, 200)
        assert mock_plugin_service.invalidate_plugin_model_providers_cache.call_args_list == [
            call("tenant-alpha"),
            call("tenant-beta"),
        ]

    @patch("controllers.inner_api.workspace.plugin_model_providers.PluginService")
    def test_post_with_empty_list_is_a_no_op(self, mock_plugin_service, api_instance, app: Flask):
        result = self._post(api_instance, app, {"tenant_ids": []})

        assert result == ({"result": "success"}, 200)
        mock_plugin_service.invalidate_plugin_model_providers_cache.assert_not_called()

    @patch("controllers.inner_api.workspace.plugin_model_providers.PluginService")
    def test_post_with_missing_payload_is_a_no_op(self, mock_plugin_service, api_instance, app: Flask):
        result = self._post(api_instance, app, None)

        assert result == ({"result": "success"}, 200)
        mock_plugin_service.invalidate_plugin_model_providers_cache.assert_not_called()
