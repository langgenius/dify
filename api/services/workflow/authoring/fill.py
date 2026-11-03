"""Fill an agent-built package: the root app's graph, then its manifest; every other member is kept as written."""

from __future__ import annotations

import copy
from collections.abc import Sequence
from itertools import starmap
from typing import TYPE_CHECKING, Any, Final

import yaml

from configs import dify_config
from libs.archive_writer import ArchiveEntry, ArchiveLimits
from models.model import AppMode
from services.agent.roster_package_reader import PackageYamlLoader
from services.dsl_content import DSL_MAX_SIZE
from services.workflow.authoring.graph_wiring import fill_graph_wiring
from services.workflow.authoring.package_io import (
    APP_PATH,
    MANIFEST_PATH,
    YAML_ERRORS,
    bytes_entry,
    merge_manifest,
    new_manifest,
    read_member,
    write_package,
)
from services.workflow.authoring.plugins import fill_plugin_values
from services.workflow.node_defaults import editor_defaults

if TYPE_CHECKING:
    from services.workflow.authoring import FillContext

_GRAPH_MODES: Final = frozenset({AppMode.WORKFLOW, AppMode.ADVANCED_CHAT})


def fill_package(entries: Sequence[ArchiveEntry], ctx: FillContext, *, limits: ArchiveLimits) -> bytes:
    """Write the package again with its root `app.yaml` filled and its manifest matching it.

    Every other member is written byte for byte. `app.yaml` is rewritten only when fill changes its data, and the
    manifest only when `app.yaml` changed (just `apps[0].size/sha256`) or when there is none. An `app.yaml` or
    manifest fill cannot read keeps the package as written. Raises the archive writer's errors for an unsafe path
    or a package over `limits`, `RosterAgentPackageTooLargeError` for an `app.yaml` or manifest over the reader's
    size limits, and `PackageUnreadableError` for a member that cannot be read.
    """
    by_path = {entry.path: entry for entry in entries}
    if APP_PATH not in by_path:
        return write_package(entries, limits=limits)
    app = read_member(by_path[APP_PATH], max_bytes=DSL_MAX_SIZE)
    manifest = None
    if MANIFEST_PATH in by_path:
        manifest = read_member(by_path[MANIFEST_PATH], max_bytes=dify_config.AGENT_PACKAGE_MAX_MANIFEST_BYTES)
    app, manifest = _filled(app, manifest, ctx)
    # Read members are written again from their bytes: a folder part's stream can be read only once.
    replaced = {APP_PATH: app, MANIFEST_PATH: manifest}
    kept = [entry for entry in entries if entry.path not in replaced]
    return write_package([*kept, *starmap(bytes_entry, replaced.items())], limits=limits)


def _filled(app: bytes, manifest: bytes | None, ctx: FillContext) -> tuple[bytes, bytes]:
    filled = _filled_app(app, ctx)
    if manifest is None:
        final = app if filled is None else filled
        return final, new_manifest(final)
    if filled is None:
        return app, manifest
    merged = merge_manifest(manifest, filled)
    if merged is None:
        return app, manifest
    return filled, merged


def _filled_app(app: bytes, ctx: FillContext) -> bytes | None:
    """The filled `app.yaml`, or None when fill changes nothing or cannot read it."""
    try:
        document = yaml.load(app, Loader=PackageYamlLoader)  # noqa: S506
    except YAML_ERRORS:
        return None
    if not isinstance(document, dict):
        return None
    before = copy.deepcopy(document)
    fill_graph_document(document, ctx)
    if document == before:
        return None
    return yaml.dump(document, allow_unicode=True).encode()


def fill_graph_document(document: dict[str, Any], ctx: FillContext) -> None:
    """Fill a workflow or chatflow DSL's graph in place; any other app, or a part it cannot read, is left as is."""
    graph = _graph(document)
    if graph is None:
        return
    nodes = graph.get("nodes")
    for node in nodes if isinstance(nodes, list) else []:
        _fill_node(node, ctx)
    fill_graph_wiring(graph)


def _fill_node(node: object, ctx: FillContext) -> None:
    if not isinstance(node, dict):
        return
    data = node.get("data")
    if not isinstance(data, dict):
        return
    node["data"] = editor_defaults(data)
    fill_plugin_values(node["data"], ctx)


def _graph(document: dict[str, Any]) -> dict[str, Any] | None:
    app = document.get("app")
    if not isinstance(app, dict):
        return None
    mode = app.get("mode")
    if not isinstance(mode, str):
        return None
    if mode not in _GRAPH_MODES:
        return None
    workflow = document.get("workflow")
    if not isinstance(workflow, dict):
        return None
    graph = workflow.get("graph")
    return graph if isinstance(graph, dict) else None
