from typing import Optional

from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import BaseNode
from models.workflow import Workflow


class WorkflowNodeAndResult:
    node: BaseNode
    result: Optional[NodeRunResult] = None

    def __init__(self, node: BaseNode, result: Optional[NodeRunResult] = None):
        self.node = node
        self.result = result


class WorkflowRunState:
    workflow: Workflow
    start_at: float
    user_inputs: dict
    variable_pool: VariablePool

    total_tokens: int = 0

    workflow_nodes_and_results: list[WorkflowNodeAndResult] = []

    def __init__(self, workflow: Workflow, start_at: float, user_inputs: dict, variable_pool: VariablePool):
        self.workflow = workflow
        self.start_at = start_at
        self.user_inputs = user_inputs
        self.variable_pool = variable_pool
