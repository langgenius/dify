"""What changed between two versions of a workflow, ignoring editor layout and import defaults."""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Final

from pydantic import BaseModel, Field

from graphon.variables import SecretVariable, VariableBase
from libs import helper
from models.workflow import Workflow
from services.workflow.node_defaults import fill_node_data

_DATA_UI_KEYS: Final = frozenset({"selected", "_connectedSourceHandleIds", "_connectedTargetHandleIds"})


@dataclass(frozen=True)
class WorkflowSnapshot:
    graph: Mapping[str, Any]
    features: Mapping[str, Any]
    environment_variable_names: frozenset[str]


class NodeChange(BaseModel):
    id: str
    type: str
    title: str
    fields: list[str]


class WorkflowDiff(BaseModel):
    published: bool = Field(description="false when the app was never published; then everything counts as added")
    nodes_added: list[NodeChange]
    nodes_removed: list[NodeChange]
    nodes_changed: list[NodeChange]
    edges_added: list[str]
    edges_removed: list[str]
    features_changed: bool
    env_added: list[str]
    env_removed: list[str]


def _nodes(graph: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    return {str(n.get("id")): n for n in graph.get("nodes") or [] if isinstance(n, Mapping)}


def _data(node: Mapping[str, Any]) -> dict[str, Any]:
    """Node data with import defaults filled, so a default added only by an import is not a change."""
    data = node.get("data")
    if not isinstance(data, Mapping):
        return {}
    return {k: v for k, v in fill_node_data(data).items() if k not in _DATA_UI_KEYS}


def _change(node: Mapping[str, Any], fields: list[str] | None = None) -> NodeChange:
    data = _data(node)
    return NodeChange(
        id=str(node.get("id")), type=str(data.get("type", "")), title=str(data.get("title", "")), fields=fields or []
    )


def _edges(graph: Mapping[str, Any]) -> set[str]:
    return {
        f"{e.get('source')} → {e.get('target')} ({e.get('sourceHandle', 'source')})"
        for e in graph.get("edges") or []
        if isinstance(e, Mapping)
    }


def _runnable(graph: Mapping[str, Any]) -> dict[str, Any]:
    """The graph as a run sees it: the editor's layout and selection state don't count."""
    return {"nodes": {i: _data(n) for i, n in _nodes(graph).items()}, "edges": sorted(_edges(graph))}


def same_graph(a: Mapping[str, Any], b: Mapping[str, Any]) -> bool:
    return _runnable(a) == _runnable(b)


def _variable(variable: VariableBase) -> dict[str, Any]:
    return variable.model_dump(mode="json", exclude={"value"} if isinstance(variable, SecretVariable) else None)


def draft_token(draft: Workflow) -> str:
    """Changes when anything a DSL import replaces changes; editor layout and secret values don't count."""
    content = {
        "graph": _runnable(draft.graph_dict),
        "features": draft.features_dict,
        "environment_variables": [_variable(v) for v in draft.environment_variables],
        "conversation_variables": [_variable(v) for v in draft.conversation_variables],
    }
    return helper.generate_text_hash(json.dumps(content, sort_keys=True))


def diff_workflows(published: WorkflowSnapshot | None, draft: WorkflowSnapshot) -> WorkflowDiff:
    base = published or WorkflowSnapshot(graph={}, features={}, environment_variable_names=frozenset())
    old, new = _nodes(base.graph), _nodes(draft.graph)
    changed = []
    for node_id in sorted(old.keys() & new.keys()):
        before, after = _data(old[node_id]), _data(new[node_id])
        fields = sorted(k for k in before.keys() | after.keys() if before.get(k) != after.get(k))
        if fields:
            changed.append(_change(new[node_id], fields))
    old_edges, new_edges = _edges(base.graph), _edges(draft.graph)
    return WorkflowDiff(
        published=published is not None,
        nodes_added=[_change(new[i]) for i in sorted(new.keys() - old.keys())],
        nodes_removed=[_change(old[i]) for i in sorted(old.keys() - new.keys())],
        nodes_changed=changed,
        edges_added=sorted(new_edges - old_edges),
        edges_removed=sorted(old_edges - new_edges),
        features_changed=dict(base.features) != dict(draft.features) if published else False,
        env_added=sorted(draft.environment_variable_names - base.environment_variable_names),
        env_removed=sorted(base.environment_variable_names - draft.environment_variable_names),
    )
