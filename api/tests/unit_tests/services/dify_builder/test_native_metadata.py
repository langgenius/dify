"""Metadata uses native App/draft representations and preserves user content."""

import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from models.base import Base
from models.model import App, AppMode
from services.dify_builder.agent.graph_translate import to_intents
from services.dify_builder.graph_ops import apply_create_node
from services.dify_builder.revision import executable_graph_revision
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
