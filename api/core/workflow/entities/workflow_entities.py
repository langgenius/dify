from core.workflow.entities.variable_pool import VariablePool
from models.workflow import WorkflowNodeExecution, WorkflowRun


class WorkflowRunState:
    workflow_run: WorkflowRun
    start_at: float
    user_inputs: dict
    variable_pool: VariablePool

    total_tokens: int = 0

    workflow_node_executions: list[WorkflowNodeExecution] = []

    def __init__(self, workflow_run: WorkflowRun,
                 start_at: float,
                 user_inputs: dict,
                 variable_pool: VariablePool) -> None:
        self.workflow_run = workflow_run
        self.start_at = start_at
        self.user_inputs = user_inputs
        self.variable_pool = variable_pool
