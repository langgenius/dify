"""Check a filled package: each check is a `Check` subclass, run on the root app's document."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING, Any, ClassVar, Final, Self

from core.workflow.node_factory import node_data_model
from graphon.enums import NodeExecutionType
from libs.archive_writer import ArchiveEntry, ArchiveLimits
from services.workflow.authoring.fill import document_graph, filled_package, graph_mode
from services.workflow.authoring.node_spec import FieldHint, Loc, NodeSpec, field_hint, node_spec
from services.workflow.authoring.package_io import APP_PATH, PackageUnreadableError
from services.workflow.authoring.plugins import (
    NO_DEFAULT,
    DeclarationStatus,
    DeclaredParameter,
    PluginReference,
    node_class,
    node_references,
)
from services.workflow.graph_check import GraphIssue, IssueCode, IssueSeverity, check_graph

if TYPE_CHECKING:
    from services.workflow.authoring import FillContext

_MISSING_ERROR_TYPE: Final = "missing"
_NODES_LOC: Final = "nodes"
_DATA_LOC: Final = "data"


class AuthoringIssueCode(StrEnum):
    """Codes of the checks only check reports; severity lives on the member, and none refuses an import."""

    severity: IssueSeverity

    def __new__(cls, value: str, severity: IssueSeverity) -> Self:
        member = str.__new__(cls, value)
        member._value_ = value
        member.severity = severity
        return member

    NO_ROOT_NODE = ("no_root_node", IssueSeverity.ERROR)
    PLUGIN_NOT_FOUND = ("plugin_not_found", IssueSeverity.ERROR)
    PLUGIN_PARAMETER_MISSING = ("plugin_parameter_missing", IssueSeverity.ERROR)

    @property
    def refuses_import(self) -> bool:
        """Imports refuse only what they refuse today, so no check-only code refuses one."""
        return False


@dataclass(frozen=True)
class AuthoringIssue:
    code: str
    severity: IssueSeverity
    refuses_import: bool
    message: str
    node_id: str | None
    loc: Loc
    hint: FieldHint | None = None

    @classmethod
    def of(cls, graph_issue: GraphIssue, hint: FieldHint | None) -> Self:
        """A `check_graph` issue: an error there is one the import refuses."""
        severity = graph_issue.code.severity
        return cls(
            code=graph_issue.code,
            severity=severity,
            refuses_import=severity == IssueSeverity.ERROR,
            message=graph_issue.message,
            node_id=graph_issue.node_id,
            loc=graph_issue.loc,
            hint=hint,
        )


@dataclass(frozen=True)
class PackageCheck:
    valid: bool
    issues: tuple[AuthoringIssue, ...]
    node_specs: tuple[NodeSpec, ...]


_CHECKS: list[Check] = []


class Check(ABC):
    """One check of a filled document; a subclass registers itself, and checks do not depend on each other's order."""

    code: ClassVar[AuthoringIssueCode | None]

    def __init_subclass__(cls, **kwargs: object) -> None:
        super().__init_subclass__(**kwargs)
        _CHECKS.append(cls())

    @abstractmethod
    def run(self, document: Mapping[str, Any], ctx: FillContext) -> Iterable[AuthoringIssue]: ...

    def issue(self, message: str, *, node_id: str | None, loc: Loc) -> AuthoringIssue:
        """An issue under this check's own code."""
        if self.code is None:
            raise TypeError(f"{type(self).__name__} reports no code of its own")
        return AuthoringIssue(
            code=self.code,
            severity=self.code.severity,
            refuses_import=self.code.refuses_import,
            message=message,
            node_id=node_id,
            loc=loc,
        )


@dataclass(frozen=True)
class _GraphNode:
    id: str
    data: Mapping[str, Any]
    top_level: bool


def _graph_nodes(document: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """The mapping nodes of a workflow or chatflow graph; none for any other app or a graph it cannot read."""
    graph = document_graph(document)
    if graph is None:
        return []
    nodes = graph.get(_NODES_LOC)
    if not isinstance(nodes, list):
        return []
    return [node for node in nodes if isinstance(node, Mapping)]


def _readable_node(node: Mapping[str, Any]) -> _GraphNode | None:
    node_id = node.get("id")
    data = node.get(_DATA_LOC)
    if not isinstance(node_id, str):
        return None
    if not isinstance(data, Mapping):
        return None
    return _GraphNode(node_id, data, top_level=not node.get("parentId"))


def _readable_nodes(document: Mapping[str, Any]) -> list[_GraphNode]:
    """The graph's nodes with a string id and mapping data; checks skip the rest, which `check_graph` reports."""
    nodes = (_readable_node(node) for node in _graph_nodes(document))
    return [node for node in nodes if node is not None]


def _data_loc(node_id: str, *path: str | int) -> Loc:
    return (_NODES_LOC, node_id, _DATA_LOC, *path)


class GraphChecks(Check):
    """Today's `check_graph`, with a hint on each required field the data lacks."""

    code = None

    def run(self, document: Mapping[str, Any], ctx: FillContext) -> Iterable[AuthoringIssue]:
        mode = graph_mode(document)
        graph = document_graph(document)
        if mode is None:
            return []
        if graph is None:
            return []
        nodes = {node.id: node.data for node in _readable_nodes(document)}
        return [AuthoringIssue.of(issue, _missing_field_hint(issue, nodes)) for issue in check_graph(graph, mode=mode)]


def _missing_field_hint(issue: GraphIssue, nodes: Mapping[str, Mapping[str, Any]]) -> FieldHint | None:
    if issue.code != IssueCode.NODE_DATA_INVALID:
        return None
    if issue.error_type != _MISSING_ERROR_TYPE:
        return None
    if issue.node_id is None:
        return None
    data = nodes.get(issue.node_id)
    if data is None:
        return None
    resolved = node_class(data)
    if resolved is None:
        return None
    path = issue.loc[len(_data_loc(issue.node_id)) :]
    return field_hint(node_data_model(resolved), path, required=True)


class NoRootNode(Check):
    """A workflow or chatflow runs from a start or trigger node at the top level of its graph."""

    code = AuthoringIssueCode.NO_ROOT_NODE

    def run(self, document: Mapping[str, Any], ctx: FillContext) -> Iterable[AuthoringIssue]:
        if graph_mode(document) is None:
            return []
        if any(_is_top_level_root(node) for node in _readable_nodes(document)):
            return []
        message = "The graph has no start or trigger node at its top level, so nothing can run it"
        return [self.issue(message, node_id=None, loc=(_NODES_LOC,))]


def _is_top_level_root(node: _GraphNode) -> bool:
    if not node.top_level:
        return False
    resolved = node_class(node.data)
    if resolved is None:
        return False
    return resolved.execution_type == NodeExecutionType.ROOT


class PluginNotFound(Check):
    """Each plugin a node uses is found in the workspace."""

    code = AuthoringIssueCode.PLUGIN_NOT_FOUND

    def run(self, document: Mapping[str, Any], ctx: FillContext) -> Iterable[AuthoringIssue]:
        return [
            self.issue(
                f"The provider or tool of {reference.key!r} was not found in this workspace",
                node_id=node.id,
                loc=_data_loc(node.id),
            )
            for node in _readable_nodes(document)
            for reference in node_references(node.data)
            if reference.resolve(ctx).status != DeclarationStatus.FOUND
        ]


class PluginParameterMissing(Check):
    """Each required parameter a found plugin declares has a value, or a default that stands in for one."""

    code = AuthoringIssueCode.PLUGIN_PARAMETER_MISSING

    def run(self, document: Mapping[str, Any], ctx: FillContext) -> Iterable[AuthoringIssue]:
        return [
            issue
            for node in _readable_nodes(document)
            for reference in node_references(node.data)
            for issue in self._reference_issues(node, reference, ctx)
        ]

    def _reference_issues(self, node: _GraphNode, reference: PluginReference, ctx: FillContext) -> list[AuthoringIssue]:
        declaration = reference.resolve(ctx)
        if declaration.status != DeclarationStatus.FOUND:
            return []
        return [
            self.issue(
                f"{reference.key!r} needs a value for its required parameter {parameter.name!r}",
                node_id=node.id,
                loc=_data_loc(node.id, *reference.value_loc(parameter)),
            )
            for parameter in declaration.parameters
            if _lacks_value(node.data, reference, parameter)
        ]


def _lacks_value(data: Mapping[str, Any], reference: PluginReference, parameter: DeclaredParameter) -> bool:
    """A required parameter with neither a stored value nor a declared default to stand in for one."""
    if not parameter.required:
        return False
    if parameter.default is not NO_DEFAULT:
        return False
    return _value_at(data, reference.value_loc(parameter)) is None


def _value_at(data: Mapping[str, Any], loc: Sequence[str]) -> object:
    value: object = data
    for key in loc:
        if not isinstance(value, Mapping):
            return None
        value = value.get(key)
    return value


def check_package(entries: Sequence[ArchiveEntry], ctx: FillContext, *, limits: ArchiveLimits) -> PackageCheck:
    """Fill the package, then run every check on its root app.

    Raises what `fill_package` raises, and `PackageUnreadableError` when there is no `app.yaml` that is a YAML mapping.
    """
    document = filled_package(entries, ctx, limits=limits).document
    if document is None:
        raise PackageUnreadableError(f"The package has no {APP_PATH} that reads as a YAML mapping")
    issues = tuple(issue for check in _CHECKS for issue in check.run(document, ctx))
    specs = (node_spec(node, ctx) for node in _graph_nodes(document))
    return PackageCheck(
        valid=not any(issue.severity == IssueSeverity.ERROR for issue in issues),
        issues=issues,
        node_specs=tuple(spec for spec in specs if spec is not None),
    )
