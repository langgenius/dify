"""Adapt plugin trigger declarations to the workspace provider query contract."""

from core.plugin.entities.plugin_daemon import CredentialType
from models.provider_ids import TriggerProviderID
from services.trigger.api_entities import TriggerProviderApiEntity
from services.trigger.provider_loader import PluginTriggerProviderLoader
from services.trigger.subscription_query_service import TriggerSubscriptionSchemas


class PluginTriggerProviderQuery:
    def __init__(self, *, providers: PluginTriggerProviderLoader) -> None:
        self._providers = providers

    def list(self, *, tenant_id: str) -> list[TriggerProviderApiEntity]:
        return [provider.to_api_entity() for provider in self._providers.list_plugin_trigger_providers(tenant_id)]

    def get(self, *, tenant_id: str, provider_id: TriggerProviderID) -> TriggerProviderApiEntity:
        return self._providers.get_trigger_provider(tenant_id, provider_id).to_api_entity()

    def get_icon(self, *, tenant_id: str, provider_id: TriggerProviderID) -> str:
        return self._providers.get_trigger_plugin_icon(tenant_id=tenant_id, provider_id=str(provider_id))

    def get_subscription_schemas(
        self,
        *,
        tenant_id: str,
        provider_id: TriggerProviderID,
        credential_types: frozenset[CredentialType],
    ) -> TriggerSubscriptionSchemas:
        provider = self._providers.get_trigger_provider(tenant_id, provider_id)
        return TriggerSubscriptionSchemas(
            credentials={
                credential_type: provider.get_credential_schema_config(credential_type)
                for credential_type in credential_types
            },
            properties=provider.get_properties_schema(),
        )
