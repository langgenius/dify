"""Check a filled package: each check is a `Check` subclass, run on the root app's document."""

from __future__ import annotations

import inspect
from abc import ABC, abstractmethod
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING, Any, ClassVar, Final, Self

from graphon.enums import NodeExecutionType
from libs.archive_writer import ArchiveEntry, ArchiveLimits
from services.workflow.authoring.fill import SubmittedRoot, document_graph, filled_package, graph_mode
from services.workflow.authoring.node_spec import (
    FieldHint,
    Loc,
    NodeSpec,
    NodeTarget,
    ResolvedReference,
    field_hint,
    node_spec,
    read_node,
)
from services.workflow.authoring.package_io import APP_PATH, MANIFEST_PATH, PackageUnreadableError, manifest_is_stale
from services.workflow.authoring.plugins import NO_DEFAULT, DeclarationStatus, DeclaredParameter, PluginReference
from services.workflow.graph_check import GraphIssue, IssueCode, IssueSeverity, check_graph, data_loc

if TYPE_CHECKING:
    from services.workflow.authoring import FillContext

_MISSING_ERROR_TYPE: Final = "missing"
_NODES_LOC: Final = "nodes"
_MANIFEST_APPS_KEY: Final = "apps"
_NO_APP_MAPPING: Final = f"The package has no {APP_PATH} that reads as a YAML mapping"


class AuthoringIssueCode(StrEnum):
    """Codes of the checks only check reports. Severity, and whether the package import refuses the issue today,
    live on the member: a new check never makes an import refuse what it accepts.
    """

    severity: IssueSeverity
    refuses_import: bool

    def __new__(cls, value: str, severity: IssueSeverity, refuses_import: bool = False) -> Self:
        member = str.__new__(cls, value)
        member._value_ = value
        member.severity = severity
        member.refuses_import = refuses_import
        return member

    NO_ROOT_NODE = ("no_root_node", IssueSeverity.ERROR)
    PLUGIN_NOT_FOUND = ("plugin_not_found", IssueSeverity.ERROR)
    PLUGIN_PARAMETER_MISSING = ("plugin_parameter_missing", IssueSeverity.ERROR)
    MANIFEST_STALE = ("manifest_stale", IssueSeverity.ERROR, True)


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


@dataclass(frozen=True)
class CheckTarget:
    """What every check reads: the filled root document, its graph nodes of a known type, each read once, and the
    root members as sent.
    """

    document: Mapping[str, Any]
    nodes: tuple[NodeTarget, ...]
    submitted: SubmittedRoot


_CHECKS: list[Check] = []


class Check(ABC):
    """One check of a filled package; a concrete subclass registers itself, and checks do not depend on each
    other's order. A check reads only its target, so it makes no lookup of its own.
    """

    code: ClassVar[AuthoringIssueCode | None]

    def __init_subclass__(cls, **kwargs: object) -> None:
        super().__init_subclass__(**kwargs)
        if not inspect.isabstract(cls):
            _CHECKS.append(cls())

    @abstractmethod
    def run(self, target: CheckTarget) -> Iterable[AuthoringIssue]: ...

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


def _graph_nodes(document: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """The mapping nodes of a workflow or chatflow graph; none for any other app or a graph it cannot read."""
    graph = document_graph(document)
    if graph is None:
        return []
    nodes = graph.get(_NODES_LOC)
    if not isinstance(nodes, list):
        return []
    return [node for node in nodes if isinstance(node, Mapping)]


def _target(document: Mapping[str, Any], submitted: SubmittedRoot, ctx: FillContext) -> CheckTarget:
    """Read each node once; a node `read_node` cannot read is left to `check_graph`, which reports it."""
    nodes = (read_node(node, ctx) for node in _graph_nodes(document))
    return CheckTarget(document=document, nodes=tuple(node for node in nodes if node is not None), submitted=submitted)


class GraphChecks(Check):
    """Today's `check_graph`, with a hint on each required field the data lacks."""

    code = None

    def run(self, target: CheckTarget) -> Iterable[AuthoringIssue]:
        mode = graph_mode(target.document)
        graph = document_graph(target.document)
        if mode is None:
            return []
        if graph is None:
            return []
        nodes = {node.id: node for node in target.nodes}
        return [AuthoringIssue.of(issue, _missing_field_hint(issue, nodes)) for issue in check_graph(graph, mode=mode)]


def _missing_field_hint(issue: GraphIssue, nodes: Mapping[str, NodeTarget]) -> FieldHint | None:
    if issue.code != IssueCode.NODE_DATA_INVALID:
        return None
    if issue.error_type != _MISSING_ERROR_TYPE:
        return None
    if issue.node_id is None:
        return None
    node = nodes.get(issue.node_id)
    if node is None:
        return None
    return field_hint(node.model, issue.loc[len(data_loc(node.id)) :], required=True)


class NoRootNode(Check):
    """A workflow or chatflow runs from a start or trigger node at the top level of its graph."""

    code = AuthoringIssueCode.NO_ROOT_NODE

    def run(self, target: CheckTarget) -> Iterable[AuthoringIssue]:
        if graph_mode(target.document) is None:
            return []
        if any(_is_top_level_root(node) for node in target.nodes):
            return []
        message = "The graph has no start or trigger node at its top level, so nothing can run it"
        return [self.issue(message, node_id=None, loc=(_NODES_LOC,))]


def _is_top_level_root(node: NodeTarget) -> bool:
    if not node.top_level:
        return False
    return node.node_class.execution_type == NodeExecutionType.ROOT


class ManifestStale(Check):
    """A sent `manifest.yaml` describes the `app.yaml` sent with it; the import refuses one that does not."""

    code = AuthoringIssueCode.MANIFEST_STALE

    def run(self, target: CheckTarget) -> Iterable[AuthoringIssue]:
        manifest = target.submitted.manifest
        if manifest is None:
            return []
        if not manifest_is_stale(manifest, target.submitted.app):
            return []
        message = (
            f"{MANIFEST_PATH} gives another size or sha256 for {APP_PATH}, so the import refuses this package. "
            "Fill the package again before importing it: fill rewrites both values."
        )
        return [self.issue(message, node_id=None, loc=(MANIFEST_PATH, _MANIFEST_APPS_KEY, 0))]


class PluginNotFound(Check):
    """Each plugin a node uses resolves in the workspace."""

    code = AuthoringIssueCode.PLUGIN_NOT_FOUND

    def run(self, target: CheckTarget) -> Iterable[AuthoringIssue]:
        return [
            self.issue(
                f"The provider or tool of {resolved.reference.key!r} could not be resolved in this workspace",
                node_id=node.id,
                loc=data_loc(node.id),
            )
            for node in target.nodes
            for resolved in node.references
            if resolved.declaration.status != DeclarationStatus.FOUND
        ]


class PluginParameterMissing(Check):
    """Each required parameter a found plugin declares has a value, or a default that stands in for one."""

    code = AuthoringIssueCode.PLUGIN_PARAMETER_MISSING

    def run(self, target: CheckTarget) -> Iterable[AuthoringIssue]:
        return [
            issue for node in target.nodes for resolved in node.references for issue in self._issues(node, resolved)
        ]

    def _issues(self, node: NodeTarget, resolved: ResolvedReference) -> list[AuthoringIssue]:
        if resolved.declaration.status != DeclarationStatus.FOUND:
            return []
        reference = resolved.reference
        return [
            self.issue(
                f"{reference.key!r} needs a value for its required parameter {parameter.name!r}",
                node_id=node.id,
                loc=data_loc(node.id, *reference.value_loc(parameter)),
            )
            for parameter in resolved.declaration.parameters
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

    Each plugin reference is looked up once here, and every check and node spec reads that one lookup. Raises what
    `fill_package` raises, and `PackageUnreadableError` when there is no `app.yaml` that is a YAML mapping.
    """
    filled = filled_package(entries, ctx, limits=limits)
    if filled.document is None:
        raise PackageUnreadableError(_NO_APP_MAPPING)
    if filled.submitted is None:
        raise PackageUnreadableError(_NO_APP_MAPPING)
    target = _target(filled.document, filled.submitted, ctx)
    issues = tuple(issue for check in _CHECKS for issue in check.run(target))
    return PackageCheck(
        valid=not any(issue.severity == IssueSeverity.ERROR for issue in issues),
        issues=issues,
        node_specs=tuple(node_spec(node) for node in target.nodes),
    )
