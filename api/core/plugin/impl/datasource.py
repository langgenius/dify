from collections.abc import Callable, Generator, Iterable, Mapping
from typing import Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict

from core.datasource.entities.datasource_entities import (
    DatasourceMessage,
    GetOnlineDocumentPageContentRequest,
    OnlineDocumentPagesMessage,
    OnlineDriveBrowseFilesRequest,
    OnlineDriveBrowseFilesResponse,
    OnlineDriveDownloadFileRequest,
    OnlineDriveDownloadMessage,
    WebsiteCrawlMessage,
)
from core.plugin.entities.plugin_daemon import (
    PluginBasicBooleanResponse,
    PluginDatasourceProviderEntity,
)
from core.plugin.impl.base import BasePluginClient
from core.plugin.plugin_service import PluginService
from core.schemas.resolver import SchemaType, resolve_dify_schema_refs
from models.provider_ids import DatasourceProviderID, GenericProviderID
from services.plugin.dispatch_identity import plugin_dispatch_headers
from services.tools.tools_transform_service import ToolTransformService


class PluginDatasourcePayloadModel(BaseModel):
    """Validate declared fields and preserve daemon-owned extras for downstream parsing."""

    model_config = ConfigDict(extra="allow")


class PluginProviderIdentityPayload(PluginDatasourcePayloadModel):
    # A provider the daemon declared without a name keeps ``None``, which the
    # manager copies onto every datasource of that provider.
    name: str | None = None


class PluginDatasourceIdentityPayload(PluginDatasourcePayloadModel):
    # The manager overwrites this with the provider name, which can be missing.
    provider: str | None = None


class PluginDatasourceEntryPayload(PluginDatasourcePayloadModel):
    """A single datasource entry, including the refs the manager rewrites."""

    identity: PluginDatasourceIdentityPayload
    output_schema: SchemaType = None


class PluginDatasourceDeclarationPayload(PluginDatasourcePayloadModel):
    """The declaration block of a datasource provider payload."""

    identity: PluginProviderIdentityPayload | None = None
    datasources: list[PluginDatasourceEntryPayload] | None = None


class PluginDatasourceProviderPayload(PluginDatasourcePayloadModel):
    """A datasource provider as the plugin daemon sends it in its JSON payload."""

    declaration: PluginDatasourceDeclarationPayload | None = None


class PluginDatasourceListPayload(PluginDatasourcePayloadModel):
    """The ``data`` section of a daemon list response, as the manager rewrites it."""

    data: list[PluginDatasourceProviderPayload] | None = None


class DatasourceProviderListRequester(Protocol):
    """Request and transform a tenant's raw datasource-provider list response."""

    def request(
        self,
        *,
        tenant_id: str,
        transformer: Callable[[dict[str, Any]], PluginDatasourceListPayload],
    ) -> list[PluginDatasourceProviderEntity]:
        """Request and transform one tenant's provider list. Inputs: Tenant ID and the daemon-response transformer.
        Preconditions: Tenant ID is non-empty; transformer accepts daemon JSON.
        Result/effects: Returns provider entities; requester applies transformer to raw JSON.
        Failure: Request and transformation exceptions propagate.
        """
        ...


class DatasourceSchemaRefResolver(Protocol):
    """Resolve schema references found in datasource provider payloads."""

    def __call__(self, schema: SchemaType) -> SchemaType:
        """Resolve Dify schema references. Inputs: A schema value accepted by the Dify resolver.
        Preconditions: The value satisfies ``SchemaType``.
        Result/effects: Returns expanded schema; a registry may be consulted.
        Failure: Schema-resolution errors propagate.
        """
        ...


class PluginDatasourceSinglePayload(PluginDatasourcePayloadModel):
    """The ``data`` section of a daemon single-provider response."""

    data: PluginDatasourceProviderPayload | None = None


class OnlineDriveDownloadStreamRequester(Protocol):
    """Request one online-drive download stream from the plugin daemon."""

    def request_stream(
        self,
        method: Literal["POST"],
        path: str,
        response_model: type[OnlineDriveDownloadMessage],
        *,
        headers: dict[str, str],
        data: dict[str, Any],
    ) -> Iterable[DatasourceMessage]:
        """Inputs: A POST route, download response model, headers, and JSON request data.
        Preconditions: The supplied request targets the online-drive download endpoint.
        Result/effects: Returns a lazy stream of typed datasource messages without buffering.
        Failure: Transport, parsing, and iteration errors propagate unchanged.
        """
        ...


class PluginDatasourceManager(BasePluginClient):
    def __init__(
        self,
        *,
        plugin_unique_identifier: str | None = None,
        get_plugin_icon_url: Callable[[str, str], str] = PluginService.get_plugin_icon_url,
        datasource_provider_list_requester: DatasourceProviderListRequester | None = None,
        schema_ref_resolver: DatasourceSchemaRefResolver | None = None,
        online_drive_download_stream_requester: OnlineDriveDownloadStreamRequester | None = None,
    ) -> None:
        """Inputs: Identifier is None or non-empty; injected callbacks implement their typed protocols;
        absent optional dependencies select production defaults.
        Preconditions: A provider-list requester applies the transformer; the download requester returns typed messages.
        Result/effects: Initializes the base client and stores dependencies without invoking them.
        Failure: Empty ID preserves BasePluginClient validation; selected dependency errors propagate.
        """
        super().__init__(plugin_unique_identifier=plugin_unique_identifier)
        self._get_plugin_icon_url = get_plugin_icon_url
        self._datasource_provider_list_requester = datasource_provider_list_requester
        self._schema_ref_resolver = schema_ref_resolver
        self._online_drive_download_stream_requester = online_drive_download_stream_requester

    def _resolve_schema_refs(self, schema: SchemaType) -> SchemaType:
        """Resolve one datasource output schema. Inputs: A schema value accepted by the Dify resolver.
        Preconditions: The value satisfies ``SchemaType``.
        Result/effects: Uses the injected resolver or production resolver at call time.
        Failure: Selected resolver errors propagate unchanged.
        """
        if self._schema_ref_resolver is not None:
            return self._schema_ref_resolver(schema)
        return resolve_dify_schema_refs(schema)

    def _request_datasource_provider_list(
        self,
        tenant_id: str,
        transformer: Callable[[dict[str, Any]], PluginDatasourceListPayload],
    ) -> list[PluginDatasourceProviderEntity]:
        """Inputs: Non-empty tenant ID and a typed daemon-response transformer.
        Preconditions: Transformer accepts the daemon JSON object.
        Result/effects: Uses the injected requester or existing GET path, entity type, and pagination.
        Failure: Request, parsing, and transformation errors propagate.
        """
        if self._datasource_provider_list_requester is not None:
            return self._datasource_provider_list_requester.request(tenant_id=tenant_id, transformer=transformer)

        return self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/management/datasources",
            list[PluginDatasourceProviderEntity],
            params={"page": 1, "page_size": 256},
            transformer=transformer,
        )

    def _transform_datasource_provider_list_response(
        self, json_response: dict[str, Any]
    ) -> PluginDatasourceListPayload:
        """Inputs: A daemon JSON object accepted by ``PluginDatasourceListPayload``.
        Preconditions: Declared payload fields satisfy the Pydantic model.
        Result/effects: Normalizes provider names and resolves truthy output schemas.
        Failure: Validation and schema-resolver errors propagate unchanged.
        """
        payload = PluginDatasourceListPayload.model_validate(json_response)
        for provider in payload.data or []:
            declaration = provider.declaration
            if declaration is not None:
                identity = declaration.identity
                provider_name = identity.name if identity is not None else None
                for datasource in declaration.datasources or []:
                    datasource.identity.provider = provider_name
                    if output_schema := datasource.output_schema:
                        datasource.output_schema = self._resolve_schema_refs(output_schema)
        return payload

    def fetch_datasource_providers(self, tenant_id: str) -> list[PluginDatasourceProviderEntity]:
        """Inputs: Tenant ID scopes the list request and icon resolution.
        Preconditions: ``tenant_id`` is non-empty; an injected requester applies the transformer.
        Result/effects: Returns the local-file provider plus resolved, repacked entities. Provider
        identity names normalize to ``plugin_id/provider_name``; each datasource identity's
        ``provider`` value matches that normalized provider name.
        Failure: Request, validation, schema-resolution, and repacking errors propagate.
        """

        response = self._request_datasource_provider_list(tenant_id, self._transform_datasource_provider_list_response)
        local_file_datasource_provider = PluginDatasourceProviderEntity.model_validate(
            self._get_local_file_datasource_provider()
        )

        for provider in response:
            ToolTransformService.repack_provider(
                tenant_id=tenant_id, provider=provider, get_plugin_icon_url=self._get_plugin_icon_url
            )
        all_response = [local_file_datasource_provider] + response

        for provider in all_response:
            provider.declaration.identity.name = f"{provider.plugin_id}/{provider.declaration.identity.name}"

            # override the provider name for each tool to plugin_id/provider_name
            for tool in provider.declaration.datasources:
                tool.identity.provider = provider.declaration.identity.name

        return all_response

    def fetch_installed_datasource_providers(self, tenant_id: str) -> list[PluginDatasourceProviderEntity]:
        """Inputs: Tenant ID scopes the list request and icon resolution.
        Preconditions: ``tenant_id`` is non-empty; an injected requester applies the transformer.
        Result/effects: Returns resolved, repacked daemon entities. Provider identity names
        normalize to ``plugin_id/provider_name``; each datasource identity's ``provider``
        value matches that normalized provider name.
        Failure: Request, validation, schema-resolution, and repacking errors propagate.
        """

        response = self._request_datasource_provider_list(tenant_id, self._transform_datasource_provider_list_response)

        for provider in response:
            ToolTransformService.repack_provider(
                tenant_id=tenant_id, provider=provider, get_plugin_icon_url=self._get_plugin_icon_url
            )

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

        def transformer(json_response: dict[str, Any]) -> PluginDatasourceSinglePayload:
            payload = PluginDatasourceSinglePayload.model_validate(json_response)
            data = payload.data
            declaration = data.declaration if data is not None else None
            if declaration is not None:
                for datasource in declaration.datasources or []:
                    datasource.identity.provider = tool_provider_id.provider_name
                    # resolve refs
                    if output_schema := datasource.output_schema:
                        datasource.output_schema = self._resolve_schema_refs(output_schema)
            return payload

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
    ) -> Generator[WebsiteCrawlMessage]:
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
    ) -> Generator[OnlineDocumentPagesMessage]:
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
    ) -> Generator[DatasourceMessage]:
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
    ) -> Generator[OnlineDriveBrowseFilesResponse]:
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
    ) -> Generator[DatasourceMessage]:
        """Invoke the datasource and lazily yield its online-drive download messages.

        Inputs: Tenant/user/provider identifiers, credentials, and a validated download request.
        Preconditions: The datasource provider identifier is valid for plugin dispatch.
        Result/effects: Uses the injected requester when present; otherwise retains the BasePluginClient transport.
        Failure: Request, response-validation, and iteration errors propagate unchanged.
        """

        datasource_provider_id = GenericProviderID(datasource_provider)
        path = f"plugin/{tenant_id}/dispatch/datasource/online_drive_download_file"
        data: dict[str, Any] = {
            "user_id": user_id,
            "data": {
                "provider": datasource_provider_id.provider_name,
                "datasource": datasource_name,
                "credentials": credentials,
                "request": request.model_dump(),
            },
        }
        headers = {
            "X-Plugin-ID": datasource_provider_id.plugin_id,
            "Content-Type": "application/json",
        }

        requester = self._online_drive_download_stream_requester
        if requester is not None:
            response = requester.request_stream(
                "POST",
                path,
                OnlineDriveDownloadMessage,
                headers=headers,
                data=data,
            )
        else:
            response = self._request_with_plugin_daemon_response_stream(
                "POST",
                path,
                OnlineDriveDownloadMessage,
                data=data,
                headers=headers,
            )
        yield from response

    def validate_provider_credentials(
        self,
        tenant_id: str,
        user_id: str,
        provider: str,
        plugin_id: str,
        credentials: dict[str, Any],
        *,
        plugin_unique_identifier: str | None = None,
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
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
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
