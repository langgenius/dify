"""Capabilities consumed by the dispatcher across application generation modes."""

from typing import Protocol

from services.agent.chat.ports import AgentDatasetTools
from services.app.generation.agent_config import AgentAppConfigurations
from services.workflow.execution.chatflow_ports import ChatflowRuntime


class AppGenerationRuntime(ChatflowRuntime, Protocol):
    @property
    def dataset_tools(self) -> AgentDatasetTools: ...
    @property
    def agent_configs(self) -> AgentAppConfigurations: ...
