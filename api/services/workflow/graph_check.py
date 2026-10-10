"""Problems in a workflow graph that would fail at import, in the editor or at run time, each located."""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Final

from pydantic import ValidationError

from core.trigger.constants import TRIGGER_NODE_TYPES
from core.workflow.human_input_adapter import adapt_node_config_for_graph
from core.workflow.node_factory import resolve_workflow_node_class
from core.workflow.nodes.human_input.constants import TIMEOUT_HANDLE
from graphon.entities.graph_config import NodeConfigDictAdapter
from graphon.enums import BuiltinNodeTypes, ErrorStrategy
from graphon.nodes.base.node import Node
from models import AppMode
from services.workflow.node_defaults import fill_node_data, node_data_type

logger = logging.getLogger(__name__)

_SOURCE_HANDLE: Final = "source"
_ELSE_HANDLE: Final = "false"
_LEGACY_IF_HANDLE: Final = "true"
_CANVAS_NOTE_TYPE: Final = "custom-note"
_ROOT_SELECTORS: Final = frozenset({"sys", "env", "conversation"})
_CONTAINER_TYPES: Final = frozenset({BuiltinNodeTypes.ITERATION, BuiltinNodeTypes.LOOP})


class IssueSeverity(StrEnum):
    ERROR = "error"
    WARNING = "warning"


class IssueCode(StrEnum):
    GRAPH_INVALID = "graph_invalid"
    MODE_INCOMPATIBLE = "mode_incompatible"
    UNKNOWN_NODE_TYPE = "unknown_node_type"
    NODE_DATA_INVALID = "node_data_invalid"
    EDGE_ENDPOINT_MISSING = "edge_endpoint_missing"
    BRANCH_HANDLE_INVALID = "branch_handle_invalid"
    REFERENCE_MISSING = "reference_missing"
    CONTAINER_START_MISSING = "container_start_missing"
    OUTPUT_NAME_DUPLICATE = "output_name_duplicate"
    BRANCH_UNCONNECTED = "branch_unconnected"
    RESOURCE_UNAVAILABLE = "resource_unavailable"

    @property
    def severity(self) -> IssueSeverity:
        return IssueSeverity.WARNING if self in _WARNING_CODES else IssueSeverity.ERROR


_WARNING_CODES: Final = frozenset({IssueCode.BRANCH_UNCONNECTED, IssueCode.RESOURCE_UNAVAILABLE})


@dataclass(frozen=True)
class GraphIssue:
    code: IssueCode
    message: str
    node_id: str | None = None
    loc: tuple[str | int, ...] = field(default_factory=tuple)


ResourceCheck = Callable[[Mapping[str, Any]], str | None]


def refused_node_types(mode: AppMode) -> frozenset[str]:
    if mode == AppMode.ADVANCED_CHAT:
        return frozenset({BuiltinNodeTypes.END, *TRIGGER_NODE_TYPES})
    return frozenset({BuiltinNodeTypes.ANSWER})


@dataclass(frozen=True)
class _Graph:
    raw: Mapping[str, Any]
    nodes: Mapping[str, Mapping[str, Any]]
    edges: Sequence[Mapping[str, Any]]
    mode: AppMode


def _data(node: Mapping[str, Any]) -> Mapping[str, Any]:
    data = node.get("data")
    return data if isinstance(data, Mapping) else {}


def _node_class(data: Mapping[str, Any]) -> type[Node]:
    return resolve_workflow_node_class(
        node_type=str(data.get("type", "")), node_version=str(data.get("version", "1")), node_data=data
    )


def _mode_issues(graph: _Graph) -> Iterable[GraphIssue]:
    refused = refused_node_types(graph.mode)
    for node_id, node in graph.nodes.items():
        node_type = _data(node).get("type")
        if node_type in refused:
            yield GraphIssue(
                IssueCode.MODE_INCOMPATIBLE,
                f"A {graph.mode} app can't hold a {node_type} node",
                node_id,
                ("nodes", node_id, "data", "type"),
            )


def _node_issues(graph: _Graph) -> Iterable[GraphIssue]:
    for node_id, node in graph.nodes.items():
        data = fill_node_data(_data(node))
        node_type = str(data.get("type", ""))
        try:
            node_class = _node_class(data)
        except ValueError:
            yield GraphIssue(
                IssueCode.UNKNOWN_NODE_TYPE,
                f"Unknown node type {node_type!r}",
                node_id,
                ("nodes", node_id, "data", "type"),
            )
            continue
        try:
            adapted = adapt_node_config_for_graph({"id": node_id, "data": data})["data"]
            node_data_type(node_type, node_class).model_validate(adapted)
        except ValidationError as error:
            for problem in error.errors(include_url=False, include_input=False, include_context=False):
                yield GraphIssue(
                    IssueCode.NODE_DATA_INVALID, problem["msg"], node_id, ("nodes", node_id, "data", *problem["loc"])
                )
        except Exception as error:
            # Some validators raise other errors on bad or newer values; report this node and check the rest.
            logger.warning("node %s data could not be validated", node_id, exc_info=True)
            yield GraphIssue(
                IssueCode.NODE_DATA_INVALID,
                f"The node data could not be read ({type(error).__name__}: {error})",
                node_id,
                ("nodes", node_id, "data"),
            )
        start = data.get("start_node_id")
        if node_type in _CONTAINER_TYPES and start and start not in graph.nodes:
            yield GraphIssue(
                IssueCode.CONTAINER_START_MISSING,
                f"start_node_id {start!r} is not in the graph",
                node_id,
                ("nodes", node_id, "data", "start_node_id"),
            )


def _handles(data: Mapping[str, Any]) -> frozenset[str] | None:
    """Valid source handles for nodes whose handles carry meaning; None means not checked."""
    extra = {ErrorStrategy.FAIL_BRANCH.value} if data.get("error_strategy") == ErrorStrategy.FAIL_BRANCH else set()
    match data.get("type"):
        case BuiltinNodeTypes.IF_ELSE:
            cases = data.get("cases")
            if cases is None:
                return frozenset({_LEGACY_IF_HANDLE, _ELSE_HANDLE} | extra)
            if not isinstance(cases, list):
                return None
            return frozenset({str(c.get("case_id")) for c in cases if isinstance(c, Mapping)} | {_ELSE_HANDLE} | extra)
        case BuiltinNodeTypes.QUESTION_CLASSIFIER:
            classes = data.get("classes") or []
            if not isinstance(classes, list):
                return None
            return frozenset({str(c.get("id")) for c in classes if isinstance(c, Mapping)} | extra)
        case BuiltinNodeTypes.HUMAN_INPUT:
            actions = data.get("user_actions") or []
            if not isinstance(actions, list):
                return None
            return frozenset({str(a.get("id")) for a in actions if isinstance(a, Mapping)} | {TIMEOUT_HANDLE} | extra)
        case _:
            return None


def _edge_issues(graph: _Graph) -> Iterable[GraphIssue]:
    for index, edge in enumerate(graph.edges):
        edge_id = str(edge.get("id", index))
        for end in ("source", "target"):
            if edge.get(end) not in graph.nodes:
                yield GraphIssue(
                    IssueCode.EDGE_ENDPOINT_MISSING,
                    f"Edge {end} {edge.get(end)!r} is not a node",
                    None,
                    ("edges", edge_id, end),
                )
        source = graph.nodes.get(str(edge.get("source")))
        valid = _handles(_data(source)) if source else None
        handle = str(edge.get("sourceHandle", _SOURCE_HANDLE))
        if valid is not None and handle not in valid:
            yield GraphIssue(
                IssueCode.BRANCH_HANDLE_INVALID,
                f"sourceHandle {handle!r} is not a branch of {edge.get('source')!r}; use one of {sorted(valid)}",
                str(edge.get("source")),
                ("edges", edge_id, "sourceHandle"),
            )


def _unconnected_branch_issues(graph: _Graph) -> Iterable[GraphIssue]:
    for node_id, node in graph.nodes.items():
        handles = _handles(_data(node))
        if handles is None:
            continue
        used = {str(e.get("sourceHandle", _SOURCE_HANDLE)) for e in graph.edges if e.get("source") == node_id}
        for handle in sorted(handles - used):
            yield GraphIssue(
                IssueCode.BRANCH_UNCONNECTED,
                f"Branch {handle!r} of {node_id!r} has no edge; a run that takes it stops there",
                node_id,
                ("nodes", node_id),
            )


def _output_name_issues(graph: _Graph) -> Iterable[GraphIssue]:
    """End nodes share one set of workflow outputs, so the console refuses to publish a name used twice."""
    places: dict[str, list[tuple[str, int]]] = {}
    for node_id, node in graph.nodes.items():
        data = _data(node)
        outputs = data.get("outputs")
        if data.get("type") != BuiltinNodeTypes.END or not isinstance(outputs, list):
            continue
        for index, output in enumerate(outputs):
            name = str(output.get("variable") or "").strip() if isinstance(output, Mapping) else ""
            if name:
                places.setdefault(name, []).append((node_id, index))
    for name, found in places.items():
        if len(found) < 2:
            continue
        for node_id, index in found:
            yield GraphIssue(
                IssueCode.OUTPUT_NAME_DUPLICATE,
                f"Output {name!r} is used by more than one End node output; output names must be unique",
                node_id,
                ("nodes", node_id, "data", "outputs", index, "variable"),
            )


def _reference_issues(graph: _Graph) -> Iterable[GraphIssue]:
    for node_id, node in graph.nodes.items():
        data = fill_node_data(_data(node))
        try:
            config = NodeConfigDictAdapter.validate_python(adapt_node_config_for_graph({"id": node_id, "data": data}))
            mapping = _node_class(data).extract_variable_selector_to_variable_mapping(
                graph_config=graph.raw, config=config
            )
        except Exception:
            # Unknown or invalid nodes are already reported by _node_issues.
            continue
        for key, selector in mapping.items():
            if selector and selector[0] not in _ROOT_SELECTORS and selector[0] not in graph.nodes:
                yield GraphIssue(
                    IssueCode.REFERENCE_MISSING,
                    f"{key} reads node {selector[0]!r}, which is not in the graph",
                    node_id,
                    ("nodes", node_id, "data"),
                )


_CHECKS: Final[Mapping[str, Callable[[_Graph], Iterable[GraphIssue]]]] = {
    "app mode": _mode_issues,
    "node data": _node_issues,
    "edge": _edge_issues,
    "branch": _unconnected_branch_issues,
    "output name": _output_name_issues,
    "reference": _reference_issues,
}


def check_graph(graph: Mapping[str, Any], *, mode: AppMode, resources: ResourceCheck | None = None) -> list[GraphIssue]:
    nodes = graph.get("nodes")
    if not isinstance(nodes, list):
        return [GraphIssue(IssueCode.GRAPH_INVALID, "graph.nodes must be a list", None, ("nodes",))]
    edges = graph.get("edges") or []
    view = _Graph(
        raw=graph,
        nodes={str(n.get("id")): n for n in nodes if isinstance(n, Mapping) and n.get("type") != _CANVAS_NOTE_TYPE},
        edges=[e for e in edges if isinstance(e, Mapping)],
        mode=mode,
    )
    issues: list[GraphIssue] = []
    for name, check in _CHECKS.items():
        try:
            issues.extend(check(view))
        except Exception:
            logger.exception("graph check %s failed", name)
            issues.append(
                GraphIssue(
                    IssueCode.GRAPH_INVALID, f"The {name} check failed, so the graph is not fully checked", None, ()
                )
            )
    if resources is not None:
        for node_id, node in view.nodes.items():
            problem = resources(node)
            if problem:
                issues.append(GraphIssue(IssueCode.RESOURCE_UNAVAILABLE, problem, node_id, ("nodes", node_id)))
    return issues
