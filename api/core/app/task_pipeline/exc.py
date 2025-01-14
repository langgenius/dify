class TaskPipilineError(ValueError):
    pass


class RecordNotFoundError(TaskPipilineError):
    def __init__(self, record_name: str, record_id: str):
        super().__init__(f"{record_name} with id {record_id} not found")


class WorkflowRunNotFoundError(RecordNotFoundError):
    def __init__(self, workflow_run_id: str):
        super().__init__("WorkflowRun", workflow_run_id)


class WorkflowNodeExecutionNotFoundError(RecordNotFoundError):
    def __init__(self, workflow_node_execution_id: str):
        super().__init__("WorkflowNodeExecution", workflow_node_execution_id)
