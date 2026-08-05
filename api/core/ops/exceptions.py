"""Core exceptions shared by ops trace dispatchers and trace providers.

Provider packages may raise these types to request generic task behavior, but
generic Celery tasks should not import provider-specific exception classes.
"""


class RetryableTraceDispatchError(RuntimeError):
    """Base class for transient trace dispatch failures that Celery may retry."""


class PendingTraceParentContextError(RetryableTraceDispatchError):
    """Raised when a nested trace arrives before its parent span context is available."""

    parent_node_execution_id: str

    def __init__(self, parent_node_execution_id: str) -> None:
        self.parent_node_execution_id = parent_node_execution_id
        super().__init__(
            "Pending trace parent context for parent_node_execution_id="
            f"{parent_node_execution_id}. Retry after the parent span context is published."
        )
