"""Deployment discovery adapters for Account consumer queries."""

import httpx

from core.plugin.plugin_service import PluginService
from services.consumer_service import ConsumerConnectionProviderMetadata
from services.end_user_connection_adapters import PluginApiKeyCredentialGateway
from services.end_user_connections.errors import ConnectionCheckUnavailableError, ConnectionConfigurationError
from services.enterprise.enterprise_service import EnterpriseService
from services.errors.enterprise import EnterpriseServiceError
from services.webapp_access_query_service import WebAppAccessUnavailableError


class PluginConsumerConnectionProviders:
    def __init__(self, *, providers: PluginApiKeyCredentialGateway) -> None:
        self._providers = providers

    def metadata(self, *, tenant_id: str, provider: str) -> ConsumerConnectionProviderMetadata | None:
        """Read only public declaration fields from an owned tenant's installed Provider.

        Missing or unavailable plugins return None, preserving personal resource
        discovery and disconnect. Credential schemas and values are never exposed.
        """
        try:
            identity = self._providers.provider(tenant_id, provider).entity.identity
        except (ConnectionConfigurationError, ConnectionCheckUnavailableError):
            return None
        return ConsumerConnectionProviderMetadata(
            label=identity.label.model_dump(),
            description=identity.description.model_dump(),
            icon=PluginService.get_plugin_icon_url(tenant_id=tenant_id, filename=identity.icon),
            icon_dark=PluginService.get_plugin_icon_url(tenant_id=tenant_id, filename=identity.icon_dark)
            if identity.icon_dark
            else None,
        )


class SharedConsumerAppDiscovery:
    def __init__(self, *, enabled: bool) -> None:
        self._enabled = enabled

    def __call__(self) -> tuple[str, ...]:
        if not self._enabled:
            return ()
        app_ids: list[str] = []
        seen: set[str] = set()
        page = 1
        while True:
            try:
                result = EnterpriseService.WebAppAuth.list_externally_accessible_apps(page=page, limit=100)
                rows = result["data"]
                ids = [row["appId"] for row in rows]
                has_more = result["hasMore"]
                if not isinstance(has_more, bool) or any(not isinstance(id_, str) for id_ in ids):
                    raise ValueError("Malformed App discovery response")
                if has_more and not set(ids).difference(seen):
                    raise ValueError("App discovery did not advance")
            except (EnterpriseServiceError, httpx.RequestError, KeyError, TypeError, ValueError) as error:
                raise WebAppAccessUnavailableError from error
            app_ids.extend(ids)
            seen.update(ids)
            if not has_more:
                return tuple(dict.fromkeys(app_ids))
            page += 1
