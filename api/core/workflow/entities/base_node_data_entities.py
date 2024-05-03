from abc import ABC
from typing import Optional

from pydantic import BaseModel


class BaseNodeData(ABC, BaseModel):
    title: str
    desc: Optional[str] = None

class BaseIterationNodeData(ABC, BaseNodeData):
    start_node_id: str

class BaseIterationState(ABC):
    iteration_node_id: str
    index: int