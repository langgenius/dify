from typing import Optional

from pydantic import BaseModel

from .common import BlockEnum, CommonNodeType, Memory, ModelConfig, ValueSelector, VisionSetting

# Import previously defined CommonNodeType, Memory, ModelConfig, ValueSelector, and VisionSetting
# Assume they are defined in the same module


class Topic(BaseModel):
    """Topic for classification."""

    id: str
    name: str


class VisionConfig(BaseModel):
    """Vision configuration."""

    enabled: bool
    configs: Optional[VisionSetting] = None


class QuestionClassifierNodeType(CommonNodeType):
    """Question classifier node type implementation."""

    query_variable_selector: ValueSelector
    model: ModelConfig
    classes: list[Topic]
    instruction: str
    memory: Optional[Memory] = None
    vision: VisionConfig


# Example usage
if __name__ == "__main__":
    example_node = QuestionClassifierNodeType(
        title="Example Question Classifier Node",
        desc="A question classifier node example",
        type=BlockEnum.question_classifier,
        query_variable_selector=ValueSelector(value=["queryNode", "value"]),
        model=ModelConfig(
            provider="example_provider", name="example_model", mode="chat", completion_params={"temperature": 0.7}
        ),
        classes=[Topic(id="1", name="Science"), Topic(id="2", name="Mathematics"), Topic(id="3", name="Literature")],
        instruction="Classify the given question into the appropriate topic.",
        memory=Memory(window={"enabled": True, "size": 10}, query_prompt_template="Classify this question: {{query}}"),
        vision=VisionConfig(enabled=True, configs={"setting": "example_setting"}),
    )
    print(example_node)
