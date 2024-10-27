from core.workflow.nodes.base import BaseNode


class WorkflowNodeRunFailedError(Exception):
    def __init__(self, node_instance: BaseNode, error: str):
        self.node_instance = node_instance
        self.error = error
        super().__init__(f"Node {node_instance.node_data.title} run failed: {error}")
