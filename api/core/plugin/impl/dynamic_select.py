from collections.abc import Mapping, Sequence
from typing import Any

from core.plugin.entities.parameters import PluginParameterOption
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
    ) -> Sequence[PluginParameterOption]:
        """
        Fetch dynamic select options for a plugin parameter.
        """
        return self._request_with_plugin_daemon_response(
            "POST",
            f"plugin/{tenant_id}/dispatch/dynamic_select/fetch_parameter_options",
            list[PluginParameterOption],
            data={
                "user_id": user_id,
                "data": {
                    "provider": provider,
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
