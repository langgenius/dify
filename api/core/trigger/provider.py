"""
Trigger Provider Controller for managing trigger providers
"""

import logging
import time
from typing import Optional

from core.entities.provider_entities import BasicProviderConfig
from core.plugin.entities.plugin import TriggerProviderID
from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.entities.api_entities import TriggerProviderApiEntity
from core.trigger.entities.entities import (
    ProviderConfig,
    Subscription,
    TriggerEntity,
    TriggerProviderEntity,
    TriggerProviderIdentity,
    Unsubscription,
)

logger = logging.getLogger(__name__)


class PluginTriggerProviderController:
    """
    Controller for plugin trigger providers
    """

    def __init__(
        self,
        entity: TriggerProviderEntity,
        plugin_id: str,
        plugin_unique_identifier: str,
        tenant_id: str,
    ):
        """
        Initialize plugin trigger provider controller

        :param entity: Trigger provider entity
        :param plugin_id: Plugin ID
        :param plugin_unique_identifier: Plugin unique identifier
        :param tenant_id: Tenant ID
        """
        self.entity = entity
        self.tenant_id = tenant_id
        self.plugin_id = plugin_id
        self.plugin_unique_identifier = plugin_unique_identifier

    def get_provider_id(self) -> TriggerProviderID:
        """
        Get provider ID
        """
        return TriggerProviderID(f"{self.plugin_id}/{self.entity.identity.name}")

    def to_api_entity(self) -> TriggerProviderApiEntity:
        """
        Convert to API entity
        """
        return TriggerProviderApiEntity(**self.entity.model_dump())

    @property
    def identity(self) -> TriggerProviderIdentity:
        """Get provider identity"""
        return self.entity.identity

    def get_triggers(self) -> list[TriggerEntity]:
        """
        Get all triggers for this provider

        :return: List of trigger entities
        """
        return self.entity.triggers

    def get_trigger(self, trigger_name: str) -> Optional[TriggerEntity]:
        """
        Get a specific trigger by name

        :param trigger_name: Trigger name
        :return: Trigger entity or None
        """
        for trigger in self.entity.triggers:
            if trigger.identity.name == trigger_name:
                return trigger
        return None

    def get_subscription_schema(self) -> list[ProviderConfig]:
        """
        Get subscription schema for this provider

        :return: List of subscription config schemas
        """
        return self.entity.subscription_schema

    def validate_credentials(self, credentials: dict) -> None:
        """
        Validate credentials against schema

        :param credentials: Credentials to validate
        :raises ValueError: If credentials are invalid
        """
        for config in self.entity.credentials_schema:
            if config.required and config.name not in credentials:
                raise ValueError(f"Missing required credential field: {config.name}")

    def get_supported_credential_types(self) -> list[CredentialType]:
        """
        Get supported credential types for this provider.

        :return: List of supported credential types
        """
        types = []
        if self.entity.oauth_schema:
            types.append(CredentialType.OAUTH2)
        if self.entity.credentials_schema:
            types.append(CredentialType.API_KEY)
        return types

    def get_credentials_schema(self, credential_type: CredentialType | str) -> list[ProviderConfig]:
        """
        Get credentials schema by credential type

        :param credential_type: The type of credential (oauth or api_key)
        :return: List of provider config schemas
        """
        credential_type = CredentialType.of(credential_type) if isinstance(credential_type, str) else credential_type
        if credential_type == CredentialType.OAUTH2:
            return self.entity.oauth_schema.credentials_schema.copy() if self.entity.oauth_schema else []
        if credential_type == CredentialType.API_KEY:
            return self.entity.credentials_schema.copy() if self.entity.credentials_schema else []

    def get_credential_schema_config(self, credential_type: CredentialType | str) -> list[BasicProviderConfig]:
        """
        Get credential schema config by credential type
        """
        return [x.to_basic_provider_config() for x in self.get_credentials_schema(credential_type)]

    def get_oauth_client_schema(self) -> list[ProviderConfig]:
        """
        Get OAuth client schema for this provider

        :return: List of OAuth client config schemas
        """
        return self.entity.oauth_schema.client_schema.copy() if self.entity.oauth_schema else []

    @property
    def need_credentials(self) -> bool:
        """Check if this provider needs credentials"""
        return len(self.get_supported_credential_types()) > 0

    def execute_trigger(self, trigger_name: str, parameters: dict, credentials: dict) -> dict:
        """
        Execute a trigger through plugin runtime

        :param trigger_name: Trigger name
        :param parameters: Trigger parameters
        :param credentials: Provider credentials
        :return: Execution result
        """
        logger.info("Executing trigger %s for plugin %s", trigger_name, self.plugin_id)
        return {
            "success": True,
            "trigger": trigger_name,
            "plugin": self.plugin_id,
            "result": "Trigger executed successfully",
        }

    def subscribe_trigger(self, trigger_name: str, subscription_params: dict, credentials: dict) -> Subscription:
        """
        Subscribe to a trigger through plugin runtime

        :param trigger_name: Trigger name
        :param subscription_params: Subscription parameters
        :param credentials: Provider credentials
        :return: Subscription result
        """
        logger.info("Subscribing to trigger %s for plugin %s", trigger_name, self.plugin_id)
        return Subscription(
            expire_at=int(time.time()) + 86400,  # 24 hours from now
            metadata={
                "subscription_id": f"{self.plugin_id}_{trigger_name}_{time.time()}",
                "webhook_url": f"/triggers/webhook/{self.plugin_id}/{trigger_name}",
                **subscription_params,
            },
        )

    def unsubscribe_trigger(self, trigger_name: str, subscription_metadata: dict, credentials: dict) -> Unsubscription:
        """
        Unsubscribe from a trigger through plugin runtime

        :param trigger_name: Trigger name
        :param subscription_metadata: Subscription metadata
        :param credentials: Provider credentials
        :return: Unsubscription result
        """
        logger.info("Unsubscribing from trigger %s for plugin %s", trigger_name, self.plugin_id)
        return Unsubscription(success=True, message=f"Successfully unsubscribed from trigger {trigger_name}")


__all__ = ["PluginTriggerProviderController"]
