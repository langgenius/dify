"""Fill an agent-built package: the root app's graph, then its manifest; every other member is kept as written."""

from __future__ import annotations

import copy
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from itertools import starmap
from typing import TYPE_CHECKING, Any

import yaml

from configs import dify_config
from libs.archive_writer import ArchiveEntry, ArchiveLimits
from models.model import AppMode
from services.dsl_content import DSL_MAX_SIZE
from services.workflow.authoring.canvas_layout import lay_out_nodes
from services.workflow.authoring.canvas_notes import fill_canvas_notes, fill_note_covers
from services.workflow.authoring.graph_wiring import fill_graph_wiring
from services.workflow.authoring.package_io import (
    APP_PATH,
    MANIFEST_PATH,
    bytes_entry,
    load_member_yaml,
    merge_manifest,
    new_manifest,
    read_member,
    write_package,
)
from services.workflow.authoring.plugins import fill_plugin_values
from services.workflow.graph_check import GRAPH_MODES
from services.workflow.node_defaults import editor_defaults

if TYPE_CHECKING:
    from services.workflow.authoring import FillContext


@dataclass(frozen=True)
class SubmittedRoot:
    """The root app's members as the caller sent them, before fill."""

    app: bytes
    manifest: bytes | None


@dataclass(frozen=True)
class FilledRoot:
    """The root app as the filled archive holds it, and as the caller sent it."""

    app: bytes
    # None when `app` is not a YAML mapping.
    document: dict[str, Any] | None
    submitted: SubmittedRoot


@dataclass(frozen=True)
class FilledPackage:
    archive: bytes
    # None when there is no `app.yaml`.
    root: FilledRoot | None

    @property
    def app_name(self) -> str | None:
        """The root app's name; None when the document has none that is text."""
        if self.root is None:
            return None
        if self.root.document is None:
            return None
        app = self.root.document.get("app")
        if not isinstance(app, dict):
            return None
        name = app.get("name")
        return name if isinstance(name, str) else None


@dataclass(frozen=True)
class _App:
    content: bytes
    document: dict[str, Any] | None


def fill_package(entries: Sequence[ArchiveEntry], ctx: FillContext, *, limits: ArchiveLimits) -> bytes:
    """Write the package again with its root `app.yaml` filled and its manifest matching it.

    Every other member is written byte for byte. `app.yaml` is rewritten only when fill changes its data. The
    manifest is rewritten only when its `apps[0].size/sha256` do not match the final `app.yaml` (just those two),
    and built when there is none. A manifest fill cannot merge keeps `app.yaml` and the manifest as written.
    Raises the archive writer's errors for an unsafe path or a package over `limits`,
    `RosterAgentPackageTooLargeError` for an `app.yaml` or manifest over the reader's size limits, and
    `PackageUnreadableError` for a member that cannot be read.
    """
    return filled_package(entries, ctx, limits=limits).archive


def filled_package(entries: Sequence[ArchiveEntry], ctx: FillContext, *, limits: ArchiveLimits) -> FilledPackage:
    """`fill_package`'s archive, with the root app's document it holds; raises what `fill_package` raises."""
    by_path = {entry.path: entry for entry in entries}
    if APP_PATH not in by_path:
        return FilledPackage(write_package(entries, limits=limits), None)
    submitted_app = _read_app(read_member(by_path[APP_PATH], max_bytes=DSL_MAX_SIZE))
    submitted_manifest = None
    if MANIFEST_PATH in by_path:
        submitted_manifest = read_member(by_path[MANIFEST_PATH], max_bytes=dify_config.AGENT_PACKAGE_MAX_MANIFEST_BYTES)
    app, manifest = _filled(submitted_app, submitted_manifest, ctx)
    # Read members are written again from their bytes: a folder part's stream can be read only once.
    replaced = {APP_PATH: app.content, MANIFEST_PATH: manifest}
    kept = [entry for entry in entries if entry.path not in replaced]
    return FilledPackage(
        write_package([*kept, *starmap(bytes_entry, replaced.items())], limits=limits),
        FilledRoot(app.content, app.document, SubmittedRoot(submitted_app.content, submitted_manifest)),
    )


def _read_app(content: bytes) -> _App:
    document = load_member_yaml(content)
    return _App(content, document if isinstance(document, dict) else None)


def _filled(app: _App, manifest: bytes | None, ctx: FillContext) -> tuple[_App, bytes]:
    final = _filled_app(app, ctx)
    if manifest is None:
        return final, new_manifest(final.content)
    merged = merge_manifest(manifest, final.content)
    if merged is None:
        return app, manifest
    return final, merged


def _filled_app(app: _App, ctx: FillContext) -> _App:
    """The filled `app.yaml`; `app` itself when fill changes nothing or cannot read it."""
    if app.document is None:
        return app
    document = copy.deepcopy(app.document)
    fill_graph_document(document, ctx)
    if document == app.document:
        return app
    return _App(yaml.dump(document, allow_unicode=True).encode(), document)


def fill_graph_document(document: dict[str, Any], ctx: FillContext) -> None:
    """Fill a workflow or chatflow DSL's graph in place; any other app, or a part it cannot read, is left as is."""
    graph = document_graph(document)
    if graph is None:
        return
    nodes = graph.get("nodes")
    for node in nodes if isinstance(nodes, list) else []:
        _fill_node(node, ctx)
    fill_graph_wiring(graph)
    fill_note_covers(graph)
    fill_canvas_notes(graph, moves=lay_out_nodes(graph))


def _fill_node(node: object, ctx: FillContext) -> None:
    if not isinstance(node, dict):
        return
    data = node.get("data")
    if not isinstance(data, dict):
        return
    node["data"] = editor_defaults(data)
    fill_plugin_values(node["data"], ctx)


def graph_mode(document: Mapping[str, Any]) -> AppMode | None:
    """The app's mode when it is a workflow or chatflow; None for any other app or a mode it cannot read."""
    app = document.get("app")
    if not isinstance(app, dict):
        return None
    mode = app.get("mode")
    if not isinstance(mode, str):
        return None
    if mode not in GRAPH_MODES:
        return None
    return AppMode(mode)


def document_graph(document: Mapping[str, Any]) -> dict[str, Any] | None:
    """A workflow or chatflow DSL's graph; None for any other app or a graph it cannot read."""
    if graph_mode(document) is None:
        return None
    workflow = document.get("workflow")
    if not isinstance(workflow, dict):
        return None
    graph = workflow.get("graph")
    return graph if isinstance(graph, dict) else None
