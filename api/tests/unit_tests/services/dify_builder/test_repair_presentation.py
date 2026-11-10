"""Repair replies describe evidence without turning intentions into applied facts."""

import re
from copy import deepcopy

import pytest

from core.dify_builder.models import ApplyResult, ChangedNode, Diagnosis, Graph, MutationIntent, Risk
from services.dify_builder.credentials import REDACTED
from services.dify_builder.repair_presentation import applied_repair_summary, repair_proposal


def test_proposal_groups_fields_and_bindings_with_business_titles() -> None:
    graph: Graph = {
        "nodes": [
            {"id": "parse", "data": {"title": "Parse releases", "type": "code"}},
            {"id": "fetch", "data": {"title": "Fetch releases", "type": "http-request"}},
        ]
    }
    intents = [
        MutationIntent(op="set_node_config", args={"node_id": "parse", "path": path, "value": value})
        for path, value in [
            ("code", "private code literal"),
            ("outputs", {"items": {"type": "array"}}),
            ("variables", [{"variable": "body", "value_selector": ["fetch", "body"]}]),
        ]
    ]
    original = deepcopy((graph, intents))
    text = repair_proposal(
        graph,
        intents,
        Diagnosis(root_cause="Response is an object"),
        Risk(level="high", reason="Read the releases collection before iteration"),
        "en-US",
    )
    assert text.count("- Parse releases:") == 1
    assert "code" in text
    assert "outputs" in text
    assert "variables" in text
    assert "Fetch releases" in text
    assert "body" in text
    assert "Response is an object" in text
    assert "Read the releases collection" in text
    assert "new Test Run" in text
    assert "not" in text
    assert "private code literal" not in text
    assert (graph, intents) == original


def test_applied_uses_only_result_diff_even_when_proposal_was_larger() -> None:
    graph: Graph = {"nodes": [{"id": "n", "data": {"title": "Old name", "type": "code"}}]}
    result = ApplyResult(
        changed_nodes=["n"], nodes=[ChangedNode(node_id="n", title="New name")], changes=["n: title", "n: outputs"]
    )
    text = applied_repair_summary(result, graph, "en-US")
    assert text.count("- New name:") == 1
    assert "title" in text
    assert "outputs" in text
    assert "code" not in text
    assert "new Test Run" in text
    assert result.changes == ["n: title", "n: outputs"]


def test_noop_and_unknown_result_do_not_claim_repairs_applied() -> None:
    assert "No changes" in applied_repair_summary(ApplyResult(), {}, "en")
    text = applied_repair_summary(ApplyResult(changes=["unrecognized arbitrary code secret"]), {}, "en")
    assert "unrecognized arbitrary code secret" not in text
    assert "No changes" in text


def test_native_fallback_connections_delete_and_chinese() -> None:
    graph: Graph = {
        "nodes": [
            {"id": "n", "data": {"title": "n", "type": "code"}},
            {"id": "end", "data": {"title": "发送结果", "type": "end"}},
        ]
    }
    text = applied_repair_summary(ApplyResult(changes=["n: code", "＋ n → end", "− end"]), graph, "zh-CN")
    assert "代码" in text
    assert "发送结果" in text
    assert "连接" in text
    assert "删除" in text
    assert "新" in text
    assert "测试" in text


def test_sensitive_nested_values_hostile_markdown_and_bounds() -> None:
    graph: Graph = {
        "nodes": [
            {
                "id": "n",
                "data": {
                    "title": "[Click](https://host/private)\n# TokenSecret1392",
                    "type": "code",
                    "nested": {"headers": {"Authorization": "Bearer TokenSecret1392"}},
                },
            }
        ]
    }
    intents = [
        MutationIntent(
            op="set_node_config",
            args={"node_id": "n", "path": "headers", "value": {"nested": {"api_key": "NestedSecret1392"}}},
        )
    ] * 100
    text = repair_proposal(
        graph,
        intents,
        Diagnosis(root_cause="TokenSecret1392"),
        Risk(reason="NestedSecret1392 https://host/private", level="high"),
        "en",
    )
    visible = _visible_text(text)
    assert "TokenSecret1392" not in visible
    assert "NestedSecret1392" not in visible
    assert f"Cause: {REDACTED}" in visible
    assert f"Rationale and risk: {REDACTED}" in visible
    assert "https://" not in text
    assert "\n#" not in text
    assert "[Click](" not in text
    assert len(text) < 6000


def test_unknown_node_uses_id_without_inventing_a_title() -> None:
    text = repair_proposal(
        {}, [MutationIntent(op="delete_node", args={"node_id": "unknown"})], Diagnosis(), Risk(), "en"
    )
    assert "unknown" in text
    assert "Delete" in text


def test_proposal_bounds_many_distinct_nodes_fields_and_binding_selectors() -> None:
    graph: Graph = {"nodes": [{"id": f"node{i}", "data": {"title": "[" * 100, "type": "code"}} for i in range(20)]}
    intents = [
        MutationIntent(
            op="set_node_config",
            args={
                "node_id": f"node{i}",
                "path": "variables." + "x" * 120 + str(j),
                "value": [{"value_selector": ["a" * 100, "x" * 100]}] * 4,
            },
        )
        for i in range(20)
        for j in range(20)
    ]
    text = repair_proposal(graph, intents, Diagnosis(root_cause="x" * 2000), Risk(reason="x" * 2000), "en")
    assert len(text) < 6000
    assert "new Test Run" in text
    assert "omitted" in text


def test_rationale_cannot_echo_opaque_code_or_payloads() -> None:
    graph: Graph = {
        "nodes": [
            {
                "id": "n",
                "data": {"type": "code", "code": "OriginalCode1392", "outputs": {"body": "OutputPayload1392"}},
            }
        ]
    }
    intent = MutationIntent(op="set_node_config", args={"node_id": "n", "path": "code", "value": "ProposedCode1392"})
    text = repair_proposal(
        graph,
        [intent],
        Diagnosis(root_cause="OriginalCode1392 OutputPayload1392"),
        Risk(reason="ProposedCode1392"),
        "en",
    )
    visible = _visible_text(text)
    assert "OriginalCode1392" not in visible
    assert "ProposedCode1392" not in visible
    assert "OutputPayload1392" not in visible
    assert f"Cause: {REDACTED} {REDACTED}" in visible
    assert f"Rationale and risk: {REDACTED}" in visible


def test_direct_selector_and_output_schema_explain_bound_field_names() -> None:
    graph: Graph = {"nodes": [{"id": "fetch", "data": {"title": "Fetch releases", "type": "http-request"}}]}
    intents = [
        MutationIntent(
            op="set_node_config", args={"node_id": "parse", "path": "value_selector", "value": ["fetch", "body"]}
        ),
        MutationIntent(
            op="set_node_config", args={"node_id": "parse", "path": "outputs", "value": {"releases": {"type": "array"}}}
        ),
    ]
    text = repair_proposal(graph, intents, Diagnosis(), Risk(), "en")
    assert "Fetch releases" in text
    assert "body" in text
    assert "releases" in text


def test_multiple_new_nodes_without_ids_keep_separate_native_groups() -> None:
    intents = [
        MutationIntent(op="create_node", args={"node_type": "code", "config": {}}),
        MutationIntent(op="create_node", args={"node_type": "end", "config": {}}),
    ]
    text = repair_proposal({}, intents, Diagnosis(), Risk(), "en")
    assert "- Code:" in text
    assert "- End:" in text


def test_blank_result_title_does_not_replace_native_fallback() -> None:
    graph: Graph = {"nodes": [{"id": "n", "data": {"type": "code"}}]}
    text = applied_repair_summary(
        ApplyResult(changes=["n: code"], nodes=[ChangedNode(node_id="n", title="  ")]), graph, "en"
    )
    assert "- Code:" in text


def test_sensitive_url_schemes_are_case_insensitive() -> None:
    text = repair_proposal(
        {},
        [MutationIntent(op="delete_node", args={"node_id": "n"})],
        Diagnosis(root_cause="HTTPS://private.invalid/path"),
        Risk(),
        "en",
    )
    assert "private" not in text


def _visible_text(markdown: str) -> str:
    """Undo Markdown character escaping so it cannot masquerade as redaction."""
    return re.sub(r"\\(.)", r"\1", markdown)


@pytest.mark.parametrize(
    "path", ["authorization.config.api_key", "outputs.body", "prompt_template.0.text", "headers.0.value"]
)
@pytest.mark.parametrize("language", ["en", "zh-CN"])
def test_dotted_private_proposal_values_are_redacted_without_hiding_field_and_selector_names(
    path: str, language: str
) -> None:
    graph: Graph = {
        "nodes": [
            {"id": "fetch", "data": {"title": "Fetch releases", "type": "http-request"}},
            {"id": "parse", "data": {"title": "Parse releases", "type": "code"}},
        ]
    }
    intents = [
        MutationIntent(op="set_node_config", args={"node_id": "parse", "path": path, "value": "ProposedLiteral1392"}),
        MutationIntent(
            op="set_node_config",
            args={"node_id": "parse", "path": "variables.0.value_selector", "value": ["fetch", "body"]},
        ),
        MutationIntent(
            op="set_node_config", args={"node_id": "parse", "path": "outputs", "value": {"releases": {"type": "array"}}}
        ),
    ]
    original = deepcopy((graph, intents))
    text = repair_proposal(
        graph,
        intents,
        Diagnosis(root_cause="ProposedLiteral1392"),
        Risk(reason="Replace ProposedLiteral1392"),
        language,
    )
    visible = _visible_text(text)
    assert "ProposedLiteral1392" not in visible
    assert visible.count(REDACTED) >= 2
    assert path in visible
    assert "Fetch releases" in visible
    assert "body" in visible
    assert "releases" in visible
    assert (graph, intents) == original


@pytest.mark.parametrize("reuse", [False, True])
@pytest.mark.parametrize("language", ["en", "zh-CN"])
def test_insertion_names_authoritative_node_and_original_edge_endpoints(reuse: bool, language: str) -> None:
    graph: Graph = {
        "nodes": [
            {"id": "fetch", "data": {"title": "Fetch releases", "type": "http-request"}},
            {"id": "parse", "data": {"title": "Parse releases", "type": "code"}},
            {"id": "end", "data": {"title": "Present summary", "type": "end"}},
        ],
        "edges": [{"source": "fetch", "target": "end"}],
    }
    intent = MutationIntent(
        op="insert_between",
        args={
            "edge": {"source": "fetch", "target": "end"},
            "node_type": "code",
            "node_id": "parse" if reuse else "newparse",
            "reuse_existing": reuse,
            "config": {} if reuse else {"title": "New parser"},
        },
    )
    original = deepcopy((graph, intent))
    text = repair_proposal(graph, [intent], Diagnosis(), Risk(), language)
    assert ("- Parse releases:" if reuse else "- New parser:") in text
    assert "Fetch releases" in text
    assert "Present summary" in text
    assert (graph, intent) == original
