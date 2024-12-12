from typing import Any, Generator, Optional, Sequence

from core.agent.entities import AgentInvokeMessage
from core.agent.plugin_entities import AgentStrategyParameter, AgentStrategyEntity
from core.agent.strategy.base import BaseAgentStrategy
from core.plugin.manager.agent import PluginAgentManager
from core.tools.plugin_tool.tool import PluginTool


class PluginAgentStrategy(BaseAgentStrategy):
    """
    Agent Strategy
    """

    tenant_id: str
    plugin_unique_identifier: str
    declaration: AgentStrategyEntity

    def __init__(self, tenant_id: str, plugin_unique_identifier: str, declaration: AgentStrategyEntity):
        self.tenant_id = tenant_id
        self.plugin_unique_identifier = plugin_unique_identifier
        self.declaration = declaration

    def get_parameters(self) -> Sequence[AgentStrategyParameter]:
        return self.declaration.parameters

    def _invoke(
        self,
        params: dict[str, Any],
        user_id: str,
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[AgentInvokeMessage, None, None]:
        """
        Invoke the agent strategy.
        """
        manager = PluginAgentManager()

        # convert agent parameters with File type to PluginFileEntity
        params = PluginTool._transform_image_parameters(params)

        yield from manager.invoke(
            tenant_id=self.tenant_id,
            user_id=user_id,
            agent_provider=self.declaration.identity.provider,
            agent_strategy=self.declaration.identity.name,
            agent_params=params,
            conversation_id=conversation_id,
            app_id=app_id,
            message_id=message_id,
        )
