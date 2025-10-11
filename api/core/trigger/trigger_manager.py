"""
Trigger Manager for loading and managing trigger providers and triggers
"""

import logging
from collections.abc import Mapping
from threading import Lock
from typing import Any

from flask import Request

import contexts
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.entities.request import TriggerInvokeEventResponse
from core.plugin.impl.exc import PluginInvokeError
from core.plugin.impl.trigger import PluginTriggerManager
from core.trigger.entities.entities import (
    EventEntity,
    Subscription,
    Unsubscription,
)
from core.trigger.provider import PluginTriggerProviderController
from models.provider_ids import TriggerProviderID

logger = logging.getLogger(__name__)


class TriggerManager:
    """
    Manager for trigger providers and triggers
    """

    @classmethod
    def list_plugin_trigger_providers(cls, tenant_id: str) -> list[PluginTriggerProviderController]:
        """
        List all plugin trigger providers for a tenant

        :param tenant_id: Tenant ID
        :return: List of trigger provider controllers
        """
        manager = PluginTriggerManager()
        provider_entities = manager.fetch_trigger_providers(tenant_id)

        controllers = []
        for provider in provider_entities:
            try:
                controller = PluginTriggerProviderController(
                    entity=provider.declaration,
                    plugin_id=provider.plugin_id,
                    plugin_unique_identifier=provider.plugin_unique_identifier,
                    provider_id=TriggerProviderID(provider.provider),
                    tenant_id=tenant_id,
                )
                controllers.append(controller)
            except Exception:
                logger.exception("Failed to load trigger provider %s", provider.plugin_id)
                continue

        return controllers

    @classmethod
    def get_trigger_provider(cls, tenant_id: str, provider_id: TriggerProviderID) -> PluginTriggerProviderController:
        """
        Get a specific plugin trigger provider

        :param tenant_id: Tenant ID
        :param provider_id: Provider ID
        :return: Trigger provider controller or None
        """
        # check if context is set
        try:
            contexts.plugin_trigger_providers.get()
        except LookupError:
            contexts.plugin_trigger_providers.set({})
            contexts.plugin_trigger_providers_lock.set(Lock())

        plugin_trigger_providers = contexts.plugin_trigger_providers.get()
        provider_id_str = str(provider_id)
        if provider_id_str in plugin_trigger_providers:
            return plugin_trigger_providers[provider_id_str]

        with contexts.plugin_trigger_providers_lock.get():
            # double check
            plugin_trigger_providers = contexts.plugin_trigger_providers.get()
            if provider_id_str in plugin_trigger_providers:
                return plugin_trigger_providers[provider_id_str]

            manager = PluginTriggerManager()
            provider = manager.fetch_trigger_provider(tenant_id, provider_id)

            if not provider:
                raise ValueError(f"Trigger provider {provider_id} not found")

            try:
                controller = PluginTriggerProviderController(
                    entity=provider.declaration,
                    plugin_id=provider.plugin_id,
                    plugin_unique_identifier=provider.plugin_unique_identifier,
                    provider_id=provider_id,
                    tenant_id=tenant_id,
                )
                plugin_trigger_providers[provider_id_str] = controller
                return controller
            except Exception as e:
                logger.exception("Failed to load trigger provider")
                raise e

    @classmethod
    def list_all_trigger_providers(cls, tenant_id: str) -> list[PluginTriggerProviderController]:
        """
        List all trigger providers (plugin)

        :param tenant_id: Tenant ID
        :return: List of all trigger provider controllers
        """
        return cls.list_plugin_trigger_providers(tenant_id)

    @classmethod
    def list_triggers_by_provider(cls, tenant_id: str, provider_id: TriggerProviderID) -> list[EventEntity]:
        """
        List all triggers for a specific provider

        :param tenant_id: Tenant ID
        :param provider_id: Provider ID
        :return: List of trigger entities
        """
        provider = cls.get_trigger_provider(tenant_id, provider_id)
        return provider.get_events()

    @classmethod
    def invoke_trigger_event(
        cls,
        tenant_id: str,
        user_id: str,
        provider_id: TriggerProviderID,
        event_name: str,
        parameters: Mapping[str, Any],
        credentials: Mapping[str, str],
        credential_type: CredentialType,
        request: Request,
    ) -> TriggerInvokeEventResponse:
        """
        Execute a trigger

        :param tenant_id: Tenant ID
        :param user_id: User ID
        :param provider_id: Provider ID
        :param event_name: Event name
        :param parameters: Trigger parameters
        :param credentials: Provider credentials
        :param credential_type: Credential type
        :param request: Request
        :return: Trigger execution result
        """
        provider: PluginTriggerProviderController = cls.get_trigger_provider(
            tenant_id=tenant_id, provider_id=provider_id
        )
        try:
            return provider.invoke_trigger_event(
                user_id=user_id,
                event_name=event_name,
                parameters=parameters,
                credentials=credentials,
                credential_type=credential_type,
                request=request,
            )
        except PluginInvokeError as e:
            if e.get_error_type() == "TriggerIgnoreEventError":
                return TriggerInvokeEventResponse(variables={}, cancelled=True)
            else:
                logger.exception("Failed to invoke trigger event")
            raise

    @classmethod
    def subscribe_trigger(
        cls,
        tenant_id: str,
        user_id: str,
        provider_id: TriggerProviderID,
        endpoint: str,
        parameters: Mapping[str, Any],
        credentials: Mapping[str, str],
    ) -> Subscription:
        """
        Subscribe to a trigger (e.g., register webhook)

        :param tenant_id: Tenant ID
        :param user_id: User ID
        :param provider_id: Provider ID
        :param endpoint: Subscription endpoint
        :param parameters: Subscription parameters
        :param credentials: Provider credentials
        :return: Subscription result
        """
        provider = cls.get_trigger_provider(tenant_id, provider_id)
        return provider.subscribe_trigger(
            user_id=user_id, endpoint=endpoint, parameters=parameters, credentials=credentials
        )

    @classmethod
    def unsubscribe_trigger(
        cls,
        tenant_id: str,
        user_id: str,
        provider_id: TriggerProviderID,
        subscription: Subscription,
        credentials: Mapping[str, str],
    ) -> Unsubscription:
        """
        Unsubscribe from a trigger

        :param tenant_id: Tenant ID
        :param user_id: User ID
        :param provider_id: Provider ID
        :param subscription: Subscription metadata from subscribe operation
        :param credentials: Provider credentials
        :return: Unsubscription result
        """
        provider = cls.get_trigger_provider(tenant_id, provider_id)
        return provider.unsubscribe_trigger(user_id=user_id, subscription=subscription, credentials=credentials)

    @classmethod
    def refresh_trigger(
        cls,
        tenant_id: str,
        provider_id: TriggerProviderID,
        subscription: Subscription,
        credentials: Mapping[str, str],
    ) -> Subscription:
        """
        Refresh a trigger subscription

        :param tenant_id: Tenant ID
        :param provider_id: Provider ID
        :param subscription: Subscription metadata from subscribe operation
        :param credentials: Provider credentials
        :return: Refreshed subscription result
        """
        return cls.get_trigger_provider(tenant_id, provider_id).refresh_trigger(subscription, credentials)


# Export
__all__ = ["TriggerManager"]
