"""Execution revisions for Builder, separate from the editor's full graph hash."""

import hashlib
import json
from copy import deepcopy
from typing import TYPE_CHECKING

from core.dify_builder.models import Graph
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


_MISSING = object()


def _merge_changed_fields(target: dict, before: dict, latest: dict, fields: frozenset[str]) -> None:
    for field in fields:
        if before.get(field, _MISSING) == latest.get(field, _MISSING):
            continue
        if field in latest:
            target[field] = deepcopy(latest[field])
        else:
            target.pop(field, None)


def merge_canvas_presentation(before: Graph, after: Graph, latest: Graph) -> Graph:
    """Keep concurrent canvas-only edits when committing an executable patch.

    Call only after ``execution_revision`` confirms that ``before`` and
    ``latest`` have the same execution configuration. Builder owns the changes
    in ``after``; the editor owns the fields excluded from that revision. This
    includes viewport, custom notes, renderer fields and transient node/edge
    data. Newly created Builder nodes and edges retain their generated layout.
    """
    merged = deepcopy(after)
    before_nodes = {node.get("id"): node for node in before.get("nodes", [])}
    latest_nodes = {node.get("id"): node for node in latest.get("nodes", [])}
    after_node_ids = {node.get("id") for node in after.get("nodes", [])}
    nodes = []
    for node in merged.get("nodes", []):
        node_id = node.get("id")
        if node.get("type") == "custom-note":
            before_note = before_nodes.get(node_id)
            latest_note = latest_nodes.get(node_id)
            if before_note is not None and latest_note is None:
                continue
            if before_note is not None and latest_note != before_note:
                node = deepcopy(latest_note)
            nodes.append(node)
            continue
        if node_id in before_nodes and node_id in latest_nodes:
            before_node = before_nodes[node_id]
            latest_node = latest_nodes[node_id]
            _merge_changed_fields(node, before_node, latest_node, _NODE_PRESENTATION_FIELDS)
            latest_data = latest_node.get("data", {})
            before_data = before_node.get("data", {})
            node_data = node.get("data", {})
            transient_fields = frozenset(
                key for key in node_data.keys() | latest_data.keys() if key == "selected" or key.startswith("_")
            )
            if node_data.get("type") in {BuiltinNodeTypes.ITERATION, BuiltinNodeTypes.LOOP}:
                transient_fields |= frozenset({"width", "height"})
            _merge_changed_fields(node_data, before_data, latest_data, transient_fields)
        nodes.append(node)
    for note in latest.get("nodes", []):
        if (
            note.get("type") == "custom-note"
            and note.get("id") not in before_nodes
            and note.get("id") not in after_node_ids
        ):
            nodes.append(deepcopy(note))
    merged["nodes"] = nodes

    before_edges = {edge.get("id"): edge for edge in before.get("edges", [])}
    latest_edges = {edge.get("id"): edge for edge in latest.get("edges", [])}
    for edge in merged.get("edges", []):
        edge_id = edge.get("id")
        if edge_id not in before_edges or edge_id not in latest_edges:
            continue
        before_edge = before_edges[edge_id]
        latest_edge = latest_edges[edge_id]
        _merge_changed_fields(
            edge, before_edge, latest_edge, _EDGE_PRESENTATION_FIELDS | frozenset({"sourceHandle", "targetHandle"})
        )
        edge_data = edge.get("data", {})
        before_data = before_edge.get("data", {})
        latest_data = latest_edge.get("data", {})
        transient_fields = _EDGE_DATA_PRESENTATION_FIELDS | frozenset(
            key for key in edge_data.keys() | latest_data.keys() if key.startswith("_")
        )
        _merge_changed_fields(edge_data, before_data, latest_data, transient_fields)
        if edge_data and "data" not in edge:
            edge["data"] = edge_data

    _merge_changed_fields(merged, before, latest, frozenset({"viewport"}))
    return merged


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
