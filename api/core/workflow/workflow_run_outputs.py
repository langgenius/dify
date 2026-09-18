from collections.abc import Mapping
from typing import Any

from graphon.enums import BuiltinNodeTypes, NodeType


def project_node_outputs_for_workflow_run(
    *,
    node_type: NodeType,
    inputs: Mapping[str, Any],
    outputs: Mapping[str, Any],
) -> dict[str, Any]:
    """Project internal node outputs onto the workflow-run public contract."""

    if node_type == BuiltinNodeTypes.START:
        return dict(inputs)

    return dict(outputs)
