from abc import ABC
from typing import Any, Optional

from pydantic import BaseModel

from core.workflow.nodes.enums import ErrorStrategy


class BaseNodeData(ABC, BaseModel):
    title: str
    desc: Optional[str] = None
    error_strategy: Optional[ErrorStrategy] = None
    default_value: Optional[Any] = None


class BaseIterationNodeData(BaseNodeData):
    start_node_id: Optional[str] = None


class BaseIterationState(BaseModel):
    iteration_node_id: str
    index: int
    inputs: dict

    class MetaData(BaseModel):
        pass

    metadata: MetaData
