import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.graph import Graph, GraphNode
from core.workflow.nodes.base_node import UserFrom
from models.workflow import WorkflowNodeExecutionStatus, WorkflowType


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


class RuntimeGraph(BaseModel):
    runtime_nodes: dict[str, RuntimeNode] = {}
    """runtime nodes"""

    def add_runtime_node(self, runtime_node: RuntimeNode) -> None:
        self.runtime_nodes[runtime_node.id] = runtime_node

    def add_link(self, source_runtime_node_id: str, target_runtime_node_id: str) -> None:
        if source_runtime_node_id in self.runtime_nodes and target_runtime_node_id in self.runtime_nodes:
            target_runtime_node = self.runtime_nodes[target_runtime_node_id]
            target_runtime_node.predecessor_runtime_node_id = source_runtime_node_id

    def runtime_node_finished(self, runtime_node_id: str, node_run_result: NodeRunResult) -> None:
        if runtime_node_id in self.runtime_nodes:
            runtime_node = self.runtime_nodes[runtime_node_id]
            runtime_node.status = RuntimeNode.Status.SUCCESS \
                if node_run_result.status == WorkflowNodeExecutionStatus.RUNNING \
                else RuntimeNode.Status.FAILED
            runtime_node.node_run_result = node_run_result
            runtime_node.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
            runtime_node.failed_reason = node_run_result.error

    def runtime_node_paused(self, runtime_node_id: str, paused_by: Optional[str] = None) -> None:
        if runtime_node_id in self.runtime_nodes:
            runtime_node = self.runtime_nodes[runtime_node_id]
            runtime_node.status = RuntimeNode.Status.PAUSED
            runtime_node.paused_at = datetime.now(timezone.utc).replace(tzinfo=None)
            runtime_node.paused_by = paused_by


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

    runtime_graph: RuntimeGraph = Field(default_factory=RuntimeGraph)
