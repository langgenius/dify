from collections.abc import Generator
from typing import Any

from core.plugin.entities.plugin_daemon import PluginBasicBooleanResponse, PluginToolProviderEntity
from core.plugin.manager.base import BasePluginManager
from core.tools.entities.tool_entities import ToolInvokeMessage


class PluginToolManager(BasePluginManager):
    def _split_provider(self, provider: str) -> tuple[str, str]:
        """
        split the provider to plugin_id and provider_name

        provider follows format: plugin_id/provider_name
        """
        if "/" in provider:
            parts = provider.split("/", -1)
            if len(parts) >= 2:
                return "/".join(parts[:-1]), parts[-1]
            raise ValueError(f"invalid provider format: {provider}")

        raise ValueError(f"invalid provider format: {provider}")

    def fetch_tool_providers(self, tenant_id: str) -> list[PluginToolProviderEntity]:
        """
        Fetch tool providers for the given tenant.
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

        for provider in response:
            provider.declaration.identity.name = f"{provider.plugin_id}/{provider.declaration.identity.name}"

            # override the provider name for each tool to plugin_id/provider_name
            for tool in provider.declaration.tools:
                tool.identity.provider = provider.declaration.identity.name

        return response

    def fetch_tool_provider(self, tenant_id: str, provider: str) -> PluginToolProviderEntity:
        """
        Fetch tool provider for the given tenant and plugin.
        """
        plugin_id, provider_name = self._split_provider(provider)

        def transformer(json_response: dict[str, Any]) -> dict:
            for tool in json_response.get("data", {}).get("declaration", {}).get("tools", []):
                tool["identity"]["provider"] = provider_name

            return json_response

        response = self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/management/tool",
            PluginToolProviderEntity,
            params={"provider": provider_name, "plugin_id": plugin_id},
            transformer=transformer,
        )

        response.declaration.identity.name = f"{response.plugin_id}/{response.declaration.identity.name}"

        # override the provider name for each tool to plugin_id/provider_name
        for tool in response.declaration.tools:
            tool.identity.provider = response.declaration.identity.name

        return response

    def invoke(
        self,
        tenant_id: str,
        user_id: str,
        tool_provider: str,
        tool_name: str,
        credentials: dict[str, Any],
        tool_parameters: dict[str, Any],
    ) -> Generator[ToolInvokeMessage, None, None]:
        """
        Invoke the tool with the given tenant, user, plugin, provider, name, credentials and parameters.
        """

        plugin_id, provider_name = self._split_provider(tool_provider)

        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/tool/invoke",
            ToolInvokeMessage,
            data={
                "user_id": user_id,
                "data": {
                    "provider": provider_name,
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
        self, tenant_id: str, user_id: str, provider: str, credentials: dict[str, Any]
    ) -> bool:
        """
        validate the credentials of the provider
        """
        plugin_id, provider_name = self._split_provider(provider)

        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/tool/validate_credentials",
            PluginBasicBooleanResponse,
            data={
                "user_id": user_id,
                "data": {
                    "provider": provider_name,
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
