from pydantic import Field

from core.workflow.nodes.base import BaseNodeData


class HumanInputNodeData(BaseNodeData):
    """Configuration schema for the HumanInput node."""

    required_variables: list[str] = Field(default_factory=list)
    pause_reason: str = Field(
        default="",
        description="Reason why the workflow should pause at this node",
        max_length=255,
    )
