"""Unit tests for WorkflowCopilotService pure helpers.

``generate`` needs a real model + DB session (integration-level), but
``_build_focus_context`` is pure: it resolves pinned node ids to their full
structure from the live graph for the generator-only instruction. These tests
pin that contract so the fix for "context leaked a bare id into the persisted
message" doesn't regress — the focus block must carry the WHOLE node structure
and must never be produced for empty inputs.
"""

import json

from services.workflow_copilot_service import WorkflowCopilotService


def _graph() -> dict[str, object]:
    return {
        "nodes": [
            {"id": "node1", "data": {"type": "start", "title": "Start"}},
            {
                "id": "node2",
                "data": {"type": "llm", "title": "Answer", "prompt_template": [{"role": "user", "text": "hi"}]},
            },
            {"id": "node3", "data": {"type": "end", "title": "End"}},
        ],
        "edges": [
            {"id": "e1", "source": "node1", "target": "node2"},
            {"id": "e2", "source": "node2", "target": "node3"},
        ],
    }


def test_focus_context_empty_without_ids() -> None:
    assert WorkflowCopilotService._build_focus_context(_graph(), []) == ""


def test_focus_context_empty_without_graph() -> None:
    assert WorkflowCopilotService._build_focus_context(None, ["node2"]) == ""


def test_focus_context_empty_when_id_absent_from_graph() -> None:
    assert WorkflowCopilotService._build_focus_context(_graph(), ["ghost"]) == ""


def test_focus_context_embeds_full_node_structure_not_bare_id() -> None:
    text = WorkflowCopilotService._build_focus_context(_graph(), ["node2"])

    # The block must carry the node's FULL structure, not just "id=node2".
    assert "node2" in text
    assert "prompt_template" in text
    assert "Answer" in text
    # The instruction must tell the LLM to match by id and preserve others.
    assert "id" in text
    # And it must be valid JSON we can parse back out of the block.
    payload = json.loads(text.split("\n")[-1])
    assert [n["id"] for n in payload["nodes"]] == ["node2"]


def test_focus_context_includes_incident_edges() -> None:
    text = WorkflowCopilotService._build_focus_context(_graph(), ["node2"])
    payload = json.loads(text.split("\n")[-1])
    # Both edges touch node2, so both are surfaced for wiring context.
    edge_ids = {e["id"] for e in payload["edges"]}
    assert edge_ids == {"e1", "e2"}


def test_focus_context_multiple_nodes() -> None:
    text = WorkflowCopilotService._build_focus_context(_graph(), ["node1", "node3"])
    payload = json.loads(text.split("\n")[-1])
    assert {n["id"] for n in payload["nodes"]} == {"node1", "node3"}
