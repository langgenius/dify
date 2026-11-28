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
