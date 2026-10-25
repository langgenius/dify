"""Build completion displays node names while preserving technical evidence."""

from copy import deepcopy

import pytest

from core.dify_builder.models import ApplyResult, ChangedNode, Graph, MutationIntent
from services.dify_builder.build_presentation import build_node_summary


def test_summary_uses_actual_titles_without_mutating_technical_evidence() -> None:
    result = ApplyResult(
        changed_nodes=["node1", "node2", "node1"],
        nodes=[ChangedNode(node_id="node1", title="Extract invoices"), ChangedNode(node_id="node2", title="提取金额")],
        changes=["＋ node1", "＋ node1 → node2", "node2: prompt_template"],
    )
    before: Graph = {"nodes": [{"id": "node1", "data": {"title": "Old title", "type": "code"}}], "edges": []}
    intents = [MutationIntent(op="create_node", args={"node_id": "node2", "node_type": "llm"})]
    original = deepcopy((result, before, intents))

    assert build_node_summary(result, before, intents, "en-US") == "- Affected nodes: Extract invoices, 提取金额"
    assert (result, before, intents) == original


@pytest.mark.parametrize("title", [None, {}, [], 42, "", "  ", "node1", " node1 "])
def test_missing_or_internal_titles_use_native_type(title: object) -> None:
    node = ChangedNode(node_id="node1")
    node.__dict__["title"] = title
    result = ApplyResult(changed_nodes=["node1"], nodes=[node])
    intents = [MutationIntent(op="create_node", args={"node_id": "node1", "node_type": "parameter-extractor"})]

    assert build_node_summary(result, {}, intents, "zh-Hans") == "- 涉及节点：参数提取器"


def test_removed_and_existing_nodes_use_before_graph_native_types() -> None:
    result = ApplyResult(changed_nodes=["old", "existing", "unknown"])
    before = {
        "nodes": [
            {"id": "old", "type": "custom", "data": {"type": "start"}},
            {"id": "existing", "data": {"type": "http-request"}},
        ]
    }

    assert build_node_summary(result, before, [], "en-US") == "- Affected nodes: Start, HTTP Request, Node"


def test_duplicate_titles_preserve_distinct_changed_identities() -> None:
    result = ApplyResult(
        changed_nodes=["node1", "node2", "node1"],
        nodes=[ChangedNode(node_id="node1", title="Review"), ChangedNode(node_id="node2", title="Review")],
    )

    assert build_node_summary(result, {}, [], "en-US") == "- Affected nodes: Review, Review"


def test_summary_bounds_long_multiline_markdown_titles_and_many_nodes() -> None:
    result = ApplyResult(
        nodes=[
            ChangedNode(node_id=f"node{i}", title="[Review](https://example.com)\n# " + "x" * 200) for i in range(20)
        ]
    )

    summary = build_node_summary(result, {}, [], "en-US")

    assert summary.startswith(r"- Affected nodes: \[Review\]\(https://example\.com\) \# ")
    assert summary.count("\n") == 0
    assert summary.count("Review") == 8
    assert summary.endswith("(+12 more)")
    assert len(summary) < 1000
    assert "node0" not in summary


@pytest.mark.parametrize(
    ("language", "expected"), [("en-US", "- No additional node changes."), ("zh-CN", "- 没有新增的节点变更。")]
)
def test_noop_does_not_claim_proposed_creates_were_applied(language: str, expected: str) -> None:
    intents = [MutationIntent(op="create_node", args={"node_id": "node1", "node_type": "code"})]

    assert build_node_summary(ApplyResult(), {}, intents, language) == expected


@pytest.mark.parametrize("node_type", [None, [], "node1", "not-a-native-type"])
def test_unknown_native_type_uses_generic_label(node_type: object) -> None:
    before = {"nodes": [{"id": "node1", "data": {"type": node_type}}]}

    assert build_node_summary(ApplyResult(changed_nodes=["node1"]), before, [], "fr-FR") == "- Affected nodes: Node"
