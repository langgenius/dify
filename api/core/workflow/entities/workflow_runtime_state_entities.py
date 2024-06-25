from enum import Enum
from typing import Optional

from pydantic import BaseModel

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.graph import Graph, GraphNode
from core.workflow.nodes.base_node import BaseNode, UserFrom
from models.workflow import WorkflowType


class RuntimeNode(BaseModel):
    class Status(Enum):
        RUNNING = "running"
        SUCCESS = "success"
        FAILED = "failed"
        PAUSED = "paused"

    id: str
    """random id for current runtime node"""

    graph_node: GraphNode
    """graph node"""

    node_instance: BaseNode
    """node instance"""

    node_run_result: Optional[NodeRunResult] = None
    """node run result"""

    status: Status = Status.RUNNING
    """node status"""

    start_at: float
    """start time"""

    paused_at: Optional[float] = None
    """paused time"""

    finished_at: Optional[float] = None
    """finished time"""

    failed_reason: Optional[str] = None
    """failed reason"""

    paused_by: Optional[str] = None
    """paused by"""


class WorkflowRuntimeState(BaseModel):
    tenant_id: str
    app_id: str
    workflow_id: str
    workflow_type: WorkflowType
    user_id: str
    user_from: UserFrom
    variable_pool: VariablePool
    invoke_from: InvokeFrom
    graph: Graph
    call_depth: int
    start_at: float

    total_tokens: int = 0
    node_run_steps: int = 0
