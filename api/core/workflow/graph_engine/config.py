"""
GraphEngine configuration models.
"""

from pydantic import BaseModel, Field


class GraphEngineConfig(BaseModel):
    """Configuration for GraphEngine worker pool scaling."""

    min_workers: int = Field(default=1)
    max_workers: int = Field(default=5)
    scale_up_threshold: int = Field(default=3)
    scale_down_idle_time: float = Field(default=5.0)
