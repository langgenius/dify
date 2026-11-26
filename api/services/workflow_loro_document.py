"""Native Loro representation of a workflow draft shared by the editor and API."""

from __future__ import annotations

from collections.abc import Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from typing import TYPE_CHECKING

from loro import EncodedBlobMode, ExportMode, LoroDoc, LoroMap, LoroMovableList, VersionVector

if TYPE_CHECKING:
    from collections.abc import Generator

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
    """Restore a stored snapshot or seed a JSON graph with unique entity IDs."""
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
        entities_to_seed = [_entity(item, seed=True) for item in items]
        reserved = {key for item in entities_to_seed if isinstance(key := item.get("id"), str) and key}
        entities = doc.get_map(kind)
        order = metadata.ensure_mergeable_movable_list(order_key)
        for index, item in enumerate(entities_to_seed):
            key = item.get("id")
            if not isinstance(key, str) or not key or key in entities:
                key = f"legacy-{kind}-{index}"
                while key in reserved:
                    key += "-"
                reserved.add(key)
                item["id"] = key
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
        ordered_ids = dict.fromkeys(order)
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


def apply_loro_agent_session_policy(
    doc: LoroDoc, projected: Mapping[str, LoroValue], saved: Mapping[str, LoroValue]
) -> None:
    """Apply saved binding fields to the same ordered nodes, rejecting invalid containers."""
    before_nodes, after_nodes = projected["nodes"], saved["nodes"]
    assert isinstance(before_nodes, list)
    assert isinstance(after_nodes, list)
    nodes = doc.get_map("nodes")
    for before_node, after_node in zip(before_nodes, after_nodes, strict=True):
        node = _object(after_node)
        before_data, after_data = _object(before_node).get("data"), node.get("data")
        if isinstance(before_data, dict) and isinstance(after_data, dict):
            for key in ("continue_agent_session", "agent_session_generation"):
                if before_data.get(key) != after_data.get(key) or (key in before_data) != (key in after_data):
                    node_id = node["id"]
                    assert isinstance(node_id, str)
                    with _loro_input_error("Invalid Loro Agent session fields."):
                        data = nodes.ensure_mergeable_map(node_id).ensure_mergeable_map("data")
                        if key in after_data:
                            data.insert(key, after_data[key])
                        else:
                            data.delete(key)
    doc.commit()


def export_loro_snapshot(doc: LoroDoc) -> bytes:
    if doc.len_ops < MAX_HISTORY_OPS:
        snapshot = doc.export(ExportMode.Snapshot())
        if len(snapshot) < MAX_SNAPSHOT_BYTES:
            return snapshot
    return doc.export(ExportMode.ShallowSnapshot(doc.oplog_frontiers))


@contextmanager
def _loro_input_error(message: str) -> Generator[None]:
    """Translate native decoding failures while leaving cancellation and interrupts alone."""
    try:
        yield
    except BaseException as error:
        if type(error) is not BaseException and not isinstance(error, (ValueError, RuntimeError, TypeError)):
            raise
        raise LoroDraftUpdateError(message) from error


def merge_loro_update(doc: LoroDoc, update: bytes) -> None:
    """Import a complete delta into a temporary document or reject the input."""
    with _loro_input_error("Invalid Loro delta."):
        mode = LoroDoc.decode_import_blob_meta(update, True).mode
    if mode != EncodedBlobMode.Updates:
        raise LoroDraftUpdateError("Expected a Loro delta.")
    with _loro_input_error("Invalid Loro delta."):
        pending = doc.import_(update).pending
    if pending is not None:
        raise LoroDraftUpdateError("Missing causal dependencies.")


def check_loro_version(doc: LoroDoc, version: bytes | None, *, pushing: bool) -> VersionVector | None:
    """Return a checked export base, requiring the inclusive shallow frontier for pushes."""
    if version is None:
        return None
    with _loro_input_error("Invalid version vector."):
        known = VersionVector.decode(version)
    if doc.is_shallow():
        boundary = doc.frontiers_to_vv(doc.shallow_since_frontiers) if pushing else doc.shallow_since_vv
        assert boundary is not None
        if not known.includes_vv(boundary):
            raise LoroDraftHistoryCompactedError
    if not doc.state_vv.includes_vv(known):
        raise LoroDraftUpdateError("Unknown version vector.")
    return known


def export_loro_delta(doc: LoroDoc, known: VersionVector | None) -> bytes | None:
    """Export changes since a checked base, or a full checkpoint for a new client."""
    if known is None:
        return doc.export(ExportMode.Snapshot())
    if known.includes_vv(doc.state_vv):
        return None
    return doc.export(ExportMode.Updates(known))
