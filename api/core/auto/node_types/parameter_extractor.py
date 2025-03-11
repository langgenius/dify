from enum import Enum
from typing import Optional

from pydantic import BaseModel

from .common import BlockEnum, CommonNodeType, Memory, ModelConfig, ValueSelector, VisionSetting

# Import previously defined CommonNodeType, Memory, ModelConfig, ValueSelector, and VisionSetting
# Assume they are defined in the same module


class ParamType(str, Enum):
    """Parameter types for extraction."""

    string = "string"
    number = "number"
    bool = "bool"
    select = "select"
    arrayString = "array[string]"
    arrayNumber = "array[number]"
    arrayObject = "array[object]"


class Param(BaseModel):
    """Parameter definition for extraction."""

    name: str
    type: ParamType
    options: Optional[list[str]] = None
    description: str
    required: Optional[bool] = None


class ReasoningModeType(str, Enum):
    """Reasoning mode types for parameter extraction."""

    prompt = "prompt"
    functionCall = "function_call"


class VisionConfig(BaseModel):
    """Vision configuration."""

    enabled: bool
    configs: Optional[VisionSetting] = None


class ParameterExtractorNodeType(CommonNodeType):
    """Parameter extractor node type implementation."""

    model: ModelConfig
    query: ValueSelector
    reasoning_mode: ReasoningModeType
    parameters: List[Param]
    instruction: str
    memory: Optional[Memory] = None
    vision: VisionConfig


# Example usage
if __name__ == "__main__":
    example_node = ParameterExtractorNodeType(
        title="Example Parameter Extractor Node",
        desc="A parameter extractor node example",
        type=BlockEnum.parameter_extractor,
        model=ModelConfig(
            provider="example_provider", name="example_model", mode="chat", completion_params={"temperature": 0.7}
        ),
        query=ValueSelector(value=["queryNode", "value"]),
        reasoning_mode=ReasoningModeType.prompt,
        parameters=[
            Param(name="param1", type=ParamType.string, description="This is a string parameter", required=True),
            Param(
                name="param2",
                type=ParamType.number,
                options=["1", "2", "3"],
                description="This is a number parameter",
                required=False,
            ),
        ],
        instruction="Please extract the parameters from the input.",
        memory=Memory(window={"enabled": True, "size": 10}, query_prompt_template="Extract parameters from: {{query}}"),
        vision=VisionConfig(enabled=True, configs={"setting": "example_setting"}),
    )
    print(example_node)
