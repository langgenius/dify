from decimal import Decimal

from core.workflow.entities.variable_pool import VariablePool
from models.workflow import WorkflowNodeExecution, WorkflowRun


class WorkflowRunState:
    workflow_run: WorkflowRun
    start_at: float
    variable_pool: VariablePool

    total_tokens: int = 0
    total_price: Decimal = Decimal(0)
    currency: str = "USD"

    workflow_node_executions: list[WorkflowNodeExecution] = []
