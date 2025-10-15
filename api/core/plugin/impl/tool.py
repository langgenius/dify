from collections.abc import Generator
from typing import Any

from pydantic import BaseModel

from core.plugin.entities.plugin_daemon import (
    PluginBasicBooleanResponse,
    PluginToolProviderEntity,
)
from core.plugin.impl.base import BasePluginClient
from core.plugin.utils.chunk_merger import merge_blob_chunks
from core.schemas.resolver import resolve_dify_schema_refs
from core.tools.entities.tool_entities import CredentialType, ToolInvokeMessage, ToolParameter
from models.provider_ids import GenericProviderID, ToolProviderID


class PluginToolManager(BasePluginClient):
    def fetch_tool_providers(self, tenant_id: str) -> list[PluginToolProviderEntity]:
        """
        Fetch tool providers for the given tenant.
        """

        def transformer(json_response: dict[str, Any]):
            for provider in json_response.get("data", []):
                declaration = provider.get("declaration", {}) or {}
                provider_name = declaration.get("identity", {}).get("name")
                for tool in declaration.get("tools", []):
                    tool["identity"]["provider"] = provider_name
                    # resolve refs
                    if tool.get("output_schema"):
                        tool["output_schema"] = resolve_dify_schema_refs(tool["output_schema"])

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
        tool_provider_id = ToolProviderID(provider)

        def transformer(json_response: dict[str, Any]):
            data = json_response.get("data")
            if data:
                for tool in data.get("declaration", {}).get("tools", []):
                    tool["identity"]["provider"] = tool_provider_id.provider_name
                    # resolve refs
                    if tool.get("output_schema"):
                        tool["output_schema"] = resolve_dify_schema_refs(tool["output_schema"])

            return json_response

        response = self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/management/tool",
            PluginToolProviderEntity,
            params={"provider": tool_provider_id.provider_name, "plugin_id": tool_provider_id.plugin_id},
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
        credential_type: CredentialType,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        """
        Invoke the tool with the given tenant, user, plugin, provider, name, credentials and parameters.
        """

        tool_provider_id = GenericProviderID(tool_provider)

        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/tool/invoke",
            ToolInvokeMessage,
            data={
                "user_id": user_id,
                "conversation_id": conversation_id,
                "app_id": app_id,
                "message_id": message_id,
                "data": {
                    "provider": tool_provider_id.provider_name,
                    "tool": tool_name,
                    "credentials": credentials,
                    "credential_type": credential_type,
                    "tool_parameters": tool_parameters,
                },
            },
            headers={
                "X-Plugin-ID": tool_provider_id.plugin_id,
                "Content-Type": "application/json",
            },
        )

        return merge_blob_chunks(response)

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

    def validate_datasource_credentials(
        self, tenant_id: str, user_id: str, provider: str, credentials: dict[str, Any]
    ) -> bool:
        """
        validate the credentials of the datasource
        """
        tool_provider_id = GenericProviderID(provider)

        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/datasource/validate_credentials",
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
        tool: str,
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> list[ToolParameter]:
        """
        get the runtime parameters of the tool
        """
        tool_provider_id = GenericProviderID(provider)

        class RuntimeParametersResponse(BaseModel):
            parameters: list[ToolParameter]

        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/tool/get_runtime_parameters",
            RuntimeParametersResponse,
            data={
                "user_id": user_id,
                "conversation_id": conversation_id,
                "app_id": app_id,
                "message_id": message_id,
                "data": {
                    "provider": tool_provider_id.provider_name,
                    "tool": tool,
                    "credentials": credentials,
                },
            },
            headers={
                "X-Plugin-ID": tool_provider_id.plugin_id,
                "Content-Type": "application/json",
            },
        )

        for resp in response:
            return resp.parameters

        return []
