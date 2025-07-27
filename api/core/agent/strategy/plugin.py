from collections.abc import Generator, Sequence
from typing import Any, Optional

from core.agent.entities import AgentInvokeMessage
from core.agent.plugin_entities import AgentStrategyEntity, AgentStrategyParameter
from core.agent.strategy.base import BaseAgentStrategy
from core.plugin.entities.request import InvokeCredentials, PluginInvokeContext
from core.plugin.impl.agent import PluginAgentClient
from core.plugin.utils.converter import convert_parameters_to_plugin_format


class PluginAgentStrategy(BaseAgentStrategy):
    """
    Agent Strategy
    """

    tenant_id: str
    declaration: AgentStrategyEntity
    meta_version: str | None = None

    def __init__(self, tenant_id: str, declaration: AgentStrategyEntity, meta_version: str | None):
        self.tenant_id = tenant_id
        self.declaration = declaration
        self.meta_version = meta_version

    def get_parameters(self) -> Sequence[AgentStrategyParameter]:
        return self.declaration.parameters

    def initialize_parameters(self, params: dict[str, Any]) -> dict[str, Any]:
        """
        Initialize the parameters for the agent strategy.
        """
        for parameter in self.declaration.parameters:
            params[parameter.name] = parameter.init_frontend_parameter(params.get(parameter.name))
        return params

    def _invoke(
        self,
        params: dict[str, Any],
        user_id: str,
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
        credentials: Optional[InvokeCredentials] = None,
    ) -> Generator[AgentInvokeMessage, None, None]:
        """
        Invoke the agent strategy.
        """
        manager = PluginAgentClient()

        initialized_params = self.initialize_parameters(params)
        params = convert_parameters_to_plugin_format(initialized_params)

        yield from manager.invoke(
            tenant_id=self.tenant_id,
            user_id=user_id,
            agent_provider=self.declaration.identity.provider,
            agent_strategy=self.declaration.identity.name,
            agent_params=params,
            conversation_id=conversation_id,
            app_id=app_id,
            message_id=message_id,
            context=PluginInvokeContext(credentials=credentials or InvokeCredentials()),
        )
