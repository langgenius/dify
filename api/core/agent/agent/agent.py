from abc import abstractmethod
from typing import Sequence, Any, List, Tuple, Union

from langchain.agents import AgentOutputParser
from langchain.schema import AgentAction, AgentFinish
from langchain.tools import BaseTool
from pydantic import BaseModel

from core.model_providers.models.llm.base import BaseLLM


class Agent(BaseModel):
    model_instance: BaseLLM
    """The language model instance to use."""
    output_parser: AgentOutputParser
    """Output parser for the agent."""
    tools: Sequence[BaseTool]
    """Tools to use for the agent."""

    @abstractmethod
    def agent_thought_template(self) -> str:
        """Prompt template for the agent thought."""

    @abstractmethod
    def observation_template(self) -> str:
        """Prompt template for the observation."""

    @abstractmethod
    def construct_scratchpad(
        self, intermediate_steps: List[Tuple[AgentAction, str]]
    ) -> str:
        """Construct the scratchpad for the agent."""

    @abstractmethod
    def plan(
            self,
            intermediate_steps: List[Tuple[AgentAction, str]],
            **kwargs: Any,
    ) -> Union[AgentAction, AgentFinish]:
        """Given input, decided what to do.

        Args:
            intermediate_steps: Steps the LLM has taken to date,
                along with observations
            **kwargs: User inputs.

        Returns:
            Action specifying what tool to use.
        """

    def return_stopped_response(
        self,
        early_stopping_method: str,
        intermediate_steps: List[Tuple[AgentAction, str]],
        **kwargs: Any,
    ) -> AgentFinish:
        """Return response when agent has been stopped due to max iterations."""
        if early_stopping_method == "force":
            # `force` just returns a constant string
            return AgentFinish(
                {"output": "Agent stopped due to iteration limit or time limit."}, ""
            )
        else:
            raise ValueError(
                f"Got unsupported early_stopping_method `{early_stopping_method}`"
            )