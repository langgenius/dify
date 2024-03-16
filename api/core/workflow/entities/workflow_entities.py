from typing import Optional

from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import BaseNode, UserFrom
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
    user_id: str
    user_from: UserFrom

    start_at: float
    variable_pool: VariablePool

    total_tokens: int = 0

    workflow_nodes_and_results: list[WorkflowNodeAndResult]

    def __init__(self, workflow: Workflow,
                 start_at: float,
                 variable_pool: VariablePool,
                 user_id: str,
                 user_from: UserFrom):
        self.workflow_id = workflow.id
        self.tenant_id = workflow.tenant_id
        self.app_id = workflow.app_id
        self.workflow_type = WorkflowType.value_of(workflow.type)
        self.user_id = user_id
        self.user_from = user_from

        self.start_at = start_at
        self.variable_pool = variable_pool

        self.total_tokens = 0
        self.workflow_nodes_and_results = []
