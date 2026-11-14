from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING

import pytest
from loro import ExportMode, LoroDoc, LoroMap, ValueOrContainer

from services.workflow_loro_document import (
    LoroDraftUpdateError,
    export_loro_delta,
    load_loro_draft,
    merge_loro_update,
    project_loro_graph,
    replace_loro_graph,
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


def _node_data(doc: LoroDoc) -> LoroMap:
    """Return the attached data map for a document seeded with node a."""
    node = doc.get_map("nodes").get("a")
    assert isinstance(node, ValueOrContainer.Container)
    assert isinstance(node.container, LoroMap)
    data = node.container.get("data")
    assert isinstance(data, ValueOrContainer.Container)
    assert isinstance(data.container, LoroMap)
    return data.container


def test_graph_edits_preserve_unchanged_containers_and_merge_concurrent_prompt_changes() -> None:
    """Within one epoch, replacing a list must not discard another editor's unrelated prompt edit."""
    graph: dict[str, LoroValue] = {
        "nodes": [
            {"id": "a", "data": {"title": "Before", "prompt": "Before", "variables": [{"name": "old"}]}},
            {"id": "removed", "data": {}},
        ],
        "edges": [{"id": "removed-edge"}],
        "viewport": {"x": 0},
    }
    doc = load_loro_draft(None, graph)
    baseline = doc.state_vv
    peer = load_loro_draft(doc.export(ExportMode.Snapshot()), {})
    _node_data(peer).insert("prompt", "Offline prompt")
    peer.commit()
    replacement: dict[str, LoroValue] = {
        "nodes": [{"id": "a", "data": {"title": "Updated", "prompt": "Before", "variables": []}}],
        "edges": [],
    }
    replace_loro_graph(doc, replacement)
    merge_loro_update(doc, peer.export(ExportMode.Updates(baseline)))
    assert project_loro_graph(doc) == {
        "nodes": [{"id": "a", "data": {"title": "Updated", "prompt": "Offline prompt", "variables": []}}],
        "edges": [],
    }
    replace_loro_graph(doc, {"nodes": [{"id": "a", "data": {"variables": [{"name": "new"}]}}], "edges": []})
    assert project_loro_graph(doc) == {
        "nodes": [{"id": "a", "data": {"variables": [{"name": "new"}]}}],
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
    """Only graph, nodes and edges can enter the persisted workflow projection."""
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
    replace_loro_graph(source, {"nodes": [{"id": "a"}, {"id": "b"}], "edges": []})
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
