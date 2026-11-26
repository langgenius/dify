from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from loro import ExportMode, VersionVector

from services import workflow_loro_document as draft

if TYPE_CHECKING:
    from loro import LoroValue


def test_native_seed_roundtrip_and_dangling_edge_reappearance():
    graph: dict[str, LoroValue] = {
        "nodes": [
            {"id": "a", "selected": True, "data": {"_hover": True, "type": "if-else", "conditions": []}},
            {"id": "b", "data": {"rows": [[1], {"name": "a"}]}},
        ],
        "edges": [
            {"id": "e", "source": "a", "target": "b"},
            {"source": "b", "target": "a"},
            {"id": "e", "source": "a", "target": "b"},
        ],
        "viewport": {"zoom": 1},
    }
    doc = draft.load_loro_draft(None, graph)
    expected = draft.project_loro_graph(doc)
    assert expected["nodes"] == [
        {
            "id": "a",
            "data": {
                "type": "if-else",
                "conditions": [],
                "cases": [{"case_id": "true", "logical_operator": "and", "conditions": []}],
            },
        },
        {"id": "b", "data": {"rows": [[1], {"name": "a"}]}},
    ]
    edges = expected["edges"]
    assert isinstance(edges, list)
    assert [edge["id"] if isinstance(edge, dict) else edge for edge in edges] == [
        "e",
        "legacy-edges-1",
        "legacy-edges-2",
    ]
    restored = draft.load_loro_draft(draft.export_loro_snapshot(doc), {})
    assert draft.project_loro_graph(restored) == expected
    restored.get_map("nodes").delete("b")
    restored.commit()
    assert draft.project_loro_graph(restored)["edges"] == []
    assert restored.get_map("edges").get("e") is not None


def test_shallow_boundary_and_idempotent_retransmission(monkeypatch):
    doc = draft.load_loro_draft(None, {"nodes": [{"id": "a"}]})
    original = doc.state_vv
    peer = doc.fork()
    peer.get_map("nodes").ensure_mergeable_map("a").insert("width", 20)
    delta = peer.export(ExportMode.Updates(original))
    draft.merge_loro_update(doc, delta)
    confirmed = doc.state_vv
    draft.merge_loro_update(doc, delta)
    assert draft.export_loro_delta(doc, confirmed) is None
    monkeypatch.setattr(draft, "MAX_HISTORY_OPS", 1)
    compacted = draft.load_loro_draft(draft.export_loro_snapshot(doc), {})
    assert compacted.is_shallow()
    with pytest.raises(draft.LoroDraftHistoryCompactedError):
        draft.check_loro_version(compacted, VersionVector().encode(), pushing=False)
    snapshot = draft.export_loro_delta(compacted, None)
    assert draft.project_loro_graph(draft.load_loro_draft(snapshot, {})) == draft.project_loro_graph(doc)


def test_invalid_version_and_snapshot_input_are_rejected():
    doc = draft.load_loro_draft(None, {})
    with pytest.raises(draft.LoroDraftUpdateError, match="Invalid version vector"):
        draft.check_loro_version(doc, b"broken", pushing=False)
    with pytest.raises(draft.LoroDraftUpdateError, match="Expected a Loro delta"):
        draft.merge_loro_update(doc, draft.export_loro_snapshot(doc))


def test_incomplete_delta_is_rejected():
    doc = draft.load_loro_draft(None, {})
    peer = doc.fork()
    peer.get_map("graph").insert("viewport", {"zoom": 2})
    peer.commit()
    missing = peer.state_vv
    peer.get_map("graph").insert("viewport", {"zoom": 3})
    with pytest.raises(draft.LoroDraftUpdateError, match="Missing causal dependencies"):
        draft.merge_loro_update(doc, peer.export(ExportMode.Updates(missing)))


def test_malformed_update_and_schema_are_rejected():
    doc = draft.load_loro_draft(None, {})
    with pytest.raises(draft.LoroDraftUpdateError):
        draft.merge_loro_update(doc, b"broken")
    doc.get_map("graph").insert("schema_version", 1)
    with pytest.raises(draft.LoroDraftUpdateError):
        draft.project_loro_graph(doc)


def test_agent_session_policy_rejects_non_mergeable_node_data():
    doc = draft.load_loro_draft(None, {"nodes": [{"id": "agent"}]})
    doc.get_map("nodes").ensure_mergeable_map("agent").insert("data", {"continue_agent_session": True})
    projected = draft.project_loro_graph(doc)
    saved: dict[str, LoroValue] = {"nodes": [{"id": "agent", "data": {"continue_agent_session": False}}]}

    with pytest.raises(draft.LoroDraftUpdateError, match="Invalid Loro Agent session fields"):
        draft.apply_loro_agent_session_policy(doc, projected, saved)
