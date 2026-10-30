"""Metadata uses native App/draft representations and preserves user content."""

import json
from typing import cast

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from core.dify_builder.models import Graph
from models.base import Base
from models.model import App, AppMode
from services.dify_builder.agent.graph_translate import to_intents
from services.dify_builder.graph_ops import apply_create_node, filter_applicable
from services.dify_builder.preflight import preflight_errors, vet_intents
from services.dify_builder.revision import executable_graph_revision
from services.workflow_generation.runner import WorkflowGenerator
from tests.helpers.unit.model_factories import make_app


def test_description_from_approved_plan_preserves_user_name_and_existing_description() -> None:
    from services.dify_builder.app_metadata import NativeAppMetadata

    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    with factory.begin() as sql:
        sql.add(make_app(app_id="app", tenant_id="tenant", mode=AppMode.WORKFLOW, name="用户的名称"))
    adapter = NativeAppMetadata(factory)
    assert (
        adapter.describe_empty_app(app_id="app", tenant_id="tenant", account_id="account", description="处理订单。")
        == "处理订单。"
    )
    assert (
        adapter.describe_empty_app(app_id="app", tenant_id="tenant", account_id="account", description="Changed")
        == "处理订单。"
    )
    with factory() as sql:
        app = sql.get(App, "app")
        assert app is not None
        assert (app.name, app.description) == ("用户的名称", "处理订单。")
    assert (
        adapter.describe_empty_app(app_id="app", tenant_id="other", account_id="account", description="Foreign") == ""
    )
    engine.dispose()


def test_generated_simple_note_uses_native_editor_json_and_has_no_execution_identity() -> None:
    graph = {
        "nodes": [{"id": "start", "data": {"type": "start"}}, {"id": "end", "data": {"type": "end"}}],
        "edges": [{"source": "start", "target": "end"}],
    }
    note_graph = {"nodes": [{"id": "note", "type": "custom-note", "data": {"type": "", "text": "流程说明"}}]}
    intents = to_intents(note_graph)
    assert len(intents) == 1
    note = intents[0]
    updated, _ = apply_create_node(graph, **note.args)
    node = updated["nodes"][-1]
    assert node["type"] == "custom-note"
    assert json.loads(node["data"]["text"])["root"]["children"][0]["children"][0]["text"] == "流程说明"
    assert executable_graph_revision(updated) == executable_graph_revision(graph)


def test_simple_note_budget_is_enforced_by_existing_mutation_owner() -> None:
    with pytest.raises(ValueError, match="2000"):
        apply_create_node({"nodes": [], "edges": []}, "", {"text": "a" * 2001}, flow_type="custom-note")


def test_planned_canvas_note_survives_generator_translation_and_native_candidate_validation() -> None:
    planned = [
        {"id": "start", "node_type": "start", "label": "Start"},
        {"id": "code", "node_type": "code", "label": "Uppercase"},
        {"id": "end", "node_type": "end", "label": "End"},
        {"id": "note1", "node_type": "custom-note", "label": "Demo Note"},
    ]
    configs = {
        "start": {
            "variables": [{"variable": "input_text", "label": "Input text", "type": "text-input", "required": True}]
        },
        "code": {
            "code_language": "python3",
            "code": "def main(input_text: str) -> dict:\n    return {'uppercase_text': input_text.upper()}",
            "variables": [{"variable": "input_text", "value_selector": ["start", "input_text"]}],
            "outputs": {"uppercase_text": {"type": "string", "children": None}},
        },
        "end": {"outputs": [{"variable": "uppercase_text", "value_selector": ["code", "uppercase_text"]}]},
        "note1": {"text": "Synthetic uppercase demonstration: LOCAL1188_TEXT_V1", "theme": "blue"},
    }
    generated = WorkflowGenerator._assemble_parallel_graph(
        plan_nodes=planned,
        plan_edges=[{"source": "start", "target": "code"}, {"source": "code", "target": "end"}],
        configs_by_id=configs,
        existing_by_id={},
    )
    generated = WorkflowGenerator._postprocess_graph(graph=generated, mode="workflow")
    intents = to_intents(cast(Graph, generated))
    candidate = vet_intents({"nodes": [], "edges": []}, intents, {"start", "code", "end"})
    assert candidate.rejections == []
    assert len(candidate.applicable) == 6
    note_intent = next(intent for intent in intents if intent.args.get("node_id") == "note1")
    assert note_intent.args["node_type"] == ""
    assert note_intent.args["flow_type"] == "custom-note"
    applied = filter_applicable({"nodes": [], "edges": []}, candidate.applicable, {"start", "code", "end"}).graph
    assert preflight_errors(applied) == []
    nodes = {node["id"]: node for node in applied["nodes"]}
    note = nodes["note1"]
    assert note["type"] == "custom-note"
    assert note["data"]["type"] == ""
    assert json.loads(note["data"]["text"])["root"]["children"][0]["children"][0]["text"] == configs["note1"]["text"]
    assert nodes["code"]["data"]["outputs"] == {"uppercase_text": {"type": "string", "children": None}}
    assert nodes["end"]["data"]["outputs"][0]["value_selector"] == ["code", "uppercase_text"]
    assert all("note1" not in (edge["source"], edge["target"]) for edge in applied["edges"])
    without_note = {**applied, "nodes": [node for node in applied["nodes"] if node["id"] != "note1"]}
    assert executable_graph_revision(applied) == executable_graph_revision(without_note)


def test_generator_does_not_treat_note_like_executable_types_as_canvas_annotations() -> None:
    generated = WorkflowGenerator._assemble_parallel_graph(
        plan_nodes=[{"id": "unsupported", "node_type": "custom-note-code"}],
        plan_edges=[],
        configs_by_id={"unsupported": {"code": "unapproved executable configuration"}},
        existing_by_id={},
    )
    generated = WorkflowGenerator._postprocess_graph(graph=generated, mode="workflow")
    candidate = vet_intents({"nodes": [], "edges": []}, to_intents(cast(Graph, generated)), {"start", "code", "end"})
    assert candidate.applicable == []
    assert any("node_type not allowed" in reason for reason in candidate.rejections)
