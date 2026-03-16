from pydantic import BaseModel, Field

from core.prompt.entities.advanced_prompt_entities import MemoryConfig
from dify_graph.entities.base_node_data import BaseNodeData
from dify_graph.enums import BuiltinNodeTypes, NodeType
from dify_graph.nodes.llm import ModelConfig, VisionConfig


class ClassConfig(BaseModel):
    id: str
    name: str


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
