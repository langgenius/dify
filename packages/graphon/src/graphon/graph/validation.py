from __future__ import annotations

from abc import abstractmethod
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from graphlib import CycleError, TopologicalSorter
from typing import TYPE_CHECKING, Protocol

from graphon.enums import BuiltinNodeTypes, NodeExecutionType, NodeType

if TYPE_CHECKING:
    from .edge import Edge
    from .graph import Graph


@dataclass(frozen=True, slots=True)
class GraphValidationIssue:
    """Immutable value object describing a single validation issue."""

    code: str
    message: str
    node_id: str | None = None


class GraphValidationError(ValueError):
    """Raised when graph validation fails."""

    def __init__(self, issues: Sequence[GraphValidationIssue]) -> None:
        if not issues:
            msg = "GraphValidationError requires at least one issue."
            raise ValueError(msg)
        self.issues: tuple[GraphValidationIssue, ...] = tuple(issues)
        message = "; ".join(f"[{issue.code}] {issue.message}" for issue in self.issues)
        super().__init__(message)


class GraphValidationRule(Protocol):
    """Protocol that individual validation rules must satisfy."""

    @abstractmethod
    def validate(self, graph: Graph) -> Sequence[GraphValidationIssue]:
        """Validate the provided graph and return any discovered issues."""
        ...


def get_edge_issues(
    node_scopes: Mapping[str, str],
    edges: Iterable[Edge],
) -> list[GraphValidationIssue]:
    """Check edge fields, endpoints, and cycles without constructing nodes.

    Cross-scope edges are rejected during scoping, so one topological check
    covers all disconnected scopes in a retained subtree.

    Args:
        node_scopes: Node IDs mapped to their direct container IDs.
        edges: Edges from the scopes being validated.

    Returns:
        Issues for invalid edges or a cycle; empty for a valid graph.
    """
    issues: list[GraphValidationIssue] = []
    predecessors: dict[str, list[str]] = {node_id: [] for node_id in node_scopes}
    for edge in edges:
        if not isinstance(edge.source_handle, str):
            issues.append(
                GraphValidationIssue(
                    code="INVALID_EDGE",
                    message=f"Edge {edge.id!r} sourceHandle must be a string.",
                    node_id=edge.tail,
                )
            )
        for field, node_id in (("source", edge.tail), ("target", edge.head)):
            if node_id not in node_scopes:
                issues.append(
                    GraphValidationIssue(
                        code="MISSING_NODE",
                        message=(
                            f"Edge {edge.id} references unknown {field} node "
                            f"'{node_id}'."
                        ),
                        node_id=node_id,
                    ),
                )
        if edge.tail in node_scopes and edge.head in node_scopes:
            predecessors[edge.head].append(edge.tail)
    if not issues:
        try:
            TopologicalSorter(predecessors).prepare()
        except CycleError as error:
            cycle_node_ids: list[str] = error.args[1]
            issues.append(
                GraphValidationIssue(
                    code="CYCLE",
                    message=(
                        f"Graph scope {node_scopes[cycle_node_ids[0]]!r} "
                        f"contains a cycle: {' -> '.join(cycle_node_ids)}"
                    ),
                    node_id=cycle_node_ids[0],
                )
            )
    return issues


class _EdgeValidator:
    def validate(self, graph: Graph) -> Sequence[GraphValidationIssue]:
        return get_edge_issues(
            dict.fromkeys(graph.nodes, ""),
            graph.edges.values(),
        )


@dataclass(frozen=True, slots=True)
class _RootNodeValidator:
    """Validates root node invariants."""

    invalid_root_code: str = "INVALID_ROOT"
    container_entry_types: tuple[NodeType, ...] = (
        BuiltinNodeTypes.ITERATION_START,
        BuiltinNodeTypes.LOOP_START,
    )

    def validate(self, graph: Graph) -> Sequence[GraphValidationIssue]:
        root_node = graph.root_node
        issues: list[GraphValidationIssue] = []
        if root_node.id not in graph.nodes:
            issues.append(
                GraphValidationIssue(
                    code=self.invalid_root_code,
                    message=(
                        f"Root node '{root_node.id}' is missing from the node registry."
                    ),
                    node_id=root_node.id,
                ),
            )
            return issues

        node_type = root_node.node_type
        if (
            root_node.execution_type != NodeExecutionType.ROOT
            and node_type not in self.container_entry_types
        ):
            issues.append(
                GraphValidationIssue(
                    code=self.invalid_root_code,
                    message=(
                        f"Root node '{root_node.id}' must declare execution "
                        "type 'root'."
                    ),
                    node_id=root_node.id,
                ),
            )
        return issues


@dataclass(frozen=True, slots=True)
class GraphValidator:
    """Coordinates execution of graph validation rules."""

    rules: tuple[GraphValidationRule, ...]

    def validate(self, graph: Graph) -> None:
        """Validate the graph against all configured rules."""
        issues: list[GraphValidationIssue] = []
        for rule in self.rules:
            issues.extend(rule.validate(graph))

        if issues:
            raise GraphValidationError(issues)


_DEFAULT_RULES: tuple[GraphValidationRule, ...] = (
    _EdgeValidator(),
    _RootNodeValidator(),
)


def get_graph_validator() -> GraphValidator:
    """Construct the validator composed of default rules."""
    return GraphValidator(_DEFAULT_RULES)
