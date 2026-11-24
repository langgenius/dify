from typing import Literal

from pydantic import Field, model_validator

from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import BuiltinNodeTypes, NodeType
from models.agent_config_entities import WorkflowOutputRoutes


class DifyAgentNodeData(BaseNodeData):
    type: NodeType = BuiltinNodeTypes.AGENT
    agent_node_kind: Literal["dify_agent"]
    agent_task: str = ""
    # These values belong to the graph frozen at run start, including after a pause.
    continue_agent_session: bool = Field(default=True, strict=True)
    agent_session_generation: str = Field(
        default="", pattern=r"^(?:[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})?$", max_length=36
    )
    agent_output_routes: WorkflowOutputRoutes = Field(default_factory=WorkflowOutputRoutes)

    @model_validator(mode="after")
    def validate_version(self) -> "DifyAgentNodeData":
        if self.version != "2":
            raise ValueError("Dify Agent Node v2 requires version='2'")
        return self
