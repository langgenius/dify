from typing import Optional

from pydantic import BaseModel

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.base_node_data_entities import BaseIterationState
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
    invoke_from: InvokeFrom

    workflow_call_depth: int

    start_at: float
    variable_pool: VariablePool

    total_tokens: int = 0

    workflow_nodes_and_results: list[WorkflowNodeAndResult]

    class NodeRun(BaseModel):
        node_id: str
        iteration_node_id: str

    workflow_node_runs: list[NodeRun]
    workflow_node_steps: int

    current_iteration_state: Optional[BaseIterationState]

    def __init__(self, workflow: Workflow,
                 start_at: float,
                 variable_pool: VariablePool,
                 user_id: str,
                 user_from: UserFrom,
                 invoke_from: InvokeFrom,
                 workflow_call_depth: int):
        self.workflow_id = workflow.id
        self.tenant_id = workflow.tenant_id
        self.app_id = workflow.app_id
        self.workflow_type = WorkflowType.value_of(workflow.type)
        self.user_id = user_id
        self.user_from = user_from
        self.invoke_from = invoke_from
        self.workflow_call_depth = workflow_call_depth

        self.start_at = start_at
        self.variable_pool = variable_pool

        self.total_tokens = 0
        self.workflow_nodes_and_results = []

        self.current_iteration_state = None
        self.workflow_node_steps = 1
        self.workflow_node_runs = []