"""
Unified Pydantic models for Workflow Generator.

All type definitions use Pydantic for:
- Runtime validation
- JSON serialization
- Clear schema documentation
"""

from typing import Any

from pydantic import BaseModel, Field

from core.workflow.generator.types.constants import INTENT_GENERATE


class WorkflowNode(BaseModel):
    """Workflow node configuration."""

    id: str
    type: str
    title: str = ""
    config: dict[str, Any] = Field(default_factory=dict)
    data: dict[str, Any] = Field(default_factory=dict)


class WorkflowEdge(BaseModel):
    """Workflow edge connection."""

    source: str
    target: str
    sourceHandle: str | None = None


class AvailableModel(BaseModel):
    """Available model configuration."""

    provider: str
    model: str


class ToolParameter(BaseModel):
    """Tool parameter definition."""

    name: str = ""
    type: str = "string"
    required: bool = False
    human_description: str | dict[str, str] = ""
    llm_description: str = ""
    options: list[Any] = Field(default_factory=list)


class AvailableTool(BaseModel):
    """Available tool configuration."""

    provider_id: str = ""
    provider: str = ""
    tool_key: str = ""
    tool_name: str = ""
    tool_description: str = ""
    description: str = ""
    is_team_authorization: bool = False
    parameters: list[ToolParameter] = Field(default_factory=list)


class WorkflowData(BaseModel):
    """Complete workflow data."""

    nodes: list[WorkflowNode] = Field(default_factory=list)
    edges: list[WorkflowEdge] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class GenerationResult(BaseModel):
    """Result of workflow generation."""

    intent: str = INTENT_GENERATE
    flowchart: str = ""
    nodes: list[dict[str, Any]] = Field(default_factory=list)
    edges: list[dict[str, Any]] = Field(default_factory=list)
    message: str = ""
    warnings: list[str] = Field(default_factory=list)
    error: str = ""
    error_code: str | None = None
    retry_count: int = 0
