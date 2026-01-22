from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class VariableSelectorPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    variable: str = Field(..., description="Variable name used in generated code")
    value_selector: list[str] = Field(..., description="Path to upstream node output, format: [node_id, output_name]")


class CodeOutputPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str = Field(..., description="Output variable type")


class CodeContextPayload(BaseModel):
    # From web/app/components/workflow/nodes/tool/components/context-generate-modal/index.tsx (code node snapshot).
    model_config = ConfigDict(extra="forbid")

    code: str = Field(..., description="Existing code in the Code node")
    outputs: dict[str, CodeOutputPayload] | None = Field(
        default=None, description="Existing output definitions for the Code node"
    )
    variables: list[VariableSelectorPayload] | None = Field(
        default=None, description="Existing variable selectors used by the Code node"
    )


class AvailableVarPayload(BaseModel):
    # From web/app/components/workflow/nodes/_base/hooks/use-available-var-list.ts (available variables).
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    value_selector: list[str] = Field(..., description="Path to upstream node output")
    type: str = Field(..., description="Variable type, e.g. string, number, array[object]")
    description: str | None = Field(default=None, description="Optional variable description")
    node_id: str | None = Field(default=None, description="Source node ID")
    node_title: str | None = Field(default=None, description="Source node title")
    node_type: str | None = Field(default=None, description="Source node type")
    json_schema: dict[str, Any] | None = Field(
        default=None,
        alias="schema",
        description="Optional JSON schema for object variables",
    )


class ParameterInfoPayload(BaseModel):
    # From web/app/components/workflow/nodes/tool/use-config.ts (ToolParameter metadata).
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., description="Target parameter name")
    type: str = Field(default="string", description="Target parameter type")
    description: str = Field(default="", description="Parameter description")
    required: bool | None = Field(default=None, description="Whether the parameter is required")
    options: list[str] | None = Field(default=None, description="Allowed option values")
    min: float | None = Field(default=None, description="Minimum numeric value")
    max: float | None = Field(default=None, description="Maximum numeric value")
    default: str | int | float | bool | None = Field(default=None, description="Default value")
    multiple: bool | None = Field(default=None, description="Whether the parameter accepts multiple values")
    label: str | None = Field(default=None, description="Optional display label")
