"""Adapt plugin trigger declarations to the workspace provider query contract."""

from core.trigger.entities.api_entities import TriggerProviderApiEntity
from core.trigger.trigger_manager import TriggerManager
from models.provider_ids import TriggerProviderID


class PluginTriggerProviderQuery:
    def list(self, *, tenant_id: str) -> list[TriggerProviderApiEntity]:
        return [provider.to_api_entity() for provider in TriggerManager.list_all_trigger_providers(tenant_id)]

    def get(self, *, tenant_id: str, provider_id: TriggerProviderID) -> TriggerProviderApiEntity:
        return TriggerManager.get_trigger_provider(tenant_id, provider_id).to_api_entity()

    def get_icon(self, *, tenant_id: str, provider_id: TriggerProviderID) -> str:
        return TriggerManager.get_trigger_plugin_icon(tenant_id=tenant_id, provider_id=str(provider_id))
