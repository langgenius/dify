"""Canned Edit cognition on PlaceholderAgent (Slice 3)."""

from core.dify_builder.models import Graph
from core.dify_builder.placeholder_agent import PlaceholderAgent
from core.dify_builder.ports import DifyBuilderAgent


def _graph_with_llm() -> Graph:
    return {
        "nodes": [{"id": "knowledge_retrieval", "data": {}}, {"id": "llm", "data": {}}],
        "edges": [],
    }


def test_analyze_impact_returns_fields_values_and_targets_from_graph() -> None:
    agent = PlaceholderAgent()
    out = agent.analyze_impact("tighten risk handling", _graph_with_llm())
    expected_keys = {"risk_threshold", "review_team", "timeout_behavior", "preserve_summary"}
    assert {f["key"] for f in out["fields"]} == expected_keys
    assert set(out["values"]) == expected_keys
    assert "llm" in out["target_node_ids"]


def test_propose_edit_plan_returns_nonempty_items() -> None:
    agent = PlaceholderAgent()
    assert agent.propose_edit_plan({"risk_threshold": "high"}, _graph_with_llm())


def test_build_edit_intents_targets_existing_llm_node_with_set_node_config() -> None:
    agent = PlaceholderAgent()
    intents = agent.build_edit_intents({"risk_threshold": "high", "timeout_behavior": "fail_closed"}, _graph_with_llm())
    assert intents
    assert all(i.op == "set_node_config" for i in intents)
    assert all(i.args["node_id"] == "llm" for i in intents)
    # the submitted rule values flow into the intents
    values = {i.args["path"]: i.args["value"] for i in intents}
    assert values["risk_threshold"] == "high"


def test_placeholder_agent_still_satisfies_dify_builder_agent_protocol() -> None:
    assert isinstance(PlaceholderAgent(), DifyBuilderAgent)
