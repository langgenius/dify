"""Workflow Tool definitions that a run pins before execution begins and keeps across pauses."""

from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict

from core.tools.entities.tool_entities import ToolEntity
from core.tools.workflow_as_tool.repository import WorkflowToolSource
from core.tools.workflow_as_tool.tool import WorkflowTool


class WorkflowToolDefinition(BaseModel):
    """Serializable tool definition, without invocation state or credentials."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    app_id: str
    workflow_id: str
    version: str
    entity: ToolEntity
    label: str


class WorkflowToolSnapshot(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    tools: dict[str, WorkflowToolDefinition]


@dataclass(frozen=True)
class MaterializedWorkflowTools:
    sources: dict[str, WorkflowToolSource]
    # Multiple providers may refer to the same workflow with different definitions.
    tools: dict[str, WorkflowTool]

    def snapshot(self) -> WorkflowToolSnapshot:
        return WorkflowToolSnapshot(
            tools={
                provider_id: WorkflowToolDefinition(
                    app_id=tool.workflow_app_id,
                    workflow_id=tool.workflow_id,
                    version=tool.version,
                    entity=tool.entity.model_copy(deep=True),
                    label=tool.label,
                )
                for provider_id, tool in self.tools.items()
            }
        )
