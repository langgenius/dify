from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

from core.workflow.enums import NodeExecutionType, NodeType

if TYPE_CHECKING:
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
            raise ValueError("GraphValidationError requires at least one issue.")
        self.issues: tuple[GraphValidationIssue, ...] = tuple(issues)
        message = "; ".join(f"[{issue.code}] {issue.message}" for issue in self.issues)
        super().__init__(message)


class GraphValidationRule(Protocol):
    """Protocol that individual validation rules must satisfy."""

    def validate(self, graph: Graph) -> Sequence[GraphValidationIssue]:
        """Validate the provided graph and return any discovered issues."""
        ...


@dataclass(frozen=True, slots=True)
class _EdgeEndpointValidator:
    """Ensures all edges reference existing nodes."""

    missing_node_code: str = "MISSING_NODE"

    def validate(self, graph: Graph) -> Sequence[GraphValidationIssue]:
        issues: list[GraphValidationIssue] = []
        for edge in graph.edges.values():
            if edge.tail not in graph.nodes:
                issues.append(
                    GraphValidationIssue(
                        code=self.missing_node_code,
                        message=f"Edge {edge.id} references unknown source node '{edge.tail}'.",
                        node_id=edge.tail,
                    )
                )
            if edge.head not in graph.nodes:
                issues.append(
                    GraphValidationIssue(
                        code=self.missing_node_code,
                        message=f"Edge {edge.id} references unknown target node '{edge.head}'.",
                        node_id=edge.head,
                    )
                )
        return issues


@dataclass(frozen=True, slots=True)
class _RootNodeValidator:
    """Validates root node invariants."""

    invalid_root_code: str = "INVALID_ROOT"
    container_entry_types: tuple[NodeType, ...] = (NodeType.ITERATION_START, NodeType.LOOP_START)

    def validate(self, graph: Graph) -> Sequence[GraphValidationIssue]:
        root_node = graph.root_node
        issues: list[GraphValidationIssue] = []
        if root_node.id not in graph.nodes:
            issues.append(
                GraphValidationIssue(
                    code=self.invalid_root_code,
                    message=f"Root node '{root_node.id}' is missing from the node registry.",
                    node_id=root_node.id,
                )
            )
            return issues

        node_type = getattr(root_node, "node_type", None)
        if root_node.execution_type != NodeExecutionType.ROOT and node_type not in self.container_entry_types:
            issues.append(
                GraphValidationIssue(
                    code=self.invalid_root_code,
                    message=f"Root node '{root_node.id}' must declare execution type 'root'.",
                    node_id=root_node.id,
                )
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
    _EdgeEndpointValidator(),
    _RootNodeValidator(),
)


def get_graph_validator() -> GraphValidator:
    """Construct the validator composed of default rules."""
    return GraphValidator(_DEFAULT_RULES)
