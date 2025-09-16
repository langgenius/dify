from typing import Any


class WorkflowExitError(Exception):
    """
    Exception raised when an EXIT node is executed to terminate workflow early.
    This allows the workflow to exit gracefully with custom outputs.
    """

    def __init__(
        self,
        outputs: dict[str, Any],
        message: str | None = None,
    ):
        self.outputs = outputs
        default_msg = "Workflow exited"
        message = message or default_msg
        self.message = message
        super().__init__(self.message)
