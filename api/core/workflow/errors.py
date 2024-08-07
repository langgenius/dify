from core.workflow.entities.node_entities import NodeType


class WorkflowNodeRunFailedError(Exception):
    def __init__(self, node_id: str, node_type: NodeType, node_title: str, error: str):
        self.node_id = node_id
        self.node_type = node_type
        self.node_title = node_title
        self.error = error
        super().__init__(f"Node {node_title} run failed: {error}")
