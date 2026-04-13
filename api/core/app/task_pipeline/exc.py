class TaskPipelineError(ValueError):
    pass


class RecordNotFoundError(TaskPipelineError):
    def __init__(self, record_name: str, record_id: str):
        super().__init__(f"{record_name} with id {record_id} not found")


class WorkflowRunNotFoundError(RecordNotFoundError):
    def __init__(self, workflow_run_id: str):
        super().__init__("WorkflowRun", workflow_run_id)
