from __future__ import annotations

from pydantic import BaseModel

from core.workflow.entities.base_node import BaseNodeData, OutputVariableEntity, RetryConfig, VariableSelector

from .exc import BaseNodeError, DefaultValueTypeError


class BaseIterationNodeData(BaseNodeData):
    start_node_id: str | None = None


class BaseIterationState(BaseModel):
    iteration_node_id: str
    index: int
    inputs: dict

    class MetaData(BaseModel):
        pass

    metadata: MetaData


class BaseLoopNodeData(BaseNodeData):
    start_node_id: str | None = None


class BaseLoopState(BaseModel):
    loop_node_id: str
    index: int
    inputs: dict

    class MetaData(BaseModel):
        pass

    metadata: MetaData


__all__ = [
    "BaseIterationNodeData",
    "BaseIterationState",
    "BaseLoopNodeData",
    "BaseLoopState",
    "BaseNodeData",
    "BaseNodeError",
    "DefaultValueTypeError",
    "OutputVariableEntity",
    "RetryConfig",
    "VariableSelector",
]
