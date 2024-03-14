
from pydantic import BaseModel

from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.variable_entities import VariableSelector


class AnswerNodeData(BaseNodeData):
    """
    Answer Node Data.
    """
    variables: list[VariableSelector] = []
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
