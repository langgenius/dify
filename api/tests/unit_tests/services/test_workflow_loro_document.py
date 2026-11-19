from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING

import pytest
from loro import ExportMode, LoroDoc

from services.workflow_loro_document import (
    LoroDraftUpdateError,
    export_loro_delta,
    load_loro_draft,
    merge_loro_update,
    project_loro_graph,
)

if TYPE_CHECKING:
    from loro import LoroValue


def test_round_trip_preserves_graph_order_lists_and_metadata() -> None:
    """A seeded history projects the editor's ordered graph and strips transient data."""
    graph: dict[str, LoroValue] = {
        "nodes": [
            {"id": "b", "data": {"variables": [], "parameters": [{"name": "query"}], "_selected": True}},
            {"id": "a", "data": {"prompt_template": [{"role": "system", "text": "Prompt"}]}},
        ],
        "edges": [{"id": "edge", "source": "b", "target": "a"}],
        "viewport": {"x": 1, "y": 2, "zoom": 1},
    }
    doc = load_loro_draft(None, graph)
    restored = load_loro_draft(doc.export(ExportMode.Snapshot()), {})
    expected: dict[str, LoroValue] = {
        **graph,
        "nodes": [
            {"id": "b", "data": {"variables": [], "parameters": [{"name": "query"}]}},
            {"id": "a", "data": {"prompt_template": [{"role": "system", "text": "Prompt"}]}},
        ],
    }
    assert project_loro_graph(restored) == expected


def test_offline_field_edit_merges_with_concurrent_list_edit() -> None:
    graph: dict[str, LoroValue] = {
        "nodes": [{"id": "a", "data": {"prompt": "Before", "variables": [{"name": "old"}]}}],
        "edges": [],
    }
    doc = load_loro_draft(None, graph)
    baseline = doc.state_vv
    peer = load_loro_draft(doc.export(ExportMode.Snapshot()), {})
    target: dict[str, LoroValue] = {"kind": "nodes", "id": "a"}
    _record(peer, "peer", [{**target, "op": "set", "path": ["data", "prompt"], "value": "Offline prompt"}])
    _record(doc, "local", [{**target, "op": "remove", "path": ["data", "variables", {"row": "i:0"}]}])
    merge_loro_update(doc, peer.export(ExportMode.Updates(baseline)))
    assert project_loro_graph(doc) == {
        "nodes": [{"id": "a", "data": {"prompt": "Offline prompt", "variables": []}}],
        "edges": [],
    }


@pytest.mark.parametrize(
    ("graph", "message"),
    [
        ({"nodes": {}}, "Expected a list of nodes"),
        ({"nodes": [None]}, "Expected a graph object"),
        ({"nodes": [{"id": 1}]}, "Expected unique string IDs"),
        ({"nodes": [{"id": "a"}, {"id": "a"}]}, "Expected unique string IDs"),
        ({"nodes": [{"id": "a", "data": []}]}, "Expected a graph object"),
        ({"edges": [{"id": "e"}, {"id": "e"}]}, "Expected unique string IDs"),
    ],
)
def test_rejects_graphs_without_valid_objects_and_unique_ids(graph: Mapping[str, LoroValue], message: str) -> None:
    """Malformed graph inputs cannot become an acknowledged history."""
    with pytest.raises(LoroDraftUpdateError, match=message):
        load_loro_draft(None, graph)


@pytest.mark.parametrize("order", ["a", [1]])
def test_rejects_malformed_node_order(order: LoroValue) -> None:
    """A remote document must provide an ordered list of string identifiers."""
    doc = LoroDoc()
    doc.get_map("graph").insert("node_order", order)
    with pytest.raises(LoroDraftUpdateError, match="Invalid graph order"):
        project_loro_graph(doc)


def test_projects_unordered_concurrent_nodes_once_after_the_declared_order() -> None:
    """Concurrent additions absent from the saved order remain visible and deterministic."""
    doc = LoroDoc()
    doc.get_map("graph").insert("node_order", ["b", "b", "removed"])
    for key in ["c", "b", "a"]:
        doc.get_map("nodes").insert(key, {"id": key})
    assert project_loro_graph(doc) == {"nodes": [{"id": "b"}, {"id": "a"}, {"id": "c"}], "edges": []}


def test_rejects_unexpected_document_roots() -> None:
    """Only graph, nodes, edges, and edit history can enter the persisted workflow projection."""
    doc = LoroDoc()
    doc.get_map("other").insert("key", "value")
    with pytest.raises(LoroDraftUpdateError, match="Unexpected workflow document root"):
        project_loro_graph(doc)


def test_rejects_a_node_whose_id_does_not_match_its_map_key() -> None:
    """Remote edits cannot alias one graph item under another item's identifier."""
    doc = LoroDoc()
    doc.get_map("nodes").insert("a", {"id": "b"})
    with pytest.raises(LoroDraftUpdateError, match="Graph item ID does not match its map key"):
        project_loro_graph(doc)


@pytest.mark.parametrize("snapshot", [False, True])
def test_rejects_corrupt_updates_and_full_snapshots(snapshot: bool) -> None:
    """The delta boundary accepts neither corrupt bytes nor a replacement snapshot."""
    source = load_loro_draft(None, {"nodes": [{"id": "a"}], "edges": []})
    update = source.export(ExportMode.Snapshot()) if snapshot else b"invalid"
    with pytest.raises(LoroDraftUpdateError):
        merge_loro_update(LoroDoc(), update)


def test_exports_only_committed_changes_missing_from_the_requester() -> None:
    """A current requester receives no delta; older requesters converge using the returned delta."""
    source = load_loro_draft(None, {"nodes": [{"id": "a"}], "edges": []})
    baseline = source.state_vv.encode()
    peer = load_loro_draft(source.export(ExportMode.Snapshot()), {})
    assert export_loro_delta(source, baseline) is None
    _record(source, "step", [{"kind": "nodes", "id": "b", "op": "set", "path": [], "value": {"id": "b"}}])
    update = export_loro_delta(source, baseline)
    assert update is not None
    merge_loro_update(peer, update)
    assert project_loro_graph(peer) == project_loro_graph(source)


def test_rejects_uncommitted_and_invalid_requester_versions() -> None:
    """A version vector from another history or invalid bytes cannot receive a confirmation."""
    source = load_loro_draft(None, {"nodes": [{"id": "a"}], "edges": []})
    other = load_loro_draft(None, {"nodes": [{"id": "b"}], "edges": []})
    with pytest.raises(LoroDraftUpdateError, match="outside the committed history"):
        export_loro_delta(source, other.state_vv.encode())
    with pytest.raises(LoroDraftUpdateError, match="Invalid version vector"):
        export_loro_delta(source, b"invalid")


def _record(doc: LoroDoc, key: str, patches: list[LoroValue]) -> None:
    doc.get_map("editLog").insert(key, {"step": key, "patches": patches})
    doc.get_map("editState").insert(key, True)


def test_selective_undo_preserves_later_fields_and_row_edits() -> None:
    """Undo and redo retain the later writer's value and an edit on the same prompt row."""
    doc = load_loro_draft(None, {"nodes": [{"id": "llm", "data": {"title": "before", "prompt": []}}], "edges": []})
    target: dict[str, LoroValue] = {"kind": "nodes", "id": "llm"}
    prompt: list[LoroValue] = ["data", "prompt", {"row": "n:row"}]
    _record(
        doc,
        "01:a",
        [
            {**target, "op": "set", "path": ["data", "title"], "value": "Alice"},
            {**target, "op": "insert", "path": prompt, "value": {"role": "system", "text": "Alice"}, "after": None},
            {**target, "op": "set", "path": ["data", "model"], "value": "Alice"},
        ],
    )
    _record(
        doc,
        "02:b",
        [
            {**target, "op": "set", "path": ["data", "title"], "value": "Bob"},
            {**target, "op": "set", "path": [*prompt, "text"], "value": "Bob"},
        ],
    )
    doc.get_map("editState").delete("01:a")
    expected: dict[str, LoroValue] = {"title": "Bob", "prompt": [{"role": "system", "text": "Bob"}]}
    assert project_loro_graph(doc)["nodes"] == [{"id": "llm", "data": expected}]
    doc.get_map("editState").insert("01:a", True)
    assert project_loro_graph(doc)["nodes"] == [{"id": "llm", "data": {**expected, "model": "Alice"}}]


def test_undone_node_and_case_survive_for_other_users_edges() -> None:
    """Retain endpoint and handle seeds while the edge exists, including their parent container."""
    doc = load_loro_draft(None, {"nodes": [{"id": "end"}], "edges": []})
    parent: dict[str, LoroValue] = {"kind": "nodes", "id": "loop", "path": []}
    branch: dict[str, LoroValue] = {"kind": "nodes", "id": "branch", "path": []}
    _record(
        doc,
        "01:a",
        [
            {**parent, "op": "set", "value": {"id": "loop"}},
            {**branch, "op": "set", "value": {"id": "branch", "parentId": "loop", "data": {"cases": []}}},
            {
                **branch,
                "op": "insert",
                "path": ["data", "cases", {"row": "n:row"}],
                "after": None,
                "value": {"case_id": "c"},
            },
        ],
    )
    edge: dict[str, LoroValue] = {"id": "edge", "source": "branch", "sourceHandle": "c", "target": "end"}
    _record(doc, "02:b", [{"kind": "edges", "id": "edge", "op": "set", "path": [], "value": edge}])
    doc.get_map("editState").delete("01:a")
    assert project_loro_graph(doc) == {
        "nodes": [
            {"id": "end"},
            {"id": "loop"},
            {"id": "branch", "parentId": "loop", "data": {"cases": [{"case_id": "c"}]}},
        ],
        "edges": [edge],
    }
    _record(doc, "03:b", [{**branch, "op": "remove"}])
    assert project_loro_graph(doc) == {"nodes": [{"id": "end"}], "edges": []}
    doc.get_map("editState").delete("03:b")
    doc.get_map("editState").delete("02:b")
    assert project_loro_graph(doc) == {"nodes": [{"id": "end"}], "edges": []}


def test_row_move_remove_and_undo_preserve_other_users_structural_changes() -> None:
    """Moves address persistent row identities even if another writer removed a preceding row."""
    doc = load_loro_draft(None, {"nodes": [{"id": "a", "data": {"vars": [{"k": "a"}, {"k": "b"}, {"k": "c"}]}}]})
    target: dict[str, LoroValue] = {"kind": "nodes", "id": "a"}
    _record(doc, "01:a", [{**target, "op": "move", "path": ["data", "vars", {"row": "i:2"}], "after": None}])
    _record(doc, "02:b", [{**target, "op": "remove", "path": ["data", "vars", {"row": "i:0"}]}])
    assert project_loro_graph(doc)["nodes"] == [{"id": "a", "data": {"vars": [{"k": "c"}, {"k": "b"}]}}]
    doc.get_map("editState").delete("01:a")
    assert project_loro_graph(doc)["nodes"] == [{"id": "a", "data": {"vars": [{"k": "b"}, {"k": "c"}]}}]


@pytest.mark.parametrize("as_list", [False, True])
def test_undone_nullable_configuration_survives_a_dependent_edit(as_list: bool) -> None:
    """Editing an option enabled by a peer keeps its required structure if that peer undoes enabling it."""
    graph: dict[str, LoroValue] = {"nodes": [{"id": "a", "data": {"config": None}}], "edges": []}
    doc = load_loro_draft(None, graph)
    item: dict[str, LoroValue] = {"type": "window", "size": 5}
    config: LoroValue = [item] if as_list else item
    target: dict[str, LoroValue] = {"kind": "nodes", "id": "a", "op": "set"}
    _record(doc, "01:a", [{**target, "path": ["data", "config"], "value": config}])
    path: list[LoroValue] = ["data", "config", {"row": "i:0"}, "size"] if as_list else ["data", "config", "size"]
    _record(doc, "02:b", [{**target, "path": path, "value": 20}])
    expected_item: dict[str, LoroValue] = {**item, "size": 20}
    expected: LoroValue = [expected_item] if as_list else expected_item
    doc.get_map("editState").delete("01:a")
    assert project_loro_graph(doc)["nodes"] == [{"id": "a", "data": {"config": expected}}]
    doc.get_map("editState").delete("02:b")
    assert project_loro_graph(doc) == graph
    doc.get_map("editState").insert("02:b", True)
    assert project_loro_graph(doc)["nodes"] == [{"id": "a", "data": {"config": expected}}]
    _record(doc, "03:b", [{**target, "op": "remove", "path": ["data", "config"]}])
    assert project_loro_graph(doc)["nodes"] == [{"id": "a", "data": {}}]
    doc.get_map("editState").delete("03:b")
    assert project_loro_graph(doc)["nodes"] == [{"id": "a", "data": {"config": expected}}]


def test_undo_retains_new_route_configuration_while_a_peer_uses_its_handle() -> None:
    """A route added by one editor stays operational while another editor's edge references it."""
    nodes: list[LoroValue] = [{"id": "agent", "data": {"type": "agent"}}, {"id": "end"}]
    doc = load_loro_draft(None, {"nodes": nodes, "edges": []})
    routes: dict[str, LoroValue] = {"enabled": True, "routes": [{"id": "approved", "label": "Approved"}]}
    _record(
        doc,
        "01:a",
        [{"kind": "nodes", "id": "agent", "op": "set", "path": ["data", "agent_output_routes"], "value": routes}],
    )
    edge: dict[str, LoroValue] = {"id": "yes", "source": "agent", "sourceHandle": "approved", "target": "end"}
    _record(doc, "02:b", [{"kind": "edges", "id": "yes", "op": "set", "path": [], "value": edge}])
    doc.get_map("editState").delete("01:a")
    assert project_loro_graph(doc) == {
        "nodes": [{"id": "agent", "data": {"type": "agent", "agent_output_routes": routes}}, {"id": "end"}],
        "edges": [edge],
    }
    doc.get_map("editState").delete("02:b")
    assert project_loro_graph(doc) == {"nodes": nodes, "edges": []}


@pytest.mark.parametrize("config", [{}, {"rows": None}])
def test_concurrent_first_rows_keep_their_identity_after_independent_undos(config: dict[str, LoroValue]) -> None:
    """Two writers can add the first optional row before either receives the other's changes."""
    graph: dict[str, LoroValue] = {"nodes": [{"id": "a", "data": config}], "edges": []}
    alice = load_loro_draft(None, graph)
    snapshot = alice.export(ExportMode.Snapshot())
    base = alice.state_vv
    bob = load_loro_draft(snapshot, {})
    for client, name in [(alice, "alice"), (bob, "bob")]:
        _record(
            client,
            name,
            [
                {
                    "kind": "nodes",
                    "id": "a",
                    "op": "insert",
                    "path": ["data", "rows", {"row": "n:" + name}],
                    "after": None,
                    "value": {"name": name},
                }
            ],
        )
    merge_loro_update(alice, bob.export(ExportMode.Updates(base)))
    assert project_loro_graph(alice)["nodes"] == [{"id": "a", "data": {"rows": [{"name": "bob"}, {"name": "alice"}]}}]
    alice.get_map("editState").delete("alice")
    assert project_loro_graph(alice)["nodes"] == [{"id": "a", "data": {"rows": [{"name": "bob"}]}}]
    alice.get_map("editState").delete("bob")
    assert project_loro_graph(alice) == graph


@pytest.mark.parametrize(
    ("record", "error"),
    [
        ({}, "record"),
        ({"step": "s", "patches": None}, "edit list"),
        ({"step": "s", "patches": [None]}, "Invalid graph edit"),
        ({"step": "s", "patches": [{"kind": "viewport", "id": "a", "op": "remove", "path": []}]}, "target"),
    ],
)
def test_rejects_incomplete_edit_records(record: LoroValue, error: str) -> None:
    doc = load_loro_draft(None, {"nodes": [{"id": "a"}]})
    doc.get_map("editLog").insert("s", record)
    with pytest.raises(LoroDraftUpdateError, match=error):
        project_loro_graph(doc)


@pytest.mark.parametrize(
    ("operation", "error"),
    [
        ({"op": "remove", "path": ["data", {"row": 1}]}, "path"),
        ({"op": "move", "path": ["data", "rows"], "after": None}, "row edit"),
        ({"op": "insert", "path": ["data", "rows", {"row": "n:row"}], "value": {}, "after": 1}, "anchor"),
        ({"op": "set", "path": ["data", "rows", {"row": "i:0"}], "value": {}}, "insert"),
        ({"op": "set", "path": [], "value": {"id": "other"}}, "ID does not match"),
        ({"op": "set", "path": ["id"], "value": "other"}, "ID does not match"),
        ({"op": "set", "path": ["data", "text"], "value": b"binary"}, "JSON graph value"),
    ],
)
def test_rejects_invalid_row_addresses_and_non_graph_values(operation: dict[str, LoroValue], error: str) -> None:
    doc = load_loro_draft(None, {"nodes": [{"id": "a", "data": {"rows": [{}]}}]})
    _record(doc, "s", [{"kind": "nodes", "id": "a", **operation}])
    with pytest.raises(LoroDraftUpdateError, match=error):
        project_loro_graph(doc)


def test_edits_and_undo_follow_the_editor_representation_of_legacy_node_data() -> None:
    conditions: list[LoroValue] = [{"comparison_operator": "is", "value": "old"}]
    branch: dict[str, LoroValue] = {"type": "if-else", "logical_operator": "and", "conditions": conditions}
    tool: dict[str, LoroValue] = {"type": "tool", "tool_configurations": {"max_tokens": 20}}
    graph: dict[str, LoroValue] = {"nodes": [{"id": "if", "data": branch}, {"id": "tool", "data": tool}], "edges": []}
    doc = load_loro_draft(None, graph)
    _record(
        doc,
        "a",
        [
            {
                "kind": "nodes",
                "id": "if",
                "op": "set",
                "path": ["data", "cases", {"row": "i:0"}, "conditions", {"row": "i:0"}, "value"],
                "value": "changed",
            }
        ],
    )
    _record(
        doc,
        "b",
        [
            {
                "kind": "nodes",
                "id": "tool",
                "op": "set",
                "path": ["data", "tool_configurations", "max_tokens", "value"],
                "value": 42,
            }
        ],
    )
    case: dict[str, LoroValue] = {
        "case_id": "true",
        "logical_operator": "and",
        "conditions": [{"comparison_operator": "is", "value": "changed"}],
    }
    configured: dict[str, LoroValue] = {
        "id": "tool",
        "data": {**tool, "tool_configurations": {"max_tokens": {"type": "constant", "value": 42}}},
    }
    assert project_loro_graph(doc)["nodes"] == [{"id": "if", "data": {**branch, "cases": [case]}}, configured]
    doc.get_map("editState").delete("a")
    assert project_loro_graph(doc)["nodes"] == [{"id": "if", "data": branch}, configured]
    doc.get_map("editState").delete("b")
    assert project_loro_graph(doc) == graph


def test_explicit_row_delete_wins_over_stale_edits_until_the_row_is_reinserted() -> None:
    doc = load_loro_draft(None, {"nodes": [{"id": "a", "data": {"rows": [{"name": "first"}, {"name": "second"}]}}]})
    row: list[LoroValue] = ["data", "rows", {"row": "i:0"}]
    target: dict[str, LoroValue] = {"kind": "nodes", "id": "a"}
    _record(doc, "01", [{**target, "path": row, "op": "remove"}])
    _record(doc, "02", [{**target, "path": [*row, "name"], "op": "set", "value": "stale"}])
    assert project_loro_graph(doc)["nodes"] == [{"id": "a", "data": {"rows": [{"name": "second"}]}}]
    _record(doc, "03", [{**target, "path": row, "op": "insert", "after": "i:1", "value": {"name": "reinserted"}}])
    assert project_loro_graph(doc)["nodes"] == [
        {"id": "a", "data": {"rows": [{"name": "second"}, {"name": "reinserted"}]}}
    ]
    doc.get_map("editState").delete("03")
    assert project_loro_graph(doc)["nodes"] == [{"id": "a", "data": {"rows": [{"name": "second"}]}}]
    doc.get_map("editState").delete("01")
    assert project_loro_graph(doc)["nodes"] == [{"id": "a", "data": {"rows": [{"name": "stale"}, {"name": "second"}]}}]
