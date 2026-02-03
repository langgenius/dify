from pydantic import Field

from core.workflow.enums import NodeType
from core.workflow.nodes.base import BaseNodeData


class HumanInputNodeData(BaseNodeData):
    """Configuration schema for the HumanInput node."""

    type: NodeType = NodeType.HUMAN_INPUT
    required_variables: list[str] = Field(default_factory=list)
    pause_reason: str | None = Field(default=None)
