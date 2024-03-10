from typing import Optional

from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import BaseNode
from models.workflow import Workflow, WorkflowType


class WorkflowNodeAndResult:
    node: BaseNode
    result: Optional[NodeRunResult] = None

    def __init__(self, node: BaseNode, result: Optional[NodeRunResult] = None):
        self.node = node
        self.result = result


class WorkflowRunState:
    tenant_id: str
    app_id: str
    workflow_id: str
    workflow_type: WorkflowType

    start_at: float
    variable_pool: VariablePool

    total_tokens: int = 0

    workflow_nodes_and_results: list[WorkflowNodeAndResult] = []

    def __init__(self, workflow: Workflow, start_at: float, variable_pool: VariablePool):
        self.workflow_id = workflow.id
        self.tenant_id = workflow.tenant_id
        self.app_id = workflow.app_id
        self.workflow_type = WorkflowType.value_of(workflow.type)

        self.start_at = start_at
        self.variable_pool = variable_pool
