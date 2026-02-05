"""
Type definitions for Vibe Workflow Generator.

This module provides:
- TypedDict classes for lightweight type hints (no runtime overhead)
- Pydantic models for runtime validation where needed

Usage:
    # For type hints only (no runtime validation):
    from core.workflow.generator.types import WorkflowNodeDict, WorkflowEdgeDict

    # For runtime validation:
    from core.workflow.generator.types import WorkflowNode, WorkflowEdge
"""

from typing import Any, TypedDict

from pydantic import BaseModel, Field

# ============================================================
# TypedDict definitions (lightweight, for type hints only)
# ============================================================


class WorkflowNodeDict(TypedDict, total=False):
    """
    Workflow node structure (TypedDict for hints).

    Attributes:
        id: Unique node identifier
        type: Node type (e.g., "start", "end", "llm", "if-else", "http-request")
        title: Human-readable node title
        config: Node-specific configuration
        data: Additional node data
    """

    id: str
    type: str
    title: str
    config: dict[str, Any]
    data: dict[str, Any]


class WorkflowEdgeDict(TypedDict, total=False):
    """
    Workflow edge structure (TypedDict for hints).

    Attributes:
        source: Source node ID
        target: Target node ID
        sourceHandle: Branch handle for if-else/question-classifier nodes
    """

    source: str
    target: str
    sourceHandle: str


class AvailableModelDict(TypedDict):
    """
    Available model structure.

    Attributes:
        provider: Model provider (e.g., "openai", "anthropic")
        model: Model name (e.g., "gpt-4", "claude-3")
    """

    provider: str
    model: str


class ToolParameterDict(TypedDict, total=False):
    """
    Tool parameter structure.

    Attributes:
        name: Parameter name
        type: Parameter type (e.g., "string", "number", "boolean")
        required: Whether parameter is required
        human_description: Human-readable description
        llm_description: LLM-oriented description
        options: Available options for enum-type parameters
    """

    name: str
    type: str
    required: bool
    human_description: str | dict[str, str]
    llm_description: str
    options: list[Any]


class AvailableToolDict(TypedDict, total=False):
    """
    Available tool structure.

    Attributes:
        provider_id: Tool provider ID
        provider: Tool provider name (alternative to provider_id)
        tool_key: Unique tool key
        tool_name: Tool name (alternative to tool_key)
        tool_description: Tool description
        description: Alternative description field
        is_team_authorization: Whether tool is configured/authorized
        parameters: List of tool parameters
    """

    provider_id: str
    provider: str
    tool_key: str
    tool_name: str
    tool_description: str
    description: str
    is_team_authorization: bool
    parameters: list[ToolParameterDict]


class WorkflowDataDict(TypedDict, total=False):
    """
    Complete workflow data structure.

    Attributes:
        nodes: List of workflow nodes
        edges: List of workflow edges
        warnings: List of warning messages
    """

    nodes: list[WorkflowNodeDict]
    edges: list[WorkflowEdgeDict]
    warnings: list[str]


# ============================================================
# Pydantic models (for runtime validation)
# ============================================================


class WorkflowNode(BaseModel):
    """
    Workflow node with runtime validation.

    Use this model when you need to validate node data at runtime.
    For lightweight type hints without validation, use WorkflowNodeDict.
    """

    id: str
    type: str
    title: str = ""
    config: dict[str, Any] = Field(default_factory=dict)
    data: dict[str, Any] = Field(default_factory=dict)


class WorkflowEdge(BaseModel):
    """
    Workflow edge with runtime validation.

    Use this model when you need to validate edge data at runtime.
    For lightweight type hints without validation, use WorkflowEdgeDict.
    """

    source: str
    target: str
    sourceHandle: str | None = None


class AvailableModel(BaseModel):
    """
    Available model with runtime validation.

    Use this model when you need to validate model data at runtime.
    For lightweight type hints without validation, use AvailableModelDict.
    """

    provider: str
    model: str


class ToolParameter(BaseModel):
    """Tool parameter with runtime validation."""

    name: str = ""
    type: str = "string"
    required: bool = False
    human_description: str | dict[str, str] = ""
    llm_description: str = ""
    options: list[Any] = Field(default_factory=list)


class AvailableTool(BaseModel):
    """
    Available tool with runtime validation.

    Use this model when you need to validate tool data at runtime.
    For lightweight type hints without validation, use AvailableToolDict.
    """

    provider_id: str = ""
    provider: str = ""
    tool_key: str = ""
    tool_name: str = ""
    tool_description: str = ""
    description: str = ""
    is_team_authorization: bool = False
    parameters: list[ToolParameter] = Field(default_factory=list)


class WorkflowData(BaseModel):
    """
    Complete workflow data with runtime validation.

    Use this model when you need to validate workflow data at runtime.
    For lightweight type hints without validation, use WorkflowDataDict.
    """

    nodes: list[WorkflowNode] = Field(default_factory=list)
    edges: list[WorkflowEdge] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
