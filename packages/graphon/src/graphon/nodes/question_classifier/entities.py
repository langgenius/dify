from pydantic import BaseModel, Field

from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import BuiltinNodeTypes, NodeType
from graphon.nodes.llm.entities import (
    ModelConfig,
    VisionConfig,
)
from graphon.prompt_entities import MemoryConfig


class ClassConfig(BaseModel):
    """Question Classifier branch configuration."""

    id: str = Field(
        description="Stable branch identifier used for routing and edge handles.",
    )
    name: str = Field(
        description=(
            "Classifier-facing category description used in prompts "
            "and returned as class_name."
        ),
    )
    label: str = Field(
        default="",
        description=(
            "Optional user-facing branch label exposed separately as class_label."
        ),
    )


class QuestionClassifierNodeData(BaseNodeData):
    type: NodeType = BuiltinNodeTypes.QUESTION_CLASSIFIER
    query_variable_selector: list[str]
    model: ModelConfig
    classes: list[ClassConfig]
    instruction: str | None = None
    memory: MemoryConfig | None = None
    vision: VisionConfig = Field(default_factory=VisionConfig)

    @property
    def structured_output_enabled(self) -> bool:
        # NOTE(QuantumGhost): Temporary workaround for issue #20725
        # (https://github.com/langgenius/dify/issues/20725).
        #
        # The proper fix would be to make `QuestionClassifierNode` inherit
        # from `BaseNode` instead of `LLMNode`.
        return False
