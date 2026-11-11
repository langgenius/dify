"""Loro graph encoding shared with the workflow editor.

Node and data maps retain their identity across edits within one draft epoch.
Only fully applied document versions can be projected or acknowledged.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING

from loro import EncodedBlobMode, ExportMode, LoroDoc, LoroList, LoroMap, ValueOrContainer, VersionVector

if TYPE_CHECKING:
    from loro import LoroValue

_LIST_FIELDS = frozenset({"variables", "parameters"})
_ORDER_KEYS = {"nodes": "node_order", "edges": "edge_order"}


class LoroDraftUpdateError(ValueError):
    """The bytes cannot be applied to this draft's confirmed history."""


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


def _child_map(parent: LoroMap, key: str) -> LoroMap:
    """Return the existing child map, or attach a fresh map at an absent key."""
    existing = parent.get(key)
    if isinstance(existing, ValueOrContainer.Container) and isinstance(existing.container, LoroMap):
        return existing.container
    child = parent.insert_container(key, LoroMap())
    assert isinstance(child, LoroMap)
    return child


def _replace_map(target: LoroMap, values: dict[str, LoroValue], *, node: bool = False, data: bool = False) -> None:
    """Write changed keys and remove absent ones without replacing unchanged containers."""
    previous = _mapping(target.get_deep_value())
    for key in previous.keys() - values.keys():
        target.delete(key)
    for key, value in values.items():
        if key not in previous or previous[key] != value:
            if node and key == "data":
                _replace_map(_child_map(target, key), _mapping(value), data=True)
            elif data and key in _LIST_FIELDS and isinstance(value, list):
                existing = target.get(key)
                if isinstance(existing, ValueOrContainer.Container) and isinstance(existing.container, LoroList):
                    target_list = existing.container
                    if len(target_list):
                        target_list.delete(0, len(target_list))
                else:
                    child = target.insert_container(key, LoroList())
                    assert isinstance(child, LoroList)
                    target_list = child
                for index, item in enumerate(value):
                    target_list.insert(index, item)
            else:
                target.insert(key, value)


def replace_loro_graph(doc: LoroDoc, graph: Mapping[str, LoroValue]) -> None:
    """Apply an explicit, validated JSON replacement as changes to the current Loro document."""
    metadata = {key: value for key, value in graph.items() if key not in _ORDER_KEYS}
    for kind, order_key in _ORDER_KEYS.items():
        items = graph.get(kind, [])
        if not isinstance(items, list):
            raise LoroDraftUpdateError(f"Expected a list of {kind}.")
        target = doc.get_map(kind)
        previous = _mapping(target.get_deep_value())
        ids: list[LoroValue] = []
        for value in items:
            item = _mapping(value)
            item_id = item.get("id")
            if not isinstance(item_id, str) or item_id in ids:
                raise LoroDraftUpdateError(f"Expected unique string IDs for {kind}.")
            ids.append(item_id)
            if item_id not in previous or previous[item_id] != item:
                if kind == "nodes":
                    _replace_map(_child_map(target, item_id), item, node=True)
                else:
                    target.insert(item_id, item)
        for item_id in previous:
            if item_id not in ids:
                target.delete(item_id)
        metadata[order_key] = ids
    _replace_map(doc.get_map("graph"), metadata)
    doc.commit()


def load_loro_draft(snapshot: bytes | None, graph: Mapping[str, LoroValue]) -> LoroDoc:
    """Load the committed history, or seed it from the current JSON graph if no history exists."""
    doc = LoroDoc()
    if snapshot is None:
        replace_loro_graph(doc, graph)
    else:
        doc.import_(snapshot)
    return doc


def project_loro_graph(doc: LoroDoc) -> dict[str, LoroValue]:
    """Project applied node and edge state for Dify, keeping the original relative order."""
    roots = _mapping(doc.get_deep_value())
    if roots.keys() - {"graph", "nodes", "edges"}:
        raise LoroDraftUpdateError("Unexpected workflow document root.")
    graph = _mapping(doc.get_map("graph").get_deep_value())
    for kind, order_key in _ORDER_KEYS.items():
        items = _mapping(doc.get_map(kind).get_deep_value())
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
                if "data" in item:
                    item["data"] = {k: v for k, v in _mapping(item["data"]).items() if not k.startswith("_")}
                projected.append(item)
        graph[kind] = projected
    return graph


def merge_loro_update(doc: LoroDoc, update: bytes) -> None:
    """Apply a native update or reject the whole request when causal dependencies are missing."""
    try:
        if LoroDoc.decode_import_blob_meta(update, True).mode != EncodedBlobMode.Updates:
            raise LoroDraftUpdateError("Expected a Loro delta.")
        status = doc.import_(update)
        if status.pending is not None:
            raise LoroDraftUpdateError("Loro update is missing causal dependencies.")
    except (ValueError, RuntimeError, TypeError) as error:
        raise LoroDraftUpdateError(str(error)) from error


def export_loro_delta(doc: LoroDoc, from_version: bytes | None) -> bytes | None:
    """Return what a requester with a confirmed version is missing; None means it is current."""
    try:
        known = VersionVector.decode(from_version) if from_version is not None else VersionVector()
    except (ValueError, RuntimeError, TypeError) as error:
        raise LoroDraftUpdateError("Invalid version vector.") from error
    applied = doc.state_vv
    if not applied.includes_vv(known):
        raise LoroDraftUpdateError("Requester version is outside the committed history.")
    if known.includes_vv(applied):
        return None
    return doc.export(ExportMode.Updates(known))
