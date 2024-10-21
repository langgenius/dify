from enum import Enum

from pydantic import BaseModel, Field

from core.workflow.nodes.base import BaseNodeData


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


class AnswerNodeDoubleLink(BaseModel):
    node_id: str = Field(..., description="node id")
    source_node_ids: list[str] = Field(..., description="source node ids")
    target_node_ids: list[str] = Field(..., description="target node ids")


class AnswerStreamGenerateRoute(BaseModel):
    """
    AnswerStreamGenerateRoute entity
    """

    answer_dependencies: dict[str, list[str]] = Field(
        ..., description="answer dependencies (answer node id -> dependent answer node ids)"
    )
    answer_generate_route: dict[str, list[GenerateRouteChunk]] = Field(
        ..., description="answer generate route (answer node id -> generate route chunks)"
    )
