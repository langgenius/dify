"""Adapt plugin provider discovery and dispatch for subscription management."""

from collections.abc import Mapping
from typing import Any

from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.entities.entities import Subscription, UnsubscribeResult
from core.trigger.errors import TriggerProviderCredentialValidationError
from core.trigger.provider import PluginTriggerProviderController
from core.trigger.trigger_manager import TriggerManager
from models.provider_ids import TriggerProviderID
from services.trigger.subscription_query_service import TriggerSubscriptionSchemas
from services.trigger.subscription_service import (
    TriggerSubscriptionInvalidError,
    TriggerSubscriptionProviderError,
)


class PluginTriggerSubscriptionGateway:
    """Reuse TriggerManager's context cache for one synchronous management operation."""

    def get_schemas(
        self, *, tenant_id: str, provider_id: TriggerProviderID, credential_type: CredentialType
    ) -> TriggerSubscriptionSchemas:
        provider = self._provider(tenant_id=tenant_id, provider_id=provider_id)
        return TriggerSubscriptionSchemas(
            credentials={credential_type: provider.get_credential_schema_config(credential_type)},
            properties=provider.get_properties_schema(),
        )

    def validate_credentials(
        self, *, tenant_id: str, provider_id: TriggerProviderID, user_id: str, credentials: Mapping[str, Any]
    ) -> None:
        provider = self._provider(tenant_id=tenant_id, provider_id=provider_id)
        try:
            provider.validate_credentials(user_id=user_id, credentials=credentials)
        except TriggerProviderCredentialValidationError as error:
            raise TriggerSubscriptionInvalidError(
                f"Invalid credentials for trigger provider {provider_id}: {error}"
            ) from error
        except Exception as error:
            raise TriggerSubscriptionProviderError(
                f"Failed to verify credentials for trigger provider {provider_id}."
            ) from error

    def subscribe(
        self,
        *,
        tenant_id: str,
        provider_id: TriggerProviderID,
        user_id: str,
        endpoint: str,
        parameters: Mapping[str, Any],
        credentials: Mapping[str, str],
        credential_type: CredentialType,
    ) -> Subscription:
        provider = self._provider(tenant_id=tenant_id, provider_id=provider_id)
        return provider.subscribe_trigger(
            user_id=user_id,
            endpoint=endpoint,
            parameters=parameters,
            credentials=credentials,
            credential_type=credential_type,
        )

    def unsubscribe(
        self,
        *,
        tenant_id: str,
        provider_id: TriggerProviderID,
        user_id: str,
        subscription: Subscription,
        credentials: Mapping[str, str],
        credential_type: CredentialType,
    ) -> UnsubscribeResult:
        provider = self._provider(tenant_id=tenant_id, provider_id=provider_id)
        return provider.unsubscribe_trigger(
            user_id=user_id,
            subscription=subscription,
            credentials=credentials,
            credential_type=credential_type,
        )

    @staticmethod
    def _provider(*, tenant_id: str, provider_id: TriggerProviderID) -> PluginTriggerProviderController:
        try:
            return TriggerManager.get_trigger_provider(tenant_id=tenant_id, provider_id=provider_id)
        except Exception as error:
            raise TriggerSubscriptionProviderError(f"Failed to load trigger provider {provider_id}.") from error
