"""Loro graph encoding shared with the workflow editor.

The JSON graph seeds a baseline for each epoch. Subsequent canvas edits refer to its nodes and rows.
Only fully applied document versions can be projected or acknowledged.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING

from loro import EncodedBlobMode, ExportMode, LoroDoc, VersionVector

from services.workflow_loro_edits import LoroDraftUpdateError, project_edit_log

if TYPE_CHECKING:
    from loro import LoroValue

_ORDER_KEYS = {"nodes": "node_order", "edges": "edge_order"}


class LoroDraftEpochChangedError(ValueError):
    """The requested epoch no longer owns the draft."""


class LoroDraftEmptyGraphError(ValueError):
    """A nonempty graph can be cleared only with the editor's explicit consent."""


@dataclass(frozen=True, slots=True)
class LoroDraftSyncResult:
    epoch: str
    version: bytes
    update: bytes | None
    hash: str
    updated_at: int
    changed: bool


def _mapping(value: LoroValue) -> dict[str, LoroValue]:
    """Require a Loro map's JSON projection to be an object."""
    if not isinstance(value, dict):
        raise LoroDraftUpdateError("Expected a graph object.")
    return value


def load_loro_draft(snapshot: bytes | None, graph: Mapping[str, LoroValue]) -> LoroDoc:
    """Restore the committed snapshot or seed a new document from a graph with unique node and edge IDs."""
    doc = LoroDoc()
    if snapshot is not None:
        doc.import_(snapshot)
        return doc

    metadata = {key: value for key, value in graph.items() if key not in _ORDER_KEYS}
    for kind, order_key in _ORDER_KEYS.items():
        items = graph.get(kind, [])
        if not isinstance(items, list):
            raise LoroDraftUpdateError(f"Expected a list of {kind}.")
        target = doc.get_map(kind)
        ids: list[LoroValue] = []
        for value in items:
            item = _mapping(value)
            item_id = item.get("id")
            if not isinstance(item_id, str) or target.get(item_id) is not None:
                raise LoroDraftUpdateError(f"Expected unique string IDs for {kind}.")
            if "data" in item:
                _mapping(item["data"])
            target.insert(item_id, item)
            ids.append(item_id)
        metadata[order_key] = ids
    graph_map = doc.get_map("graph")
    for key, value in metadata.items():
        graph_map.insert(key, value)
    doc.commit()
    return doc


def project_loro_graph(doc: LoroDoc) -> dict[str, LoroValue]:
    """Apply the document's edit history to its ordered graph baseline, rejecting invalid graph values."""
    roots = _mapping(doc.get_deep_value())
    if roots.keys() - {"graph", "nodes", "edges", "editLog", "editState"}:
        raise LoroDraftUpdateError("Unexpected workflow document root.")
    graph = _mapping(roots.get("graph", {}))
    for kind, order_key in _ORDER_KEYS.items():
        items = _mapping(roots.get(kind, {}))
        order = graph.pop(order_key, [])
        if not isinstance(order, list):
            raise LoroDraftUpdateError("Invalid graph order.")
        ordered_ids: dict[str, None] = {}
        for key in order:
            if not isinstance(key, str):
                raise LoroDraftUpdateError("Invalid graph order.")
            ordered_ids[key] = None
        ordered_ids.update(dict.fromkeys(sorted(items)))
        projected: list[LoroValue] = []
        for key in ordered_ids:
            if key in items:
                item = _mapping(items[key])
                if item.get("id") != key:
                    raise LoroDraftUpdateError("Graph item ID does not match its map key.")
                projected.append(item)
        graph[kind] = projected
    project_edit_log(graph, _mapping(roots.get("editLog", {})), _mapping(roots.get("editState", {})))
    for kind in _ORDER_KEYS:
        items = graph[kind]
        assert isinstance(items, list)
        for item in items:
            assert isinstance(item, dict)
            if "data" in item:
                item["data"] = {k: v for k, v in _mapping(item["data"]).items() if not k.startswith("_")}
    return graph


def merge_loro_update(doc: LoroDoc, update: bytes) -> None:
    """Apply a delta, rejecting malformed bytes and missing causal dependencies.

    Native Loro decoding can raise a bare BaseException. Normalize that error
    while allowing process-control exceptions to propagate.
    """
    try:
        if LoroDoc.decode_import_blob_meta(update, True).mode != EncodedBlobMode.Updates:
            raise LoroDraftUpdateError("Expected a Loro delta.")
        status = doc.import_(update)
        if status.pending is not None:
            raise LoroDraftUpdateError("Loro update is missing causal dependencies.")
    except BaseException as error:
        if type(error) is not BaseException and not isinstance(error, (ValueError, RuntimeError, TypeError)):
            raise
        raise LoroDraftUpdateError(str(error)) from error


def export_loro_delta(doc: LoroDoc, from_version: bytes | None) -> bytes | None:
    """Return missing committed changes, or None when the requester is current.

    Reject invalid versions, including native decode errors raised as a bare
    BaseException, without intercepting process-control exceptions.
    """
    try:
        known = VersionVector.decode(from_version) if from_version is not None else VersionVector()
    except BaseException as error:
        if type(error) is not BaseException and not isinstance(error, (ValueError, RuntimeError, TypeError)):
            raise
        raise LoroDraftUpdateError("Invalid version vector.") from error
    applied = doc.state_vv
    if not applied.includes_vv(known):
        raise LoroDraftUpdateError("Requester version is outside the committed history.")
    if known.includes_vv(applied):
        return None
    return doc.export(ExportMode.Updates(known))
