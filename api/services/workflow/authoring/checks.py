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
from machinery.context import RequestContext
from services.workflow.authoring.canvas_notes import (
    COVERS_KEY,
    TEXT_KEY,
    NoteField,
    NoteSize,
    coverable_nodes,
    is_note,
    is_number,
    text_loads,
)
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
from services.workflow.dsl_import import DslImportService
from services.workflow.graph_check import GraphIssue, IssueCode, IssueSeverity, data_loc

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
    MANIFEST_MISSING = ("manifest_missing", IssueSeverity.ERROR, True)
    NOTE_TEXT_INVALID = ("note_text_invalid", IssueSeverity.ERROR)
    NOTE_FIELD_MISSING = ("note_field_missing", IssueSeverity.ERROR)
    NOTE_COVER_UNKNOWN = ("note_cover_unknown", IssueSeverity.ERROR)
    NOTE_TOO_SMALL = ("note_too_small", IssueSeverity.WARNING)


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
        """A DSL check issue: an error there is one the import refuses."""
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
class DslCheckRequest:
    """`check.console_app.dsl` as the caller would run it. The package check runs it on the filled `app.yaml`, so
    the package check reports every issue the DSL check reports.
    """

    service: DslImportService
    context: RequestContext
    # The app whose mode the graph must fit; None for the mode the package's `app.yaml` gives.
    app_id: str | None

    def issues(self, app: bytes, document: Mapping[str, Any]) -> tuple[GraphIssue, ...]:
        """Raises what `DslImportService.check` raises, and `PackageUnreadableError` for an `app` that is not UTF-8."""
        if not self._checks(document):
            return ()
        return tuple(self.service.check(self.context, _utf8(app), self.app_id))

    def _checks(self, document: Mapping[str, Any]) -> bool:
        """The DSL check refuses an app that is not a workflow or chatflow unless `app_id` gives the mode, while a
        package of any app can be checked, so that app is left out.
        """
        if self.app_id is not None:
            return True
        return graph_mode(document) is not None


def _utf8(app: bytes) -> str:
    try:
        return app.decode()
    except UnicodeDecodeError as error:
        raise PackageUnreadableError(f"{APP_PATH} is not UTF-8 text") from error


@dataclass(frozen=True)
class CheckTarget:
    """What every check reads: the filled root document, its graph nodes of a known type, each read once, the
    root members as sent, and what `check.console_app.dsl` reports on the filled `app.yaml`.
    """

    document: Mapping[str, Any]
    nodes: tuple[NodeTarget, ...]
    submitted: SubmittedRoot
    dsl_issues: tuple[GraphIssue, ...]


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


def _read_nodes(document: Mapping[str, Any], ctx: FillContext) -> tuple[NodeTarget, ...]:
    """Read each node once; a node `read_node` cannot read is left to the DSL check, which reports it."""
    nodes = (read_node(node, ctx) for node in _graph_nodes(document))
    return tuple(node for node in nodes if node is not None)


class DslChecks(Check):
    """`check.console_app.dsl` on the filled `app.yaml`, with a hint on each required field the data lacks."""

    code = None

    def run(self, target: CheckTarget) -> Iterable[AuthoringIssue]:
        nodes = {node.id: node for node in target.nodes}
        return [AuthoringIssue.of(issue, _missing_field_hint(issue, nodes)) for issue in target.dsl_issues]


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


class ManifestMissing(Check):
    """A package sends a `manifest.yaml`; the import refuses one without it."""

    code = AuthoringIssueCode.MANIFEST_MISSING

    def run(self, target: CheckTarget) -> Iterable[AuthoringIssue]:
        if target.submitted.manifest is not None:
            return []
        message = (
            f"The package has no {MANIFEST_PATH}, so the import refuses it. "
            f"Fill the package before importing it: fill writes one that matches its {APP_PATH}."
        )
        return [self.issue(message, node_id=None, loc=(MANIFEST_PATH,))]


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


def _notes(document: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """The canvas notes of a workflow or chatflow graph that have an id the DSL check accepts."""
    return [node for node in _graph_nodes(document) if is_note(node) if isinstance(node.get("id"), str)]


class NoteTextInvalid(Check):
    """A note's text is plain text or editor JSON; the canvas shows other JSON as an empty note, or fails to open."""

    code = AuthoringIssueCode.NOTE_TEXT_INVALID

    def run(self, target: CheckTarget) -> Iterable[AuthoringIssue]:
        return [
            self.issue(
                f"Note {note['id']!r} has {TEXT_KEY} the note editor cannot load: write plain text, or editor JSON "
                "with a root that holds a list of children",
                node_id=note["id"],
                loc=data_loc(note["id"], TEXT_KEY),
            )
            for note in _notes(target.document)
            if not text_loads(note["data"])
        ]


class NoteFieldMissing(Check):
    """Each field only the web gives a note has a value the canvas can read; without a theme the canvas fails."""

    code = AuthoringIssueCode.NOTE_FIELD_MISSING

    def run(self, target: CheckTarget) -> Iterable[AuthoringIssue]:
        return [
            self.issue(
                f"Note {note['id']!r} needs {field.requirement}",
                node_id=note["id"],
                loc=data_loc(note["id"], field.value),
            )
            for note in _notes(target.document)
            for field in NoteField
            if not field.accepts(note["data"].get(field))
        ]


class NoteCoverUnknown(Check):
    """Each id a note covers names a top-level node of the graph, so fill can place the note under it."""

    code = AuthoringIssueCode.NOTE_COVER_UNKNOWN

    def run(self, target: CheckTarget) -> Iterable[AuthoringIssue]:
        coverable = coverable_nodes(_graph_nodes(target.document))
        return [
            self.issue(
                f"Note {note['id']!r} covers what is not a top-level node of the graph, so fill cannot place it",
                node_id=note["id"],
                loc=data_loc(note["id"], *loc),
            )
            for note in _notes(target.document)
            for loc in _unknown_covers(note["data"].get(COVERS_KEY), coverable)
        ]


def _unknown_covers(covers: object, coverable: Mapping[str, object]) -> list[Loc]:
    if covers is None:
        return []
    if not isinstance(covers, list):
        return [(COVERS_KEY,)]
    return [(COVERS_KEY, index) for index, node_id in enumerate(covers) if not _names_node(node_id, coverable)]


def _names_node(node_id: object, coverable: Mapping[str, object]) -> bool:
    if not isinstance(node_id, str):
        return False
    return node_id in coverable


class NoteTooSmall(Check):
    """A note is at least as large as the canvas resizer lets a user make it."""

    code = AuthoringIssueCode.NOTE_TOO_SMALL

    def run(self, target: CheckTarget) -> Iterable[AuthoringIssue]:
        return [
            self.issue(
                f"Note {note['id']!r} has a {size} below the canvas minimum of {size.minimum}",
                node_id=note["id"],
                loc=data_loc(note["id"], size.value),
            )
            for note in _notes(target.document)
            for size in NoteSize
            if _below_minimum(note["data"].get(size), size)
        ]


def _below_minimum(value: object, size: NoteSize) -> bool:
    if not is_number(value):
        return False
    return value < size.minimum


def check_package(
    entries: Sequence[ArchiveEntry], ctx: FillContext, *, limits: ArchiveLimits, dsl: DslCheckRequest
) -> PackageCheck:
    """Fill the package, run `check.console_app.dsl` on the filled `app.yaml`, then run every check on its root app.

    Each plugin reference is looked up once here, and every check and node spec reads that one lookup. Raises what
    `fill_package` raises, `PackageUnreadableError` when there is no `app.yaml` that is a YAML mapping, and what
    `DslCheckRequest.issues` raises.
    """
    root = filled_package(entries, ctx, limits=limits).root
    if root is None:
        raise PackageUnreadableError(_NO_APP_MAPPING)
    document = root.document
    if document is None:
        raise PackageUnreadableError(_NO_APP_MAPPING)
    target = CheckTarget(
        document=document,
        nodes=_read_nodes(document, ctx),
        submitted=root.submitted,
        dsl_issues=dsl.issues(root.app, document),
    )
    issues = tuple(issue for check in _CHECKS for issue in check.run(target))
    return PackageCheck(
        valid=not any(issue.severity == IssueSeverity.ERROR for issue in issues),
        issues=issues,
        node_specs=tuple(node_spec(node) for node in target.nodes),
    )
