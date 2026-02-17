from libs.exception import BaseHTTPException


class WorkflowPausedInBlockingModeError(BaseHTTPException):
    error_code = "workflow_paused_in_blocking_mode"
    description = "Workflow execution paused for human input; blocking response mode is not supported."
    code = 400
