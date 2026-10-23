"""Resolve plugin providers and dispatch dynamic option requests to their package."""

from collections.abc import Mapping, Sequence
from typing import Any

from core.plugin.entities.parameters import PluginParameterOption
from core.plugin.impl.dynamic_select import DynamicSelectClient
from core.tools.plugin_tool.provider import PluginToolProviderController
from core.tools.tool_manager import ToolManager
from core.trigger.provider import PluginTriggerProviderController
from core.trigger.trigger_manager import TriggerManager
from models.provider_ids import TriggerProviderID


class DaemonPluginParameterGateway:
    def get_tool_provider(self, *, tenant_id: str, provider: str) -> PluginToolProviderController:
        return ToolManager.get_plugin_provider(provider=provider, tenant_id=tenant_id)

    def get_trigger_provider(
        self, *, tenant_id: str, provider_id: TriggerProviderID
    ) -> PluginTriggerProviderController:
        return TriggerManager.get_trigger_provider(tenant_id=tenant_id, provider_id=provider_id)

    def fetch_options(
        self,
        *,
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        action: str,
        parameter: str,
        credentials: Mapping[str, Any],
        credential_type: str,
        plugin_unique_identifier: str,
    ) -> Sequence[PluginParameterOption]:
        return (
            DynamicSelectClient()
            .fetch_dynamic_select_options(
                tenant_id=tenant_id,
                user_id=user_id,
                plugin_id=plugin_id,
                provider=provider,
                action=action,
                credentials=credentials,
                credential_type=credential_type,
                parameter=parameter,
                plugin_unique_identifier=plugin_unique_identifier,
            )
            .options
        )
