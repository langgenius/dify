from typing import Literal

from pydantic import model_validator

from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import BuiltinNodeTypes, NodeType


class DifyAgentNodeData(BaseNodeData):
    type: NodeType = BuiltinNodeTypes.AGENT
    agent_node_kind: Literal["dify_agent"] = "dify_agent"

    @model_validator(mode="after")
    def validate_version(self) -> "DifyAgentNodeData":
        if self.version != "2":
            raise ValueError("Dify Agent Node v2 requires version='2'")
        return self
