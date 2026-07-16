"""Tests for the backend KnowledgeFS contract projection."""

from dev.generate_knowledge_fs_contract import render_routes


def test_render_routes_keeps_literal_paths_before_overlapping_parameters() -> None:
    document = {
        "paths": {
            "/items/{id}": {"delete": operation("knowledge-spaces:write")},
            "/items/bulk": {"delete": operation("knowledge-spaces:write")},
        }
    }

    rendered = render_routes(document)

    assert rendered.index('"items/bulk"') < rendered.index('"items/{id}"')
    assert "Final[tuple[ContractOperation, ...]]" in rendered


def test_render_routes_preserves_transport_metadata() -> None:
    route = operation("knowledge-spaces:read")
    route["parameters"] = [{"in": "header", "name": "Last-Event-ID"}]
    route["responses"] = {
        "200": {
            "content": {"text/event-stream": {}},
            "headers": {"Cache-Control": {}},
        }
    }
    document = {"paths": {"/events": {"get": route}}}

    rendered = render_routes(document)

    assert '"stream"' in rendered
    assert '"last-event-id"' in rendered
    assert '"cache-control"' in rendered
    assert '"text/event-stream"' in rendered


def operation(scope: str) -> dict[str, object]:
    return {
        "responses": {"200": {"content": {"application/json": {}}}},
        "x-knowledge-fs-max-response-bytes": 1_048_576,
        "x-knowledge-fs-required-scope": scope,
    }
