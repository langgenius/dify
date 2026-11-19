"""
Load trigger plugin metadata with a context-scoped, tenant-isolated cache.
"""

import logging
from collections.abc import Mapping
from threading import Lock
from typing import Any

import contexts
from core.plugin.entities.plugin_daemon import CredentialType, PluginTriggerProviderEntity
from core.plugin.impl.exc import PluginDaemonError, PluginNotFoundError
from core.plugin.impl.trigger import PluginTriggerClient
from core.trigger.entities.entities import Subscription
from models.provider_ids import TriggerProviderID
from models.utils.trigger_endpoint import generate_trigger_plugin_icon_url
from services.trigger.plugin_provider import PluginTriggerProvider

logger = logging.getLogger(__name__)


class PluginTriggerProviderLoader:
    """Share provider discovery between gateways without retaining request state on the loader."""

    def __init__(self, *, client: PluginTriggerClient) -> None:
        self._client = client

    def get_trigger_plugin_icon(self, tenant_id: str, provider_id: str) -> str:
        """
        Get the icon of a trigger plugin
        """
        manager = self._client
        provider: PluginTriggerProviderEntity = manager.fetch_trigger_provider(
            tenant_id=tenant_id, provider_id=TriggerProviderID(provider_id)
        )
        return generate_trigger_plugin_icon_url(tenant_id, provider.declaration.identity.icon)

    def list_plugin_trigger_providers(self, tenant_id: str) -> list[PluginTriggerProvider]:
        """
        List all plugin trigger providers for a tenant

        :param tenant_id: Tenant ID
        :return: List of trigger provider controllers
        """
        manager = self._client
        provider_entities = manager.fetch_trigger_providers(tenant_id)

        controllers: list[PluginTriggerProvider] = []
        for provider in provider_entities:
            try:
                controller = PluginTriggerProvider(
                    entity=provider.declaration,
                    plugin_id=provider.plugin_id,
                    plugin_unique_identifier=provider.plugin_unique_identifier,
                    provider_id=TriggerProviderID(provider.provider),
                    tenant_id=tenant_id,
                )
                controllers.append(controller)
            except Exception:
                logger.exception("Failed to load trigger provider %s", provider.plugin_id)

        return controllers

    def get_trigger_provider(self, tenant_id: str, provider_id: TriggerProviderID) -> PluginTriggerProvider:
        """
        Get a specific plugin trigger provider

        :param tenant_id: Tenant ID
        :param provider_id: Provider ID
        :return: Provider runtime for this workspace
        """
        # check if context is set
        try:
            contexts.plugin_trigger_providers.get()
        except LookupError:
            contexts.plugin_trigger_providers.set({})
            contexts.plugin_trigger_providers_lock.set(Lock())

        plugin_trigger_providers = contexts.plugin_trigger_providers.get()
        cache_key = (tenant_id, str(provider_id))
        if cache_key in plugin_trigger_providers:
            return plugin_trigger_providers[cache_key]

        with contexts.plugin_trigger_providers_lock.get():
            # double check
            plugin_trigger_providers = contexts.plugin_trigger_providers.get()
            if cache_key in plugin_trigger_providers:
                return plugin_trigger_providers[cache_key]

            try:
                manager = self._client
                provider = manager.fetch_trigger_provider(tenant_id, provider_id)

                if not provider:
                    raise ValueError(f"Trigger provider {provider_id} not found")

                controller = PluginTriggerProvider(
                    entity=provider.declaration,
                    plugin_id=provider.plugin_id,
                    plugin_unique_identifier=provider.plugin_unique_identifier,
                    provider_id=provider_id,
                    tenant_id=tenant_id,
                )
                plugin_trigger_providers[cache_key] = controller
                return controller
            except PluginNotFoundError as e:
                raise ValueError(f"Trigger provider {provider_id} not found") from e
            except PluginDaemonError as e:
                raise e
            except Exception as e:
                logger.exception("Failed to load trigger provider")
                raise e

    def subscribe_trigger(
        self,
        tenant_id: str,
        user_id: str,
        provider_id: TriggerProviderID,
        endpoint: str,
        parameters: Mapping[str, Any],
        credentials: Mapping[str, object],
        credential_type: CredentialType,
    ) -> Subscription:
        """
        Subscribe to a trigger (e.g., register webhook)

        :param tenant_id: Tenant ID
        :param user_id: User ID
        :param provider_id: Provider ID
        :param endpoint: Subscription endpoint
        :param parameters: Subscription parameters
        :param credentials: Provider credentials
        :param credential_type: Credential type
        :return: Subscription result
        """
        provider: PluginTriggerProvider = self.get_trigger_provider(tenant_id=tenant_id, provider_id=provider_id)
        return provider.subscribe_trigger(
            user_id=user_id,
            endpoint=endpoint,
            parameters=parameters,
            credentials=credentials,
            credential_type=credential_type,
        )
