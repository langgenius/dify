"""
Trigger Provider Controller for managing trigger providers
"""

import logging
from collections.abc import Mapping
from typing import Any, Optional

from flask import Request

from core.entities.provider_entities import BasicProviderConfig
from core.plugin.entities.plugin import TriggerProviderID
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.entities.request import (
    TriggerDispatchResponse,
    TriggerInvokeResponse,
)
from core.plugin.impl.trigger import PluginTriggerManager
from core.trigger.entities.api_entities import TriggerApiEntity, TriggerProviderApiEntity
from core.trigger.entities.entities import (
    ProviderConfig,
    Subscription,
    SubscriptionSchema,
    TriggerCreationMethod,
    TriggerEntity,
    TriggerProviderEntity,
    TriggerProviderIdentity,
    Unsubscription,
)
from core.trigger.errors import TriggerProviderCredentialValidationError
from services.plugin.plugin_service import PluginService

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
        provider_id: TriggerProviderID,
        tenant_id: str,
    ):
        """
        Initialize plugin trigger provider controller

        :param entity: Trigger provider entity
        :param plugin_id: Plugin ID
        :param plugin_unique_identifier: Plugin unique identifier
        :param provider_id: Provider ID
        :param tenant_id: Tenant ID
        """
        self.entity = entity
        self.tenant_id = tenant_id
        self.plugin_id = plugin_id
        self.provider_id = provider_id
        self.plugin_unique_identifier = plugin_unique_identifier

    def get_provider_id(self) -> TriggerProviderID:
        """
        Get provider ID
        """
        return self.provider_id

    def to_api_entity(self) -> TriggerProviderApiEntity:
        """
        Convert to API entity
        """
        icon = (
            PluginService.get_plugin_icon_url(self.tenant_id, self.entity.identity.icon)
            if self.entity.identity.icon
            else None
        )
        icon_dark = (
            PluginService.get_plugin_icon_url(self.tenant_id, self.entity.identity.icon_dark)
            if self.entity.identity.icon_dark
            else None
        )
        supported_creation_methods = []
        if self.entity.oauth_schema:
            supported_creation_methods.append(TriggerCreationMethod.OAUTH)
        if self.entity.credentials_schema:
            supported_creation_methods.append(TriggerCreationMethod.APIKEY)
        if self.entity.subscription_schema:
            supported_creation_methods.append(TriggerCreationMethod.MANUAL)
        return TriggerProviderApiEntity(
            author=self.entity.identity.author,
            name=self.entity.identity.name,
            label=self.entity.identity.label,
            description=self.entity.identity.description,
            icon=icon,
            icon_dark=icon_dark,
            tags=self.entity.identity.tags,
            plugin_id=self.plugin_id,
            plugin_unique_identifier=self.plugin_unique_identifier,
            credentials_schema=self.entity.credentials_schema,
            oauth_client_schema=self.entity.oauth_schema.client_schema if self.entity.oauth_schema else [],
            subscription_schema=self.entity.subscription_schema,
            supported_creation_methods=supported_creation_methods,
            triggers=[
                TriggerApiEntity(
                    name=trigger.identity.name,
                    identity=trigger.identity,
                    description=trigger.description,
                    parameters=trigger.parameters,
                    output_schema=trigger.output_schema,
                )
                for trigger in self.entity.triggers
            ],
        )

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

    def get_subscription_schema(self) -> SubscriptionSchema:
        """
        Get subscription schema for this provider

        :return: List of subscription config schemas
        """
        return self.entity.subscription_schema

    def validate_credentials(self, user_id: str, credentials: Mapping[str, str]) -> None:
        """
        Validate credentials against schema

        :param credentials: Credentials to validate
        :return: Validation response
        """
        # First validate against schema
        for config in self.entity.credentials_schema:
            if config.required and config.name not in credentials:
                raise TriggerProviderCredentialValidationError(f"Missing required credential field: {config.name}")

        # Then validate with the plugin daemon
        manager = PluginTriggerManager()
        provider_id = self.get_provider_id()
        response = manager.validate_provider_credentials(
            tenant_id=self.tenant_id,
            user_id=user_id,
            provider=str(provider_id),
            credentials=credentials,
        )
        if not response:
            raise TriggerProviderCredentialValidationError(
                "Invalid credentials",
            )

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
        if credential_type == CredentialType.UNAUTHORIZED:
            return []
        raise ValueError(f"Invalid credential type: {credential_type}")

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

    def get_properties_schema(self) -> list[BasicProviderConfig]:
        """
        Get properties schema for this provider

        :return: List of properties config schemas
        """
        return (
            [x.to_basic_provider_config() for x in self.entity.subscription_schema.properties_schema.copy()]
            if self.entity.subscription_schema.properties_schema
            else []
        )

    def dispatch(self, user_id: str, request: Request, subscription: Subscription) -> TriggerDispatchResponse:
        """
        Dispatch a trigger through plugin runtime

        :param user_id: User ID
        :param request: Flask request object
        :param subscription: Subscription
        :return: Dispatch response with triggers and raw HTTP response
        """
        manager = PluginTriggerManager()
        provider_id = self.get_provider_id()

        response = manager.dispatch_event(
            tenant_id=self.tenant_id,
            user_id=user_id,
            provider=str(provider_id),
            subscription=subscription.model_dump(),
            request=request,
        )
        return response

    def invoke_trigger(
        self,
        user_id: str,
        trigger_name: str,
        parameters: Mapping[str, Any],
        credentials: Mapping[str, str],
        credential_type: CredentialType,
        request: Request,
    ) -> TriggerInvokeResponse:
        """
        Execute a trigger through plugin runtime

        :param user_id: User ID
        :param trigger_name: Trigger name
        :param parameters: Trigger parameters
        :param credentials: Provider credentials
        :param credential_type: Credential type
        :param request: Request
        :return: Trigger execution result
        """
        manager = PluginTriggerManager()
        provider_id = self.get_provider_id()

        return manager.invoke_trigger(
            tenant_id=self.tenant_id,
            user_id=user_id,
            provider=str(provider_id),
            trigger=trigger_name,
            credentials=credentials,
            credential_type=credential_type,
            request=request,
            parameters=parameters,
        )

    def subscribe_trigger(
        self, user_id: str, endpoint: str, parameters: Mapping[str, Any], credentials: Mapping[str, str]
    ) -> Subscription:
        """
        Subscribe to a trigger through plugin runtime

        :param user_id: User ID
        :param endpoint: Subscription endpoint
        :param subscription_params: Subscription parameters
        :param credentials: Provider credentials
        :return: Subscription result
        """
        manager = PluginTriggerManager()
        provider_id = self.get_provider_id()

        response = manager.subscribe(
            tenant_id=self.tenant_id,
            user_id=user_id,
            provider=str(provider_id),
            credentials=credentials,
            endpoint=endpoint,
            parameters=parameters,
        )

        return Subscription.model_validate(response.subscription)

    def unsubscribe_trigger(
        self, user_id: str, subscription: Subscription, credentials: Mapping[str, str]
    ) -> Unsubscription:
        """
        Unsubscribe from a trigger through plugin runtime

        :param user_id: User ID
        :param subscription: Subscription metadata
        :param credentials: Provider credentials
        :return: Unsubscription result
        """
        manager = PluginTriggerManager()
        provider_id = self.get_provider_id()

        response = manager.unsubscribe(
            tenant_id=self.tenant_id,
            user_id=user_id,
            provider=str(provider_id),
            subscription=subscription,
            credentials=credentials,
        )

        return Unsubscription.model_validate(response.subscription)

    def refresh_trigger(self, subscription: Subscription, credentials: Mapping[str, str]) -> Subscription:
        """
        Refresh a trigger subscription through plugin runtime

        :param subscription: Subscription metadata
        :param credentials: Provider credentials
        :return: Refreshed subscription result
        """
        manager = PluginTriggerManager()
        provider_id = self.get_provider_id()

        response = manager.refresh(
            tenant_id=self.tenant_id,
            user_id="system",  # System refresh
            provider=str(provider_id),
            subscription=subscription,
            credentials=credentials,
        )

        return Subscription.model_validate(response.subscription)


__all__ = ["PluginTriggerProviderController"]
