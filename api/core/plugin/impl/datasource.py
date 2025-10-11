from collections.abc import Generator, Mapping
from typing import Any

from core.datasource.entities.datasource_entities import (
    DatasourceMessage,
    GetOnlineDocumentPageContentRequest,
    OnlineDocumentPagesMessage,
    OnlineDriveBrowseFilesRequest,
    OnlineDriveBrowseFilesResponse,
    OnlineDriveDownloadFileRequest,
    WebsiteCrawlMessage,
)
from core.plugin.entities.plugin_daemon import (
    PluginBasicBooleanResponse,
    PluginDatasourceProviderEntity,
)
from core.plugin.impl.base import BasePluginClient
from core.schemas.resolver import resolve_dify_schema_refs
from models.provider_ids import DatasourceProviderID, GenericProviderID
from services.tools.tools_transform_service import ToolTransformService


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
                        # resolve refs
                        if datasource.get("output_schema"):
                            datasource["output_schema"] = resolve_dify_schema_refs(datasource["output_schema"])

            return json_response

        response = self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/management/datasources",
            list[PluginDatasourceProviderEntity],
            params={"page": 1, "page_size": 256},
            transformer=transformer,
        )
        local_file_datasource_provider = PluginDatasourceProviderEntity.model_validate(
            self._get_local_file_datasource_provider()
        )

        for provider in response:
            ToolTransformService.repack_provider(tenant_id=tenant_id, provider=provider)
        all_response = [local_file_datasource_provider] + response

        for provider in all_response:
            provider.declaration.identity.name = f"{provider.plugin_id}/{provider.declaration.identity.name}"

            # override the provider name for each tool to plugin_id/provider_name
            for tool in provider.declaration.datasources:
                tool.identity.provider = provider.declaration.identity.name

        return all_response

    def fetch_installed_datasource_providers(self, tenant_id: str) -> list[PluginDatasourceProviderEntity]:
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
                        # resolve refs
                        if datasource.get("output_schema"):
                            datasource["output_schema"] = resolve_dify_schema_refs(datasource["output_schema"])

            return json_response

        response = self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/management/datasources",
            list[PluginDatasourceProviderEntity],
            params={"page": 1, "page_size": 256},
            transformer=transformer,
        )

        for provider in response:
            ToolTransformService.repack_provider(tenant_id=tenant_id, provider=provider)

        for provider in response:
            provider.declaration.identity.name = f"{provider.plugin_id}/{provider.declaration.identity.name}"

            # override the provider name for each tool to plugin_id/provider_name
            for tool in provider.declaration.datasources:
                tool.identity.provider = provider.declaration.identity.name

        return response

    def fetch_datasource_provider(self, tenant_id: str, provider_id: str) -> PluginDatasourceProviderEntity:
        """
        Fetch datasource provider for the given tenant and plugin.
        """
        if provider_id == "langgenius/file/file":
            return PluginDatasourceProviderEntity.model_validate(self._get_local_file_datasource_provider())

        tool_provider_id = DatasourceProviderID(provider_id)

        def transformer(json_response: dict[str, Any]) -> dict:
            data = json_response.get("data")
            if data:
                for datasource in data.get("declaration", {}).get("datasources", []):
                    datasource["identity"]["provider"] = tool_provider_id.provider_name
                    if datasource.get("output_schema"):
                        datasource["output_schema"] = resolve_dify_schema_refs(datasource["output_schema"])
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
    ) -> Generator[WebsiteCrawlMessage, None, None]:
        """
        Invoke the datasource with the given tenant, user, plugin, provider, name, credentials and parameters.
        """

        datasource_provider_id = GenericProviderID(datasource_provider)

        return self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/datasource/get_website_crawl",
            WebsiteCrawlMessage,
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

    def get_online_document_pages(
        self,
        tenant_id: str,
        user_id: str,
        datasource_provider: str,
        datasource_name: str,
        credentials: dict[str, Any],
        datasource_parameters: Mapping[str, Any],
        provider_type: str,
    ) -> Generator[OnlineDocumentPagesMessage, None, None]:
        """
        Invoke the datasource with the given tenant, user, plugin, provider, name, credentials and parameters.
        """

        datasource_provider_id = GenericProviderID(datasource_provider)

        return self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/datasource/get_online_document_pages",
            OnlineDocumentPagesMessage,
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

    def get_online_document_page_content(
        self,
        tenant_id: str,
        user_id: str,
        datasource_provider: str,
        datasource_name: str,
        credentials: dict[str, Any],
        datasource_parameters: GetOnlineDocumentPageContentRequest,
        provider_type: str,
    ) -> Generator[DatasourceMessage, None, None]:
        """
        Invoke the datasource with the given tenant, user, plugin, provider, name, credentials and parameters.
        """

        datasource_provider_id = GenericProviderID(datasource_provider)

        return self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/datasource/get_online_document_page_content",
            DatasourceMessage,
            data={
                "user_id": user_id,
                "data": {
                    "provider": datasource_provider_id.provider_name,
                    "datasource": datasource_name,
                    "credentials": credentials,
                    "page": datasource_parameters.model_dump(),
                },
            },
            headers={
                "X-Plugin-ID": datasource_provider_id.plugin_id,
                "Content-Type": "application/json",
            },
        )

    def online_drive_browse_files(
        self,
        tenant_id: str,
        user_id: str,
        datasource_provider: str,
        datasource_name: str,
        credentials: dict[str, Any],
        request: OnlineDriveBrowseFilesRequest,
        provider_type: str,
    ) -> Generator[OnlineDriveBrowseFilesResponse, None, None]:
        """
        Invoke the datasource with the given tenant, user, plugin, provider, name, credentials and parameters.
        """

        datasource_provider_id = GenericProviderID(datasource_provider)

        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/datasource/online_drive_browse_files",
            OnlineDriveBrowseFilesResponse,
            data={
                "user_id": user_id,
                "data": {
                    "provider": datasource_provider_id.provider_name,
                    "datasource": datasource_name,
                    "credentials": credentials,
                    "request": request.model_dump(),
                },
            },
            headers={
                "X-Plugin-ID": datasource_provider_id.plugin_id,
                "Content-Type": "application/json",
            },
        )
        yield from response

    def online_drive_download_file(
        self,
        tenant_id: str,
        user_id: str,
        datasource_provider: str,
        datasource_name: str,
        credentials: dict[str, Any],
        request: OnlineDriveDownloadFileRequest,
        provider_type: str,
    ) -> Generator[DatasourceMessage, None, None]:
        """
        Invoke the datasource with the given tenant, user, plugin, provider, name, credentials and parameters.
        """

        datasource_provider_id = GenericProviderID(datasource_provider)

        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/datasource/online_drive_download_file",
            DatasourceMessage,
            data={
                "user_id": user_id,
                "data": {
                    "provider": datasource_provider_id.provider_name,
                    "datasource": datasource_name,
                    "credentials": credentials,
                    "request": request.model_dump(),
                },
            },
            headers={
                "X-Plugin-ID": datasource_provider_id.plugin_id,
                "Content-Type": "application/json",
            },
        )
        yield from response

    def validate_provider_credentials(
        self, tenant_id: str, user_id: str, provider: str, plugin_id: str, credentials: dict[str, Any]
    ) -> bool:
        """
        validate the credentials of the provider
        """
        # datasource_provider_id = GenericProviderID(provider_id)

        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/datasource/validate_credentials",
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

    def _get_local_file_datasource_provider(self) -> dict[str, Any]:
        return {
            "id": "langgenius/file/file",
            "plugin_id": "langgenius/file",
            "provider": "file",
            "plugin_unique_identifier": "langgenius/file:0.0.1@dify",
            "declaration": {
                "identity": {
                    "author": "langgenius",
                    "name": "file",
                    "label": {"zh_Hans": "File", "en_US": "File", "pt_BR": "File", "ja_JP": "File"},
                    "icon": "https://assets.dify.ai/images/File%20Upload.svg",
                    "description": {"zh_Hans": "File", "en_US": "File", "pt_BR": "File", "ja_JP": "File"},
                },
                "credentials_schema": [],
                "provider_type": "local_file",
                "datasources": [
                    {
                        "identity": {
                            "author": "langgenius",
                            "name": "upload-file",
                            "provider": "file",
                            "label": {"zh_Hans": "File", "en_US": "File", "pt_BR": "File", "ja_JP": "File"},
                        },
                        "parameters": [],
                        "description": {"zh_Hans": "File", "en_US": "File", "pt_BR": "File", "ja_JP": "File"},
                    }
                ],
            },
        }
