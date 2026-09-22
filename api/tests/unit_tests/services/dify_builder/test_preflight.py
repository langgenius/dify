"""``preflight_errors``: the dry ``Graph.init`` a draft is put through before
it is written or run. Exercised on the REAL ESQ1-303 dev draft (app 0f11bedc,
dumped from dev on 2026-09-21), which the engine refused to start."""

import copy
import json
from pathlib import Path

from services.dify_builder.preflight import preflight_errors

_FIXTURES = Path(__file__).parent / "fixtures"


def _esq1_303_draft() -> dict:
    return json.loads((_FIXTURES / "esq1_303_draft_graph.json").read_text(encoding="utf-8"))


def test_the_esq1_303_dev_draft_would_not_start_and_the_error_names_the_node():
    errors = preflight_errors(_esq1_303_draft())

    assert len(errors) == 1
    assert errors[0].startswith("node 'node2' (if-else): ")
    assert "Input should be a valid string" in errors[0]  # value 60 is a JSON number


def test_the_same_draft_passes_once_the_value_is_a_string():
    graph = _esq1_303_draft()
    node2 = next(n for n in graph["nodes"] if n["id"] == "node2")
    node2["data"]["cases"][0]["conditions"][0]["value"] = "60"

    assert preflight_errors(graph) == []


def test_every_broken_node_is_reported_not_only_the_first():
    graph = _esq1_303_draft()
    broken_twice = copy.deepcopy(next(n for n in graph["nodes"] if n["id"] == "node2"))
    broken_twice["id"] = "node2b"
    graph["nodes"].append(broken_twice)

    errors = preflight_errors(graph)

    assert [e.split(" ")[1] for e in errors] == ["'node2'", "'node2b'"]


def test_note_widgets_are_skipped_exactly_like_graph_init_skips_them():
    graph = {
        "nodes": [
            {"id": "note", "type": "custom-note", "data": {"type": "", "text": "remember"}},
            {"id": "s", "type": "custom", "data": {"type": "start", "title": "Start", "variables": []}},
        ],
        "edges": [],
    }

    assert preflight_errors(graph) == []


def test_an_empty_or_shapeless_graph_has_nothing_to_report():
    assert preflight_errors({}) == []
    assert preflight_errors({"nodes": [None, "junk"], "edges": []}) == []
