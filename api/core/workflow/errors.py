from core.workflow.nodes.base import BaseNode


class WorkflowNodeRunFailedError(Exception):
    def __init__(self, node: BaseNode, err_msg: str):
        self._node = node
        self._error = err_msg
        super().__init__(f"Node {node.title} run failed: {err_msg}")
