"""All these exceptions are not meant to be caught by callers."""


class WorkflowDataError(Exception):
    """Base class for all workflow data related exceptions.

    This should be used to indicate issues with workflow data integrity, such as
    no `graph` configuration, missing `nodes` field in `graph` configuration, or
    similar issues.
    """

    pass


class NodeNotFoundError(WorkflowDataError):
    """Raised when a node with the specified ID is not found in the workflow."""

    def __init__(self, node_id: str):
        super().__init__(f"Node with ID '{node_id}' not found in the workflow.")
        self.node_id = node_id
