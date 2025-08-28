from typing import Any

from core.plugin.entities.plugin import TriggerProviderID
from core.plugin.entities.plugin_daemon import PluginTriggerProviderEntity
from core.plugin.impl.base import BasePluginClient


class PluginTriggerManager(BasePluginClient):
    def fetch_trigger_providers(self, tenant_id: str) -> list[PluginTriggerProviderEntity]:
        """
        Fetch tool providers for the given tenant.
        """

        def transformer(json_response: dict[str, Any]) -> dict:
            for provider in json_response.get("data", []):
                declaration = provider.get("declaration", {}) or {}
                provider_name = declaration.get("identity", {}).get("name")
                for trigger in declaration.get("triggers", []):
                    trigger["identity"]["provider"] = provider_name

            return json_response

        response = self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/management/triggers",
            list[PluginTriggerProviderEntity],
            params={"page": 1, "page_size": 256},
            transformer=transformer,
        )

        for provider in response:
            provider.declaration.identity.name = f"{provider.plugin_id}/{provider.declaration.identity.name}"

            # override the provider name for each tool to plugin_id/provider_name
            for trigger in provider.declaration.triggers:
                trigger.identity.provider = provider.declaration.identity.name

        return response

    def fetch_trigger_provider(self, tenant_id: str, provider_id: TriggerProviderID) -> PluginTriggerProviderEntity:
        """
        Fetch tool provider for the given tenant and plugin.
        """

        def transformer(json_response: dict[str, Any]) -> dict:
            data = json_response.get("data")
            if data:
                for trigger in data.get("declaration", {}).get("triggers", []):
                    trigger["identity"]["provider"] = provider_id.provider_name

            return json_response

        response = self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/management/trigger",
            PluginTriggerProviderEntity,
            params={"provider": provider_id.provider_name, "plugin_id": provider_id.plugin_id},
            transformer=transformer,
        )

        response.declaration.identity.name = f"{response.plugin_id}/{response.declaration.identity.name}"

        # override the provider name for each trigger to plugin_id/provider_name
        for trigger in response.declaration.triggers:
            trigger.identity.provider = response.declaration.identity.name

        return response
