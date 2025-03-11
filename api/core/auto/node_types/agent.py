from typing import Any, Optional

from pydantic import BaseModel

from .common import BlockEnum, CommonNodeType

# Introduce previously defined CommonNodeType and ToolVarInputs
# Assume they are defined in the same module


class ToolVarInputs(BaseModel):
    variable_name: Optional[str] = None
    default_value: Optional[Any] = None


class AgentNodeType(CommonNodeType):
    agent_strategy_provider_name: Optional[str] = None
    agent_strategy_name: Optional[str] = None
    agent_strategy_label: Optional[str] = None
    agent_parameters: Optional[ToolVarInputs] = None
    output_schema: dict[str, Any]
    plugin_unique_identifier: Optional[str] = None


# 示例用法
if __name__ == "__main__":
    example_node = AgentNodeType(
        title="Example Agent",
        desc="An agent node example",
        type=BlockEnum.agent,
        output_schema={"key": "value"},
        agent_parameters=ToolVarInputs(variable_name="example_var", default_value="default"),
    )
    print(example_node)
