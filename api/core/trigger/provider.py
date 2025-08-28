"""
Trigger Provider Controller for managing trigger providers
"""

import logging
import time
from typing import Optional

from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.entities import (
    ProviderConfig,
    Subscription,
    TriggerEntity,
    TriggerProviderEntity,
    TriggerProviderIdentity,
    Unsubscription,
)

logger = logging.getLogger(__name__)


class TriggerProviderController:
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

    def get_credentials_schema(self) -> list[ProviderConfig]:
        """
        Get credentials schema for this provider

        :return: List of provider config schemas
        """
        return self.entity.credentials_schema

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

    def get_credentials_schema_by_type(self, credential_type: str) -> list[ProviderConfig]:
        """
        Get credentials schema by credential type

        :param credential_type: The type of credential (oauth or api_key)
        :return: List of provider config schemas
        """
        if credential_type == CredentialType.OAUTH2.value:
            return self.entity.oauth_schema.credentials_schema.copy() if self.entity.oauth_schema else []
        if credential_type == CredentialType.API_KEY.value:
            return self.entity.credentials_schema.copy() if self.entity.credentials_schema else []
        raise ValueError(f"Invalid credential type: {credential_type}")

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

    def handle_webhook(self, webhook_path: str, request_data: dict, credentials: dict) -> dict:
        """
        Handle incoming webhook through plugin runtime

        :param webhook_path: Webhook path
        :param request_data: Request data
        :param credentials: Provider credentials
        :return: Webhook handling result
        """
        logger.info("Handling webhook for path %s for plugin %s", webhook_path, self.plugin_id)
        return {"success": True, "path": webhook_path, "plugin": self.plugin_id, "data_received": request_data}


__all__ = ["TriggerProviderController"]
