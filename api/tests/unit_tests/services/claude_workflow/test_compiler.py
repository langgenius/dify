from __future__ import annotations

from pathlib import Path

import yaml

from services.claude_workflow.compiler import compile_claude_workflow_to_dify_dsl
from services.claude_workflow.schema import parse_claude_workflow_document


FIXTURES_DIR = Path(__file__).resolve().parents[3] / "fixtures" / "claude_workflow"


def _compile_fixture(name: str) -> dict:
    raw_document = yaml.safe_load((FIXTURES_DIR / name).read_text(encoding="utf-8"))
    document = parse_claude_workflow_document(raw_document)
    return yaml.safe_load(compile_claude_workflow_to_dify_dsl(document))


def _find_node(graph: dict, node_id: str) -> dict:
    return next(node for node in graph["nodes"] if node["id"] == node_id)


def test_compile_claude_workflow_to_dify_dsl_builds_linear_graph() -> None:
    compiled = _compile_fixture("basic_llm.yml")
    graph = compiled["workflow"]["graph"]

    assert compiled["kind"] == "app"
    assert compiled["app"]["mode"] == "workflow"
    assert [node["id"] for node in graph["nodes"]] == ["start", "summarize", "done"]
    assert [edge["source"] for edge in graph["edges"]] == ["start", "summarize"]

    llm_node = _find_node(graph, "summarize")
    assert llm_node["data"]["type"] == "llm"
    assert llm_node["data"]["prompt_template"][1]["text"] == "{{#start.query#}}"


def test_compile_claude_workflow_to_dify_dsl_builds_if_else_cases_and_branch_edges() -> None:
    compiled = _compile_fixture("branching.yml")
    graph = compiled["workflow"]["graph"]

    route_node = _find_node(graph, "route")
    assert route_node["data"]["type"] == "if-else"
    assert route_node["data"]["cases"][0]["case_id"] == "true"
    assert route_node["data"]["cases"][0]["conditions"][0]["variable_selector"] == ["start", "query"]

    true_edge = next(edge for edge in graph["edges"] if edge["sourceHandle"] == "true")
    false_edge = next(edge for edge in graph["edges"] if edge["sourceHandle"] == "false")
    assert true_edge["source"] == "route"
    assert true_edge["target"] == "true_end"
    assert false_edge["source"] == "route"
    assert false_edge["target"] == "false_end"


def test_compile_claude_workflow_to_dify_dsl_preserves_http_and_code_identifiers() -> None:
    compiled = _compile_fixture("http_request.yml")
    graph = compiled["workflow"]["graph"]

    request_node = _find_node(graph, "fetch")
    code_node = _find_node(graph, "transform")
    end_node = _find_node(graph, "done")

    assert request_node["data"]["type"] == "http-request"
    assert request_node["data"]["url"] == "{{#start.url#}}"
    assert code_node["data"]["type"] == "code"
    assert code_node["data"]["code_language"] == "python3"
    assert code_node["data"]["variables"][0]["value_selector"] == ["fetch", "body"]
    assert end_node["data"]["outputs"][0]["value_selector"] == ["fetch", "status_code"]
    assert end_node["data"]["outputs"][1]["value_selector"] == ["transform", "result"]
