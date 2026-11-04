"""Problems in a workflow graph that would fail at import, in the editor or at run time, each located."""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Final

from pydantic import ValidationError
from sqlalchemy.orm import Session

from core.trigger.constants import TRIGGER_NODE_TYPES
from core.workflow.human_input_adapter import adapt_node_config_for_graph
from core.workflow.node_factory import node_data_model, resolve_workflow_node_class
from core.workflow.nodes.knowledge_index import KNOWLEDGE_INDEX_NODE_TYPE
from core.workflow.variable_prefixes import ROOT_VARIABLE_NODE_IDS
from graphon.entities.graph_config import NodeConfigDictAdapter
from graphon.enums import BuiltinNodeTypes
from graphon.nodes.base.node import Node
from graphon.variables import VariableBase
from models import AppMode
from services.workflow.node_defaults import complete_sub_models, editor_defaults
from services.workflow_service import WorkflowService
from services.workflow_variable_reference_validator import SOURCE_HANDLE, branch_handles

logger = logging.getLogger(__name__)

GRAPH_MODES: Final = frozenset({AppMode.WORKFLOW, AppMode.ADVANCED_CHAT})
MESSAGE_MODES: Final = frozenset({AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.COMPLETION})
CONTAINER_NODE_TYPES: Final = frozenset({BuiltinNodeTypes.ITERATION, BuiltinNodeTypes.LOOP})
CANVAS_NOTE_TYPE: Final = "custom-note"
START_NODE_ID_KEY: Final = "start_node_id"
EMPTY_SELECTOR_MESSAGE: Final = "A variable selector reads no variable"


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
    REFERENCE_EMPTY = "reference_empty"
    CONTAINER_START_MISSING = "container_start_missing"
    OUTPUT_NAME_DUPLICATE = "output_name_duplicate"
    BRANCH_UNCONNECTED = "branch_unconnected"
    RESOURCE_UNAVAILABLE = "resource_unavailable"

    @property
    def severity(self) -> IssueSeverity:
        return IssueSeverity.WARNING if self in _WARNING_CODES else IssueSeverity.ERROR


# An empty reference is a warning: the console saves a selector not chosen yet, and this check gates imports.
_WARNING_CODES: Final = frozenset(
    {IssueCode.BRANCH_UNCONNECTED, IssueCode.RESOURCE_UNAVAILABLE, IssueCode.REFERENCE_EMPTY}
)


@dataclass(frozen=True)
class GraphIssue:
    code: IssueCode
    message: str
    node_id: str | None = None
    loc: tuple[str | int, ...] = field(default_factory=tuple)
    # The pydantic error type of a node data problem, such as "missing".
    error_type: str | None = None


ResourceCheck = Callable[[Mapping[str, Any]], str | None]


def refused_node_types(mode: AppMode) -> frozenset[str]:
    if mode == AppMode.ADVANCED_CHAT:
        return frozenset({BuiltinNodeTypes.END, *TRIGGER_NODE_TYPES, KNOWLEDGE_INDEX_NODE_TYPE})
    return frozenset({BuiltinNodeTypes.ANSWER, KNOWLEDGE_INDEX_NODE_TYPE})


def credential_check(workspace_id: str, environment: Mapping[str, VariableBase], session: Session) -> ResourceCheck:
    """A `ResourceCheck` reporting what publish's credential check would refuse for one node."""

    service = WorkflowService()

    def check(node: Mapping[str, Any]) -> str | None:
        try:
            service.validate_node_credentials(workspace_id, node, environment, session=session)
        except ValueError as error:
            return str(error)
        return None

    return check


@dataclass(frozen=True)
class _Node:
    """One node read once: its data with editor defaults filled, what reading it found wrong,
    and the variables it references (empty when its data could not be read)."""

    id: str
    data: Mapping[str, Any]
    issues: tuple[GraphIssue, ...] = ()
    references: Mapping[str, Sequence[str]] = field(default_factory=dict)

    @property
    def type(self) -> str:
        return str(self.data.get("type", ""))


@dataclass(frozen=True)
class _Graph:
    nodes: Mapping[str, _Node]
    edges: Sequence[Mapping[str, Any]]
    mode: AppMode


def data_loc(node_id: str, *path: str | int) -> tuple[str | int, ...]:
    return ("nodes", node_id, "data", *path)


def _references(node_class: type[Node], config: Mapping[str, Any]) -> Mapping[str, Sequence[str]]:
    """The node's own references; a container's children are read on their own, so it gets a graph of itself."""
    return node_class.extract_variable_selector_to_variable_mapping(
        graph_config={"nodes": [config], "edges": []}, config=NodeConfigDictAdapter.validate_python(config)
    )


def _read_known_node(node_id: str, raw_data: Mapping[str, Any], node_class: type[Node]) -> _Node:
    data = editor_defaults(raw_data)
    model = node_data_model(node_class)
    config = adapt_node_config_for_graph({"id": node_id, "data": data})
    try:
        model.model_validate(config["data"])
    except ValidationError as error:
        problems = error.errors(include_url=False, include_input=False, include_context=False)
        issues = tuple(
            GraphIssue(IssueCode.NODE_DATA_INVALID, p["msg"], node_id, data_loc(node_id, *p["loc"]), p["type"])
            for p in problems
        )
        return _Node(node_id, data, issues)
    return _Node(node_id, complete_sub_models(model, data), references=_references(node_class, config))


def _read_node(node_id: str, raw: Mapping[str, Any]) -> _Node:
    raw_data: Mapping[str, Any] = raw["data"]
    node_type = str(raw_data.get("type", ""))
    try:
        node_class = resolve_workflow_node_class(
            node_type=node_type, node_version=str(raw_data.get("version", "1")), node_data=raw_data
        )
    except ValueError:
        issue = GraphIssue(
            IssueCode.UNKNOWN_NODE_TYPE, f"Unknown node type {node_type!r}", node_id, data_loc(node_id, "type")
        )
        return _Node(node_id, raw_data, (issue,))
    try:
        return _read_known_node(node_id, raw_data, node_class)
    except Exception as error:
        # A validator or reference reader can raise other errors on bad or newer data; report this node, check the rest.
        logger.warning("node %s data could not be read", node_id, exc_info=True)
        message = f"The node data could not be read ({type(error).__name__}: {error})"
        return _Node(node_id, raw_data, (GraphIssue(IssueCode.NODE_DATA_INVALID, message, node_id, data_loc(node_id)),))


def _mode_issues(graph: _Graph) -> Iterable[GraphIssue]:
    refused = refused_node_types(graph.mode)
    for node in graph.nodes.values():
        if node.type in refused:
            yield GraphIssue(
                IssueCode.MODE_INCOMPATIBLE,
                f"A {graph.mode} app can't hold a {node.type} node",
                node.id,
                data_loc(node.id, "type"),
            )


def _is_node(graph: _Graph, node_id: object) -> bool:
    if not isinstance(node_id, str):
        return False
    return node_id in graph.nodes


def _start_issue(graph: _Graph, node: _Node) -> GraphIssue | None:
    if node.type not in CONTAINER_NODE_TYPES:
        return None
    loc = data_loc(node.id, START_NODE_ID_KEY)
    # A missing start_node_id is already reported as invalid data.
    if any(issue.loc == loc for issue in node.issues):
        return None
    start = node.data.get(START_NODE_ID_KEY)
    if _is_node(graph, start):
        return None
    return GraphIssue(IssueCode.CONTAINER_START_MISSING, f"start_node_id {start!r} is not in the graph", node.id, loc)


def _node_issues(graph: _Graph) -> Iterable[GraphIssue]:
    for node in graph.nodes.values():
        yield from node.issues
        start_issue = _start_issue(graph, node)
        if start_issue is not None:
            yield start_issue


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
        valid = branch_handles(source.data) if source else None
        handle = str(edge.get("sourceHandle", SOURCE_HANDLE))
        if valid is not None and handle not in valid:
            yield GraphIssue(
                IssueCode.BRANCH_HANDLE_INVALID,
                f"sourceHandle {handle!r} is not a branch of {edge.get('source')!r}; use one of {sorted(valid)}",
                str(edge.get("source")),
                ("edges", edge_id, "sourceHandle"),
            )


def _unconnected_branch_issues(graph: _Graph) -> Iterable[GraphIssue]:
    for node in graph.nodes.values():
        handles = branch_handles(node.data)
        if handles is None:
            continue
        used = {str(e.get("sourceHandle", SOURCE_HANDLE)) for e in graph.edges if e.get("source") == node.id}
        for handle in sorted(handles - used):
            yield GraphIssue(
                IssueCode.BRANCH_UNCONNECTED,
                f"Branch {handle!r} of {node.id!r} has no edge; a run that takes it stops there",
                node.id,
                ("nodes", node.id),
            )


def _output_name_issues(graph: _Graph) -> Iterable[GraphIssue]:
    """End nodes share one set of workflow outputs, so the console refuses to publish a name used twice."""
    places: dict[str, list[tuple[str, int]]] = {}
    for node in graph.nodes.values():
        outputs = node.data.get("outputs")
        if node.type != BuiltinNodeTypes.END or not isinstance(outputs, list):
            continue
        for index, output in enumerate(outputs):
            name = str(output.get("variable") or "").strip() if isinstance(output, Mapping) else ""
            if name:
                places.setdefault(name, []).append((node.id, index))
    for name, found in places.items():
        if len(found) < 2:
            continue
        for node_id, index in found:
            yield GraphIssue(
                IssueCode.OUTPUT_NAME_DUPLICATE,
                f"Output {name!r} is used by more than one End node output; output names must be unique",
                node_id,
                data_loc(node_id, "outputs", index, "variable"),
            )


def _reference_issue(graph: _Graph, node: _Node, key: str, selector: Sequence[str]) -> GraphIssue | None:
    if not selector:
        name = key.removeprefix(f"{node.id}.").strip("#")
        message = f"{name} reads no variable" if name else EMPTY_SELECTOR_MESSAGE
        return GraphIssue(IssueCode.REFERENCE_EMPTY, message, node.id, data_loc(node.id))
    if selector[0] in ROOT_VARIABLE_NODE_IDS:
        return None
    if selector[0] in graph.nodes:
        return None
    return GraphIssue(
        IssueCode.REFERENCE_MISSING,
        f"{key} reads node {selector[0]!r}, which is not in the graph",
        node.id,
        data_loc(node.id),
    )


def _reference_issues(graph: _Graph) -> Iterable[GraphIssue]:
    for node in graph.nodes.values():
        issues = (_reference_issue(graph, node, key, selector) for key, selector in node.references.items())
        yield from (issue for issue in issues if issue is not None)


_CHECKS: Final[tuple[Callable[[_Graph], Iterable[GraphIssue]], ...]] = (
    _mode_issues,
    _node_issues,
    _edge_issues,
    _unconnected_branch_issues,
    _output_name_issues,
    _reference_issues,
)


def _shape_issues(graph: Mapping[str, Any]) -> list[GraphIssue]:
    """The shape every later check reads: a list of nodes, each a mapping with a string id and mapping data,
    and a list of edge mappings."""
    nodes = graph.get("nodes")
    if not isinstance(nodes, list):
        return [GraphIssue(IssueCode.GRAPH_INVALID, "graph.nodes must be a list", None, ("nodes",))]
    issues: list[GraphIssue] = []
    seen_ids: set[str] = set()
    for index, node in enumerate(nodes):
        node_id = node.get("id") if isinstance(node, Mapping) else None
        if not isinstance(node, Mapping):
            issues.append(GraphIssue(IssueCode.GRAPH_INVALID, "A node must be a mapping", None, ("nodes", index)))
        elif not isinstance(node_id, str) or not node_id:
            issues.append(GraphIssue(IssueCode.GRAPH_INVALID, "A node needs a string id", None, ("nodes", index, "id")))
        elif node_id in seen_ids:
            issues.append(
                GraphIssue(
                    IssueCode.GRAPH_INVALID,
                    f"Node id {node_id!r} is used by more than one node; node ids must be unique",
                    node_id,
                    ("nodes", index, "id"),
                )
            )
        elif not isinstance(node.get("data"), Mapping):
            issues.append(
                GraphIssue(IssueCode.GRAPH_INVALID, "The node data must be a mapping", node_id, data_loc(node_id))
            )
        if isinstance(node_id, str) and node_id:
            seen_ids.add(node_id)
    edges = graph.get("edges")
    if edges is None:
        return issues
    if not isinstance(edges, list):
        return [*issues, GraphIssue(IssueCode.GRAPH_INVALID, "graph.edges must be a list", None, ("edges",))]
    issues.extend(
        GraphIssue(IssueCode.GRAPH_INVALID, "An edge must be a mapping", None, ("edges", index))
        for index, edge in enumerate(edges)
        if not isinstance(edge, Mapping)
    )
    return issues


def check_graph(graph: Mapping[str, Any], *, mode: AppMode, resources: ResourceCheck | None = None) -> list[GraphIssue]:
    shape_issues = _shape_issues(graph)
    if shape_issues:
        return shape_issues
    raw_nodes = {str(n["id"]): n for n in graph["nodes"] if n.get("type") != CANVAS_NOTE_TYPE}
    view = _Graph(
        nodes={node_id: _read_node(node_id, raw) for node_id, raw in raw_nodes.items()},
        edges=graph.get("edges") or [],
        mode=mode,
    )
    issues = [issue for check in _CHECKS for issue in check(view)]
    if resources is not None:
        for node_id, raw in raw_nodes.items():
            problem = resources(raw)
            if problem:
                issues.append(GraphIssue(IssueCode.RESOURCE_UNAVAILABLE, problem, node_id, ("nodes", node_id)))
    return issues
