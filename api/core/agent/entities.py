from enum import Enum
from typing import Any, Literal, Optional, Union

from pydantic import BaseModel


class AgentToolEntity(BaseModel):
    """
    Agent Tool Entity.
    """

    provider_type: Literal["builtin", "api", "workflow"]
    provider_id: str
    tool_name: str
    tool_parameters: dict[str, Any] = {}


class AgentPromptEntity(BaseModel):
    """
    Agent Prompt Entity.
    """

    first_prompt: str
    next_iteration: str


class AgentScratchpadUnit(BaseModel):
    """
    Agent First Prompt Entity.
    """

    class Action(BaseModel):
        """
        Action Entity.
        """

        action_name: str
        action_input: Union[dict, str]

        def to_dict(self) -> dict:
            """
            Convert to dictionary.
            """
            return {
                "action": self.action_name,
                "action_input": self.action_input,
            }

    agent_response: Optional[str] = None
    thought: Optional[str] = None
    action_str: Optional[str] = None
    observation: Optional[str] = None
    action: Optional[Action] = None

    def is_final(self) -> bool:
        """
        Check if the scratchpad unit is final.
        """
        return self.action is None or (
            "final" in self.action.action_name.lower() and "answer" in self.action.action_name.lower()
        )


class AgentEntity(BaseModel):
    """
    Agent Entity.
    """

    class Strategy(Enum):
        """
        Agent Strategy.
        """

        CHAIN_OF_THOUGHT = "chain-of-thought"
        FUNCTION_CALLING = "function-calling"

    provider: str
    model: str
    strategy: Strategy
    prompt: Optional[AgentPromptEntity] = None
    tools: list[AgentToolEntity] = None
    max_iteration: int = 5
