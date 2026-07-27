from __future__ import annotations

import re
from collections import defaultdict, deque
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from graphon.enums import ErrorStrategy
from graphon.nodes import BuiltinNodeTypes

_RESERVED_SELECTOR_HEADS: frozenset[str] = frozenset({"sys", "env", "conversation", "start"})

_REFERENCE_EXEMPT_NODE_TYPES: frozenset[str] = frozenset(
    {
        BuiltinNodeTypes.VARIABLE_AGGREGATOR,
        BuiltinNodeTypes.LEGACY_VARIABLE_AGGREGATOR,
    }
)

_BRANCH_NODE_TYPES: frozenset[str] = frozenset(
    {
        BuiltinNodeTypes.IF_ELSE,
        BuiltinNodeTypes.QUESTION_CLASSIFIER,
        BuiltinNodeTypes.HUMAN_INPUT,
    }
)

_TEMPLATE_REFERENCE_PATTERN = re.compile(
    r"\{\{#([a-zA-Z0-9_]{1,50})\.[a-zA-Z_][a-zA-Z0-9_]{0,29}(?:\.[a-zA-Z_][a-zA-Z0-9_]{0,29}){0,9}#\}\}"
)
_MAX_REPORTED_ISSUES = 10


@dataclass(frozen=True)
class VariableReferenceIssue:
    """A single unsafe variable reference: ``node`` reads output from ``referenced_node``."""

    node_id: str
    node_title: str
    referenced_node_id: str
    referenced_node_title: str


def validate_variable_references(graph: Mapping[str, Any]) -> list[VariableReferenceIssue]:
    """Flag references where the consumer can run without the producer.

    Uses engine execution semantics: nodes fire on any active inbound edge; branch
    nodes (if-else / question-classifier / human-input / fail-branch) take one handle
    (possibly unwired); other nodes fan out all outbound edges. Returns [] when clean.
    """
    nodes = graph.get("nodes") or []
    edges = graph.get("edges") or []
    if not isinstance(nodes, list) or not isinstance(edges, list) or not nodes:
        return []

    node_type: dict[str, str] = {}
    node_title: dict[str, str] = {}
    node_parent: dict[str, str | None] = {}
    node_data: dict[str, Mapping[str, Any]] = {}
    for node in nodes:
        if not isinstance(node, Mapping):
            continue
        node_id = node.get("id")
        if not isinstance(node_id, str):
            continue
        raw_data = node.get("data")
        data: Mapping[str, Any] = raw_data if isinstance(raw_data, Mapping) else {}
        node_type[node_id] = str(data.get("type") or "")
        title = data.get("title")
        node_title[node_id] = str(title) if title else node_id
        parent = node.get("parentId")
        node_parent[node_id] = parent if isinstance(parent, str) else None
        node_data[node_id] = data

    node_ids = set(node_type)

    out_targets_by_handle: dict[str, dict[str | None, list[str]]] = defaultdict(lambda: defaultdict(list))
    predecessors: dict[str, list[str]] = defaultdict(list)
    in_degree: dict[str, int] = defaultdict(int)
    successors: dict[str, list[str]] = defaultdict(list)
    for edge in edges:
        if not isinstance(edge, Mapping):
            continue
        source = edge.get("source")
        target = edge.get("target")
        if not isinstance(source, str) or not isinstance(target, str):
            continue
        out_targets_by_handle[source][edge.get("sourceHandle")].append(target)
        predecessors[target].append(source)
        successors[source].append(target)
        in_degree[target] += 1

    entries = [nid for nid in node_ids if node_parent.get(nid) is None and in_degree[nid] == 0]
    reachable = _reachable_from(entries, successors)
    exclusive = {
        nid
        for nid in node_ids
        if node_type.get(nid) in _BRANCH_NODE_TYPES or node_data[nid].get("error_strategy") == ErrorStrategy.FAIL_BRANCH
    }

    consumers_by_producer: dict[str, set[str]] = defaultdict(set)
    for node_id in node_ids:
        if node_parent.get(node_id) is not None or node_id not in reachable:
            continue
        if node_type.get(node_id) in _REFERENCE_EXEMPT_NODE_TYPES:
            continue
        for referenced_id in _referenced_node_ids(node_data[node_id]):
            if referenced_id == node_id or referenced_id not in node_ids:
                continue
            if node_parent.get(referenced_id) is not None:
                continue
            consumers_by_producer[referenced_id].add(node_id)

    issues: list[VariableReferenceIssue] = []
    for producer, consumers in consumers_by_producer.items():
        runnable_without_producer = _nodes_runnable_without(
            producer,
            entries=entries,
            predecessors=predecessors,
            successors=successors,
            out_targets_by_handle=out_targets_by_handle,
            exclusive=exclusive,
        )
        for consumer in consumers:
            if consumer in runnable_without_producer:
                issues.append(
                    VariableReferenceIssue(
                        node_id=consumer,
                        node_title=node_title.get(consumer, consumer),
                        referenced_node_id=producer,
                        referenced_node_title=node_title.get(producer, producer),
                    )
                )

    return issues


def format_variable_reference_errors(issues: Sequence[VariableReferenceIssue]) -> str:
    """Build a single-line warning listing unsafe reader ← producer pairs."""
    count = len(issues)
    shown = issues[:_MAX_REPORTED_ISSUES]
    pairs = "; ".join(f'"{issue.node_title}" ← "{issue.referenced_node_title}"' for issue in shown)
    if count > len(shown):
        pairs += f"; +{count - len(shown)} more"
    return (
        f"{count} variable reference{'s' if count != 1 else ''} may read a skipped branch "
        f"output. Use a Variable Aggregator or a default value — {pairs}."
    )


def _reachable_from(starts: Sequence[str], successors: Mapping[str, list[str]]) -> set[str]:
    visited: set[str] = set()
    queue: deque[str] = deque(starts)
    while queue:
        current = queue.popleft()
        if current in visited:
            continue
        visited.add(current)
        for nxt in successors.get(current, ()):
            if nxt not in visited:
                queue.append(nxt)
    return visited


def _nodes_runnable_without(
    producer: str,
    *,
    entries: Sequence[str],
    predecessors: Mapping[str, list[str]],
    successors: Mapping[str, list[str]],
    out_targets_by_handle: Mapping[str, Mapping[str | None, list[str]]],
    exclusive: Sequence[str] | set[str],
) -> set[str]:
    """Return nodes that can execute in some run where ``producer`` does not."""
    forbidden = {producer}
    queue: deque[str] = deque([producer])
    while queue:
        node = queue.popleft()
        for pred in predecessors.get(node, ()):
            if pred in forbidden:
                continue
            if pred not in exclusive or (
                len(out_targets_by_handle[pred]) > 1
                and all(
                    all(target in forbidden for target in targets) for targets in out_targets_by_handle[pred].values()
                )
            ):
                forbidden.add(pred)
                queue.append(pred)

    if any(entry in forbidden for entry in entries):
        return set()

    runnable: set[str] = set()
    work: deque[str] = deque(entry for entry in entries if entry not in forbidden)
    while work:
        node = work.popleft()
        if node in runnable:
            continue
        runnable.add(node)
        for nxt in successors.get(node, ()):
            if nxt not in forbidden and nxt not in runnable:
                work.append(nxt)
    return runnable


def _referenced_node_ids(node_data: Mapping[str, Any]) -> Iterator[str]:
    """Yield the node ids referenced by ``node_data`` via selectors and templates."""
    for selector in _iter_value_selectors(node_data):
        head = selector[0]
        if isinstance(head, str) and head not in _RESERVED_SELECTOR_HEADS:
            yield head
    for text in _iter_strings(node_data):
        for match in _TEMPLATE_REFERENCE_PATTERN.finditer(text):
            head = match.group(1)
            if head not in _RESERVED_SELECTOR_HEADS:
                yield head


def _is_selector_key(key: object) -> bool:
    return isinstance(key, str) and (key == "selector" or key.endswith("_selector"))


def _iter_value_selectors(value: Any) -> Iterator[Sequence[Any]]:
    if isinstance(value, Mapping):
        if value.get("type") == "variable" and isinstance(value.get("value"), list) and value["value"]:
            yield value["value"]
        for key, child in value.items():
            if _is_selector_key(key) and isinstance(child, list) and child:
                yield child
            yield from _iter_value_selectors(child)
    elif isinstance(value, list):
        for item in value:
            yield from _iter_value_selectors(item)


def _iter_strings(value: Any) -> Iterator[str]:
    if isinstance(value, Mapping):
        for child in value.values():
            yield from _iter_strings(child)
    elif isinstance(value, list):
        for item in value:
            yield from _iter_strings(item)
    elif isinstance(value, str):
        yield value
