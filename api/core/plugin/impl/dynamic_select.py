from collections.abc import Mapping
from typing import Any

from core.plugin.entities.plugin_daemon import PluginDynamicSelectOptionsResponse
from core.plugin.impl.base import BasePluginClient
from models.provider_ids import GenericProviderID


class DynamicSelectClient(BasePluginClient):
    def fetch_dynamic_select_options(
        self,
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        action: str,
        credentials: Mapping[str, Any],
        credential_type: str,
        parameter: str,
        *,
        parameter_values: Mapping[str, Any] | None = None,
    ) -> PluginDynamicSelectOptionsResponse:
        """
        Fetch dynamic select options for a plugin parameter.
        """
        payload: dict[str, Any] = {
            "provider": GenericProviderID(provider).provider_name,
            "credentials": credentials,
            "credential_type": credential_type,
            "provider_action": action,
            "parameter": parameter,
        }
        if parameter_values:
            payload["parameter_values"] = dict(parameter_values)

        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/dynamic_select/fetch_parameter_options",
            PluginDynamicSelectOptionsResponse,
            data={
                "user_id": user_id,
                "data": payload,
            },
            headers={
                "X-Plugin-ID": plugin_id,
                "Content-Type": "application/json",
            },
        )

        for options in response:
            return options

        raise ValueError(f"Plugin service returned no options for parameter '{parameter}' in provider '{provider}'")
