from collections.abc import Mapping
from typing import Any

from core.plugin.entities.plugin import GenericProviderID
from core.plugin.entities.plugin_daemon import PluginDynamicSelectOptionsResponse
from core.plugin.impl.base import BasePluginClient


class DynamicSelectClient(BasePluginClient):
    def fetch_dynamic_select_options(
        self,
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        action: str,
        credentials: Mapping[str, Any],
        parameter: str,
    ) -> PluginDynamicSelectOptionsResponse:
        """
        Fetch dynamic select options for a plugin parameter.
        """
        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/dynamic_select/fetch_parameter_options",
            PluginDynamicSelectOptionsResponse,
            data={
                "user_id": user_id,
                "data": {
                    "provider": GenericProviderID(provider).provider_name,
                    "credentials": credentials,
                    "provider_action": action,
                    "parameter": parameter,
                },
            },
            headers={
                "X-Plugin-ID": plugin_id,
                "Content-Type": "application/json",
            },
        )

        for options in response:
            return options

        raise ValueError(f"Plugin service returned no options for parameter '{parameter}' in provider '{provider}'")
