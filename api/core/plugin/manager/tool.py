from collections.abc import Generator
from typing import Any

from core.plugin.entities.plugin_daemon import PluginToolProviderEntity
from core.plugin.manager.base import BasePluginManager
from core.tools.entities.tool_entities import ToolInvokeMessage


class PluginToolManager(BasePluginManager):
    def fetch_tool_providers(self, tenant_id: str) -> list[PluginToolProviderEntity]:
        """
        Fetch tool providers for the given asset.
        """
        response = self._request_with_plugin_daemon_response(
            "GET", f"plugin/{tenant_id}/tools", list[PluginToolProviderEntity], params={"page": 1, "page_size": 256}
        )
        return response

    def invoke(
        self,
        tenant_id: str,
        user_id: str,
        plugin_unique_identifier: str,
        tool_provider: str,
        tool_name: str,
        credentials: dict[str, Any],
        tool_parameters: dict[str, Any],
    ) -> Generator[ToolInvokeMessage, None, None]:
        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/tool/invoke",
            ToolInvokeMessage,
            data={
                "plugin_unique_identifier": plugin_unique_identifier,
                "user_id": user_id,
                "data": {
                    "provider": tool_provider,
                    "tool": tool_name,
                    "credentials": credentials,
                    "tool_parameters": tool_parameters,
                },
            },
        )
        return response

    def validate_provider_credentials(
        self, tenant_id: str, user_id: str, plugin_unique_identifier: str, provider: str, credentials: dict[str, Any]
    ) -> bool:
        """
        validate the credentials of the provider
        """
        response = self._request_with_plugin_daemon_response(
            "POST",
            f"plugin/{tenant_id}/tool/validate_credentials",
            bool,
            data={
                "plugin_unique_identifier": plugin_unique_identifier,
                "user_id": user_id,
                "data": {
                    "provider": provider,
                    "credentials": credentials,
                },
            },
        )
        return response
