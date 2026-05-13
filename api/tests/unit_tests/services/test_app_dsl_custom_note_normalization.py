from services.app_dsl_service import normalize_workflow_custom_notes_hide_author


def test_normalize_custom_notes_sets_show_author_false() -> None:
    graph = {
        "nodes": [
            {"id": "n1", "type": "custom-note", "data": {"text": "hi", "showAuthor": True}},
            {"id": "n2", "type": "start", "data": {"type": "start"}},
        ],
        "edges": [],
    }
    normalize_workflow_custom_notes_hide_author(graph)
    assert graph["nodes"][0]["data"]["showAuthor"] is False


def test_normalize_custom_notes_creates_data_when_absent() -> None:
    graph = {"nodes": [{"id": "n1", "type": "custom-note"}]}
    normalize_workflow_custom_notes_hide_author(graph)
    assert graph["nodes"][0]["data"]["showAuthor"] is False


def test_normalize_ignores_other_node_types() -> None:
    graph = {"nodes": [{"id": "n1", "type": "custom", "data": {"type": "llm"}}]}
    normalize_workflow_custom_notes_hide_author(graph)
    assert "showAuthor" not in graph["nodes"][0]["data"]
