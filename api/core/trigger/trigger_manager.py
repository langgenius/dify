"""
Trigger Manager for loading and managing trigger providers and triggers
"""

import logging
from typing import Optional

from core.trigger.entities import (
    ProviderConfig,
    TriggerEntity,
)
from core.trigger.plugin_trigger import PluginTriggerController
from core.trigger.provider import PluginTriggerProviderController

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
        manager = PluginTriggerController()
        provider_entities = manager.fetch_trigger_providers(tenant_id)

        controllers = []
        for provider in provider_entities:
            try:
                controller = PluginTriggerProviderController(
                    entity=provider.declaration,
                    plugin_id=provider.plugin_id,
                    plugin_unique_identifier=provider.plugin_unique_identifier,
                    tenant_id=tenant_id,
                )
                controllers.append(controller)
            except Exception as e:
                logger.exception("Failed to load trigger provider {provider.plugin_id}")
                continue

        return controllers

    @classmethod
    def get_plugin_trigger_provider(
        cls, tenant_id: str, plugin_id: str, provider_name: str
    ) -> Optional[PluginTriggerProviderController]:
        """
        Get a specific plugin trigger provider

        :param tenant_id: Tenant ID
        :param plugin_id: Plugin ID
        :param provider_name: Provider name
        :return: Trigger provider controller or None
        """
        manager = PluginTriggerManager()
        provider = manager.fetch_trigger_provider(tenant_id, plugin_id, provider_name)

        if not provider:
            return None

        try:
            return PluginTriggerProviderController(
                entity=provider.declaration,
                plugin_id=provider.plugin_id,
                plugin_unique_identifier=provider.plugin_unique_identifier,
                tenant_id=tenant_id,
            )
        except Exception as e:
            logger.exception("Failed to load trigger provider")
            return None

    @classmethod
    def list_all_trigger_providers(cls, tenant_id: str) -> list[PluginTriggerProviderController]:
        """
        List all trigger providers (plugin and builtin)

        :param tenant_id: Tenant ID
        :return: List of all trigger provider controllers
        """
        providers = []

        # Get plugin providers
        plugin_providers = cls.list_plugin_trigger_providers(tenant_id)
        providers.extend(plugin_providers)

        # TODO: Add builtin providers when implemented
        # builtin_providers = cls.list_builtin_trigger_providers(tenant_id)
        # providers.extend(builtin_providers)

        return providers

    @classmethod
    def list_triggers_by_provider(cls, tenant_id: str, plugin_id: str, provider_name: str) -> list[TriggerEntity]:
        """
        List all triggers for a specific provider

        :param tenant_id: Tenant ID
        :param plugin_id: Plugin ID
        :param provider_name: Provider name
        :return: List of trigger entities
        """
        provider = cls.get_plugin_trigger_provider(tenant_id, plugin_id, provider_name)

        if not provider:
            return []

        return provider.get_triggers()

    @classmethod
    def get_trigger(
        cls, tenant_id: str, plugin_id: str, provider_name: str, trigger_name: str
    ) -> Optional[TriggerEntity]:
        """
        Get a specific trigger

        :param tenant_id: Tenant ID
        :param plugin_id: Plugin ID
        :param provider_name: Provider name
        :param trigger_name: Trigger name
        :return: Trigger entity or None
        """
        provider = cls.get_plugin_trigger_provider(tenant_id, plugin_id, provider_name)

        if not provider:
            return None

        return provider.get_trigger(trigger_name)

    @classmethod
    def validate_trigger_credentials(
        cls, tenant_id: str, plugin_id: str, provider_name: str, credentials: dict
    ) -> tuple[bool, str]:
        """
        Validate trigger provider credentials

        :param tenant_id: Tenant ID
        :param plugin_id: Plugin ID
        :param provider_name: Provider name
        :param credentials: Credentials to validate
        :return: Tuple of (is_valid, error_message)
        """
        provider = cls.get_plugin_trigger_provider(tenant_id, plugin_id, provider_name)

        if not provider:
            return False, "Provider not found"

        try:
            provider.validate_credentials(credentials)
            return True, ""
        except Exception as e:
            return False, str(e)

    @classmethod
    def execute_trigger(
        cls, tenant_id: str, plugin_id: str, provider_name: str, trigger_name: str, parameters: dict, credentials: dict
    ) -> dict:
        """
        Execute a trigger

        :param tenant_id: Tenant ID
        :param plugin_id: Plugin ID
        :param provider_name: Provider name
        :param trigger_name: Trigger name
        :param parameters: Trigger parameters
        :param credentials: Provider credentials
        :return: Trigger execution result
        """
        provider = cls.get_plugin_trigger_provider(tenant_id, plugin_id, provider_name)

        if not provider:
            raise ValueError(f"Provider {plugin_id}/{provider_name} not found")

        trigger = provider.get_trigger(trigger_name)
        if not trigger:
            raise ValueError(f"Trigger {trigger_name} not found in provider {provider_name}")

        return provider.execute_trigger(trigger_name, parameters, credentials)

    @classmethod
    def subscribe_trigger(
        cls,
        tenant_id: str,
        plugin_id: str,
        provider_name: str,
        trigger_name: str,
        subscription_params: dict,
        credentials: dict,
    ) -> dict:
        """
        Subscribe to a trigger (e.g., register webhook)

        :param tenant_id: Tenant ID
        :param plugin_id: Plugin ID
        :param provider_name: Provider name
        :param trigger_name: Trigger name
        :param subscription_params: Subscription parameters
        :param credentials: Provider credentials
        :return: Subscription result
        """
        provider = cls.get_plugin_trigger_provider(tenant_id, plugin_id, provider_name)

        if not provider:
            raise ValueError(f"Provider {plugin_id}/{provider_name} not found")

        return provider.subscribe_trigger(trigger_name, subscription_params, credentials)

    @classmethod
    def unsubscribe_trigger(
        cls,
        tenant_id: str,
        plugin_id: str,
        provider_name: str,
        trigger_name: str,
        subscription_metadata: dict,
        credentials: dict,
    ) -> dict:
        """
        Unsubscribe from a trigger

        :param tenant_id: Tenant ID
        :param plugin_id: Plugin ID
        :param provider_name: Provider name
        :param trigger_name: Trigger name
        :param subscription_metadata: Subscription metadata from subscribe operation
        :param credentials: Provider credentials
        :return: Unsubscription result
        """
        provider = cls.get_plugin_trigger_provider(tenant_id, plugin_id, provider_name)

        if not provider:
            raise ValueError(f"Provider {plugin_id}/{provider_name} not found")

        return provider.unsubscribe_trigger(trigger_name, subscription_metadata, credentials)

    @classmethod
    def handle_webhook(
        cls,
        tenant_id: str,
        plugin_id: str,
        provider_name: str,
        webhook_path: str,
        request_data: dict,
        credentials: dict,
    ) -> dict:
        """
        Handle incoming webhook for a trigger

        :param tenant_id: Tenant ID
        :param plugin_id: Plugin ID
        :param provider_name: Provider name
        :param webhook_path: Webhook path
        :param request_data: Webhook request data
        :param credentials: Provider credentials
        :return: Webhook handling result
        """
        provider = cls.get_plugin_trigger_provider(tenant_id, plugin_id, provider_name)

        if not provider:
            raise ValueError(f"Provider {plugin_id}/{provider_name} not found")

        return provider.handle_webhook(webhook_path, request_data, credentials)

    @classmethod
    def get_provider_credentials_schema(
        cls, tenant_id: str, plugin_id: str, provider_name: str
    ) -> list[ProviderConfig]:
        """
        Get provider credentials schema

        :param tenant_id: Tenant ID
        :param plugin_id: Plugin ID
        :param provider_name: Provider name
        :return: List of provider config schemas
        """
        provider = cls.get_plugin_trigger_provider(tenant_id, plugin_id, provider_name)

        if not provider:
            return []

        return provider.get_credentials_schema()

    @classmethod
    def get_provider_subscription_schema(
        cls, tenant_id: str, plugin_id: str, provider_name: str
    ) -> list[ProviderConfig]:
        """
        Get provider subscription schema

        :param tenant_id: Tenant ID
        :param plugin_id: Plugin ID
        :param provider_name: Provider name
        :return: List of subscription config schemas
        """
        provider = cls.get_plugin_trigger_provider(tenant_id, plugin_id, provider_name)

        if not provider:
            return []

        return provider.get_subscription_schema()

    @classmethod
    def get_provider_info(cls, tenant_id: str, plugin_id: str, provider_name: str) -> Optional[dict]:
        """
        Get provider information

        :param tenant_id: Tenant ID
        :param plugin_id: Plugin ID
        :param provider_name: Provider name
        :return: Provider info dict or None
        """
        provider = cls.get_plugin_trigger_provider(tenant_id, plugin_id, provider_name)

        if not provider:
            return None

        return {
            "plugin_id": plugin_id,
            "provider_name": provider_name,
            "identity": provider.entity.identity.model_dump() if provider.entity.identity else {},
            "credentials_schema": [c.model_dump() for c in provider.entity.credentials_schema],
            "subscription_schema": [s.model_dump() for s in provider.entity.subscription_schema],
            "oauth_enabled": provider.entity.oauth_schema is not None,
            "trigger_count": len(provider.entity.triggers),
            "triggers": [t.identity.model_dump() for t in provider.entity.triggers],
        }

    @classmethod
    def list_providers_for_workflow(cls, tenant_id: str) -> list[dict]:
        """
        List trigger providers suitable for workflow usage

        :param tenant_id: Tenant ID
        :return: List of provider info dicts
        """
        providers = cls.list_all_trigger_providers(tenant_id)

        result = []
        for provider in providers:
            info = {
                "plugin_id": provider.plugin_id,
                "provider_name": provider.entity.identity.name,
                "label": provider.entity.identity.label.model_dump(),
                "description": provider.entity.identity.description.model_dump(),
                "icon": provider.entity.identity.icon,
                "trigger_count": len(provider.entity.triggers),
            }
            result.append(info)

        return result


# Export
__all__ = ["TriggerManager"]
