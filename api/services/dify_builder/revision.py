"""Execution revisions for Builder, separate from the editor's full graph hash."""

import hashlib
import json
from typing import TYPE_CHECKING

from graphon.enums import BuiltinNodeTypes

if TYPE_CHECKING:
    from models.workflow import Workflow


# Only strip presentation fields at their defined canvas paths. A node's
# configuration may legitimately contain keys such as "position" or "width".
_NODE_PRESENTATION_FIELDS = frozenset(
    {
        "type",  # ReactFlow renderer; the executable node type is data.type.
        "position",
        "positionAbsolute",
        "width",
        "height",
        "selected",
        "dragging",
        "resizing",
        "measured",
        "zIndex",
        "style",
        "sourcePosition",
        "targetPosition",
    }
)
_EDGE_PRESENTATION_FIELDS = frozenset({"type", "selected", "animated", "style", "zIndex"})
# initialEdges derives these rendering hints from the connected nodes. Builder
# creates edges without them, so the first canvas save adds them even when the
# user only moves a node. Container membership in NODE data remains executable.
_EDGE_DATA_PRESENTATION_FIELDS = frozenset(
    {"sourceType", "targetType", "isInIteration", "iteration_id", "isInLoop", "loop_id"}
)


def execution_revision(workflow: "Workflow") -> str:
    """Hash execution inputs while retaining unknown configuration fields.

    Canvas hydration and the editor's transient data keys (prefixed with ``_``)
    do not affect execution. Array order is preserved: sorting configuration
    arrays can change branch, prompt, or variable semantics. Secret variables
    use their resolved values so re-encryption alone cannot invalidate a plan.
    Only the digest leaves the adapter; plaintext values are neither returned
    nor persisted here.

    Mutation callers resolve secrets while holding the workflow row lock.
    Key-provider access is required there to compare the same configuration
    that will be mutated, including any concurrent secret changes.
    """
    graph = dict(workflow.graph_dict)
    graph.pop("viewport", None)
    graph["nodes"] = [
        {
            **{key: value for key, value in node.items() if key not in _NODE_PRESENTATION_FIELDS},
            "data": {
                key: value
                for key, value in node.get("data", {}).items()
                if key != "selected"
                and not key.startswith("_")
                and not (
                    node.get("data", {}).get("type") in {BuiltinNodeTypes.ITERATION, BuiltinNodeTypes.LOOP}
                    and key in {"width", "height"}
                )
            },
        }
        for node in graph.get("nodes", [])
        if node.get("type") != "custom-note"
    ]
    graph["edges"] = [
        {
            **{key: value for key, value in edge.items() if key not in _EDGE_PRESENTATION_FIELDS},
            # The canvas fills missing handles with these defaults. Preserve
            # explicit values, especially source handles that select branches.
            "sourceHandle": edge.get("sourceHandle", "source"),
            "targetHandle": edge.get("targetHandle", "target"),
            "data": {
                key: value
                for key, value in edge.get("data", {}).items()
                if key not in _EDGE_DATA_PRESENTATION_FIELDS and not key.startswith("_")
            },
        }
        for edge in graph.get("edges", [])
    ]
    content = {
        "graph": graph,
        "features": workflow.features_dict,
        "environment_variables": [variable.model_dump(mode="json") for variable in workflow.environment_variables],
        "conversation_variables": [variable.model_dump(mode="json") for variable in workflow.conversation_variables],
    }
    return hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
