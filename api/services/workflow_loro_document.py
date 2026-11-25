"""Native Loro representation of a workflow draft shared by the editor and API."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING

from loro import EncodedBlobMode, ExportMode, LoroDoc, LoroMap, LoroMovableList, VersionVector

if TYPE_CHECKING:
    from loro import LoroValue

_ORDER = {"nodes": "node_order", "edges": "edge_order"}
_TRANSIENT = {"selected", "dragging", "resizing", "positionAbsolute", "measured", "__rf"}
MAX_HISTORY_OPS = 2000
MAX_SNAPSHOT_BYTES = 512 * 1024


class LoroDraftUpdateError(ValueError):
    """The delta or its graph projection failed validation."""


class LoroDraftEpochChangedError(ValueError):
    """The workflow has been replaced since this editor joined."""


class LoroDraftHistoryCompactedError(ValueError):
    """The editor needs a new checkpoint within the same epoch."""


class LoroDraftEmptyGraphError(ValueError):
    """Clearing a confirmed graph requires the editor's consent."""


@dataclass(frozen=True, slots=True)
class LoroDraftSyncResult:
    epoch: str
    version: bytes
    update: bytes | None
    hash: str
    updated_at: int
    changed: bool
    from_version: bytes | None = None
    committed_update: bytes | None = None


def _object(value: LoroValue) -> dict[str, LoroValue]:
    if not isinstance(value, dict):
        raise LoroDraftUpdateError("Expected a graph object.")
    return value


def _write_map(target: LoroMap, source: Mapping[str, LoroValue]) -> None:
    for key, value in source.items():
        if isinstance(value, dict):
            _write_map(target.ensure_mergeable_map(key), value)
        elif isinstance(value, list):
            _write_list(target.ensure_mergeable_movable_list(key), value)
        else:
            target.insert(key, value)


def _write_list(target: LoroMovableList, values: list[LoroValue]) -> None:
    for value in values:
        if isinstance(value, dict):
            child = target.push_container(LoroMap())
            assert isinstance(child, LoroMap)
            _write_map(child, value)
        elif isinstance(value, list):
            nested = target.push_container(LoroMovableList())
            assert isinstance(nested, LoroMovableList)
            _write_list(nested, value)
        else:
            target.push(value)


def _entity(value: LoroValue, *, seed: bool = False) -> dict[str, LoroValue]:
    item = {k: v for k, v in _object(value).items() if k not in _TRANSIENT}
    if "data" in item:
        data = {k: v for k, v in _object(item["data"]).items() if k != "selected" and not k.startswith("_")}
        if seed and data.get("type") == "if-else" and "cases" not in data and "conditions" in data:
            data["cases"] = [
                {
                    "case_id": "true",
                    "conditions": data["conditions"],
                    "logical_operator": data.get("logical_operator", "and"),
                }
            ]
        item["data"] = data
    return item


def load_loro_draft(snapshot: bytes | None, graph: Mapping[str, LoroValue]) -> LoroDoc:
    doc = LoroDoc()
    if snapshot is not None:
        doc.import_(snapshot)
        return doc
    metadata = doc.get_map("graph")
    _write_map(metadata, {k: v for k, v in graph.items() if k not in (*_ORDER, "schema_version", *_ORDER.values())})
    metadata.insert("schema_version", 2)
    for kind, order_key in _ORDER.items():
        items = graph.get(kind, [])
        if not isinstance(items, list):
            raise LoroDraftUpdateError(f"Expected an array of {kind}.")
        entities = doc.get_map(kind)
        order = metadata.ensure_mergeable_movable_list(order_key)
        for value in items:
            item = _entity(value, seed=True)
            key = item.get("id")
            if not isinstance(key, str) or not key or key in entities:
                raise LoroDraftUpdateError(f"Expected unique string IDs for {kind}.")
            _write_map(entities.ensure_mergeable_map(key), item)
            order.push(key)
    doc.commit()
    return doc


def project_loro_graph(doc: LoroDoc) -> dict[str, LoroValue]:
    roots = _object(doc.get_deep_value())
    if roots.keys() - {"graph", "nodes", "edges"}:
        raise LoroDraftUpdateError("Unexpected workflow document root.")
    graph = _object(roots.get("graph"))
    if graph.pop("schema_version", None) != 2:
        raise LoroDraftUpdateError("Invalid workflow document schema.")
    nodes = _object(roots.get("nodes", {}))
    for kind, order_key in _ORDER.items():
        entities = _object(roots.get(kind, {}))
        order = graph.pop(order_key, None)
        if not isinstance(order, list) or not all(isinstance(key, str) for key in order):
            raise LoroDraftUpdateError("Invalid entity order.")
        ordered_ids = dict.fromkeys(key for key in order if isinstance(key, str))
        ordered_ids.update(dict.fromkeys(sorted(entities)))
        projected: list[LoroValue] = []
        for key in ordered_ids:
            if key not in entities:
                continue
            item = _entity(entities[key])
            if item.get("id") != key:
                raise LoroDraftUpdateError("Entity ID differs from its map key.")
            if kind == "edges":
                source, target = item.get("source"), item.get("target")
                if not isinstance(source, str) or not isinstance(target, str):
                    raise LoroDraftUpdateError("Invalid edge endpoints.")
                if source not in nodes or target not in nodes:
                    continue
            projected.append(item)
        graph[kind] = projected
    return graph


def export_loro_snapshot(doc: LoroDoc) -> bytes:
    if doc.len_ops < MAX_HISTORY_OPS:
        snapshot = doc.export(ExportMode.Snapshot())
        if len(snapshot) < MAX_SNAPSHOT_BYTES:
            return snapshot
    return doc.export(ExportMode.ShallowSnapshot(doc.oplog_frontiers))


def merge_loro_update(doc: LoroDoc, update: bytes) -> None:
    try:
        if LoroDoc.decode_import_blob_meta(update, True).mode != EncodedBlobMode.Updates:
            raise LoroDraftUpdateError("Expected a Loro delta.")
        if doc.import_(update).pending is not None:
            raise LoroDraftUpdateError("Missing causal dependencies.")
    except BaseException as error:
        if type(error) is not BaseException and not isinstance(error, (ValueError, RuntimeError, TypeError)):
            raise
        raise LoroDraftUpdateError(str(error)) from error


def check_loro_version(doc: LoroDoc, version: bytes | None) -> VersionVector | None:
    if version is None:
        return None
    try:
        known = VersionVector.decode(version)
    except BaseException as error:
        if type(error) is not BaseException and not isinstance(error, (ValueError, RuntimeError, TypeError)):
            raise
        raise LoroDraftUpdateError("Invalid version vector.") from error
    if doc.is_shallow() and not known.includes_vv(doc.shallow_since_vv):
        raise LoroDraftHistoryCompactedError
    if not doc.state_vv.includes_vv(known):
        raise LoroDraftUpdateError("Unknown version vector.")
    return known


def export_loro_delta(doc: LoroDoc, version: bytes | None) -> bytes | None:
    known = check_loro_version(doc, version)
    if known is None:
        return doc.export(ExportMode.Snapshot())
    if known.includes_vv(doc.state_vv):
        return None
    return doc.export(ExportMode.Updates(known))
