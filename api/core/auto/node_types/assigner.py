from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field

from .common import BlockEnum, CommonNodeType

# Import previously defined CommonNodeType and ValueSelector
# Assume they are defined in the same module


class WriteMode(str, Enum):
    overwrite = "over-write"
    clear = "clear"
    append = "append"
    extend = "extend"
    set = "set"
    increment = "+="
    decrement = "-="
    multiply = "*="
    divide = "/="


class AssignerNodeInputType(str, Enum):
    variable = "variable"
    constant = "constant"


class AssignerNodeOperation(BaseModel):
    variable_selector: Any  # Placeholder for ValueSelector type
    input_type: AssignerNodeInputType
    operation: WriteMode
    value: Any


class AssignerNodeType(CommonNodeType):
    version: Optional[str] = Field(None, pattern="^[12]$")  # Version is '1' or '2'
    items: list[AssignerNodeOperation]


# Example usage
if __name__ == "__main__":
    example_node = AssignerNodeType(
        title="Example Assigner Node",
        desc="An assigner node example",
        type=BlockEnum.variable_assigner,
        items=[
            AssignerNodeOperation(
                variable_selector={"nodeId": "node1", "key": "value"},  # Example ValueSelector
                input_type=AssignerNodeInputType.variable,
                operation=WriteMode.set,
                value="newValue",
            ),
            AssignerNodeOperation(
                variable_selector={"nodeId": "node2", "key": "value"},
                input_type=AssignerNodeInputType.constant,
                operation=WriteMode.increment,
                value=1,
            ),
        ],
    )
    print(example_node)
