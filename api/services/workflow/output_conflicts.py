"""End node outputs that clash, judged the same way as the workflow editor.

Port of ``web/app/components/workflow/utils/end-output-conflicts.ts``; keep the two in step. Workflow outputs
are keyed by variable name only, so two kinds of clash exist:

- ``DUPLICATE_NAME``: two End nodes that can run in the same execution declare the same name, so one value
  silently overwrites the other.
- ``CONFLICTING_TYPES``: End nodes on mutually exclusive branches reuse a name but declare different types. Only
  one of them runs, but the published output schema keeps one definition per name.

Reusing a name across mutually exclusive branches with a matching type is legitimate.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Final

from core.trigger.constants import TRIGGER_NODE_TYPES
from graphon.enums import BuiltinNodeTypes
from services.workflow_variable_reference_validator import SOURCE_HANDLE, branch_handles

# Upper bound on the branch combinations tracked per node; past it, exclusivity is judged only from the branch
# choices every path to a node must make (see ``_required_choices``).
MAX_PATH_CONDITIONS: Final = 64
_ENTRY_BRANCH_ID: Final = "__entry__"
_ENTRY_NODE_TYPES: Final = frozenset({BuiltinNodeTypes.START, *TRIGGER_NODE_TYPES})
_ANY_TYPE: Final = "any"

# Branch node id -> handle taken.
_Condition = dict[str, str]


class ConflictKind(StrEnum):
    DUPLICATE_NAME = "duplicateName"
    CONFLICTING_TYPES = "conflictingTypes"


@dataclass(frozen=True)
class OutputConflict:
    node_id: str
    output_index: int
    variable: str
    kind: ConflictKind
    types: tuple[str, ...] = ()


@dataclass(frozen=True)
class _Scope:
    entry_ids: tuple[str, ...]
    outgoing: Mapping[str, Sequence[tuple[str, str]]]
    branch_ids: frozenset[str]


def _key(condition: Mapping[str, str]) -> str:
    return "&".join(sorted(f"{branch}={handle}" for branch, handle in condition.items()))


def _build_scope(nodes: Mapping[str, Mapping[str, Any]], edges: Iterable[Mapping[str, Any]]) -> _Scope:
    outgoing: dict[str, list[tuple[str, str]]] = {node_id: [] for node_id in nodes}
    incoming = dict.fromkeys(nodes, 0)
    for edge in edges:
        data = edge.get("data")
        # Temporary edges are injected by the editor while highlighting variable dependencies.
        if isinstance(data, Mapping) and data.get("_isTemp"):
            continue
        source, target = str(edge.get("source")), str(edge.get("target"))
        if source not in nodes or target not in nodes:
            continue
        outgoing[source].append((str(edge.get("sourceHandle") or SOURCE_HANDLE), target))
        incoming[target] += 1
    # Only nodes that choose one handle per run branch; every other node follows all of its edges.
    branch_ids = frozenset(
        node_id
        for node_id, data in nodes.items()
        if branch_handles(data) is not None and len({handle for handle, _ in outgoing[node_id]}) > 1
    )
    typed = tuple(node_id for node_id, data in nodes.items() if data.get("type") in _ENTRY_NODE_TYPES)
    # Nested scopes have no Start node: fall back to their roots. An End node is never an entry point.
    roots = tuple(
        node_id for node_id, data in nodes.items() if data.get("type") != BuiltinNodeTypes.END and not incoming[node_id]
    )
    return _Scope(typed or roots, outgoing, branch_ids)


@dataclass
class _Reach:
    conditions: dict[str, _Condition]
    overflow: bool = False


def _reachability(scope: _Scope) -> dict[str, _Reach]:
    """For every node, the branch decisions that lead to it; de-duplicated, so cycles terminate."""
    reach: dict[str, _Reach] = {}
    queue: list[str] = []
    for entry in scope.entry_ids:
        condition = {_ENTRY_BRANCH_ID: entry}
        reach.setdefault(entry, _Reach({})).conditions[_key(condition)] = condition
        queue.append(entry)
    while queue:
        current_id = queue.pop(0)
        current = reach.setdefault(current_id, _Reach({}))
        conditions = list(current.conditions.values())
        is_branch = current_id in scope.branch_ids
        for handle, target in scope.outgoing.get(current_id, ()):
            nxt = reach.setdefault(target, _Reach({}))
            changed = False
            if current.overflow and not nxt.overflow:
                nxt.overflow = changed = True
            for condition in conditions:
                extended = dict(condition)
                if is_branch:
                    taken = extended.get(current_id)
                    if taken is None:
                        extended[current_id] = handle
                    elif taken != handle:
                        # Routed back through the same branch on another handle: it constrains nothing.
                        del extended[current_id]
                key = _key(extended)
                if key in nxt.conditions:
                    continue
                if len(nxt.conditions) >= MAX_PATH_CONDITIONS:
                    if not nxt.overflow:
                        nxt.overflow = changed = True
                    continue
                nxt.conditions[key] = extended
                changed = True
            if changed:
                queue.append(target)
    return reach


def _cyclic_branches(scope: _Scope) -> frozenset[str]:
    """Branch nodes reachable from their own outgoing edges, which may take several handles in one run."""
    cyclic = set()
    for branch in scope.branch_ids:
        seen: set[str] = set()
        stack = [target for _, target in scope.outgoing.get(branch, ())]
        while stack:
            node_id = stack.pop()
            if node_id == branch:
                cyclic.add(branch)
                break
            if node_id in seen:
                continue
            seen.add(node_id)
            stack.extend(target for _, target in scope.outgoing.get(node_id, ()))
    return frozenset(cyclic)


def _required_choices(scope: _Scope) -> dict[str, _Condition]:
    """The branch decisions every path to a node makes, as a dataflow intersection over incoming edges: no path
    enumeration and no size limit. It proves less than the full path conditions, so it is only the fallback for
    nodes past ``MAX_PATH_CONDITIONS``."""
    cyclic = _cyclic_branches(scope)
    incoming: dict[str, list[tuple[str, str]]] = {}
    for source, edges in scope.outgoing.items():
        for handle, target in edges:
            incoming.setdefault(target, []).append((source, handle))
    entries = set(scope.entry_ids)
    required: dict[str, _Condition] = {}  # Absent means not reached yet; values only shrink, so this terminates.
    changed = True
    while changed:
        changed = False
        for node_id in scope.outgoing:
            nxt: _Condition | None = {_ENTRY_BRANCH_ID: node_id} if node_id in entries else None
            for source, handle in incoming.get(node_id, ()):
                before = required.get(source)
                if before is None:
                    continue
                extended = dict(before)
                if source in scope.branch_ids and source not in cyclic:
                    extended[source] = handle
                nxt = extended if nxt is None else {k: v for k, v in nxt.items() if extended.get(k) == v}
            if nxt is None or (node_id in required and _key(required[node_id]) == _key(nxt)):
                continue
            required[node_id] = nxt
            changed = True
    return required


def _compatible(a: Mapping[str, str], b: Mapping[str, str]) -> bool:
    """Two conditions never requiring different handles of the same branch."""
    return all(b.get(branch) in (None, handle) for branch, handle in a.items())


def _types_compatible(a: str | None, b: str | None) -> bool:
    """``any`` matches everything; a missing type cannot prove a clash either."""
    return not a or not b or _ANY_TYPE in {a, b} or a == b


class _ScopeAnalysis:
    """Whether two nodes of one scope can run in the same execution."""

    def __init__(self, scope: _Scope) -> None:
        self._scope = scope
        self._reach = _reachability(scope)
        self._required: dict[str, _Condition] | None = None

    def _required_choices(self) -> dict[str, _Condition]:
        if self._required is None:
            self._required = _required_choices(self._scope)
        return self._required

    def run_together(self, a_id: str, b_id: str) -> bool:
        """True unless every way of reaching one contradicts every way of reaching the other; unreachable nodes
        also count as running together, since nothing proves them exclusive."""
        a, b = self._reach.get(a_id), self._reach.get(b_id)
        if not a or not b or not a.conditions or not b.conditions:
            return True
        if a.overflow or b.overflow:
            required = self._required_choices()
            req_a, req_b = required.get(a_id), required.get(b_id)
            return req_a is None or req_b is None or _compatible(req_a, req_b)
        return any(_compatible(x, y) for x in a.conditions.values() for y in b.conditions.values())


def output_conflicts(
    nodes: Mapping[str, Mapping[str, Any]],
    edges: Sequence[Mapping[str, Any]],
    parents: Mapping[str, str],
) -> list[OutputConflict]:
    """Clashing End node outputs. ``nodes`` maps node id to node data; ``parents`` maps node id to its container
    (Iteration / Loop) id, or "" at the top level, and End nodes are compared only within their own scope."""
    conflicts: list[OutputConflict] = []
    ends = [node_id for node_id, data in nodes.items() if data.get("type") == BuiltinNodeTypes.END]
    for scope_id in dict.fromkeys(parents.get(node_id, "") for node_id in ends):
        occurrences: dict[str, list[tuple[str, int, str | None]]] = {}
        for node_id in ends:
            if parents.get(node_id, "") != scope_id:
                continue
            outputs = nodes[node_id].get("outputs")
            for index, output in enumerate(outputs if isinstance(outputs, list) else []):
                if not isinstance(output, Mapping):
                    continue
                variable = str(output.get("variable") or "").strip()
                if variable:
                    value_type = output.get("value_type")
                    occurrences.setdefault(variable, []).append(
                        (node_id, index, str(value_type) if value_type else None)
                    )
        if not any(len(found) > 1 for found in occurrences.values()):
            continue

        analysis = _ScopeAnalysis(
            _build_scope({k: v for k, v in nodes.items() if parents.get(k, "") == scope_id}, edges)
        )

        for variable, found in occurrences.items():
            node_ids = list(dict.fromkeys(node_id for node_id, _, _ in found))
            for node_id in node_ids:
                own = [entry for entry in found if entry[0] == node_id]
                duplicate = len(own) > 1
                clashing: set[str] = set()
                for other_id in node_ids:
                    if other_id == node_id:
                        continue
                    if analysis.run_together(node_id, other_id):
                        duplicate = True
                        continue
                    for _, _, other_type in (entry for entry in found if entry[0] == other_id):
                        for _, _, my_type in own:
                            if not _types_compatible(my_type, other_type):
                                clashing.update(t for t in (my_type, other_type) if t)
                if not duplicate and not clashing:
                    continue
                for _, index, _ in own:
                    conflicts.append(
                        OutputConflict(node_id, index, variable, ConflictKind.DUPLICATE_NAME)
                        if duplicate
                        else OutputConflict(
                            node_id, index, variable, ConflictKind.CONFLICTING_TYPES, tuple(sorted(clashing))
                        )
                    )
    return conflicts
