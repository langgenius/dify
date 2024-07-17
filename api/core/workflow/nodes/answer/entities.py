from enum import Enum

from pydantic import BaseModel, Field

from core.workflow.entities.base_node_data_entities import BaseNodeData


class AnswerNodeData(BaseNodeData):
    """
    Answer Node Data.
    """
    answer: str = Field(..., description="answer template string")


class GenerateRouteChunk(BaseModel):
    """
    Generate Route Chunk.
    """

    class ChunkType(Enum):
        VAR = "var"
        TEXT = "text"

    type: ChunkType = Field(..., description="generate route chunk type")


class VarGenerateRouteChunk(GenerateRouteChunk):
    """
    Var Generate Route Chunk.
    """
    type: GenerateRouteChunk.ChunkType = GenerateRouteChunk.ChunkType.VAR
    """generate route chunk type"""
    value_selector: list[str] = Field(..., description="value selector")


class TextGenerateRouteChunk(GenerateRouteChunk):
    """
    Text Generate Route Chunk.
    """
    type: GenerateRouteChunk.ChunkType = GenerateRouteChunk.ChunkType.TEXT
    """generate route chunk type"""
    text: str = Field(..., description="text")


class AnswerStreamGenerateRoute(BaseModel):
    """
    ChatflowStreamGenerateRoute entity
    """
    answer_node_id: str = Field(..., description="answer node ID")
    generate_route: list[GenerateRouteChunk] = Field(..., description="answer stream generate route")
    current_route_position: int = 0
    """current generate route position"""
