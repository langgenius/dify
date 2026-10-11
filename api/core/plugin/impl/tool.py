from collections.abc import Generator, Mapping
from typing import Any

from pydantic import BaseModel

from configs import dify_config
from core.dify_builder.real_call_consent import validate_confirmed_dispatch_headers

# from core.plugin.entities.plugin import GenericProviderID, ToolProviderID
from core.plugin.entities.plugin import PluginCategory, PluginInstallation
from core.plugin.entities.plugin_daemon import CredentialType, PluginBasicBooleanResponse, PluginToolProviderEntity
from core.plugin.impl.base import BasePluginClient
from core.plugin.impl.plugin import PluginInstaller
from core.plugin.utils.chunk_merger import merge_blob_chunks
from core.schemas.resolver import resolve_dify_schema_refs
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolParameter
from models.provider_ids import GenericProviderID, ToolProviderID

# The daemon's ``management/tools`` (ListTools) accepts ``page >= 1`` and
# ``page_size <= 256`` and returns one tenant-filtered OFFSET/LIMIT page with
# no total and no ORDER BY. Pages are read until a short or empty page, but
# that alone does not prove completeness: coverage is checked against the
# installed Tool plugin ID list (see ``fetch_tool_providers``).
_TOOL_PROVIDER_PAGE_SIZE = 256
# 40 pages = 10,240 tool providers for one workspace -- far beyond any real
# tenant. Reaching it means the daemon is not paging, so fail explicitly rather
# than report a truncated inventory as complete.
_MAX_TOOL_PROVIDER_PAGES = 40
# The same bound on the authoritative installed Tool plugin ID list.
_MAX_INSTALLED_TOOL_PLUGINS = _TOOL_PROVIDER_PAGE_SIZE * _MAX_TOOL_PROVIDER_PAGES
# The daemon's ``installation/fetch/batch`` accepts at most 256 plugin IDs.
_INSTALLATION_BATCH_SIZE = 256


class PluginToolManager(BasePluginClient):
    def fetch_tool_providers(self, tenant_id: str) -> list[PluginToolProviderEntity]:
        """
        Fetch every tool provider installed for the given tenant.

        The daemon's installed Tool plugin ID list is the authority for
        coverage: ``management/tools`` pages with OFFSET/LIMIT and no ORDER BY,
        so paging alone cannot prove completeness. Providers come from the bulk
        pages; any installed plugin those pages missed is recovered through
        native installation batches (at most 256 IDs) and the single-provider
        fetch. Each provider keeps its stable ``plugin_id/provider`` id and
        normalized actions on either path.

        Any HTTP/parse failure, a provider (bulk or recovered) whose identity
        disagrees with its own public metadata, a bulk provider that is not
        installed, a conflicting duplicate, an incomplete or mismatched
        recovery, or a violated bound raises -- a partial inventory is never
        returned as complete. The installed ID list is re-read at the end and
        must be unchanged; this detects a change in the observed installed set
        between the two reads, not every concurrent install transaction, and is
        not an atomic snapshot.
        """
        installer = PluginInstaller()
        installed = self._installed_tool_plugin_ids(installer, tenant_id)
        by_plugin_id: dict[str, PluginToolProviderEntity] = {}
        for provider in self._fetch_bulk_tool_providers(tenant_id):
            plugin_id = provider.plugin_id
            self._check_provider_identity(provider)
            if plugin_id not in installed:
                raise ValueError(f"tool provider plugin {plugin_id} is not installed; inventory is inconsistent")
            if plugin_id in by_plugin_id:
                raise ValueError(f"tool provider plugin {plugin_id} listed with conflicting providers")
            by_plugin_id[plugin_id] = provider

        missing = [plugin_id for plugin_id in installed if plugin_id not in by_plugin_id]
        for provider in self._recover_tool_providers(installer, tenant_id, missing):
            by_plugin_id[provider.plugin_id] = provider

        if by_plugin_id.keys() != installed.keys():
            raise ValueError("tool provider inventory does not cover the installed tool plugins")
        if self._installed_tool_plugin_ids(installer, tenant_id).keys() != installed.keys():
            raise ValueError("installed tool plugins changed while listing tool providers; inventory is inconsistent")
        return list(by_plugin_id.values())

    @staticmethod
    def _check_provider_identity(provider: PluginToolProviderEntity) -> None:
        """Reject provider metadata that disagrees with itself: the normalized
        full id must be ``plugin_id/provider`` and the unique identifier must
        belong to the same plugin (``<plugin_id>:<version>@<checksum>``)."""
        plugin_id = provider.plugin_id
        if provider.declaration.identity.name != f"{plugin_id}/{provider.provider}":
            raise ValueError(f"tool provider {provider.declaration.identity.name} disagrees with its plugin id")
        if provider.plugin_unique_identifier.split(":", 1)[0] != plugin_id:
            raise ValueError(f"tool provider {provider.declaration.identity.name} has another plugin's identifier")

    def _installed_tool_plugin_ids(self, installer: PluginInstaller, tenant_id: str) -> dict[str, None]:
        """The installed Tool plugin IDs, deduplicated in daemon order."""
        installed = dict.fromkeys(installer.list_installed_plugin_ids(tenant_id, PluginCategory.Tool))
        if len(installed) > _MAX_INSTALLED_TOOL_PLUGINS:
            raise ValueError(
                f"more than {_MAX_INSTALLED_TOOL_PLUGINS} installed tool plugins; inventory bound exceeded"
            )
        return installed

    def _recover_tool_providers(
        self, installer: PluginInstaller, tenant_id: str, plugin_ids: list[str]
    ) -> list[PluginToolProviderEntity]:
        """Fetch installed providers the bulk pages missed, validating every row.

        The installation's ``declaration.tool`` names the provider but carries
        no actions, so the complete normalized provider comes from
        ``fetch_tool_provider``.
        """
        recovered: list[PluginToolProviderEntity] = []
        for start in range(0, len(plugin_ids), _INSTALLATION_BATCH_SIZE):
            batch = plugin_ids[start : start + _INSTALLATION_BATCH_SIZE]
            installations: dict[str, PluginInstallation] = {}
            for installation in installer.fetch_plugin_installation_by_ids(tenant_id, batch):
                if installation.tenant_id != tenant_id or installation.plugin_id not in batch:
                    raise ValueError(f"unexpected installation {installation.plugin_id} for this tool inventory")
                if installation.plugin_id in installations:
                    raise ValueError(f"duplicate installation {installation.plugin_id} for this tool inventory")
                installations[installation.plugin_id] = installation
            if installations.keys() != set(batch):
                raise ValueError("installation lookup did not return every installed tool plugin")
            for plugin_id in batch:
                installation = installations[plugin_id]
                tool = installation.declaration.tool
                if tool is None:
                    raise ValueError(f"installed tool plugin {plugin_id} declares no tool provider")
                provider_id = f"{plugin_id}/{tool.identity.name}"
                provider = self.fetch_tool_provider(tenant_id, provider_id)
                self._check_provider_identity(provider)
                if (
                    provider.plugin_id != plugin_id
                    or provider.declaration.identity.name != provider_id
                    or provider.plugin_unique_identifier != installation.plugin_unique_identifier
                ):
                    raise ValueError(f"tool provider {provider_id} metadata disagrees with its installation")
                recovered.append(provider)
        return recovered

    def _fetch_bulk_tool_providers(self, tenant_id: str) -> list[PluginToolProviderEntity]:
        """
        Page through ``management/tools`` until a short or empty page.

        Providers are deduplicated on their stable ``plugin_id/provider`` id,
        within and across pages; a repeated id is dropped only when its parsed
        metadata is identical, otherwise ``ValueError`` (conflicting versions
        or declarations). A failed page fails the whole fetch; a page that adds
        nothing new (the daemon ignoring ``page``) or exceeding
        ``_MAX_TOOL_PROVIDER_PAGES`` raises ``ValueError``. Coverage is
        checked by ``fetch_tool_providers``.
        """
        providers: list[PluginToolProviderEntity] = []
        seen: dict[str, PluginToolProviderEntity] = {}
        for page in range(1, _MAX_TOOL_PROVIDER_PAGES + 1):
            page_providers = self._fetch_tool_provider_page(tenant_id, page)
            added = 0
            for provider in page_providers:
                identity = provider.declaration.identity.name
                if identity in seen:
                    if seen[identity] != provider:
                        raise ValueError(f"tool provider {identity} listed with conflicting metadata")
                    continue
                seen[identity] = provider
                providers.append(provider)
                added += 1
            if page_providers and not added:
                raise ValueError(f"plugin daemon repeated tool provider page {page}; inventory is incomplete")
            if len(page_providers) < _TOOL_PROVIDER_PAGE_SIZE:
                return providers
        raise ValueError(
            f"plugin daemon returned more than {_MAX_TOOL_PROVIDER_PAGES} full tool provider pages; "
            "inventory is incomplete"
        )

    def _fetch_tool_provider_page(self, tenant_id: str, page: int) -> list[PluginToolProviderEntity]:
        """Fetch one ``management/tools`` page with stable ``plugin_id/provider`` names."""

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
            params={"page": page, "page_size": _TOOL_PROVIDER_PAGE_SIZE},
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
        *,
        confirmed_dispatch_headers: Mapping[str, str] | None = None,
    ) -> Generator[ToolInvokeMessage]:
        """
        Invoke the tool with the given tenant, user, plugin, provider, name, credentials and parameters.

        ``confirmed_dispatch_headers`` is ``None`` for every ordinary call. A
        confirmed Builder call supplies exactly the three server-built companion
        headers (validated here, before any transport) on the same native route.
        """

        tool_provider_id = GenericProviderID(tool_provider)
        headers = {
            "X-Plugin-ID": tool_provider_id.plugin_id,
            "Content-Type": "application/json",
        }
        if confirmed_dispatch_headers is not None:
            headers.update(validate_confirmed_dispatch_headers(confirmed_dispatch_headers))

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
            headers=headers,
        )

        return merge_blob_chunks(response, max_file_size=dify_config.PLUGIN_MAX_FILE_SIZE)

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
