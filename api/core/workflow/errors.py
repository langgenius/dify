from core.workflow.nodes.base import BaseNode


class WorkflowNodeRunFailedError(Exception):
    def __init__(self, node: BaseNode, error: str):
        self.node = node
        self.error = error
        super().__init__(f"Node {node.title} run failed: {error}")
