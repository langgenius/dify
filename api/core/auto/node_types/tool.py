from enum import Enum
from typing import Any, Optional, Union

from pydantic import BaseModel

from .common import BlockEnum, CommonNodeType, ValueSelector

# Import previously defined CommonNodeType and ValueSelector
# Assume they are defined in the same module


class VarType(str, Enum):
    variable = "variable"
    constant = "constant"
    mixed = "mixed"


class ToolVarInputs(BaseModel):
    type: VarType
    value: Optional[Union[str, ValueSelector, Any]] = None


class ToolNodeType(CommonNodeType):
    """Tool node type implementation."""

    provider_id: str
    provider_type: Any  # Placeholder for CollectionType
    provider_name: str
    tool_name: str
    tool_label: str
    tool_parameters: dict[str, ToolVarInputs]
    tool_configurations: dict[str, Any]
    output_schema: dict[str, Any]


# Example usage
if __name__ == "__main__":
    example_node = ToolNodeType(
        title="Example Tool Node",
        desc="A tool node example",
        type=BlockEnum.tool,
        provider_id="12345",
        provider_type="some_collection_type",  # Placeholder for CollectionType
        provider_name="Example Provider",
        tool_name="Example Tool",
        tool_label="Example Tool Label",
        tool_parameters={
            "input1": ToolVarInputs(type=VarType.variable, value="some_value"),
            "input2": ToolVarInputs(type=VarType.constant, value="constant_value"),
        },
        tool_configurations={"config1": "value1", "config2": {"nested": "value2"}},
        output_schema={"output1": "string", "output2": "number"},
    )
    print(example_node.json(indent=2))  # Print as JSON format for viewing
