from abc import ABC
from typing import Optional

from pydantic import BaseModel


class BaseNodeData(ABC, BaseModel):
    title: str
    desc: Optional[str] = None
    version: str = "1"


class BaseIterationNodeData(BaseNodeData):
    start_node_id: Optional[str] = None


class BaseIterationState(BaseModel):
    iteration_node_id: str
    index: int
    inputs: dict

    class MetaData(BaseModel):
        pass

    metadata: MetaData
