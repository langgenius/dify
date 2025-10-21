from pydantic import Field

from core.workflow.nodes.base import BaseNodeData


class HumanInputNodeData(BaseNodeData):
    """Configuration schema for the HumanInput node."""

    required_variables: list[str] = Field(default_factory=list)
    pause_reason: str | None = Field(default=None)
