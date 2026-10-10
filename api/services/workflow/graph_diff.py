"""What changed between two versions of a workflow, ignoring editor layout and import defaults."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Final

from services.workflow.node_defaults import fill_node_data

_DATA_UI_KEYS: Final = frozenset({"selected", "_connectedSourceHandleIds", "_connectedTargetHandleIds"})


@dataclass(frozen=True)
class WorkflowSnapshot:
    graph: Mapping[str, Any]
    features: Mapping[str, Any]
    environment_variable_names: frozenset[str]


@dataclass(frozen=True)
class NodeChange:
    id: str
    type: str
    title: str
    fields: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class WorkflowDiff:
    published: bool
    nodes_added: list[NodeChange]
    nodes_removed: list[NodeChange]
    nodes_changed: list[NodeChange]
    edges_added: list[str]
    edges_removed: list[str]
    features_changed: bool
    env_added: list[str]
    env_removed: list[str]

    @property
    def empty(self) -> bool:
        return not (
            self.nodes_added
            or self.nodes_removed
            or self.nodes_changed
            or self.edges_added
            or self.edges_removed
            or self.features_changed
            or self.env_added
            or self.env_removed
        )


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
    return NodeChange(str(node.get("id")), str(data.get("type", "")), str(data.get("title", "")), fields or [])


def _edges(graph: Mapping[str, Any]) -> set[str]:
    return {
        f"{e.get('source')} → {e.get('target')} ({e.get('sourceHandle', 'source')})"
        for e in graph.get("edges") or []
        if isinstance(e, Mapping)
    }


def same_graph(a: Mapping[str, Any], b: Mapping[str, Any]) -> bool:
    """Whether two graphs run the same; the editor's layout and selection state don't count."""
    old, new = _nodes(a), _nodes(b)
    return old.keys() == new.keys() and all(_data(old[i]) == _data(new[i]) for i in old) and _edges(a) == _edges(b)


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
