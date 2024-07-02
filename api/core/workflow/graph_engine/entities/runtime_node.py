import uuid
from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.graph_engine.entities.graph import GraphNode


class RuntimeNode(BaseModel):
    class Status(Enum):
        PENDING = "pending"
        RUNNING = "running"
        SUCCESS = "success"
        FAILED = "failed"
        PAUSED = "paused"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    """random id for current runtime node"""

    graph_node: GraphNode
    """graph node"""

    node_run_result: Optional[NodeRunResult] = None
    """node run result"""

    status: Status = Status.PENDING
    """node status"""

    start_at: Optional[datetime] = None
    """start time"""

    paused_at: Optional[datetime] = None
    """paused time"""

    finished_at: Optional[datetime] = None
    """finished time"""

    failed_reason: Optional[str] = None
    """failed reason"""

    paused_by: Optional[str] = None
    """paused by"""

    predecessor_runtime_node_id: Optional[str] = None
    """predecessor runtime node id"""
