from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel

from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.graph_engine.entities.runtime_node import RuntimeNode
from models.workflow import WorkflowNodeExecutionStatus


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
