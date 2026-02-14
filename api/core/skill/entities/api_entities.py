from pydantic import BaseModel, Field

from core.skill.entities.tool_dependencies import ToolDependency


class NodeSkillInfo(BaseModel):
    """Information about skills referenced by a workflow node."""

    node_id: str = Field(description="The node ID")
    tool_dependencies: list[ToolDependency] = Field(
        default_factory=list, description="Tool dependencies extracted from skill prompts"
    )

    @staticmethod
    def empty(node_id: str = "") -> "NodeSkillInfo":
        """Create an empty NodeSkillInfo with no tool dependencies."""
        return NodeSkillInfo(node_id=node_id, tool_dependencies=[])
