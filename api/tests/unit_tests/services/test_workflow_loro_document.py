import pytest
from loro import ExportMode, VersionVector

from services import workflow_loro_document as draft


def test_native_seed_roundtrip_and_dangling_edge_reappearance():
    graph = {
        "nodes": [{"id": "a", "selected": True, "data": {"_hover": True, "rows": [[1], {"name": "a"}]}}, {"id": "b"}],
        "edges": [{"id": "e", "source": "a", "target": "b"}],
        "viewport": {"zoom": 1},
    }
    doc = draft.load_loro_draft(None, graph)
    expected = draft.project_loro_graph(doc)
    assert expected["nodes"] == [{"id": "a", "data": {"rows": [[1], {"name": "a"}]}}, {"id": "b"}]
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
    assert draft.export_loro_delta(doc, confirmed.encode()) is None
    monkeypatch.setattr(draft, "MAX_HISTORY_OPS", 1)
    compacted = draft.load_loro_draft(draft.export_loro_snapshot(doc), {})
    assert compacted.is_shallow()
    with pytest.raises(draft.LoroDraftHistoryCompactedError):
        draft.export_loro_delta(compacted, VersionVector().encode())
    snapshot = draft.export_loro_delta(compacted, None)
    assert draft.project_loro_graph(draft.load_loro_draft(snapshot, {})) == draft.project_loro_graph(doc)


def test_legacy_conditions_are_normalized_only_when_seeding():
    doc = draft.load_loro_draft(None, {"nodes": [{"id": "if", "data": {"type": "if-else", "conditions": []}}]})
    assert doc.get_map("nodes").get_deep_value()["if"]["data"]["cases"] == [
        {"case_id": "true", "logical_operator": "and", "conditions": []}
    ]


def test_malformed_update_and_schema_are_rejected():
    doc = draft.load_loro_draft(None, {})
    with pytest.raises(draft.LoroDraftUpdateError):
        draft.merge_loro_update(doc, b"broken")
    doc.get_map("graph").insert("schema_version", 1)
    with pytest.raises(draft.LoroDraftUpdateError):
        draft.project_loro_graph(doc)
