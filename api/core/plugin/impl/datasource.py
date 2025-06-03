from collections.abc import Mapping
from typing import Any

from core.datasource.entities.datasource_entities import (
    GetOnlineDocumentPageContentRequest,
    GetOnlineDocumentPageContentResponse,
    GetOnlineDocumentPagesResponse,
    GetWebsiteCrawlResponse,
)
from core.plugin.entities.plugin import GenericProviderID, ToolProviderID
from core.plugin.entities.plugin_daemon import (
    PluginBasicBooleanResponse,
    PluginDatasourceProviderEntity,
)
from core.plugin.impl.base import BasePluginClient


class PluginDatasourceManager(BasePluginClient):
    def fetch_datasource_providers(self, tenant_id: str) -> list[PluginDatasourceProviderEntity]:
        """
        Fetch datasource providers for the given tenant.
        """

        def transformer(json_response: dict[str, Any]) -> dict:
            if json_response.get("data"):
                for provider in json_response.get("data", []):
                    declaration = provider.get("declaration", {}) or {}
                    provider_name = declaration.get("identity", {}).get("name")
                    for datasource in declaration.get("datasources", []):
                        datasource["identity"]["provider"] = provider_name

            return json_response

        response = self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/management/datasources",
            list[PluginDatasourceProviderEntity],
            params={"page": 1, "page_size": 256},
            transformer=transformer,
        )
        local_file_datasource_provider = PluginDatasourceProviderEntity(**self._get_local_file_datasource_provider())

        return [local_file_datasource_provider] + response

    def fetch_datasource_provider(self, tenant_id: str, provider: str) -> PluginDatasourceProviderEntity:
        """
        Fetch datasource provider for the given tenant and plugin.
        """
        if provider == "langgenius/file/file":
            return PluginDatasourceProviderEntity(**self._get_local_file_datasource_provider())

        tool_provider_id = ToolProviderID(provider)

        def transformer(json_response: dict[str, Any]) -> dict:
            data = json_response.get("data")
            if data:
                for datasource in data.get("declaration", {}).get("datasources", []):
                    datasource["identity"]["provider"] = tool_provider_id.provider_name

            return json_response

        response = self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/management/datasource",
            PluginDatasourceProviderEntity,
            params={"provider": tool_provider_id.provider_name, "plugin_id": tool_provider_id.plugin_id},
            transformer=transformer,
        )

        response.declaration.identity.name = f"{response.plugin_id}/{response.declaration.identity.name}"

        # override the provider name for each tool to plugin_id/provider_name
        for datasource in response.declaration.datasources:
            datasource.identity.provider = response.declaration.identity.name

        return response

    def get_website_crawl(
        self,
        tenant_id: str,
        user_id: str,
        datasource_provider: str,
        datasource_name: str,
        credentials: dict[str, Any],
        datasource_parameters: Mapping[str, Any],
        provider_type: str,
    ) -> GetWebsiteCrawlResponse:
        """
        Invoke the datasource with the given tenant, user, plugin, provider, name, credentials and parameters.
        """

        datasource_provider_id = GenericProviderID(datasource_provider)

        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/datasource/get_website_crawl",
            GetWebsiteCrawlResponse,
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
        for resp in response:
            return resp

        raise Exception("No response from plugin daemon")

    def get_online_document_pages(
        self,
        tenant_id: str,
        user_id: str,
        datasource_provider: str,
        datasource_name: str,
        credentials: dict[str, Any],
        datasource_parameters: Mapping[str, Any],
        provider_type: str,
    ) -> GetOnlineDocumentPagesResponse:
        """
        Invoke the datasource with the given tenant, user, plugin, provider, name, credentials and parameters.
        """

        datasource_provider_id = GenericProviderID(datasource_provider)

        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/datasource/get_online_document_pages",
            GetOnlineDocumentPagesResponse,
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
        for resp in response:
            return resp

        raise Exception("No response from plugin daemon")

    def get_online_document_page_content(
        self,
        tenant_id: str,
        user_id: str,
        datasource_provider: str,
        datasource_name: str,
        credentials: dict[str, Any],
        datasource_parameters: GetOnlineDocumentPageContentRequest,
        provider_type: str,
    ) -> GetOnlineDocumentPageContentResponse:
        """
        Invoke the datasource with the given tenant, user, plugin, provider, name, credentials and parameters.
        """

        datasource_provider_id = GenericProviderID(datasource_provider)

        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/datasource/get_online_document_page_content",
            GetOnlineDocumentPageContentResponse,
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
        for resp in response:
            return resp

        raise Exception("No response from plugin daemon")

    def validate_provider_credentials(
        self, tenant_id: str, user_id: str, provider: str, credentials: dict[str, Any]
    ) -> bool:
        """
        validate the credentials of the provider
        """
        datasource_provider_id = GenericProviderID(provider)

        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/datasource/validate_credentials",
            PluginBasicBooleanResponse,
            data={
                "user_id": user_id,
                "data": {
                    "provider": datasource_provider_id.provider_name,
                    "credentials": credentials,
                },
            },
            headers={
                "X-Plugin-ID": datasource_provider_id.plugin_id,
                "Content-Type": "application/json",
            },
        )

        for resp in response:
            return resp.result

        return False

    def _get_local_file_datasource_provider(self) -> dict[str, Any]:
        return {
            "id": "langgenius/file/file",
            "plugin_id": "langgenius/file/file",
            "provider": "langgenius",
            "plugin_unique_identifier": "langgenius/file:0.0.1@dify",
            "declaration": {
                "identity": {
                    "author": "langgenius",
                    "name": "langgenius/file/file",
                    "label": {"zh_Hans": "File", "en_US": "File", "pt_BR": "File", "ja_JP": "File"},
                    "icon": "https://cloud.dify.ai/console/api/workspaces/current/plugin/icon?tenant_id=945b4365-9d99-48c1-8c47-90593fe8b9c9&filename=13d9312f6b1352d3939b90a5257de58ff3cd619d5be4f5b266ff0298935ac328.svg",
                    "description": {"zh_Hans": "File", "en_US": "File", "pt_BR": "File", "ja_JP": "File"},
                },
                "credentials_schema": [],
                "provider_type": "local_file",
                "datasources": [
                    {
                        "identity": {
                            "author": "langgenius",
                            "name": "upload-file",
                            "provider": "langgenius",
                            "label": {"zh_Hans": "File", "en_US": "File", "pt_BR": "File", "ja_JP": "File"},
                        },
                        "parameters": [],
                        "description": {"zh_Hans": "File", "en_US": "File", "pt_BR": "File", "ja_JP": "File"},
                    }
                ],
            },
        }
