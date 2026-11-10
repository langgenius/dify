"""FakeEditDifyPort: pre-seeded graph fake for Edit handler tests (Slice 3)."""

from core.dify_builder.models import Actor, MutationIntent
from tests.unit_tests.core.dify_builder.fakes import FakeEditDifyPort


def _actor() -> Actor:
    return Actor(account_id="a", tenant_id="t")


def test_set_node_config_edits_existing_node_and_reports_real_diff() -> None:
    dify = FakeEditDifyPort()
    intents = [MutationIntent(op="set_node_config", args={"node_id": "llm", "path": "risk_threshold", "value": "high"})]
    result = dify.apply_repair("app", _actor(), intents, on_canvas=None)
    assert result.changed_nodes == ["llm"]
    assert any("llm" in c and "risk_threshold" in c for c in result.changes)
    assert result.scope == "configuration"
    graph, _hash = dify.read_graph("app", _actor())
    llm = next(n for n in graph["nodes"] if n["id"] == "llm")
    assert llm["data"]["risk_threshold"] == "high"
