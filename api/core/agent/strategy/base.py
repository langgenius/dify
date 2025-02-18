from abc import ABC, abstractmethod
from collections.abc import Generator, Sequence
from typing import Any, Optional

from core.agent.entities import AgentInvokeMessage
from core.agent.plugin_entities import AgentStrategyParameter


class BaseAgentStrategy(ABC):
    """
    Agent Strategy
    """

    def invoke(
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
        yield from self._invoke(params, user_id, conversation_id, app_id, message_id)

    def get_parameters(self) -> Sequence[AgentStrategyParameter]:
        """
        Get the parameters for the agent strategy.
        """
        return []

    @abstractmethod
    def _invoke(
        self,
        params: dict[str, Any],
        user_id: str,
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[AgentInvokeMessage, None, None]:
        pass
