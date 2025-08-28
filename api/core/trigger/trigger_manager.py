"""
Trigger Manager for loading and managing trigger providers and triggers
"""

import logging
from typing import Optional

from core.plugin.entities.plugin import TriggerProviderID
from core.plugin.impl.trigger import PluginTriggerManager
from core.trigger.entities.entities import (
    ProviderConfig,
    Subscription,
    TriggerEntity,
    Unsubscription,
)
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
        manager = PluginTriggerManager()
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
    def get_trigger_provider(
        cls, tenant_id: str, provider_id: TriggerProviderID
    ) -> PluginTriggerProviderController:
        """
        Get a specific plugin trigger provider

        :param tenant_id: Tenant ID
        :param provider_id: Provider ID
        :return: Trigger provider controller or None
        """
        manager = PluginTriggerManager()
        provider = manager.fetch_trigger_provider(tenant_id, provider_id)

        if not provider:
            raise ValueError(f"Trigger provider {provider_id} not found")

        try:
            return PluginTriggerProviderController(
                entity=provider.declaration,
                plugin_id=provider.plugin_id,
                plugin_unique_identifier=provider.plugin_unique_identifier,
                tenant_id=tenant_id,
            )
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
    def list_triggers_by_provider(cls, tenant_id: str, provider_id: TriggerProviderID) -> list[TriggerEntity]:
        """
        List all triggers for a specific provider

        :param tenant_id: Tenant ID
        :param provider_id: Provider ID
        :return: List of trigger entities
        """
        provider = cls.get_trigger_provider(tenant_id, provider_id)
        return provider.get_triggers()

    @classmethod
    def get_trigger(
        cls, tenant_id: str, provider_id: TriggerProviderID, trigger_name: str
    ) -> Optional[TriggerEntity]:
        """
        Get a specific trigger

        :param tenant_id: Tenant ID
        :param provider_id: Provider ID
        :param trigger_name: Trigger name
        :return: Trigger entity or None
        """
        return cls.get_trigger_provider(tenant_id, provider_id).get_trigger(trigger_name)

    @classmethod
    def validate_trigger_credentials(
        cls, tenant_id: str, provider_id: TriggerProviderID, credentials: dict
    ) -> tuple[bool, str]:
        """
        Validate trigger provider credentials

        :param tenant_id: Tenant ID
        :param provider_id: Provider ID
        :param credentials: Credentials to validate
        :return: Tuple of (is_valid, error_message)
        """
        try:
            cls.get_trigger_provider(tenant_id, provider_id).validate_credentials(credentials)
            return True, ""
        except Exception as e:
            return False, str(e)

    @classmethod
    def execute_trigger(
        cls, tenant_id: str, provider_id: TriggerProviderID, trigger_name: str, parameters: dict, credentials: dict
    ) -> dict:
        """
        Execute a trigger

        :param tenant_id: Tenant ID
        :param provider_id: Provider ID
        :param trigger_name: Trigger name
        :param parameters: Trigger parameters
        :param credentials: Provider credentials
        :return: Trigger execution result
        """
        trigger = cls.get_trigger_provider(tenant_id, provider_id).get_trigger(trigger_name)
        if not trigger:
            raise ValueError(f"Trigger {trigger_name} not found in provider {provider_id}")
        return cls.get_trigger_provider(tenant_id, provider_id).execute_trigger(trigger_name, parameters, credentials)

    @classmethod
    def subscribe_trigger(
        cls,
        tenant_id: str,
        provider_id: TriggerProviderID,
        trigger_name: str,
        subscription_params: dict,
        credentials: dict,
    ) -> Subscription:
        """
        Subscribe to a trigger (e.g., register webhook)

        :param tenant_id: Tenant ID
        :param provider_id: Provider ID
        :param trigger_name: Trigger name
        :param subscription_params: Subscription parameters
        :param credentials: Provider credentials
        :return: Subscription result
        """
        return cls.get_trigger_provider(tenant_id, provider_id).subscribe_trigger(
            trigger_name, subscription_params, credentials
        )

    @classmethod
    def unsubscribe_trigger(
        cls,
        tenant_id: str,
        provider_id: TriggerProviderID,
        trigger_name: str,
        subscription_metadata: dict,
        credentials: dict,
    ) -> Unsubscription:
        """
        Unsubscribe from a trigger

        :param tenant_id: Tenant ID
        :param provider_id: Provider ID
        :param trigger_name: Trigger name
        :param subscription_metadata: Subscription metadata from subscribe operation
        :param credentials: Provider credentials
        :return: Unsubscription result
        """
        return cls.get_trigger_provider(tenant_id, provider_id).unsubscribe_trigger(
            trigger_name, subscription_metadata, credentials
        )

    @classmethod
    def get_provider_subscription_schema(
        cls, tenant_id: str, provider_id: TriggerProviderID
    ) -> list[ProviderConfig]:
        """
        Get provider subscription schema

        :param tenant_id: Tenant ID
        :param provider_id: Provider ID
        :return: List of subscription config schemas
        """
        return cls.get_trigger_provider(tenant_id, provider_id).get_subscription_schema()

# Export
__all__ = ["TriggerManager"]
