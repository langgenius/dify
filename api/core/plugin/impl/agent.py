from collections.abc import Generator
from typing import Any

from core.agent.entities import AgentInvokeMessage
from core.plugin.entities.plugin_daemon import (
    PluginAgentProviderEntity,
)
from core.plugin.entities.request import PluginInvokeContext
from core.plugin.impl.base import BasePluginClient
from core.plugin.utils.chunk_merger import merge_blob_chunks
from models.provider_ids import GenericProviderID


class PluginAgentClient(BasePluginClient):
    def fetch_agent_strategy_providers(self, tenant_id: str) -> list[PluginAgentProviderEntity]:
        """
        Fetch agent providers for the given tenant.
        """

        def transformer(json_response: dict[str, Any]):
            for provider in json_response.get("data", []):
                declaration = provider.get("declaration", {}) or {}
                provider_name = declaration.get("identity", {}).get("name")
                for strategy in declaration.get("strategies", []):
                    strategy["identity"]["provider"] = provider_name

            return json_response

        response = self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/management/agent_strategies",
            list[PluginAgentProviderEntity],
            params={"page": 1, "page_size": 256},
            transformer=transformer,
        )

        for provider in response:
            provider.declaration.identity.name = f"{provider.plugin_id}/{provider.declaration.identity.name}"

            # override the provider name for each tool to plugin_id/provider_name
            for strategy in provider.declaration.strategies:
                strategy.identity.provider = provider.declaration.identity.name

        return response

    def fetch_agent_strategy_provider(self, tenant_id: str, provider: str) -> PluginAgentProviderEntity:
        """
        Fetch tool provider for the given tenant and plugin.
        """
        agent_provider_id = GenericProviderID(provider)

        def transformer(json_response: dict[str, Any]):
            # skip if error occurs
            if json_response.get("data") is None or json_response.get("data", {}).get("declaration") is None:
                return json_response

            for strategy in json_response.get("data", {}).get("declaration", {}).get("strategies", []):
                strategy["identity"]["provider"] = agent_provider_id.provider_name

            return json_response

        response = self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/management/agent_strategy",
            PluginAgentProviderEntity,
            params={"provider": agent_provider_id.provider_name, "plugin_id": agent_provider_id.plugin_id},
            transformer=transformer,
        )

        response.declaration.identity.name = f"{response.plugin_id}/{response.declaration.identity.name}"

        # override the provider name for each tool to plugin_id/provider_name
        for strategy in response.declaration.strategies:
            strategy.identity.provider = response.declaration.identity.name

        return response

    def invoke(
        self,
        tenant_id: str,
        user_id: str,
        agent_provider: str,
        agent_strategy: str,
        agent_params: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
        context: PluginInvokeContext | None = None,
    ) -> Generator[AgentInvokeMessage, None, None]:
        """
        Invoke the agent with the given tenant, user, plugin, provider, name and parameters.
        """

        agent_provider_id = GenericProviderID(agent_provider)

        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/agent_strategy/invoke",
            AgentInvokeMessage,
            data={
                "user_id": user_id,
                "conversation_id": conversation_id,
                "app_id": app_id,
                "message_id": message_id,
                "context": context.model_dump() if context else {},
                "data": {
                    "agent_strategy_provider": agent_provider_id.provider_name,
                    "agent_strategy": agent_strategy,
                    "agent_strategy_params": agent_params,
                },
            },
            headers={
                "X-Plugin-ID": agent_provider_id.plugin_id,
                "Content-Type": "application/json",
            },
        )
        return merge_blob_chunks(response)
