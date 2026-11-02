"""
Trigger Manager for loading and managing trigger providers and triggers
"""

import logging
from collections.abc import Mapping
from threading import Lock
from typing import Any

from flask import Request

import contexts
from configs import dify_config
from core.plugin.entities.plugin_daemon import CredentialType, PluginTriggerProviderEntity
from core.plugin.entities.request import TriggerInvokeEventResponse
from core.plugin.impl.exc import PluginDaemonError, PluginNotFoundError
from core.plugin.impl.trigger import PluginTriggerClient
from core.trigger.entities.entities import (
    EventEntity,
    Subscription,
    UnsubscribeResult,
)
from core.trigger.errors import EventIgnoreError
from core.trigger.provider import PluginTriggerProviderController
from models.provider_ids import TriggerProviderID

logger = logging.getLogger(__name__)


class TriggerManager:
    """
    Manager for trigger providers and triggers
    """

    @classmethod
    def get_trigger_plugin_icon(cls, tenant_id: str, provider_id: str) -> str:
        """
        Get the icon of a trigger plugin
        """
        manager = PluginTriggerClient()
        provider: PluginTriggerProviderEntity = manager.fetch_trigger_provider(
            tenant_id=tenant_id, provider_id=TriggerProviderID(provider_id)
        )
        filename = provider.declaration.identity.icon
        base_url = f"{dify_config.CONSOLE_API_URL}/console/api/workspaces/current/plugin/icon"
        return f"{base_url}?tenant_id={tenant_id}&filename={filename}"

    @classmethod
    def list_plugin_trigger_providers(cls, tenant_id: str) -> list[PluginTriggerProviderController]:
        """
        List all plugin trigger providers for a tenant

        :param tenant_id: Tenant ID
        :return: List of trigger provider controllers
        """
        manager = PluginTriggerClient()
        provider_entities = manager.fetch_trigger_providers(tenant_id)

        controllers: list[PluginTriggerProviderController] = []
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

            try:
                manager = PluginTriggerClient()
                provider = manager.fetch_trigger_provider(tenant_id, provider_id)

                if not provider:
                    raise ValueError(f"Trigger provider {provider_id} not found")

                controller = PluginTriggerProviderController(
                    entity=provider.declaration,
                    plugin_id=provider.plugin_id,
                    plugin_unique_identifier=provider.plugin_unique_identifier,
                    provider_id=provider_id,
                    tenant_id=tenant_id,
                )
                plugin_trigger_providers[provider_id_str] = controller
                return controller
            except PluginNotFoundError as e:
                raise ValueError(f"Trigger provider {provider_id} not found") from e
            except PluginDaemonError as e:
                raise e
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
        subscription: Subscription,
        request: Request,
        payload: Mapping[str, Any],
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
        :param subscription: Subscription
        :param request: Request
        :param payload: Payload
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
                subscription=subscription,
                request=request,
                payload=payload,
            )
        except EventIgnoreError:
            return TriggerInvokeEventResponse(variables={}, cancelled=True)
        except Exception as e:
            raise e

    @classmethod
    def subscribe_trigger(
        cls,
        tenant_id: str,
        user_id: str,
        provider_id: TriggerProviderID,
        endpoint: str,
        parameters: Mapping[str, Any],
        credentials: Mapping[str, str],
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
        provider: PluginTriggerProviderController = cls.get_trigger_provider(
            tenant_id=tenant_id, provider_id=provider_id
        )
        return provider.subscribe_trigger(
            user_id=user_id,
            endpoint=endpoint,
            parameters=parameters,
            credentials=credentials,
            credential_type=credential_type,
        )

    @classmethod
    def unsubscribe_trigger(
        cls,
        tenant_id: str,
        user_id: str,
        provider_id: TriggerProviderID,
        subscription: Subscription,
        credentials: Mapping[str, str],
        credential_type: CredentialType,
    ) -> UnsubscribeResult:
        """
        Unsubscribe from a trigger

        :param tenant_id: Tenant ID
        :param user_id: User ID
        :param provider_id: Provider ID
        :param subscription: Subscription metadata from subscribe operation
        :param credentials: Provider credentials
        :param credential_type: Credential type
        :return: Unsubscription result
        """
        provider: PluginTriggerProviderController = cls.get_trigger_provider(
            tenant_id=tenant_id, provider_id=provider_id
        )
        return provider.unsubscribe_trigger(
            user_id=user_id,
            subscription=subscription,
            credentials=credentials,
            credential_type=credential_type,
        )

    @classmethod
    def refresh_trigger(
        cls,
        tenant_id: str,
        provider_id: TriggerProviderID,
        subscription: Subscription,
        credentials: Mapping[str, str],
        credential_type: CredentialType,
    ) -> Subscription:
        """
        Refresh a trigger subscription

        :param tenant_id: Tenant ID
        :param provider_id: Provider ID
        :param subscription: Subscription metadata from subscribe operation
        :param credentials: Provider credentials
        :param credential_type: Credential type
        :return: Refreshed subscription result
        """

        # TODO you should update the subscription using the return value of the refresh_trigger
        return cls.get_trigger_provider(tenant_id=tenant_id, provider_id=provider_id).refresh_trigger(
            subscription=subscription, credentials=credentials, credential_type=credential_type
        )
