"""Mocked results for side-effect nodes a Builder confirmed Test Run did not confirm.

PRD §9.1 makes Mock the Test Run default. The mocked class keeps the real
node's data model, title, edges and output handles; only ``_run`` changes, so
nothing is dispatched and downstream nodes read empty values in the node's
native output shape. ``process_data`` marks the row so the run evidence and the
result card can say which steps were mocked, and a run with any mocked step
cannot be published (§19.2).
"""

import copy
from functools import cache
from typing import Any

from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from graphon.node_events import NodeRunResult
from graphon.nodes.base.node import Node

MOCKED_PROCESS_KEY = "builder_mocked"

_OUTPUTS: dict[str, dict[str, Any]] = {
    BuiltinNodeTypes.TOOL: {"text": "", "files": [], "json": []},
    BuiltinNodeTypes.HTTP_REQUEST: {"status_code": 200, "body": "", "headers": {}, "files": []},
    BuiltinNodeTypes.AGENT: {"text": "", "files": [], "json": []},
}


class _MockedRun:
    node_type: str

    def _run(self) -> NodeRunResult:
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs={},
            process_data={MOCKED_PROCESS_KEY: True},
            outputs=copy.deepcopy(_OUTPUTS.get(self.node_type, {})),
        )


@cache
def mocked_node_class(node_class: type[Node]) -> type[Node]:
    """The same node with a mocked ``_run``; one class per native class, never registered over it."""
    return type(f"BuilderMocked{node_class.__name__}", (_MockedRun, node_class), {"__module__": __name__})
