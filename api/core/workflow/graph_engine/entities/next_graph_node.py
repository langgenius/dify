from typing import Optional

from pydantic import BaseModel

from core.workflow.graph_engine.entities.graph import GraphParallel


class NextGraphNode(BaseModel):
    node_id: str
    """next node id"""

    parallel: Optional[GraphParallel] = None
    """parallel"""
