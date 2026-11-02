"""Persistence-neutral workflow definition errors."""


class WorkflowDataError(Exception):
    """Workflow definition data is incomplete or internally inconsistent."""


class NodeNotFoundError(WorkflowDataError):
    """A workflow graph does not contain the requested node."""

    def __init__(self, node_id: str):
        super().__init__(f"Node with ID '{node_id}' not found in the workflow.")
        self.node_id = node_id
