
from pydantic import BaseModel

from core.workflow.entities.base_node_data_entities import BaseNodeData


class AnswerNodeData(BaseNodeData):
    """
    Answer Node Data.
    """
    answer: str


class GenerateRouteChunk(BaseModel):
    """
    Generate Route Chunk.
    """
    type: str


class VarGenerateRouteChunk(GenerateRouteChunk):
    """
    Var Generate Route Chunk.
    """
    type: str = "var"
    value_selector: list[str]


class TextGenerateRouteChunk(GenerateRouteChunk):
    """
    Text Generate Route Chunk.
    """
    type: str = "text"
    text: str
