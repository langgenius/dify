from collections.abc import Generator
from typing import Any, Optional

from pydantic import BaseModel

from core.plugin.entities.plugin import GenericProviderID, ToolProviderID
from core.plugin.entities.plugin_daemon import PluginBasicBooleanResponse, PluginToolProviderEntity
from core.plugin.manager.base import BasePluginManager
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolParameter


class PluginDatasourceManager(BasePluginManager):
    def fetch_datasource_providers(self, tenant_id: str) -> list[PluginToolProviderEntity]:
        """
        Fetch datasource providers for the given tenant.
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
            f"plugin/{tenant_id}/management/datasources",
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

    def fetch_datasource_provider(self, tenant_id: str, provider: str) -> PluginToolProviderEntity:
        """
        Fetch datasource provider for the given tenant and plugin.
        """
        tool_provider_id = ToolProviderID(provider)

        def transformer(json_response: dict[str, Any]) -> dict:
            data = json_response.get("data")
            if data:
                for datasource in data.get("declaration", {}).get("datasources", []):
                    datasource["identity"]["provider"] = tool_provider_id.provider_name

            return json_response

        response = self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/management/datasources",
            PluginToolProviderEntity,
            params={"provider": tool_provider_id.provider_name, "plugin_id": tool_provider_id.plugin_id},
            transformer=transformer,
        )

        response.declaration.identity.name = f"{response.plugin_id}/{response.declaration.identity.name}"

        # override the provider name for each tool to plugin_id/provider_name
        for tool in response.declaration.tools:
            tool.identity.provider = response.declaration.identity.name

        return response

    def invoke_first_step(
        self,
        tenant_id: str,
        user_id: str,
        datasource_provider: str,
        datasource_name: str,
        credentials: dict[str, Any],
        datasource_parameters: dict[str, Any],
    ) -> Generator[ToolInvokeMessage, None, None]:
        """
        Invoke the datasource with the given tenant, user, plugin, provider, name, credentials and parameters.
        """

        datasource_provider_id = GenericProviderID(datasource_provider)

        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/datasource/invoke_first_step",
            ToolInvokeMessage,
            data={
                "user_id": user_id,
                "data": {
                    "provider": datasource_provider_id.provider_name,
                    "datasource": datasource_name,
                    "credentials": credentials,
                    "datasource_parameters": datasource_parameters,
                },
            },
            headers={
                "X-Plugin-ID": datasource_provider_id.plugin_id,
                "Content-Type": "application/json",
            },
        )
        return response
    
    def invoke_second_step(
        self,
        tenant_id: str,
        user_id: str,
        datasource_provider: str,
        datasource_name: str,
        credentials: dict[str, Any],
        datasource_parameters: dict[str, Any],    
        ) -> Generator[ToolInvokeMessage, None, None]:
        """
        Invoke the datasource with the given tenant, user, plugin, provider, name, credentials and parameters.
        """

        datasource_provider_id = GenericProviderID(datasource_provider)

        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/datasource/invoke_second_step",
            ToolInvokeMessage,
            data={
                "user_id": user_id,
                "data": {
                    "provider": datasource_provider_id.provider_name,
                    "datasource": datasource_name,
                    "credentials": credentials,
                    "datasource_parameters": datasource_parameters,
                },
            },
            headers={
                "X-Plugin-ID": datasource_provider_id.plugin_id,
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
        tool_provider_id = GenericProviderID(provider)

        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/tool/validate_credentials",
            PluginBasicBooleanResponse,
            data={
                "user_id": user_id,
                "data": {
                    "provider": tool_provider_id.provider_name,
                    "credentials": credentials,
                },
            },
            headers={
                "X-Plugin-ID": tool_provider_id.plugin_id,
                "Content-Type": "application/json",
            },
        )

        for resp in response:
            return resp.result

        return False

    def get_runtime_parameters(
        self,
        tenant_id: str,
        user_id: str,
        provider: str,
        credentials: dict[str, Any],
        datasource: str,
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> list[ToolParameter]:
        """
        get the runtime parameters of the datasource
        """
        datasource_provider_id = GenericProviderID(provider)

        class RuntimeParametersResponse(BaseModel):
            parameters: list[ToolParameter]

        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/datasource/get_runtime_parameters",
            RuntimeParametersResponse,
            data={
                "user_id": user_id,
                "conversation_id": conversation_id,
                "app_id": app_id,
                "message_id": message_id,
                "data": {
                    "provider": datasource_provider_id.provider_name,
                    "datasource": datasource,
                    "credentials": credentials,
                },
            },
            headers={
                "X-Plugin-ID": datasource_provider_id.plugin_id,
                "Content-Type": "application/json",
            },
        )

        for resp in response:
            return resp.parameters

        return []
