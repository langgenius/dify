from collections.abc import Generator
from typing import Any

from core.plugin.entities.plugin_daemon import PluginBasicBooleanResponse, PluginToolProviderEntity
from core.plugin.manager.base import BasePluginManager
from core.tools.entities.tool_entities import ToolInvokeMessage


class PluginToolManager(BasePluginManager):
    def fetch_tool_providers(self, tenant_id: str) -> list[PluginToolProviderEntity]:
        """
        Fetch tool providers for the given asset.
        """

        def transformer(json_response: dict[str, Any]) -> dict:
            for provider in json_response.get("data", []):
                declaration = provider.get("declaration", {}) or {}
                provider_name = declaration.get("identity", {}).get("name")
                for tool in declaration.get("tools", []):
                    tool["identity"]["provider"] = provider_name

            return json_response

        response = self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/management/tools",
            list[PluginToolProviderEntity],
            params={"page": 1, "page_size": 256},
            transformer=transformer,
        )
        return response

    def invoke(
        self,
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        tool_provider: str,
        tool_name: str,
        credentials: dict[str, Any],
        tool_parameters: dict[str, Any],
    ) -> Generator[ToolInvokeMessage, None, None]:
        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/tool/invoke",
            ToolInvokeMessage,
            data={
                "user_id": user_id,
                "data": {
                    "provider": tool_provider,
                    "tool": tool_name,
                    "credentials": credentials,
                    "tool_parameters": tool_parameters,
                },
            },
            headers={
                "X-Plugin-ID": plugin_id,
                "Content-Type": "application/json",
            },
        )
        return response

    def validate_provider_credentials(
        self, tenant_id: str, user_id: str, plugin_id: str, provider: str, credentials: dict[str, Any]
    ) -> bool:
        """
        validate the credentials of the provider
        """
        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/tool/validate_credentials",
            PluginBasicBooleanResponse,
            data={
                "user_id": user_id,
                "data": {
                    "provider": provider,
                    "credentials": credentials,
                },
            },
            headers={
                "X-Plugin-ID": plugin_id,
                "Content-Type": "application/json",
            },
        )

        for resp in response:
            return resp.result

        return False
