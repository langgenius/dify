from core.workflow.nodes.base.node import Node


class WorkflowNodeRunFailedError(Exception):
    def __init__(self, node: Node, err_msg: str):
        self._node = node
        self._error = err_msg
        super().__init__(f"Node {node.title} run failed: {err_msg}")

    @property
    def node(self) -> Node:
        return self._node

    @property
    def error(self) -> str:
        return self._error
