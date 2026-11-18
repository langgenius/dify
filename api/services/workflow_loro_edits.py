"""Replay the workflow editor's ordered edit records over the epoch's original graph.

Loro undo toggles the presence of a step in editState. Keeping its immutable
editLog records at their original priority prevents undo and redo from
overwriting a later collaborator's edit to the same field.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from loro import LoroValue


class LoroDraftUpdateError(ValueError):
    """The update cannot be projected as a workflow graph."""


type _Value = None | bool | int | float | str | dict[str, _Value] | _Rows
type _Visibility = Literal["visible", "undone", "deleted"]


@dataclass
class _Entry:
    value: _Value
    visibility: _Visibility = "visible"

    def retain(self) -> None:
        if self.visibility == "undone":
            self.visibility = "visible"


@dataclass
class _Rows:
    entries: dict[str, _Entry]
    order: list[str]

    def place(self, key: str, after: str | None) -> None:
        if key == after:
            return
        if key in self.order:
            self.order.remove(key)
        if after is None:
            self.order.insert(0, key)
        elif after in self.order:
            self.order.insert(self.order.index(after) + 1, key)
        else:
            self.order.append(key)


def _decode(value: LoroValue) -> _Value:
    if isinstance(value, list):
        entries = {f"i:{index}": _Entry(_decode(item)) for index, item in enumerate(value)}
        return _Rows(entries, list(entries))
    if isinstance(value, dict):
        return {key: _decode(item) for key, item in value.items()}
    if value is None or isinstance(value, (str, int, float)):
        return value
    raise LoroDraftUpdateError("Expected a JSON graph value.")


def _encode(value: _Value) -> LoroValue:
    if isinstance(value, _Rows):
        return [_encode(value.entries[key].value) for key in value.order if value.entries[key].visibility == "visible"]
    if isinstance(value, dict):
        return {key: _encode(item) for key, item in value.items()}
    return value


def _row_key(token: LoroValue) -> str:
    if isinstance(token, dict) and token.keys() == {"row"} and isinstance(key := token["row"], str):
        return key
    raise LoroDraftUpdateError("Invalid graph edit path.")


def _hydrate_child(entry: _Entry, fields: dict[str, _Value], path: list[LoroValue], index: int, key: str) -> None:
    """Materialize older node values the same way the editor presents them on first use."""
    data = entry.value.get("data") if isinstance(entry.value, dict) else None
    if path[0] != "data" or not isinstance(data, dict):
        return
    if index == 1 and key == "cases" and key not in fields and data.get("type") == "if-else":
        conditions, operator = data.get("conditions"), data.get("logical_operator")
        if isinstance(conditions, _Rows) and isinstance(operator, str):
            case = _Entry({"case_id": "true", "conditions": deepcopy(conditions), "logical_operator": operator})
            fields[key] = _Rows({"i:0": case}, ["i:0"])
    if (
        index == 2
        and path[1] == "tool_configurations"
        and data.get("type") == "tool"
        and key in fields
        and not isinstance(fields[key], (dict, _Rows))
        and path[index + 1] in ("type", "value")
    ):
        fields[key] = {"type": "constant", "value": fields[key]}


def _apply_path(entry: _Entry, path: list[LoroValue], patch: dict[str, LoroValue], active: bool) -> None:
    touched = [entry]
    value = entry.value
    op = patch["op"]
    for index, token in enumerate(path):
        last = index == len(path) - 1
        if isinstance(token, str):
            if not isinstance(value, dict):
                return
            if last:
                if op == "set":
                    value[token] = _decode(patch["value"])
                else:
                    value.pop(token, None)
            else:
                _hydrate_child(entry, value, path, index, token)
                if token not in value:
                    value[token] = {} if isinstance(path[index + 1], str) else _Rows({}, [])
                value = value[token]
            continue
        key = _row_key(token)
        if not isinstance(value, _Rows):
            return
        row = value.entries.get(key)
        if last and op == "insert":
            if active or row is None or row.visibility == "undone":
                value.entries[key] = _Entry(_decode(patch["value"]), "visible" if active else "undone")
                after = patch["after"]
                assert after is None or isinstance(after, str)
                value.place(key, after)
        elif row is None or row.visibility == "deleted":
            return
        elif last and op == "remove":
            row.visibility = "deleted"
        else:
            touched.append(row)
            if last and op == "move":
                after = patch["after"]
                assert after is None or isinstance(after, str)
                value.place(key, after)
            value = row.value
    if active:
        for slot in touched:
            slot.retain()


def _apply_patch(groups: dict[str, dict[str, _Entry]], raw: LoroValue, active: bool) -> None:
    if not isinstance(raw, dict):
        raise LoroDraftUpdateError("Invalid graph edit.")
    kind, key, path, op = raw.get("kind"), raw.get("id"), raw.get("path"), raw.get("op")
    if not isinstance(kind, str) or kind not in groups or not isinstance(key, str) or not isinstance(path, list):
        raise LoroDraftUpdateError("Invalid graph edit target.")
    if op not in ("set", "remove", "insert", "move") or (op in ("set", "insert") and "value" not in raw):
        raise LoroDraftUpdateError("Invalid graph edit operation.")
    for token in path:
        if not isinstance(token, str):
            _row_key(token)
    if op in ("insert", "move"):
        if not path or isinstance(path[-1], str) or "after" not in raw:
            raise LoroDraftUpdateError("Invalid graph row edit.")
        if raw["after"] is not None and not isinstance(raw["after"], str):
            raise LoroDraftUpdateError("Invalid graph row anchor.")
    if op == "set" and path and not isinstance(path[-1], str):
        raise LoroDraftUpdateError("A row is created with an insert edit.")
    group = groups[kind]
    entry = group.get(key)
    if not path:
        if op == "set":
            seed = raw["value"]
            if not isinstance(seed, dict) or seed.get("id") != key:
                raise LoroDraftUpdateError("Graph item ID does not match its map key.")
            if active or entry is None or entry.visibility == "undone":
                group[key] = _Entry(_decode(seed), "visible" if active else "undone")
        elif active and entry is not None:
            entry.visibility = "deleted"
    elif entry is not None and entry.visibility != "deleted" and (active or op == "insert"):
        _apply_path(entry, path, raw, active)


def _retain_handle(node: _Entry, handle: _Value) -> None:
    if not isinstance(handle, str) or not isinstance(node.value, dict):
        return
    data = node.value.get("data")
    if not isinstance(data, dict):
        return
    routes = data.get("agent_output_routes")
    agent_rows = routes.get("routes") if isinstance(routes, dict) else None
    for rows in (data.get("cases"), data.get("candidate"), data.get("classes"), data.get("user_actions"), agent_rows):
        if isinstance(rows, _Rows):
            for row in rows.entries.values():
                if isinstance(row.value, dict) and handle in (row.value.get("id"), row.value.get("case_id")):
                    row.retain()
                    if rows is agent_rows and row.visibility == "visible" and isinstance(routes, dict):
                        routes["enabled"] = True


def _retain_dependencies(nodes: dict[str, _Entry], edges: dict[str, _Entry]) -> None:
    for edge in edges.values():
        if edge.visibility != "visible" or not isinstance(edge.value, dict):
            continue
        endpoints = [node for key in ("source", "target") if isinstance(node := edge.value.get(key), str)]
        if any(endpoint not in nodes or nodes[endpoint].visibility == "deleted" for endpoint in endpoints):
            edge.visibility = "deleted"
            continue
        for endpoint in endpoints:
            nodes[endpoint].retain()
        source = edge.value.get("source")
        if isinstance(source, str):
            _retain_handle(nodes[source], edge.value.get("sourceHandle"))
    visible = [node for node in nodes.values() if node.visibility == "visible"]
    while visible:
        node = visible.pop()
        if isinstance(node.value, dict) and isinstance(parent_id := node.value.get("parentId"), str):
            parent = nodes.get(parent_id)
            if parent is not None and parent.visibility == "undone":
                parent.retain()
                visible.append(parent)


def project_edit_log(graph: dict[str, LoroValue], log: dict[str, LoroValue], state: dict[str, LoroValue]) -> None:
    """Resolve locally undone seeds, row positions, and dependent edits before emitting ordinary JSON."""
    groups: dict[str, dict[str, _Entry]] = {"nodes": {}, "edges": {}}
    for kind, group in groups.items():
        items = graph[kind]
        assert isinstance(items, list)
        for item in items:
            assert isinstance(item, dict)
            assert isinstance(item["id"], str)
            group[item["id"]] = _Entry(_decode(item))
    for key in sorted(log):
        record = log[key]
        if not isinstance(record, dict) or not isinstance(step := record.get("step"), str):
            raise LoroDraftUpdateError("Invalid graph edit record.")
        patches = record.get("patches")
        if not isinstance(patches, list):
            raise LoroDraftUpdateError("Invalid graph edit list.")
        for patch in patches:
            _apply_patch(groups, patch, state.get(step) is True)
    _retain_dependencies(groups["nodes"], groups["edges"])
    for kind, group in groups.items():
        result: list[LoroValue] = []
        for key, entry in group.items():
            if entry.visibility == "visible":
                item = _encode(entry.value)
                if not isinstance(item, dict) or item.get("id") != key:
                    raise LoroDraftUpdateError("Graph item ID does not match its map key.")
                result.append(item)
        graph[kind] = result


class LoroDraftLegacyEditConflictError(ValueError):
    """An older pending edit would displace a row or overwrite a field used by the undo history."""


def _legacy_path_changed(before: LoroValue, after: LoroValue, path: list[LoroValue]) -> bool:
    """Compare only fields and stable row identities addressed by an existing edit."""
    for token in path:
        if before == after:
            return False
        if isinstance(token, str):
            if not isinstance(before, dict) or not isinstance(after, dict):
                return True
            if (token in before) != (token in after):
                return True
            before, after = before.get(token), after.get(token)
            continue
        if not isinstance(before, list) or not isinstance(after, list):
            return True
        row = _row_key(token)
        if not row.startswith("i:"):
            return False
        index = int(row[2:])
        if index >= min(len(before), len(after)):
            return index < max(len(before), len(after))
        before, after = before[index], after[index]
        if before != after and not (
            isinstance(before, dict)
            and isinstance(after, dict)
            and any(isinstance(before.get(key), str) and before[key] == after.get(key) for key in ("id", "case_id"))
        ):
            return True
    return before != after


def validate_legacy_edit(before: dict[str, LoroValue], after: dict[str, LoroValue], log: dict[str, LoroValue]) -> None:
    """A v1 outbox may merge into the baseline only while all earlier v2 edit addresses remain valid."""
    for record in log.values():
        assert isinstance(record, dict)
        patches = record["patches"]
        assert isinstance(patches, list)
        for patch in patches:
            assert isinstance(patch, dict)
            kind, key, path = patch["kind"], patch["id"], patch["path"]
            assert isinstance(kind, str)
            assert isinstance(key, str)
            assert isinstance(path, list)
            old_items = before.get(kind, {})
            new_items = after.get(kind, {})
            assert isinstance(old_items, dict)
            assert isinstance(new_items, dict)
            old, new = old_items.get(key), new_items.get(key)
            if _legacy_path_changed(old, new, path):
                raise LoroDraftLegacyEditConflictError("A legacy edit overlaps the draft's undo history.")
            if isinstance(anchor := patch.get("after"), str) and _legacy_path_changed(
                old, new, [*path[:-1], {"row": anchor}]
            ):
                raise LoroDraftLegacyEditConflictError("A legacy edit changes a referenced row anchor.")
