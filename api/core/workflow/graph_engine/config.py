"""
GraphEngine configuration models.
"""

from pydantic import BaseModel


class GraphEngineConfig(BaseModel):
    """Configuration for GraphEngine worker pool scaling."""

    min_workers: int = 1
    max_workers: int = 5
    scale_up_threshold: int = 3
    scale_down_idle_time: float = 5.0
